//! The individual ingest steps.

use crate::domain::clip::ClipStatus;
use crate::domain::probe::ProbeInfo;
use crate::domain::segment::{
    Segment, SpeakerRow, TranscriptRows, TurnRow, segment_id, speaker_id, turn_id,
};
use crate::domain::segmenting::{Span, windows};
use crate::domain::transcript::{RawTurn, Turn, chunks, clip_turns, overlaps, speaker_labels};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::PutFile;

use super::{IngestSteps, Work};

pub(super) const MP4: &str = "video/mp4";
const ORIGINAL: &str = "original";
const PROXY: &str = "proxy_720p.mp4";
pub(super) const FPS1: &str = "fps1.mp4";
const AUDIO: &str = "audio.wav";

impl IngestSteps {
    pub(super) async fn put(
        &self,
        key: &ObjectKey,
        path: &std::path::Path,
        mime: &str,
    ) -> Result<(), AppError> {
        let put = PutFile {
            key,
            path,
            content_type: mime,
            class: None,
            cache_control: Some(keys::DERIVED_CACHE_CONTROL),
        };
        self.blobs.put_file(put).await
    }

    fn original_key(work: &Work) -> ObjectKey {
        keys::original(&work.clip.user_id, &work.clip.id, work.clip.ext)
    }

    async fn local_original(&self, work: &Work) -> Result<std::path::PathBuf, AppError> {
        let path = work.file(&format!("{ORIGINAL}.{}", work.clip.ext.as_str()));
        self.ensure_local(&Self::original_key(work), &path).await?;
        Ok(path)
    }

    pub(super) async fn local_proxy(&self, work: &Work) -> Result<std::path::PathBuf, AppError> {
        let path = work.file(PROXY);
        self.ensure_local(&keys::proxy_720p(&work.clip.user_id, &work.clip.id), &path)
            .await?;
        Ok(path)
    }

    pub(super) fn probe_of(work: &Work) -> Result<&ProbeInfo, AppError> {
        work.clip
            .probe
            .as_ref()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "step ran before probe"))
    }

    /// Probes the original and marks the clip `processing`.
    pub(super) async fn probe(&self, work: &Work) -> Result<(), AppError> {
        let id = &work.clip.id;
        self.catalogue
            .set_clip_status(id, ClipStatus::Processing, None)
            .await?;
        let original = self.local_original(work).await?;
        let info = self.media.probe(&original).await?;
        self.catalogue.record_probe(id, &info).await
    }

    /// Upright 720p proxy, uploaded.
    pub(super) async fn proxy(&self, work: &Work) -> Result<(), AppError> {
        let original = self.local_original(work).await?;
        let proxy = work.file(PROXY);
        self.media.make_proxy(&original, &proxy).await?;
        self.put(
            &keys::proxy_720p(&work.clip.user_id, &work.clip.id),
            &proxy,
            MP4,
        )
        .await
    }

    /// 1 fps copy for face tracking, and the 16 kHz mono WAV when the clip has audio.
    pub(super) async fn derivatives(&self, work: &Work) -> Result<(), AppError> {
        let (user, clip) = (&work.clip.user_id, &work.clip.id);
        let proxy = self.local_proxy(work).await?;
        let fps1 = work.file(FPS1);
        self.media.make_sam_fps1(&proxy, &fps1).await?;
        self.put(&keys::proxy_fps1(user, clip), &fps1, MP4).await?;
        let probe = Self::probe_of(work)?;
        if probe.has_audio {
            let original = self.local_original(work).await?;
            let wav = work.file(AUDIO);
            let whole = Span {
                start_s: 0.0,
                end_s: probe.duration_s,
            };
            self.media.extract_wav(&original, whole, &wav).await?;
            self.put(&keys::audio(user, clip), &wav, "audio/wav")
                .await?;
        }
        Ok(())
    }

    /// Scene cuts → 5–10 s windows → segment rows, a thumbnail and a 360p snippet each.
    pub(super) async fn segments(&self, work: &Work) -> Result<(), AppError> {
        let (user, clip) = (&work.clip.user_id, &work.clip.id);
        let proxy = self.local_proxy(work).await?;
        let cuts = self.media.scene_cuts(&proxy).await?;
        let spans = windows(Self::probe_of(work)?.duration_s, &cuts);
        let mut segments = Vec::with_capacity(spans.len());
        for (idx, span) in (0u32..).zip(spans) {
            segments.push(Segment {
                id: segment_id(clip, idx)?,
                clip_id: clip.clone(),
                idx,
                span,
            });
        }
        self.catalogue.replace_segments(clip, &segments).await?;
        for seg in &segments {
            let thumb = work.file(&format!("thumb_{}.jpg", seg.idx));
            self.media.thumbnail(&proxy, seg.span.mid(), &thumb).await?;
            self.put(&keys::thumb(user, clip, &seg.id), &thumb, "image/jpeg")
                .await?;
            let snippet = work.file(&format!("snippet_{}.mp4", seg.idx));
            self.media.snippet(&proxy, seg.span, &snippet).await?;
            self.put(&keys::snippet(user, clip, &seg.id), &snippet, MP4)
                .await?;
        }
        Ok(())
    }

    /// Diarized transcript in ≤ 9.5 min chunks, joined to segments by time overlap.
    pub(super) async fn transcribe(&self, work: &Work) -> Result<(), AppError> {
        let probe = Self::probe_of(work)?;
        let turns = if probe.has_audio {
            self.raw_turns(work, probe.duration_s).await?
        } else {
            Vec::new()
        };
        let segments = self.catalogue.list_segments(&work.clip.id).await?;
        let rows = transcript_rows(work, &segments, &turns)?;
        self.catalogue
            .replace_transcript(&work.clip.id, &rows)
            .await
    }

    async fn raw_turns(&self, work: &Work, duration_s: f64) -> Result<Vec<Turn>, AppError> {
        let wav = work.file(AUDIO);
        self.ensure_local(&keys::audio(&work.clip.user_id, &work.clip.id), &wav)
            .await?;
        let pieces = chunks(duration_s);
        let mut per_chunk: Vec<Vec<RawTurn>> = Vec::with_capacity(pieces.len());
        if pieces.len() == 1 {
            per_chunk.push(self.transcriber.transcribe(&wav).await?);
        } else {
            for (i, piece) in pieces.iter().enumerate() {
                let chunk = work.file(&format!("audio_{i}.wav"));
                self.media.extract_wav(&wav, *piece, &chunk).await?;
                per_chunk.push(self.transcriber.transcribe(&chunk).await?);
            }
        }
        Ok(clip_turns(&pieces, &per_chunk))
    }

    /// Marks the clip `ready` and frees its scratch space.
    pub(super) async fn ready(&self, work: &Work) -> Result<(), AppError> {
        self.catalogue
            .set_clip_status(&work.clip.id, ClipStatus::Ready, None)
            .await?;
        self.scratch.remove_clip_dir(&work.clip.id).await
    }
}

/// Builds speaker, turn and link rows with deterministic ids.
fn transcript_rows(
    work: &Work,
    segments: &[Segment],
    turns: &[Turn],
) -> Result<TranscriptRows, AppError> {
    let clip = &work.clip.id;
    let labels = speaker_labels(turns);
    let speakers = labels
        .iter()
        .enumerate()
        .map(|(i, label)| {
            Ok(SpeakerRow {
                id: speaker_id(clip, i)?,
                label: label.clone(),
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let mut rows = Vec::with_capacity(turns.len());
    for turn in turns {
        let speaker = turn
            .speaker_label
            .as_ref()
            .and_then(|l| speakers.iter().find(|s| &s.label == l));
        rows.push(TurnRow {
            id: turn_id(clip, turn.turn_no)?,
            turn: turn.clone(),
            speaker_id: speaker.map(|s| s.id.clone()),
        });
    }
    let spans: Vec<Span> = segments.iter().map(|s| s.span).collect();
    let links = overlaps(&spans, turns)
        .into_iter()
        .map(|(si, ti)| (segments[si].id.clone(), rows[ti].id.clone()))
        .collect();
    Ok(TranscriptRows {
        speakers,
        turns: rows,
        links,
    })
}
