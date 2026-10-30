//! iListen: `POST /api/listens` (201), `PUT /api/listens/{id}/source` and
//! `POST /api/listens/{id}/complete` (202), `GET /api/listens`,
//! `GET/PATCH/DELETE /api/listens/{id}` and `POST /api/listens/{id}/language`.

use axum::Json;
use axum::body::{Body, BodyDataStream};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use futures_util::StreamExt;
use nimbytes_contracts::listens::{
    ChangeListenLanguage, CompleteListenResponse, CreateListenRequest, CreateListenResponse,
    HeardLanguage, ListenDetail, ListenSummary, ListenTurn, ListenVersion, RenameListen,
};
use nimbytes_core::domain::ids::ListenId;
use nimbytes_core::domain::listen::{self, ListenStatus};
use nimbytes_core::ports::{BoxFuture, ChunkSource};
use nimbytes_core::usecases::listens::{
    ListenDetailView, ListenRequest, ListenView, SourceBody, change_language, complete_listen,
    create_listen, delete_listen, get_listen, list_listens, rename_listen, upload_listen_source,
};
use nimbytes_core::{AppError, ErrorCode};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/listens`: a file to upload next, or a clip listened to at once.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<CreateListenRequest>,
) -> Result<(StatusCode, Json<CreateListenResponse>), ApiError> {
    let req = ListenRequest {
        filename: b.filename,
        content_type: b.content_type,
        size_bytes: b.size_bytes,
        clip_id: b.clip_id,
        target: b.target,
    };
    let made = create_listen(&state.listens, &user, req).await?;
    let body = CreateListenResponse {
        listen_id: made.id.into(),
        status: made.status.as_str().to_owned(),
    };
    Ok((StatusCode::CREATED, Json(body)))
}

/// `POST /api/listens/{id}/complete`: queues the job once the file is stored.
pub async fn complete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<CompleteListenResponse>), ApiError> {
    let id = ListenId::parse(id)?;
    let status = complete_listen(&state.listens, &user, &id).await?;
    Ok(queued(&state, id, status))
}

/// The request body read piece by piece (iListen and Photos sources).
pub(super) struct BodyChunks(pub(super) BodyDataStream);

impl ChunkSource for BodyChunks {
    fn next_chunk(&mut self) -> BoxFuture<'_, Result<Option<Vec<u8>>, AppError>> {
        Box::pin(async move {
            match self.0.next().await {
                None => Ok(None),
                Some(Ok(bytes)) => Ok(Some(bytes.to_vec())),
                Some(Err(e)) => Err(AppError::new(
                    ErrorCode::ValidationFailed,
                    format!("the upload was cut off: {e}"),
                )),
            }
        })
    }
}

/// `PUT /api/listens/{id}/source`: the file itself (raw body, its type as `Content-Type`),
/// streamed to the working directory, never whole in memory; the use case stops reading past
/// 300 MB. Then the job is queued as `/complete` does.
pub async fn source(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    (Path(id), headers): (Path<String>, HeaderMap),
    body: Body,
) -> Result<(StatusCode, Json<CompleteListenResponse>), ApiError> {
    let id = ListenId::parse(id)?;
    let mut chunks = BodyChunks(body.into_data_stream());
    let source = SourceBody {
        content_type: headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        chunks: &mut chunks,
    };
    let status = upload_listen_source(&state.listens, &user, &id, source).await?;
    Ok(queued(&state, id, status))
}

/// 202 with the listen's status; storage use changed, so it is measured again.
fn queued(
    state: &AppState,
    id: ListenId,
    status: ListenStatus,
) -> (StatusCode, Json<CompleteListenResponse>) {
    state.ports.usage_refresh.poke();
    let body = CompleteListenResponse {
        listen_id: id.into(),
        status: status.as_str().to_owned(),
    };
    (StatusCode::ACCEPTED, Json(body))
}

/// `GET /api/listens`, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<ListenSummary>>, ApiError> {
    let rows = list_listens(&state.listens, &user).await?;
    Ok(Json(rows.into_iter().map(summary_body).collect()))
}

fn summary_body(v: ListenView) -> ListenSummary {
    let l = v.listen;
    let size_bytes = match l.source {
        listen::ListenSource::File => l.size_bytes,
        listen::ListenSource::Clip => 0,
    };
    ListenSummary {
        id: l.id.into(),
        title: l.title,
        source_name: l.source_name,
        source_kind: l.source.as_str().to_owned(),
        clip_id: l.clip_id.map(Into::into),
        status: l.status.as_str().to_owned(),
        step: l.step,
        version: l.version,
        target: l.target,
        languages: l
            .languages
            .into_iter()
            .map(|h| HeardLanguage {
                code: h.code,
                share: h.share,
            })
            .collect(),
        cover_url: v.cover_url,
        duration_ms: l.duration_ms,
        speakers: l.speakers,
        confidence: l.confidence,
        passed: l.passed,
        created_at: l.created_at,
        project_ids: v.project_ids.iter().map(ToString::to_string).collect(),
        size_bytes,
        error: l.error,
    }
}

fn turn_body(t: listen::ListenTurn) -> ListenTurn {
    ListenTurn {
        index: t.index,
        start_ms: t.start_ms,
        end_ms: t.end_ms,
        speaker: t.speaker,
        lang: t.lang,
        text: t.text,
        translation: t.translation,
        score: t.score,
        issue: t.issue,
        fixed_in: t.fixed_in,
    }
}

fn detail_body(v: ListenDetailView) -> ListenDetail {
    let l = &v.view.listen;
    let (summary, key_points) = (l.summary.clone(), l.key_points.clone());
    ListenDetail {
        summary_row: summary_body(v.view),
        summary,
        key_points,
        turns: v.turns.into_iter().map(turn_body).collect(),
        versions: v
            .versions
            .into_iter()
            .map(|r| ListenVersion {
                version: r.version,
                confidence: r.confidence,
                summary_score: r.summary_score,
                passed: r.passed,
                notes: r.notes,
            })
            .collect(),
        audio_url: v.audio_url,
        summary_audio_url: v.summary_audio_url,
    }
}

/// `GET /api/listens/{id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ListenDetail>, ApiError> {
    let id = ListenId::parse(id)?;
    let view = get_listen(&state.listens, &user, &id).await?;
    Ok(Json(detail_body(view)))
}

/// `PATCH /api/listens/{id}`: renames; answers the listen in full.
pub async fn rename(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<RenameListen>,
) -> Result<Json<ListenDetail>, ApiError> {
    let id = ListenId::parse(id)?;
    let view = rename_listen(&state.listens, &user, &id, &b.title).await?;
    Ok(Json(detail_body(view)))
}

/// `POST /api/listens/{id}/language`: the summary in another language (the transcript is kept);
/// answers the listen in full, `listening` again unless nothing changed.
pub async fn language(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<ChangeListenLanguage>,
) -> Result<Json<ListenDetail>, ApiError> {
    let id = ListenId::parse(id)?;
    let view = change_language(&state.listens, &user, &id, &b.target).await?;
    Ok(Json(detail_body(view)))
}

/// `DELETE /api/listens/{id}`: 204.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = ListenId::parse(id)?;
    delete_listen(&state.listens, &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}
