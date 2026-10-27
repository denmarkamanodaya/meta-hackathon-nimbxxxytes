//! Upload handlers: parse the body and path, call one use case, shape the wire response.

use axum::Json;
use axum::extract::{Path, State};
use nimbytes_contracts::uploads::{
    CompleteUploadRequest, CompleteUploadResponse, CreateUploadRequest, CreateUploadResponse,
    ExistingClip, PresignPartsRequest, PresignPartsResponse, PresignedPart, ProxyUploadResponse,
    UploadCheckRequest, UploadCheckResponse,
};
use nimbytes_core::domain::clip::ClipStatus;
use nimbytes_core::domain::ids::UploadId;
use nimbytes_core::domain::upload::{self, CompletedPart};
use nimbytes_core::usecases::uploads::{
    NewUpload, check_upload, complete_upload, create_upload, presign_parts, presign_proxy,
};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::composition::URL_TTL;
use crate::state::AppState;

/// `POST /api/uploads`.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<CreateUploadRequest>,
) -> Result<Json<CreateUploadResponse>, ApiError> {
    let req = NewUpload {
        filename: body.filename,
        size_bytes: body.size_bytes,
        content_type: body.content_type,
    };
    let created = create_upload(&state.ports.upload_deps(), &user, req).await?;
    Ok(Json(CreateUploadResponse {
        upload_id: created.upload_id.to_string(),
        clip_id: created.clip_id.to_string(),
        part_size: created.part_size,
        parts: wire_parts(created.parts),
    }))
}

/// `POST /api/uploads/{id}/parts`.
pub async fn presign(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<PresignPartsRequest>,
) -> Result<Json<PresignPartsResponse>, ApiError> {
    let id = UploadId::parse(id)?;
    let parts = presign_parts(&state.ports.upload_deps(), &user, &id, &body.part_numbers).await?;
    Ok(Json(PresignPartsResponse {
        parts: wire_parts(parts),
    }))
}

/// `POST /api/uploads/{id}/proxy`: a PUT URL for the Mac app's hardware-made proxy.
pub async fn proxy(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<ProxyUploadResponse>, ApiError> {
    let id = UploadId::parse(id)?;
    let url = presign_proxy(&state.ports.upload_deps(), &user, &id, URL_TTL).await?;
    Ok(Json(ProxyUploadResponse { url }))
}

/// `POST /api/uploads/{id}/complete`.
pub async fn complete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(body): ApiJson<CompleteUploadRequest>,
) -> Result<Json<CompleteUploadResponse>, ApiError> {
    let id = UploadId::parse(id)?;
    let parts: Vec<CompletedPart> = body
        .parts
        .into_iter()
        .map(|p| CompletedPart {
            n: p.n,
            etag: p.etag,
        })
        .collect();
    let clip_id = complete_upload(&state.ports.upload_deps(), &user, &id, &parts).await?;
    state.ports.usage_refresh.poke();
    Ok(Json(CompleteUploadResponse {
        clip_id: clip_id.to_string(),
        status: ClipStatus::Uploaded,
    }))
}

fn wire_parts(parts: Vec<upload::PresignedPart>) -> Vec<PresignedPart> {
    parts
        .into_iter()
        .map(|p| PresignedPart { n: p.n, url: p.url })
        .collect()
}

/// `POST /api/uploads/check`.
pub async fn check(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(body): ApiJson<UploadCheckRequest>,
) -> Result<Json<UploadCheckResponse>, ApiError> {
    let found = check_upload(
        state.ports.catalogue.as_ref(),
        &user,
        (&body.filename, body.size_bytes),
    )
    .await?;
    Ok(Json(UploadCheckResponse {
        duplicate_of: found.map(|(id, title)| ExistingClip {
            clip_id: id.to_string(),
            title,
        }),
    }))
}
