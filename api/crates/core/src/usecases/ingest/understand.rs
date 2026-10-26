//! Understanding steps: segment facts, face tracks, embeddings, and the search index.

use std::path::Path;

use crate::domain::faces::{FaceTrack, FrameCrop, crop_rect, tracks};
use crate::domain::facts::{SegmentFacts, fallback, transcript_context};
use crate::domain::ids::{SegmentId, TrackId};
use crate::domain::index::DocScope;
use crate::domain::segment::{Segment, TrackRow, track_id};
use crate::error::AppError;
use crate::keys;
use crate::ports::{FactsAttempt, SegmentPrompt};

use super::steps::FPS1;
use super::{IngestSteps, Work};

impl IngestSteps {
    /// Facts for every segment: one try, one retry with the validation error, then a fallback.
    pub(super) async fn describe(&self, work: &Work) -> Result<(), AppError> {
        let segments = self.catalogue.list_segments(&work.clip.id).await?;
        let mut prompts = Vec::with_capacity(segments.len());
        let transcripts = self.catalogue.segment_transcripts(&work.clip.id).await?;
        for seg in &segments {
            let texts = transcripts
                .iter()
                .find(|(id, _)| id == &seg.id)
                .map(|(_, t)| t.as_slice())
                .unwrap_or_default();
            prompts.push(SegmentPrompt {
                snippet: self.local_snippet(work, seg).await?,
                start_s: seg.span.start_s,
                end_s: seg.span.end_s,
                recorded_at: work.clip.recorded_at().unwrap_or("unknown").to_owned(),
                transcript: transcript_context(texts.iter().map(String::as_str)),
                previous_error: None,
            });
        }
        let facts = self.facts_with_retry(prompts).await?;
        for (seg, facts) in segments.iter().zip(&facts) {
            self.catalogue.set_segment_facts(&seg.id, facts).await?;
        }
        Ok(())
    }

    async fn facts_with_retry(
        &self,
        mut prompts: Vec<SegmentPrompt>,
    ) -> Result<Vec<SegmentFacts>, AppError> {
        let first = self.describer.describe_all(&prompts).await?;
        let mut retry_idx = Vec::new();
        for (i, attempt) in first.iter().enumerate() {
            if let FactsAttempt::Invalid { error, .. } = attempt {
                prompts[i].previous_error = Some(error.clone());
                retry_idx.push(i);
            }
        }
        let retry_prompts: Vec<SegmentPrompt> =
            retry_idx.iter().map(|&i| prompts[i].clone()).collect();
        let second = if retry_prompts.is_empty() {
            Vec::new()
        } else {
            self.describer.describe_all(&retry_prompts).await?
        };
        let mut out = Vec::with_capacity(first.len());
        for (i, attempt) in first.into_iter().enumerate() {
            let attempt = match retry_idx.iter().position(|&r| r == i) {
                Some(pos) => second.get(pos).cloned().unwrap_or(attempt),
                None => attempt,
            };
            out.push(match attempt {
                FactsAttempt::Valid(facts) => facts,
                FactsAttempt::Invalid { text, .. } => fallback(&text),
            });
        }
        Ok(out)
    }

    async fn local_snippet(
        &self,
        work: &Work,
        seg: &Segment,
    ) -> Result<std::path::PathBuf, AppError> {
        let path = work.file(&format!("snippet_{}.mp4", seg.idx));
        self.ensure_local(
            &keys::snippet(&work.clip.user_id, &work.clip.id, &seg.id),
            &path,
        )
        .await?;
        Ok(path)
    }

    /// Face tracks from the 1 fps copy; one crop per track from the proxy at its best frame.
    pub(super) async fn faces(&self, work: &Work) -> Result<(), AppError> {
        let (user, clip) = (&work.clip.user_id, &work.clip.id);
        let fps1 = work.file(FPS1);
        self.ensure_local(&keys::proxy_fps1(user, clip), &fps1)
            .await?;
        let found = tracks(&self.tracker.track_faces(&fps1).await?);
        if found.is_empty() {
            return self.catalogue.replace_face_tracks(clip, &[], &[]).await;
        }
        let proxy = self.local_proxy(work).await?;
        let segments = self.catalogue.list_segments(clip).await?;
        let mut rows = Vec::with_capacity(found.len());
        let mut links: Vec<(TrackId, SegmentId)> = Vec::new();
        for t in &found {
            let row = self.crop_track(work, &proxy, t).await?;
            let seen_in = segments.iter().filter(|s| s.span.overlap(t.span()) > 0.0);
            links.extend(seen_in.map(|s| (row.id.clone(), s.id.clone())));
            rows.push(row);
        }
        self.catalogue
            .replace_face_tracks(clip, &rows, &links)
            .await
    }

    /// Cuts and uploads one track's face crop; returns its row.
    async fn crop_track(
        &self,
        work: &Work,
        proxy: &Path,
        t: &FaceTrack,
    ) -> Result<TrackRow, AppError> {
        let (user, clip) = (&work.clip.user_id, &work.clip.id);
        let id = track_id(clip, t.ordinal)?;
        let crop = work.file(&format!("face_{}.jpg", t.ordinal));
        // The 1 fps copy has the proxy's size, so its box maps 1:1 onto the proxy frame.
        let rect = crop_rect(&t.best, t.best.frame_w, t.best.frame_h);
        let frame = FrameCrop {
            at_s: f64::from(t.best.frame),
            rect,
        };
        self.media.crop(proxy, frame, &crop).await?;
        let key = keys::face(user, clip, &id);
        self.put(&key, &crop, "image/jpeg").await?;
        Ok(TrackRow {
            id,
            ordinal: t.ordinal,
            first_s: t.first_s,
            last_s: t.last_s,
            crop_key: key.to_string(),
            max_area: t.max_area,
        })
    }

    /// One image embedding per segment thumbnail.
    pub(super) async fn embed(&self, work: &Work) -> Result<(), AppError> {
        let (user, clip) = (&work.clip.user_id, &work.clip.id);
        for seg in self.catalogue.list_segments(clip).await? {
            let thumb = work.file(&format!("thumb_{}.jpg", seg.idx));
            self.ensure_local(&keys::thumb(user, clip, &seg.id), &thumb)
                .await?;
            let vector = self.embedder.embed_image(&thumb).await?;
            self.vectors.upsert(&seg.id, user, &vector).await?;
        }
        Ok(())
    }

    /// Text documents for every segment of the clip.
    pub(super) async fn index(&self, work: &Work) -> Result<(), AppError> {
        let docs = self
            .catalogue
            .index_docs(DocScope::Clip(&work.clip.id))
            .await?;
        self.text_index.upsert(&docs).await
    }
}
