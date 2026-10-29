//! iRead: `POST /api/documents` (201), `POST /api/documents/{id}/complete` (202),
//! `GET /api/documents`, `GET/PATCH/DELETE /api/documents/{id}`, `POST /api/documents/{id}/ask`
//! and `POST /api/documents/{id}/speak`.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use nimbytes_contracts::documents::{
    AskDocumentRequest, AskDocumentResponse, CompleteDocumentResponse, CreateDocumentRequest,
    CreateDocumentResponse, DocumentDetail, DocumentPage, DocumentSummary, RenameDocument,
    SpeakRequest, SpeakResponse,
};
use nimbytes_core::domain::document::NewDocument;
use nimbytes_core::domain::ids::DocumentId;
use nimbytes_core::usecases::documents::{
    DocumentDetailView, DocumentView, Spoken, ask_document, complete_document, create_document,
    delete_document, get_document, list_documents, rename_document, speak_part,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/documents`: a new document and the URL its file is PUT to.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<CreateDocumentRequest>,
) -> Result<(StatusCode, Json<CreateDocumentResponse>), ApiError> {
    let req = NewDocument {
        filename: b.filename,
        content_type: b.content_type,
        size_bytes: b.size_bytes,
    };
    let made = create_document(&state.documents, &user, req).await?;
    let body = CreateDocumentResponse {
        document_id: made.document_id.into(),
        upload_url: made.upload_url,
    };
    Ok((StatusCode::CREATED, Json(body)))
}

/// `POST /api/documents/{id}/complete`: queues the read.
pub async fn complete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<CompleteDocumentResponse>), ApiError> {
    let id = DocumentId::parse(id)?;
    let status = complete_document(&state.documents, &user, &id).await?;
    state.ports.usage_refresh.poke();
    let body = CompleteDocumentResponse {
        document_id: id.into(),
        status: status.as_str().to_owned(),
    };
    Ok((StatusCode::ACCEPTED, Json(body)))
}

/// `GET /api/documents`, newest first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<DocumentSummary>>, ApiError> {
    let rows = list_documents(&state.documents, &user).await?;
    Ok(Json(rows.into_iter().map(summary_body).collect()))
}

fn summary_body(v: DocumentView) -> DocumentSummary {
    let d = v.doc;
    DocumentSummary {
        id: d.id.into(),
        title: d.title,
        kind: d.kind.as_str().to_owned(),
        sender: d.sender,
        date: d.date,
        status: d.status.as_str().to_owned(),
        page_count: d.page_count,
        thumb_url: v.thumb_url,
        created_at: d.created_at,
        error: d.error,
    }
}

fn detail_body(v: DocumentDetailView) -> DocumentDetail {
    let (summary, text) = (v.view.doc.summary.clone(), v.view.doc.text.clone());
    DocumentDetail {
        summary_row: summary_body(v.view),
        summary,
        text,
        pages: v
            .pages
            .into_iter()
            .map(|(n, image_url)| DocumentPage { n, image_url })
            .collect(),
        summary_audio_url: v.summary_audio_url,
    }
}

/// `GET /api/documents/{id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<DocumentDetail>, ApiError> {
    let id = DocumentId::parse(id)?;
    let view = get_document(&state.documents, &user, &id).await?;
    Ok(Json(detail_body(view)))
}

/// `PATCH /api/documents/{id}`: renames; answers the document in full.
pub async fn rename(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<RenameDocument>,
) -> Result<Json<DocumentDetail>, ApiError> {
    let id = DocumentId::parse(id)?;
    let view = rename_document(&state.documents, &user, &id, &b.title).await?;
    Ok(Json(detail_body(view)))
}

/// `DELETE /api/documents/{id}`: 204.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = DocumentId::parse(id)?;
    delete_document(&state.documents, &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}

/// The voice's URL; a skipped voice is logged so it shows in the server logs.
fn audio_url(voice: Spoken, id: &DocumentId) -> Option<String> {
    match voice {
        Spoken::Url(url) => Some(url),
        Spoken::Skipped(reason) => {
            tracing::warn!(document = %id, %reason, "iRead voice skipped");
            None
        }
    }
}

/// `POST /api/documents/{id}/ask`: Spark's answer and its voice.
pub async fn ask(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<AskDocumentRequest>,
) -> Result<Json<AskDocumentResponse>, ApiError> {
    let id = DocumentId::parse(id)?;
    let a = ask_document(&state.documents, &user, &id, &b.question).await?;
    state.ports.usage_refresh.poke();
    Ok(Json(AskDocumentResponse {
        question: a.question,
        answer: a.answer,
        audio_url: audio_url(a.voice, &id),
    }))
}

/// `POST /api/documents/{id}/speak`: one part of the whole text and its voice.
pub async fn speak(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<SpeakRequest>,
) -> Result<Json<SpeakResponse>, ApiError> {
    let id = DocumentId::parse(id)?;
    let s = speak_part(&state.documents, &user, &id, b.part).await?;
    state.ports.usage_refresh.poke();
    Ok(Json(SpeakResponse {
        part: s.part,
        parts: s.parts,
        text: s.text,
        audio_url: audio_url(s.voice, &id),
    }))
}
