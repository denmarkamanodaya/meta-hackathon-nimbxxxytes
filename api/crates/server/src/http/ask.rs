//! The ask box: `POST /api/transcribe` (raw audio) and `POST /api/intents`.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::rejection::BytesRejection;
use axum::http::{HeaderMap, header};
use nimbytes_contracts::ask::{IntentChoice, IntentResponse, IntentsRequest, TranscribeResponse};
use nimbytes_core::domain::ids::{ClipId, DocumentId};
use nimbytes_core::domain::intent::Intent;
use nimbytes_core::domain::voice::MAX_AUDIO_BYTES;
use nimbytes_core::usecases::ask::{Ask, VoiceNote, read_intent, transcribe_voice};

use super::json::ApiJson;
use super::raw_body::raw_body;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// Body limit of `POST /api/transcribe`: one byte over the largest recording, so the use case
/// sees an oversized body and names the limit (larger bodies are cut off by the extractor).
pub const TRANSCRIBE_BODY_LIMIT: usize = MAX_AUDIO_BYTES + 1;

/// `POST /api/transcribe`: the recording's words.
pub async fn transcribe(
    State(state): State<AppState>,
    CurrentUser(_user): CurrentUser,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<TranscribeResponse>, ApiError> {
    let bytes = raw_body(body, "the recording is larger than 10 MB")?;
    let note = VoiceNote {
        content_type: headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        bytes: &bytes,
    };
    let text = transcribe_voice(&state.ask, note).await?;
    Ok(Json(TranscribeResponse { text }))
}

/// `POST /api/intents`: what the request asks for.
pub async fn intents(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<IntentsRequest>,
) -> Result<Json<IntentResponse>, ApiError> {
    let clips = b
        .clip_ids
        .into_iter()
        .map(ClipId::parse)
        .collect::<Result<Vec<_>, _>>()?;
    let documents = b
        .document_ids
        .into_iter()
        .map(DocumentId::parse)
        .collect::<Result<Vec<_>, _>>()?;
    let ask = Ask {
        text: &b.text,
        clips: &clips,
        documents: &documents,
    };
    let intent = read_intent(&state.ask, &user, ask).await?;
    Ok(Json(body(intent)))
}

fn body(i: Intent) -> IntentResponse {
    IntentResponse {
        kind: i.kind.as_str().to_owned(),
        title: i.title,
        query: i.query,
        source: i.source.map(|s| s.as_str().to_owned()),
        project_id: i.project_id.map(String::from),
        new_project_name: i.new_project_name,
        clip_ids: i.clip_ids.into_iter().map(String::from).collect(),
        target_s: i.target_s,
        aspect: i.aspect.map(|a| a.as_str().to_owned()),
        choices: i
            .choices
            .into_iter()
            .map(|c| IntentChoice {
                label: c.label,
                text: c.text,
            })
            .collect(),
        document_ids: i.document_ids.into_iter().map(String::from).collect(),
        question: i.question,
    }
}
