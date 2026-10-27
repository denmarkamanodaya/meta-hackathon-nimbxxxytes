//! `GET/PUT /api/brand` and `POST /api/brand/uploads`: the owner's brand kit.

use axum::Json;
use axum::extract::State;
use nimbytes_contracts::brand::{
    BrandKitBody, BrandResponse, BrandUploadKind, BrandUploadRequest, BrandUploadResponse,
    SaveBrandRequest,
};
use nimbytes_core::domain::brand::{BrandSlot, TitleFont};
use nimbytes_core::usecases::brand::{
    BrandView, NewBrandKit, brand_kit, brand_upload, save_brand_kit,
};
use nimbytes_core::{AppError, ErrorCode};

use super::json::ApiJson;
use super::{ApiError, CurrentUser};
use crate::state::AppState;

fn body(v: BrandView) -> BrandKitBody {
    BrandKitBody {
        colors: v.kit.colors,
        title_font: v.kit.title_font.as_str().to_owned(),
        logo_key: v.kit.logo_key.map(|k| k.as_str().to_owned()),
        logo_url: v.logo_url,
        ref_keys: v
            .kit
            .ref_keys
            .iter()
            .map(|k| k.as_str().to_owned())
            .collect(),
        ref_urls: v.ref_urls,
        updated_at: v.kit.updated_at,
    }
}

/// `GET /api/brand`.
pub async fn get(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> Result<Json<BrandResponse>, ApiError> {
    let kit = brand_kit(&state.ports.brand_deps(), &user).await?;
    Ok(Json(BrandResponse { kit: kit.map(body) }))
}

/// `PUT /api/brand`.
pub async fn put(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<SaveBrandRequest>,
) -> Result<Json<BrandKitBody>, ApiError> {
    let new = NewBrandKit {
        colors: b.colors,
        title_font: TitleFont::parse(&b.title_font)?,
        logo_key: b.logo_key,
        ref_keys: b.ref_keys,
    };
    let saved = save_brand_kit(&state.ports.brand_deps(), &user, new).await?;
    Ok(Json(body(saved)))
}

/// `POST /api/brand/uploads`: a presigned PUT for a logo or a style reference.
pub async fn upload(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(b): ApiJson<BrandUploadRequest>,
) -> Result<Json<BrandUploadResponse>, ApiError> {
    let slot = match (b.kind, b.slot) {
        (BrandUploadKind::Logo, _) => BrandSlot::Logo,
        (BrandUploadKind::Ref, Some(n)) => BrandSlot::Ref(n),
        (BrandUploadKind::Ref, None) => {
            return Err(
                AppError::new(ErrorCode::ValidationFailed, "a ref upload needs a slot").into(),
            );
        }
    };
    let deps = state.ports.brand_deps();
    let (key, url) = brand_upload(&deps, &user, (slot, &b.content_type, b.size_bytes)).await?;
    Ok(Json(BrandUploadResponse {
        key: key.as_str().to_owned(),
        url,
    }))
}
