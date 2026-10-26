//! Transcript turns: chunking long audio, shifting chunk times back, and joining turns to
//! segments by time overlap.

use crate::domain::segmenting::Span;

/// Longest audio sent in one transcription request, seconds (the API rejects > 10 min).
pub const MAX_CHUNK_S: f64 = 570.0;

/// A turn as Voice Transcribe returns it, times in milliseconds from the start of its chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawTurn {
    /// Start, ms.
    pub start_ms: u64,
    /// End, ms.
    pub end_ms: u64,
    /// Words.
    pub text: String,
    /// Diarization label (`"A"`, `"B"`, …); absent outside diarization mode.
    pub speaker: Option<String>,
}

/// A turn on the clip timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    /// 0-based order within the clip.
    pub turn_no: u32,
    /// Start/end in clip seconds.
    pub span: Span,
    /// Words.
    pub text: String,
    /// Raw diarization label.
    pub speaker_label: Option<String>,
}

/// Audio chunks of at most [`MAX_CHUNK_S`] covering `[0, duration)`.
pub fn chunks(duration_s: f64) -> Vec<Span> {
    let mut out = Vec::new();
    let mut start = 0.0;
    while start < duration_s {
        let end = (start + MAX_CHUNK_S).min(duration_s);
        out.push(Span {
            start_s: start,
            end_s: end,
        });
        start = end;
    }
    out
}

/// Places chunk turns on the clip timeline: adds each chunk's start offset, drops empty turns and
/// numbers the rest in time order. `per_chunk[i]` holds the turns of `chunks[i]`.
pub fn clip_turns(chunks: &[Span], per_chunk: &[Vec<RawTurn>]) -> Vec<Turn> {
    let mut turns: Vec<Turn> = chunks
        .iter()
        .zip(per_chunk)
        .flat_map(|(chunk, raw)| raw.iter().map(move |t| (chunk.start_s, t)))
        .filter(|(_, t)| !t.text.trim().is_empty())
        .map(|(offset, t)| Turn {
            turn_no: 0,
            span: Span {
                start_s: offset + ms_to_s(t.start_ms),
                end_s: offset + ms_to_s(t.end_ms.max(t.start_ms)),
            },
            text: t.text.trim().to_owned(),
            speaker_label: t.speaker.clone(),
        })
        .collect();
    turns.sort_by(|a, b| a.span.start_s.total_cmp(&b.span.start_s));
    for (n, t) in turns.iter_mut().enumerate() {
        t.turn_no = u32::try_from(n).unwrap_or(u32::MAX);
    }
    turns
}

/// Distinct speaker labels in first-appearance order.
pub fn speaker_labels(turns: &[Turn]) -> Vec<String> {
    let mut labels: Vec<String> = Vec::new();
    for label in turns.iter().filter_map(|t| t.speaker_label.as_ref()) {
        if !labels.contains(label) {
            labels.push(label.clone());
        }
    }
    labels
}

/// `(segment index, turn index)` for every pair that shares time. A turn spanning two segments
/// joins both.
pub fn overlaps(segments: &[Span], turns: &[Turn]) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for (si, seg) in segments.iter().enumerate() {
        for (ti, turn) in turns.iter().enumerate() {
            let point_turn =
                turn.span.len() == 0.0 && (seg.start_s..seg.end_s).contains(&turn.span.start_s);
            if seg.overlap(turn.span) > 0.0 || point_turn {
                pairs.push((si, ti));
            }
        }
    }
    pairs
}

/// Milliseconds to seconds; turn times are far below 2^52 ms, so the cast is exact.
fn ms_to_s(ms: u64) -> f64 {
    ms as f64 / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(start_ms: u64, end_ms: u64, text: &str, speaker: &str) -> RawTurn {
        RawTurn {
            start_ms,
            end_ms,
            text: text.into(),
            speaker: Some(speaker.into()),
        }
    }

    #[test]
    fn chunks_cover_the_clip_in_570_s_pieces() {
        let c = chunks(1200.0);
        assert_eq!(c.len(), 3);
        assert_eq!((c[1].start_s, c[1].end_s), (570.0, 1140.0));
        assert_eq!(c[2].end_s, 1200.0);
        assert_eq!(chunks(21.5).len(), 1);
    }

    #[test]
    fn turns_from_chunk_2_are_shifted_by_the_chunk_start() {
        let c = chunks(600.0);
        let per = vec![
            vec![raw(5_820, 13_980, " with food. ", "A")],
            vec![raw(1_000, 2_500, "hi", "B")],
        ];
        let turns = clip_turns(&c, &per);
        assert_eq!(
            turns[0].span,
            Span {
                start_s: 5.82,
                end_s: 13.98
            }
        );
        assert_eq!(turns[0].text, "with food.");
        assert_eq!(
            turns[1].span,
            Span {
                start_s: 571.0,
                end_s: 572.5
            }
        );
        assert_eq!(
            (turns[1].turn_no, turns[1].speaker_label.as_deref()),
            (1, Some("B"))
        );
    }

    #[test]
    fn empty_turns_are_dropped_and_labels_kept_in_first_appearance_order() {
        let per = vec![vec![
            raw(0, 1, " ", "C"),
            raw(2_000, 3_000, "b", "B"),
            raw(4_000, 5_000, "a", "A"),
            raw(6_000, 7_000, "b2", "B"),
        ]];
        let turns = clip_turns(&chunks(10.0), &per);
        assert_eq!(turns.len(), 3);
        assert_eq!(speaker_labels(&turns), ["B", "A"]);
    }

    #[test]
    fn a_turn_spanning_two_segments_joins_both() {
        let segs = [
            Span {
                start_s: 0.0,
                end_s: 7.0,
            },
            Span {
                start_s: 7.0,
                end_s: 14.0,
            },
        ];
        let turns = clip_turns(
            &chunks(14.0),
            &[vec![
                raw(5_820, 13_980, "with food.", "A"),
                raw(1_000, 2_000, "x", "A"),
            ]],
        );
        // turns sorted: [1.0–2.0, 5.82–13.98]
        assert_eq!(overlaps(&segs, &turns), [(0, 0), (0, 1), (1, 1)]);
    }

    #[test]
    fn a_turn_ending_exactly_at_a_boundary_joins_only_the_first_segment() {
        let segs = [
            Span {
                start_s: 0.0,
                end_s: 7.0,
            },
            Span {
                start_s: 7.0,
                end_s: 14.0,
            },
        ];
        let turns = clip_turns(&chunks(14.0), &[vec![raw(6_000, 7_000, "edge", "A")]]);
        assert_eq!(overlaps(&segs, &turns), [(0, 0)]);
    }
}
