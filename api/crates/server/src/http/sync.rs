//! `GET /api/sync/manifest` and `POST /api/sync/clips/{id}/original`: the Mac app's sync API,
//! owner only.

use axum::Json;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use nimbytes_contracts::sync::{OriginalResponse, SyncClip, SyncManifest, SyncShort};
use nimbytes_core::domain::ids::ClipId;
use nimbytes_core::usecases::sync::{
    self as usecase, ManifestOutcome, SyncDeps, original_url, sync_manifest,
};
use nimbytes_core::{AppError, ErrorCode};
use sha2::{Digest, Sha256};

use super::{ApiError, CurrentUser};
use crate::state::{AppState, Ports};

/// Lower-case hex SHA-256: the digest behind the manifest etag.
fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn deps(ports: &Ports) -> SyncDeps<'_> {
    SyncDeps {
        catalogue: ports.catalogue.as_ref(),
        shorts: ports.shorts.as_ref(),
        blobs: ports.blobs.as_ref(),
        url_ttl: ports.url_ttl,
        digest: sha256_hex,
    }
}

/// The etags in an `If-None-Match` header (`"a", W/"b"` or bare `a`), unquoted.
fn if_none_match(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(header::IF_NONE_MATCH)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|t| {
            t.trim()
                .trim_start_matches("W/")
                .trim_matches('"')
                .to_owned()
        })
        .filter(|t| !t.is_empty())
        .collect()
}

fn etag_header(etag: &str) -> Result<HeaderValue, ApiError> {
    HeaderValue::from_str(&format!("\"{etag}\"")).map_err(|_| {
        ApiError(AppError::new(
            ErrorCode::Internal,
            "etag is not header text",
        ))
    })
}

fn clip_body(c: usecase::SyncClip) -> SyncClip {
    let probe = c.clip.probe.as_ref();
    SyncClip {
        clip_id: c.clip.id.to_string(),
        title: c.clip.display_title(),
        ext: c.clip.ext.as_str().to_owned(),
        size_bytes: c.clip.size_bytes,
        duration_s: probe.map(|p| p.duration_s),
        fps: probe.map(|p| p.fps),
        width: probe.map(|p| p.width),
        height: probe.map(|p| p.height),
        recorded_at: c.clip.recorded_at().map(str::to_owned),
        filename: c.clip.filename,
        proxy_url: c.proxy_url,
        proxy_size_bytes: c.proxy_size_bytes,
    }
}

fn short_body(s: usecase::SyncShort) -> SyncShort {
    SyncShort {
        short_id: s.short.id.to_string(),
        prompt: s.short.prompt,
        aspect: s.short.aspect,
        status: s.short.status,
        best_version: s.short.best_version,
        render_url: s.render_url,
        created_at: s.short.created_at,
    }
}

/// `GET /api/sync/manifest`: `200` with the snapshot, or `304` with an empty body when
/// `If-None-Match` holds the current etag; both carry the quoted `ETag`.
pub async fn manifest(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let known = if_none_match(&headers);
    match sync_manifest(&deps(&state.ports), &user, &known).await? {
        ManifestOutcome::Unchanged { etag } => {
            let tag = etag_header(&etag)?;
            Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, tag)]).into_response())
        }
        ManifestOutcome::Changed(m) => {
            let tag = etag_header(&m.etag)?;
            let body = SyncManifest {
                etag: m.etag,
                clips: m.clips.into_iter().map(clip_body).collect(),
                shorts: m.shorts.into_iter().map(short_body).collect(),
            };
            Ok(([(header::ETAG, tag)], Json(body)).into_response())
        }
    }
}

/// `POST /api/sync/clips/{id}/original`: a presigned download of the original.
pub async fn original(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<String>,
) -> Result<Json<OriginalResponse>, ApiError> {
    let id = ClipId::parse(id)?;
    let url = original_url(&deps(&state.ports), &user, &id).await?;
    Ok(Json(OriginalResponse { url }))
}
