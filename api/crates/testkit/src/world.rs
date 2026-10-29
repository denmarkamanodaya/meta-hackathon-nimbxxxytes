//! A ready-made ingest world for tests: every port faked, one clip and one queued ingest job.

use std::sync::Arc;

use crate::{
    FakeBlobStore, FakeEmbedder, FakeFaceTracker, FakeMediaTool, FakeScratch, FakeTranscriber,
    FixedClock, InMemoryCatalogue, InMemoryClipLinks, InMemoryFaceStore, InMemoryJobQueue,
    InMemoryPrivacy, InMemoryTextIndex, InMemoryVectorIndex, RecordedProgress, ScriptedDescriber,
    ScriptedTitler, SequentialIds,
};
use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::facts::{FactsStatus, SegmentFacts};
use nimbytes_core::domain::ids::{ClipId, JobId, UserId};
use nimbytes_core::domain::job::JobKind;
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::domain::transcript::RawTurn;
use nimbytes_core::ports::{JobQueue, NewJob};
use nimbytes_core::usecases::ingest::{FaceFollowUp, IngestSteps};
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::{AppError, ErrorCode};

/// Id of the clip under test.
pub const CLIP: &str = "c1";

/// Probe facts of a portrait clip.
pub fn probe(duration_s: f64, has_audio: bool) -> ProbeInfo {
    ProbeInfo {
        duration_s,
        width: 720,
        height: 1280,
        fps: 30.0,
        rotation: -90,
        codec: "hevc".into(),
        recorded_at: Some("2026-01-28T05:59:00.000Z".into()),
        has_audio,
    }
}

/// The clip row, uploaded, with optional probe facts.
///
/// # Errors
/// Never for the built-in ids.
pub fn clip(probe: Option<ProbeInfo>) -> Result<Clip, AppError> {
    Ok(Clip {
        id: ClipId::parse(CLIP)?,
        user_id: UserId::parse("u1")?,
        filename: "IMG_0001.MOV".into(),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Uploaded,
        probe,
        created_at: "2026-10-27T01:00:00.000Z".into(),
        title: None,
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    })
}

/// Fakes for every port the ingest steps use, plus the queue, progress sink and clock.
pub struct IngestWorld {
    /// Fake blobs.
    pub blobs: Arc<FakeBlobStore>,
    /// Fake catalogue.
    pub catalogue: Arc<InMemoryCatalogue>,
    /// Fake media.
    pub media: Arc<FakeMediaTool>,
    /// Fake scratch.
    pub scratch: Arc<FakeScratch>,
    /// Fake transcriber.
    pub transcriber: Arc<FakeTranscriber>,
    /// Fake describer.
    pub describer: Arc<ScriptedDescriber>,
    /// Fake titler (answers nothing until told to).
    pub titler: Arc<ScriptedTitler>,
    /// Fake tracker.
    pub tracker: Arc<FakeFaceTracker>,
    /// Fake vectors.
    pub vectors: Arc<InMemoryVectorIndex>,
    /// Fake text index.
    pub text_index: Arc<InMemoryTextIndex>,
    /// Fake queue.
    pub queue: InMemoryJobQueue,
    /// Fake progress.
    pub progress: RecordedProgress,
    /// Fake clock.
    pub clock: FixedClock,
    /// Fake face matching switch (off unless a test turns it on).
    pub faces: Arc<InMemoryFaceStore>,
    /// Where the ready step queues face matching jobs (kept apart from the ingest queue).
    pub face_jobs: Arc<InMemoryJobQueue>,
    /// Face boxes the faces step wrote.
    pub privacy: Arc<InMemoryPrivacy>,
    /// Near-copy and same-moment links the similar step wrote.
    pub links: Arc<InMemoryClipLinks>,
}

impl IngestWorld {
    /// Stores `stored` and queues the ingest job.
    pub async fn new(probe: ProbeInfo, cuts: Vec<f64>, stored: Clip) -> Result<Self, AppError> {
        let scratch = Arc::new(FakeScratch::default());
        let w = Self {
            blobs: Arc::new(FakeBlobStore::writing_to(scratch.clone())),
            catalogue: Arc::new(InMemoryCatalogue::default()),
            media: Arc::new(FakeMediaTool::writing_to(probe, cuts, scratch.clone())),
            scratch,
            transcriber: Arc::new(FakeTranscriber::default()),
            describer: Arc::new(ScriptedDescriber::default()),
            titler: Arc::new(ScriptedTitler::default()),
            tracker: Arc::new(FakeFaceTracker::default()),
            vectors: Arc::new(InMemoryVectorIndex::default()),
            text_index: Arc::new(InMemoryTextIndex::default()),
            queue: InMemoryJobQueue::default(),
            progress: RecordedProgress::default(),
            clock: FixedClock::at(0),
            faces: Arc::new(InMemoryFaceStore::default()),
            face_jobs: Arc::new(InMemoryJobQueue::default()),
            privacy: Arc::new(InMemoryPrivacy::default()),
            links: Arc::new(InMemoryClipLinks::default()),
        };
        w.catalogue.put_clip(stored);
        let id = JobId::parse("j1")?;
        let job = NewJob {
            id: &id,
            kind: JobKind::Ingest,
            subject_id: CLIP,
        };
        w.queue.enqueue(job, 0).await?;
        Ok(w)
    }

    /// The ingest runner over these fakes.
    pub fn steps(&self) -> IngestSteps {
        IngestSteps {
            blobs: self.blobs.clone(),
            catalogue: self.catalogue.clone(),
            media: self.media.clone(),
            scratch: self.scratch.clone(),
            transcriber: self.transcriber.clone(),
            describer: self.describer.clone(),
            tracker: self.tracker.clone(),
            embedder: Arc::new(FakeEmbedder),
            vectors: self.vectors.clone(),
            text_index: self.text_index.clone(),
            titler: self.titler.clone(),
            face_matching: FaceFollowUp {
                faces: self.faces.clone(),
                jobs: self.face_jobs.clone(),
                ids: Arc::new(SequentialIds::new("face-job")),
                clock: Arc::new(FixedClock::at(0)),
            },
            privacy: self.privacy.clone(),
            links: self.links.clone(),
            clock: Arc::new(FixedClock::at(0)),
        }
    }

    /// Claims and runs the job once; `INTERNAL` when nothing was runnable.
    pub async fn run_once(&self) -> Result<(), AppError> {
        let steps = self.steps();
        let deps = JobDeps {
            queue: &self.queue,
            runner: &steps,
            clock: &self.clock,
            progress: &self.progress,
        };
        if run_next_job(&deps).await? {
            Ok(())
        } else {
            Err(AppError::new(ErrorCode::Internal, "no job was runnable"))
        }
    }

    /// The clip row as stored now.
    pub fn stored(&self) -> Result<Clip, AppError> {
        let id = ClipId::parse(CLIP)?;
        self.catalogue
            .clip(&id)
            .ok_or_else(|| AppError::new(ErrorCode::NotFound, "clip gone"))
    }
}

/// A raw turn by speaker A.
pub fn said(start_ms: u64, end_ms: u64, text: &str) -> RawTurn {
    RawTurn {
        start_ms,
        end_ms,
        text: text.into(),
        speaker: Some("A".into()),
    }
}

/// Valid facts with the given description.
pub fn facts(description: &str) -> SegmentFacts {
    SegmentFacts {
        description: description.into(),
        actions: vec!["sleeping".into()],
        objects: vec!["dog".into()],
        place: Some("living room".into()),
        mood: Some("calm".into()),
        quality: Some(7),
        hook_score: Some(4),
        status: FactsStatus::Ok,
    }
}
