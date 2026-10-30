//! iListen wiring: the listen store, Voice Transcribe, Spark's listen interpreter, ffmpeg and the
//! shared narrator (English summaries only are spoken).

use std::sync::Arc;
use std::time::Duration;

use nimbytes_adapters::meta::listen::{ListenPrompts, SparkListenInterpreter};
use nimbytes_adapters::meta::listen_cover::MuseListenCover;
use nimbytes_adapters::meta::prompt::{StrictSchema, Template};
use nimbytes_adapters::meta::{MetaClient, MetaTranscriber};
use nimbytes_adapters::{FfmpegMediaTool, MediaTimeouts, SqliteListenStore};
use nimbytes_core::AppError;
use nimbytes_core::ports::Narrator;
use nimbytes_core::usecases::listens::ListenPorts;
use sqlx::SqlitePool;

use super::URL_TTL;
use super::understanding::{ENCODE_TIMEOUT, PROBE_TIMEOUT, TRANSCRIBE_TIMEOUT};
use crate::state::Ports;

const UNDERSTAND_PROMPT: &str = include_str!("../../../../prompts/listen_understand.md");
const UNDERSTAND_SCHEMA: &str = include_str!("../../../../prompts/listen_understand.schema.json");
const MERGE_PROMPT: &str = include_str!("../../../../prompts/listen_merge.md");
const MERGE_SCHEMA: &str = include_str!("../../../../prompts/listen_merge.schema.json");
const CHECK_PROMPT: &str = include_str!("../../../../prompts/listen_check.md");
const CHECK_SCHEMA: &str = include_str!("../../../../prompts/listen_check.schema.json");
const FIX_PROMPT: &str = include_str!("../../../../prompts/listen_fix.md");
const FIX_SCHEMA: &str = include_str!("../../../../prompts/listen_fix.schema.json");
const COVER_PROMPT: &str = include_str!("../../../../prompts/listen_cover.md");

/// One Muse Image cover, retries included (key art takes about 20 s).
pub const LISTEN_COVER_TIMEOUT: Duration = Duration::from_secs(120);

/// Windows of the coverage pass transcribed at once.
pub const TRANSCRIBE_CONCURRENCY: usize = 4;

/// One Spark call of the listen job, retries included (a part is at most 120 turns; the
/// medium-effort check is the slowest).
pub const LISTEN_SPARK_TIMEOUT: Duration = Duration::from_secs(240);

fn prompt(name: &str, md: &str, schema: &str) -> Result<(Template, StrictSchema), AppError> {
    Ok((Template::parse(md)?, StrictSchema::parse(name, schema)?))
}

/// The iListen ports over the request ports, the pool, the Meta client and the narrator.
///
/// # Errors
/// `INTERNAL` when a listen prompt cannot be loaded.
pub fn listen_ports(
    ports: &Ports,
    (pool, meta): (&SqlitePool, &MetaClient),
    narrator: Option<Arc<dyn Narrator>>,
) -> Result<ListenPorts, AppError> {
    let prompts = ListenPrompts {
        understand: prompt("listen_understand", UNDERSTAND_PROMPT, UNDERSTAND_SCHEMA)?,
        merge: prompt("listen_merge", MERGE_PROMPT, MERGE_SCHEMA)?,
        check: prompt("listen_check", CHECK_PROMPT, CHECK_SCHEMA)?,
        fix: prompt("listen_fix", FIX_PROMPT, FIX_SCHEMA)?,
    };
    Ok(ListenPorts {
        store: Arc::new(SqliteListenStore::new(pool.clone())),
        blobs: ports.blobs.clone(),
        scratch: ports.scratch.clone(),
        media: Arc::new(FfmpegMediaTool::new(MediaTimeouts {
            probe: PROBE_TIMEOUT,
            encode: ENCODE_TIMEOUT,
        })),
        transcriber: Arc::new(
            MetaTranscriber::new(meta.clone(), TRANSCRIBE_TIMEOUT)
                .with_concurrency(TRANSCRIBE_CONCURRENCY),
        ),
        interpreter: Arc::new(SparkListenInterpreter::new(
            meta.clone(),
            prompts,
            LISTEN_SPARK_TIMEOUT,
        )),
        cover_artist: Arc::new(MuseListenCover::new(
            meta.clone(),
            Template::parse(COVER_PROMPT)?,
            LISTEN_COVER_TIMEOUT,
        )),
        catalogue: ports.catalogue.clone(),
        jobs: ports.jobs.clone(),
        narrator,
        clock: ports.clock.clone(),
        ids: ports.ids.clone(),
        usage: ports.usage.clone(),
        cap: ports.storage_cap,
        url_ttl: URL_TTL,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_listen_prompt_loads_with_its_schema() {
        for (name, md, schema) in [
            ("listen_understand", UNDERSTAND_PROMPT, UNDERSTAND_SCHEMA),
            ("listen_merge", MERGE_PROMPT, MERGE_SCHEMA),
            ("listen_check", CHECK_PROMPT, CHECK_SCHEMA),
            ("listen_fix", FIX_PROMPT, FIX_SCHEMA),
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
