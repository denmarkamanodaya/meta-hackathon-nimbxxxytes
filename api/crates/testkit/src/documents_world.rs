//! An iRead world: every document port as a fake (the narrator on), plus helpers that create
//! u1's document and run the queued job once.

use std::sync::Arc;

use nimbytes_core::domain::document::{DocKind, NewDocument, Reading};
use nimbytes_core::domain::ids::{DocumentId, UserId};
use nimbytes_core::usecases::documents::{DocumentPorts, complete_document, create_document};
use nimbytes_core::usecases::jobs::{JobDeps, run_next_job};
use nimbytes_core::{AppError, ErrorCode};

use crate::{
    FakeBlobStore, FakeMediaTool, FakeNarrator, FakeScratch, FixedClock, InMemoryDocuments,
    InMemoryJobQueue, InMemoryUsage, ROOMY_CAP, RecordedProgress, ScriptedDocumentReader,
    SequentialIds,
};

/// Every fake a document test may assert on.
pub struct DocumentWorld {
    /// The ports as the use cases see them.
    pub ports: DocumentPorts,
    /// Document rows.
    pub docs: Arc<InMemoryDocuments>,
    /// Private objects.
    pub blobs: Arc<FakeBlobStore>,
    /// Working files.
    pub scratch: Arc<FakeScratch>,
    /// PDF pages and page JPEGs.
    pub media: Arc<FakeMediaTool>,
    /// Jobs.
    pub jobs: Arc<InMemoryJobQueue>,
    /// Spark.
    pub reader: Arc<ScriptedDocumentReader>,
    /// MMS-TTS.
    pub narrator: Arc<FakeNarrator>,
    /// Step events.
    pub progress: RecordedProgress,
    /// Time.
    pub clock: Arc<FixedClock>,
}

/// A water bill as Spark reads it.
pub fn water_bill() -> Reading {
    Reading {
        title: "Water bill".into(),
        kind: DocKind::Bill,
        sender: "City Water".into(),
        date: "1 October 2026".into(),
        text: "Amount due: $142.60\nDue date: 14 November 2026".into(),
        summary: "City Water asks for $142.60. Pay by 14 November 2026.".into(),
    }
}

/// What a client declares for a file of `content_type`.
pub fn upload(content_type: &str) -> NewDocument {
    NewDocument {
        filename: "letter".into(),
        content_type: content_type.into(),
        size_bytes: 200_000,
    }
}

/// A media tool whose outputs appear in `scratch`.
fn media_on(scratch: &Arc<FakeScratch>) -> Arc<FakeMediaTool> {
    let probe = crate::world::probe(1.0, false);
    Arc::new(FakeMediaTool::writing_to(
        probe,
        Vec::new(),
        scratch.clone(),
    ))
}

impl DocumentWorld {
    /// Fresh fakes with the narrator on.
    pub fn new() -> Self {
        let scratch = Arc::new(FakeScratch::default());
        let blobs = Arc::new(FakeBlobStore::writing_to(scratch.clone()));
        let media = media_on(&scratch);
        let (docs, jobs, reader, narrator) = (
            Arc::new(InMemoryDocuments::default()),
            Arc::new(InMemoryJobQueue::default()),
            Arc::new(ScriptedDocumentReader::default()),
            Arc::new(FakeNarrator::default()),
        );
        let clock = Arc::new(FixedClock::at(1_793_062_923_456));
        let ports = DocumentPorts {
            store: docs.clone(),
            blobs: blobs.clone(),
            scratch: scratch.clone(),
            media: media.clone(),
            jobs: jobs.clone(),
            reader: reader.clone(),
            narrator: Some(narrator.clone()),
            clock: clock.clone(),
            ids: Arc::new(SequentialIds::new("d")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
            upload_ttl: std::time::Duration::from_secs(900),
        };
        Self {
            ports,
            docs,
            blobs,
            scratch,
            media,
            jobs,
            reader,
            narrator,
            progress: RecordedProgress::default(),
            clock,
        }
    }

    /// u1 creates a document of `content_type`, "uploads" it and completes it.
    ///
    /// # Errors
    /// Whatever create or complete answer.
    pub async fn uploaded(&self, content_type: &str) -> Result<DocumentId, AppError> {
        let u1 = UserId::parse("u1")?;
        let made = create_document(&self.ports, &u1, upload(content_type)).await?;
        let doc = self.docs.doc(made.document_id.as_str());
        let format = doc
            .map(|d| d.format)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "gone"))?;
        let key = nimbytes_core::keys::document_source(&u1, &made.document_id, format);
        self.blobs.store(key.as_str(), 200_000);
        complete_document(&self.ports, &u1, &made.document_id).await?;
        Ok(made.document_id)
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

impl Default for DocumentWorld {
    fn default() -> Self {
        Self::new()
    }
}
