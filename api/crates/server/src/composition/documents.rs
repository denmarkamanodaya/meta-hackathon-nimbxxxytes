//! iRead wiring: the document store, Spark's document reader, ffmpeg + pdftoppm, and the shared
//! narrator (answers have no voice without it).

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::document::{DocumentPrompts, DocumentTimeouts, SparkDocumentReader};
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::{FfmpegMediaTool, MediaTimeouts, SqliteDocumentStore};
use nimbytes_core::AppError;
use nimbytes_core::ports::Narrator;
use nimbytes_core::usecases::documents::DocumentPorts;
use sqlx::SqlitePool;

use super::understanding::{ENCODE_TIMEOUT, PROBE_TIMEOUT};
use super::{PRESIGN_TTL, URL_TTL};
use crate::state::Ports;

const READ_PROMPT: &str = include_str!("../../../../prompts/document_read.md");
const READ_SCHEMA: &str = include_str!("../../../../prompts/document_read.schema.json");
const ANSWER_PROMPT: &str = include_str!("../../../../prompts/document_answer.md");
const ANSWER_SCHEMA: &str = include_str!("../../../../prompts/document_answer.schema.json");

/// Spark reading up to 10 pages in the background job (the spike read 2 pages in 9 s).
pub const DOCUMENT_READ_TIMEOUT: Duration = Duration::from_secs(180);
/// One answer while the person waits (2 to 5 s in the spike).
pub const DOCUMENT_ANSWER_TIMEOUT: Duration = Duration::from_secs(45);

/// The iRead ports over the request ports, the pool, the Meta client and the narrator.
///
/// # Errors
/// `INTERNAL` when a document prompt cannot be loaded.
pub fn document_ports(
    ports: &Ports,
    (pool, meta): (&SqlitePool, &MetaClient),
    narrator: Option<Arc<dyn Narrator>>,
) -> Result<DocumentPorts, AppError> {
    let prompts = DocumentPrompts {
        read: (
            Template::parse(READ_PROMPT)?,
            StrictSchema::parse("document_read", READ_SCHEMA)?,
        ),
        answer: (
            Template::parse(ANSWER_PROMPT)?,
            StrictSchema::parse("document_answer", ANSWER_SCHEMA)?,
        ),
    };
    let timeouts = DocumentTimeouts {
        read: DOCUMENT_READ_TIMEOUT,
        answer: DOCUMENT_ANSWER_TIMEOUT,
    };
    Ok(DocumentPorts {
        store: Arc::new(SqliteDocumentStore::new(pool.clone())),
        blobs: ports.blobs.clone(),
        scratch: ports.scratch.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        jobs: ports.jobs.clone(),
        reader: Arc::new(SparkDocumentReader::new(meta.clone(), prompts, timeouts)),
        narrator,
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
        usage: ports.usage.clone(),
        cap: ports.storage_cap,
        url_ttl: URL_TTL,
        upload_ttl: PRESIGN_TTL,
    })
}
