//! The face box backfill: clips ingested before face boxes were stored get them by rerunning
//! their `faces` job (SAM's answer is cached, so no model cost). Only when the config asks.

use nimbytes_core::usecases::jobs::restart_faces;

use super::Config;
use crate::state::Ports;

/// Reruns every finished `faces` job once when `FACE_BOXES_BACKFILL=1`; does nothing otherwise.
/// A failure is logged; start-up goes on.
pub async fn backfill_face_boxes(config: &Config, ports: &Ports) {
    if !config.face_boxes_backfill {
        return;
    }
    let now = ports.clock.now_millis();
    match restart_faces(ports.catalogue.as_ref(), ports.jobs.as_ref(), now).await {
        Ok(n) => tracing::info!(clips = n, "face box backfill queued"),
        Err(err) => {
            tracing::error!(code = ?err.code, message = %err.message, "face box backfill failed")
        }
    }
}
