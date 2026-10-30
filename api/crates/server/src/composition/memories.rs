//! Memory Lane wiring: the memory store, Spark's memory writer, ffmpeg for the frames and Muse
//! Image for the cover (the iListen cover prompt).

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::MetaClient;
use nimbytes_adapters::meta::listen_cover::MuseListenCover;
use nimbytes_adapters::meta::memory::{MemoryPrompts, SparkMemoryWriter};
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::{FfmpegMediaTool, MediaTimeouts, SqliteMemoryStore};
use nimbytes_core::AppError;
use nimbytes_core::usecases::memories::MemoryPorts;
use sqlx::SqlitePool;

use super::URL_TTL;
use super::listens::LISTEN_COVER_TIMEOUT;
use super::understanding::{ENCODE_TIMEOUT, PROBE_TIMEOUT};
use crate::state::Ports;

const WRITE_PROMPT: &str = include_str!("../../../../prompts/memory_write.md");
const WRITE_SCHEMA: &str = include_str!("../../../../prompts/memory_write.schema.json");
const CHECK_PROMPT: &str = include_str!("../../../../prompts/memory_check.md");
const CHECK_SCHEMA: &str = include_str!("../../../../prompts/memory_check.schema.json");
const COVER_PROMPT: &str = include_str!("../../../../prompts/listen_cover.md");

/// One Spark call of the memory job, retries included (up to 8 frames and the faces are sent).
pub const MEMORY_SPARK_TIMEOUT: Duration = Duration::from_secs(180);

fn prompt(name: &str, md: &str, schema: &str) -> Result<(Template, StrictSchema), AppError> {
    Ok((Template::parse(md)?, StrictSchema::parse(name, schema)?))
}

/// The Memory Lane ports over the request ports, the pool and the Meta client.
///
/// # Errors
/// `INTERNAL` when a memory prompt cannot be loaded.
pub fn memory_ports(
    ports: &Ports,
    pool: &SqlitePool,
    meta: &MetaClient,
) -> Result<MemoryPorts, AppError> {
    let prompts = MemoryPrompts {
        write: prompt("memory_write", WRITE_PROMPT, WRITE_SCHEMA)?,
        check: prompt("memory_check", CHECK_PROMPT, CHECK_SCHEMA)?,
    };
    Ok(MemoryPorts {
        store: Arc::new(SqliteMemoryStore::new(pool.clone())),
        catalogue: ports.catalogue.clone(),
        people: ports.people.clone(),
        blobs: ports.blobs.clone(),
        scratch: ports.scratch.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        writer: Arc::new(SparkMemoryWriter::new(
            meta.clone(),
            prompts,
            MEMORY_SPARK_TIMEOUT,
        )),
        cover_artist: Arc::new(MuseListenCover::new(
            meta.clone(),
            Template::parse(COVER_PROMPT)?,
            LISTEN_COVER_TIMEOUT,
        )),
        jobs: ports.jobs.clone(),
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
        url_ttl: URL_TTL,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_memory_prompt_loads_with_its_schema() {
        for (name, md, schema) in [
            ("memory_write", WRITE_PROMPT, WRITE_SCHEMA),
            ("memory_check", CHECK_PROMPT, CHECK_SCHEMA),
        ] {
            let (t, s) = prompt(name, md, schema).unwrap();
            assert!(!t.system.is_empty() && !t.user.is_empty(), "{name}");
            assert_eq!(
                s.format()["schema"]["additionalProperties"],
                false,
                "{name}"
            );
        }
    }
}
