//! Photos: `POST /api/photos` (201), `PUT /api/photos/{id}/source` (202), `GET /api/photos`,
//! `GET/PATCH/DELETE /api/photos/{id}`.

use axum::Json;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode, header};
use nimbytes_contracts::photos::{
    CreatePhotoRequest, CreatePhotoResponse, PhotoDetail, PhotoQueued, PhotoSummary, RenamePhoto,
};
use nimbytes_core::domain::ids::PhotoId;
use nimbytes_core::domain::photo::NewPhoto;
use nimbytes_core::usecases::photos::{
    PhotoDetailView, PhotoView, create_photo, delete_photo, get_photo, list_photos, rename_photo,
    upload_photo_source,
};
use nimbytes_core::usecases::streamed::SourceBody;

use super::json::ApiJson;
use super::listens::BodyChunks;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

/// `POST /api/photos`: a new photo; PUT its file next.
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<CreatePhotoRequest>,
) -> Result<(StatusCode, Json<CreatePhotoResponse>), ApiError> {
    let req = NewPhoto {
        filename: b.filename,
        content_type: b.content_type,
        size_bytes: b.size_bytes,
        last_modified: b.last_modified,
    };
    let made = create_photo(&state.photos, &user, req).await?;
    let body = CreatePhotoResponse {
        photo_id: made.id.into(),
        status: made.status.as_str().to_owned(),
    };
    Ok((StatusCode::CREATED, Json(body)))
}

/// `PUT /api/photos/{id}/source`: the file itself (raw body, its type as `Content-Type`),
/// streamed to the working directory; the use case stops reading past 40 MB. Then the analysis
/// is queued.
pub async fn source(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    (Path(id), headers): (Path<String>, HeaderMap),
    body: Body,
) -> Result<(StatusCode, Json<PhotoQueued>), ApiError> {
    let id = PhotoId::parse(id)?;
    let mut chunks = BodyChunks(body.into_data_stream());
    let source = SourceBody {
        content_type: headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        chunks: &mut chunks,
    };
    let status = upload_photo_source(&state.photos, &user, &id, source).await?;
    state.ports.usage_refresh.poke();
    let body = PhotoQueued {
        photo_id: id.into(),
        status: status.as_str().to_owned(),
    };
    Ok((StatusCode::ACCEPTED, Json(body)))
}

/// `GET /api/photos`, newest taken first.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<Vec<PhotoSummary>>, ApiError> {
    let rows = list_photos(&state.photos, &user).await?;
    Ok(Json(rows.into_iter().map(summary_body).collect()))
}

fn summary_body(v: PhotoView) -> PhotoSummary {
    let p = v.photo;
    PhotoSummary {
        title: p.shown_title().to_owned(),
        id: p.id.into(),
        filename: p.filename,
        status: p.status.as_str().to_owned(),
        taken_at: p.taken_at,
        width: p.width,
        height: p.height,
        size_bytes: p.size_bytes,
        thumb_url: v.thumb_url,
        created_at: p.created_at,
        error: p.error,
    }
}

fn detail_body(v: PhotoDetailView) -> PhotoDetail {
    let p = &v.view.photo;
    let (description, things, camera) = (
        p.facts.description.clone(),
        p.facts.things.clone(),
        p.camera.clone(),
    );
    PhotoDetail {
        summary_row: summary_body(v.view),
        description,
        things,
        image_url: v.image_url,
        original_url: v.original_url,
        camera,
    }
}

/// `GET /api/photos/{id}`.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<PhotoDetail>, ApiError> {
    let id = PhotoId::parse(id)?;
    let view = get_photo(&state.photos, &user, &id).await?;
    Ok(Json(detail_body(view)))
}

/// `PATCH /api/photos/{id}`: renames; answers the photo in full.
pub async fn rename(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
    ApiJson(b): ApiJson<RenamePhoto>,
) -> Result<Json<PhotoDetail>, ApiError> {
    let id = PhotoId::parse(id)?;
    let view = rename_photo(&state.photos, &user, &id, &b.title).await?;
    Ok(Json(detail_body(view)))
}

/// `DELETE /api/photos/{id}`: 204.
pub async fn remove(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let id = PhotoId::parse(id)?;
    delete_photo(&state.photos, &user, &id).await?;
    state.ports.usage_refresh.poke();
    Ok(StatusCode::NO_CONTENT)
}
