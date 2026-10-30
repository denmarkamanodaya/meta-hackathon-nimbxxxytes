//! Photos wiring: the photo store and vectors, Spark's photo describer, ffmpeg, and the shared
//! Perception Encoder and keyword index (photos are searched next to moments).

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::photo::SparkPhotoDescriber;
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::{FfmpegMediaTool, MediaTimeouts};
use nimbytes_core::AppError;
use nimbytes_core::usecases::photos::PhotoPorts;

use super::URL_TTL;
use super::understanding::{ENCODE_TIMEOUT, PROBE_TIMEOUT};
use crate::state::Ports;

const FACTS_PROMPT: &str = include_str!("../../../../prompts/photo_facts.md");
const FACTS_SCHEMA: &str = include_str!("../../../../prompts/photo_facts.schema.json");

/// One Spark photo description, retries included (a few seconds at low effort).
pub const PHOTO_FACTS_TIMEOUT: Duration = Duration::from_secs(90);

/// The Photos ports over the request ports and the Meta client.
///
/// # Errors
/// `INTERNAL` when the photo prompt cannot be loaded.
pub fn photo_ports(ports: &Ports, meta: &MetaClient) -> Result<PhotoPorts, AppError> {
    let prompt = (
        Template::parse(FACTS_PROMPT)?,
        StrictSchema::parse("photo_facts", FACTS_SCHEMA)?,
    );
    Ok(PhotoPorts {
        store: ports.photo_store.clone(),
        projects: ports.projects.clone(),
        blobs: ports.blobs.clone(),
        scratch: ports.scratch.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        describer: Arc::new(SparkPhotoDescriber::new(
            meta.clone(),
            prompt,
            PHOTO_FACTS_TIMEOUT,
        )),
        embedder: ports.embedder.clone(),
        text: ports.text.clone(),
        vectors: ports.photo_vectors.clone(),
        jobs: ports.jobs.clone(),
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
        usage: ports.usage.clone(),
        cap: ports.storage_cap,
        url_ttl: URL_TTL,
    })
}
