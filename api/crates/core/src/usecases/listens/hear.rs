//! The transcribe step's coverage loop ([`coverage`](crate::domain::listen::coverage)): a first
//! pass that keeps speakers (a clip's ingest transcript, or one pass over the whole WAV), then a window pass cut at pauses, where a window that came back far
//! too sparse is split at a pause and heard again (up to twice), keeping whichever heard more.
//! The window lines win only when they hold clearly more speech than the full pass.

use std::path::Path;

use crate::domain::listen::coverage::{
    MAX_SPLIT_DEPTH, density, median, plan_windows, sparse, speech_seconds, split_at, text_units,
    windows_heard_more,
};
use crate::domain::listen::{HeardBy, ListenTurn};
use crate::domain::segmenting::Span;
use crate::domain::transcript::{RawTurn, Turn, clip_turns};
use crate::error::AppError;
use crate::usecases::transcribe::chunked_turns;

use super::ListenPorts;

/// Seconds to whole milliseconds; turn times are far below 2^52 ms.
pub(super) fn ms(seconds: f64) -> u64 {
    (seconds.max(0.0) * 1000.0).round() as u64
}

/// Transcript turns as listen lines.
pub(super) fn heard(turns: &[Turn]) -> Vec<ListenTurn> {
    turns
        .iter()
        .map(|t| {
            let span = (ms(t.span.start_s), ms(t.span.end_s));
            ListenTurn::heard(t.turn_no, span, t.speaker_label.clone(), &t.text)
        })
        .collect()
}

/// The lines of a recording and which pass they came from.
pub(super) struct Heard {
    /// In time order.
    pub lines: Vec<ListenTurn>,
    /// The full pass or the window pass.
    pub by: HeardBy,
}

/// One window heard: its span, its turns (times from the window start) and whether a split was
/// already tried.
struct Piece {
    span: Span,
    turns: Vec<RawTurn>,
    tried: bool,
}

impl Piece {
    fn units(&self) -> f64 {
        self.turns.iter().map(|t| text_units(&t.text)).sum()
    }
}

/// Where the window pass works: the WAV, its pauses, the working directory.
struct Windows<'a> {
    p: &'a ListenPorts,
    wav: &'a Path,
    silences: &'a [Span],
    dir: &'a Path,
}

impl Windows<'_> {
    /// Each span cut out of the WAV and transcribed (a few at once), in order.
    async fn hear(&self, spans: &[Span]) -> Result<Vec<Piece>, AppError> {
        let mut files = Vec::with_capacity(spans.len());
        for s in spans {
            let file = self
                .dir
                .join(format!("win_{}_{}.wav", ms(s.start_s), ms(s.end_s)));
            self.p.media.extract_wav(self.wav, *s, &file).await?;
            files.push(file);
        }
        let heard = self.p.transcriber.transcribe_all(&files).await?;
        Ok(spans
            .iter()
            .zip(heard)
            .map(|(span, turns)| Piece {
                span: *span,
                turns,
                tried: false,
            })
            .collect())
    }

    fn density(&self, piece: &Piece) -> f64 {
        density(piece.units(), speech_seconds(piece.span, self.silences))
    }

    /// One round: every sparse window not tried yet is split at a pause and both halves heard;
    /// the halves replace it when together they heard more.
    async fn split_round(&self, mut pieces: Vec<Piece>, med: f64) -> Result<Vec<Piece>, AppError> {
        let mut halves = Vec::new();
        let mut split = Vec::new();
        for (i, piece) in pieces.iter_mut().enumerate() {
            if piece.tried || !sparse(piece.span, self.density(piece), med) {
                continue;
            }
            piece.tried = true;
            if let Some(at) = split_at(piece.span, self.silences) {
                halves.push(Span {
                    start_s: piece.span.start_s,
                    end_s: at,
                });
                halves.push(Span {
                    start_s: at,
                    end_s: piece.span.end_s,
                });
                split.push(i);
            }
        }
        if split.is_empty() {
            return Ok(pieces);
        }
        let mut heard = self.hear(&halves).await?.into_iter();
        let mut out = Vec::with_capacity(pieces.len() + split.len());
        for (i, piece) in pieces.into_iter().enumerate() {
            if !split.contains(&i) {
                out.push(piece);
                continue;
            }
            let pair: Vec<Piece> = heard.by_ref().take(2).collect();
            if pair.iter().map(Piece::units).sum::<f64>() > piece.units() {
                out.extend(pair);
            } else {
                out.push(piece);
            }
        }
        Ok(out)
    }

    /// The windows heard, sparse ones split up to [`MAX_SPLIT_DEPTH`] times.
    async fn pass(&self, duration_s: f64) -> Result<Vec<Piece>, AppError> {
        let mut pieces = self.hear(&plan_windows(duration_s, self.silences)).await?;
        let densities: Vec<f64> = pieces.iter().map(|x| self.density(x)).collect();
        let med = median(&densities);
        for _ in 0..MAX_SPLIT_DEPTH {
            pieces = self.split_round(pieces, med).await?;
        }
        Ok(pieces)
    }
}

/// The window lines on the recording's timeline, without speakers.
fn window_lines(pieces: &[Piece]) -> Vec<ListenTurn> {
    let spans: Vec<Span> = pieces.iter().map(|x| x.span).collect();
    let per: Vec<Vec<RawTurn>> = pieces.iter().map(|x| x.turns.clone()).collect();
    let mut turns = clip_turns(&spans, &per);
    for t in &mut turns {
        t.speaker_label = None;
    }
    heard(&turns)
}

/// The first pass: the clip's stored transcript when there is one, else one pass over the whole
/// WAV (both keep speakers).
pub(super) enum FirstPass {
    /// A clip's ingest transcript, as listen lines.
    Clip(Vec<ListenTurn>),
    /// Transcribe the whole WAV.
    Full,
}

/// The lines of `wav` (`duration_s` long): the first pass, unless the window pass heard more than
/// [`WINDOW_GAIN`](crate::domain::listen::coverage::WINDOW_GAIN) times its text.
pub(super) async fn hear(
    p: &ListenPorts,
    (wav, duration_s): (&Path, f64),
    dir: &Path,
    first: FirstPass,
) -> Result<Heard, AppError> {
    let full = match first {
        FirstPass::Clip(lines) => Heard {
            lines,
            by: HeardBy::Clip,
        },
        FirstPass::Full => {
            let tools = (p.media.as_ref(), p.transcriber.as_ref());
            Heard {
                lines: heard(&chunked_turns(tools, wav, duration_s, dir).await?),
                by: HeardBy::Full,
            }
        }
    };
    let full_units: f64 = full.lines.iter().map(|t| text_units(&t.text)).sum();
    let silences = p.media.silences(wav).await?;
    let windows = Windows {
        p,
        wav,
        silences: &silences,
        dir,
    };
    let pieces = windows.pass(duration_s).await?;
    let window_units: f64 = pieces.iter().map(Piece::units).sum();
    Ok(if windows_heard_more(full_units, window_units) {
        Heard {
            lines: window_lines(&pieces),
            by: HeardBy::Windows,
        }
    } else {
        full
    })
}
