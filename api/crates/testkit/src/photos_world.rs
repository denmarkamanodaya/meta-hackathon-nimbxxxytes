//! A Photos world: every photo port as a fake, helpers that add u1's photo through the API and
//! run its job, and the birthday-stage facts Spark gave in the recorded call.

use std::sync::Arc;

use nimbytes_core::domain::ids::{PhotoId, UserId};
use nimbytes_core::domain::photo::{NewPhoto, PhotoFacts};
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::usecases::photos::{PhotoPorts, create_photo, upload_photo_source};
use nimbytes_core::usecases::streamed::SourceBody;
use nimbytes_core::{AppError, ErrorCode};

use crate::listens_world::Body;
use crate::{
    FakeBlobStore, FakeEmbedder, FakeMediaTool, FakeScratch, FixedClock, InMemoryJobQueue,
    InMemoryPhotos, InMemoryTextIndex, InMemoryUsage, InMemoryVectorIndex, ROOMY_CAP,
    RecordedProgress, ScriptedPhotoDescriber, SequentialIds,
};

/// Every fake a photo test may assert on.
pub struct PhotoWorld {
    /// The ports as the use cases see them.
    pub ports: PhotoPorts,
    /// Photo rows.
    pub photos: Arc<InMemoryPhotos>,
    /// Private objects.
    pub blobs: Arc<FakeBlobStore>,
    /// Working files.
    pub scratch: Arc<FakeScratch>,
    /// ffprobe and the fitted copies.
    pub media: Arc<FakeMediaTool>,
    /// Spark.
    pub describer: Arc<ScriptedPhotoDescriber>,
    /// The keyword index.
    pub text: Arc<InMemoryTextIndex>,
    /// Photo vectors.
    pub vectors: Arc<InMemoryVectorIndex>,
    /// Jobs.
    pub jobs: Arc<InMemoryJobQueue>,
    /// Step events.
    pub progress: RecordedProgress,
    /// Time.
    pub clock: Arc<FixedClock>,
}

/// The facts Spark wrote for the birthday stage photo (recorded call).
pub fn stage_facts() -> PhotoFacts {
    PhotoFacts {
        title: "60th Birthday Decorated Stage".into(),
        description: "No people are present. A white loveseat sits on a green grass stage \
                      surrounded by flowers, gold balloons and large white numbers reading '60'."
            .into(),
        things: ["stage", "balloons", "flowers", "couch"]
            .map(String::from)
            .to_vec(),
        place: "event hall".into(),
        mood: "festive".into(),
    }
}

/// What a client declares for a JPEG.
pub fn jpeg(name: &str) -> NewPhoto {
    NewPhoto {
        filename: name.into(),
        content_type: "image/jpeg".into(),
        size_bytes: 79_810,
        last_modified: Some("2026-08-19T10:00:00Z".into()),
    }
}

impl PhotoWorld {
    /// Fresh fakes.
    pub fn new() -> Self {
        let scratch = Arc::new(FakeScratch::default());
        let blobs = Arc::new(FakeBlobStore::writing_to(scratch.clone()));
        let media = Arc::new(FakeMediaTool::writing_to(
            crate::world::probe(1.0, false),
            Vec::new(),
            scratch.clone(),
        ));
        let (photos, describer, text, vectors, jobs) = Default::default();
        let clock = Arc::new(FixedClock::at(1_793_062_923_456));
        let ports = PhotoPorts {
            store: Arc::clone(&photos) as Arc<InMemoryPhotos>,
            blobs: blobs.clone(),
            scratch: scratch.clone(),
            media: media.clone(),
            describer: Arc::clone(&describer) as Arc<ScriptedPhotoDescriber>,
            embedder: Arc::new(FakeEmbedder),
            text: Arc::clone(&text) as Arc<InMemoryTextIndex>,
            vectors: Arc::clone(&vectors) as Arc<InMemoryVectorIndex>,
            jobs: Arc::clone(&jobs) as Arc<InMemoryJobQueue>,
            clock: clock.clone(),
            ids: Arc::new(SequentialIds::new("p")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
        };
        Self {
            ports,
            photos,
            blobs,
            scratch,
            media,
            describer,
            text,
            vectors,
            jobs,
            progress: RecordedProgress::default(),
            clock,
        }
    }

    /// u1 adds a JPEG named `name` and sends it through the API.
    ///
    /// # Errors
    /// Whatever create or upload answer.
    pub async fn uploaded(&self, name: &str) -> Result<PhotoId, AppError> {
        let u1 = UserId::parse("u1")?;
        let made = create_photo(&self.ports, &u1, jpeg(name)).await?;
        let mut body = Body(vec![b"\xff\xd8jpeg".to_vec()]);
        let source = SourceBody {
            content_type: Some("image/jpeg"),
            chunks: &mut body,
        };
        upload_photo_source(&self.ports, &u1, &made.id, source).await?;
        Ok(made.id)
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

impl Default for PhotoWorld {
    fn default() -> Self {
        Self::new()
    }
}
