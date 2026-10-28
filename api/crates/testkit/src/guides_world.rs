//! A MyWay world: u1's ready 60 s clip `c1` and every guide port as a fake, plus a helper that
//! runs the queued job once.

use std::sync::Arc;

use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::guide::{DraftStep, GuideDraft, Safety};
use nimbytes_core::usecases::guides::GuidePorts;
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::{AppError, ErrorCode};

use crate::world::{clip, probe};
use crate::{
    FakeBlobStore, FakeMasks, FakeMediaTool, FakeNarrator, FakeScratch, FixedClock,
    InMemoryCatalogue, InMemoryGuides, InMemoryJobQueue, RecordedProgress, ScriptedGuideWriter,
    ScriptedTracker, SequentialIds,
};

/// Every fake a guide test may assert on.
pub struct GuideWorld {
    /// The ports as the use cases see them.
    pub ports: GuidePorts,
    /// Guide rows.
    pub guides: Arc<InMemoryGuides>,
    /// Clips.
    pub catalogue: Arc<InMemoryCatalogue>,
    /// Private objects.
    pub blobs: Arc<FakeBlobStore>,
    /// Working files.
    pub scratch: Arc<FakeScratch>,
    /// Frames and clips.
    pub media: Arc<FakeMediaTool>,
    /// Jobs.
    pub jobs: Arc<InMemoryJobQueue>,
    /// Spark.
    pub writer: Arc<ScriptedGuideWriter>,
    /// SAM.
    pub tracker: Arc<ScriptedTracker>,
    /// Renderer outline and stills.
    pub masks: Arc<FakeMasks>,
    /// MMS-TTS.
    pub narrator: Arc<FakeNarrator>,
    /// Step events.
    pub progress: RecordedProgress,
    /// Time.
    pub clock: Arc<FixedClock>,
}

/// A step of a draft: `title`, `instruction` and the control `control`, at `[start, end)`.
pub fn draft_step(start_s: f64, end_s: f64, control: &str) -> DraftStep {
    DraftStep {
        title: format!("Step at {start_s}"),
        instruction: format!("Do the thing at {start_s}"),
        start_s,
        end_s,
        key_s: start_s + 1.0,
        control: control.to_owned(),
    }
}

/// An everyday draft of three steps (0–10, 10–20, 20–30 s) circling `dial`, `button`, nothing.
pub fn washing_draft() -> GuideDraft {
    GuideDraft {
        safety: Safety::Everyday,
        safety_reason: "Laundry is an everyday task.".into(),
        title: "Start a quick wash".into(),
        steps: vec![
            draft_step(0.0, 10.0, "dial"),
            draft_step(10.0, 20.0, "start button"),
            draft_step(20.0, 30.0, ""),
        ],
    }
}

impl GuideWorld {
    /// u1's ready 60 s clip c1 and fresh fakes, with the narrator on.
    ///
    /// # Errors
    /// Never for the built-in ids.
    pub fn new() -> Result<Self, AppError> {
        let scratch = Arc::new(FakeScratch::default());
        let blobs = Arc::new(FakeBlobStore::writing_to(scratch.clone()));
        let media = Arc::new(FakeMediaTool::writing_to(
            probe(60.0, true),
            Vec::new(),
            scratch.clone(),
        ));
        let catalogue = Arc::new(InMemoryCatalogue::default());
        let mut c1 = clip(Some(probe(60.0, true)))?;
        c1.status = ClipStatus::Ready;
        catalogue.put_clip(c1);
        let (guides, jobs) = (Arc::new(InMemoryGuides::default()), Arc::default());
        let (writer, tracker, masks) = (Arc::default(), Arc::default(), Arc::default());
        let narrator = Arc::default();
        let clock = Arc::new(FixedClock::at(1_793_062_923_456));
        let ports = ports(
            (&guides, &catalogue, &blobs, &scratch, &media, &jobs),
            (&writer, &tracker, &masks, &narrator),
            &clock,
        );
        Ok(Self {
            ports,
            guides,
            catalogue,
            blobs,
            scratch,
            media,
            jobs,
            writer,
            tracker,
            masks,
            narrator,
            progress: RecordedProgress::default(),
            clock,
        })
    }

    /// Claims and runs one job; `INTERNAL` when nothing was runnable.
    ///
    /// # Errors
    /// Queue errors, or nothing runnable.
    pub async fn run_once(&self) -> Result<(), AppError> {
        let deps = JobDeps {
            queue: self.jobs.as_ref(),
            runner: &self.ports,
            clock: self.clock.as_ref(),
            progress: &self.progress,
        };
        if run_next_job(&deps).await? {
            Ok(())
        } else {
            Err(AppError::new(ErrorCode::Internal, "no job was runnable"))
        }
    }
}

type Stores<'a> = (
    &'a Arc<InMemoryGuides>,
    &'a Arc<InMemoryCatalogue>,
    &'a Arc<FakeBlobStore>,
    &'a Arc<FakeScratch>,
    &'a Arc<FakeMediaTool>,
    &'a Arc<InMemoryJobQueue>,
);

type Models<'a> = (
    &'a Arc<ScriptedGuideWriter>,
    &'a Arc<ScriptedTracker>,
    &'a Arc<FakeMasks>,
    &'a Arc<FakeNarrator>,
);

fn ports(
    (guides, catalogue, blobs, scratch, media, jobs): Stores<'_>,
    (writer, tracker, masks, narrator): Models<'_>,
    clock: &Arc<FixedClock>,
) -> GuidePorts {
    GuidePorts {
        store: guides.clone(),
        catalogue: catalogue.clone(),
        blobs: blobs.clone(),
        scratch: scratch.clone(),
        media: media.clone(),
        jobs: jobs.clone(),
        writer: writer.clone(),
        tracker: tracker.clone(),
        masks: masks.clone(),
        narrator: Some(narrator.clone()),
        clock: clock.clone(),
        ids: Arc::new(SequentialIds::new("id")),
        url_ttl: std::time::Duration::from_secs(3600),
    }
}
