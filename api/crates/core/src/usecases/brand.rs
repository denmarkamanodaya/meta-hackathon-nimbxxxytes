//! The brand kit: read it with signed images, save it, and hand out upload URLs for its logo and
//! style references.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domain::brand::{
    BrandKit, BrandSlot, TitleFont, anchor_keys, checked_colors, checked_keys, upload_key,
};
use crate::domain::ids::UserId;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{BlobStore, BrandStore, Clock};
use crate::time::format_utc;

/// Lifetime of a brand upload URL.
pub const UPLOAD_TTL: Duration = Duration::from_secs(15 * 60);

/// Ports the brand kit use cases need.
pub struct BrandDeps<'a> {
    /// Kits.
    pub brand: &'a dyn BrandStore,
    /// Brand images.
    pub blobs: &'a dyn BlobStore,
    /// Save time.
    pub clock: &'a dyn Clock,
    /// Lifetime of signed GET URLs.
    pub url_ttl: Duration,
}

/// A kit with signed image URLs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrandView {
    /// The kit.
    pub kit: BrandKit,
    /// Signed logo.
    pub logo_url: Option<String>,
    /// Signed references, in kit order.
    pub ref_urls: Vec<String>,
}

/// What the owner saves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewBrandKit {
    /// 1–3 `#rrggbb` colours, the first is the accent.
    pub colors: Vec<String>,
    /// `bricolage` or `geist`.
    pub title_font: TitleFont,
    /// An uploaded logo key, or none.
    pub logo_key: Option<String>,
    /// Uploaded reference keys, at most 4.
    pub ref_keys: Vec<String>,
}

async fn view(deps: &BrandDeps<'_>, kit: BrandKit) -> Result<BrandView, AppError> {
    let logo_url = match &kit.logo_key {
        Some(k) => Some(deps.blobs.presign_get(k, deps.url_ttl).await?),
        None => None,
    };
    let mut ref_urls = Vec::with_capacity(kit.ref_keys.len());
    for k in &kit.ref_keys {
        ref_urls.push(deps.blobs.presign_get(k, deps.url_ttl).await?);
    }
    Ok(BrandView {
        kit,
        logo_url,
        ref_urls,
    })
}

/// The user's kit, or `None` when they have not saved one (renders use the defaults).
///
/// # Errors
/// Store and signing errors.
pub async fn brand_kit(deps: &BrandDeps<'_>, user: &UserId) -> Result<Option<BrandView>, AppError> {
    match deps.brand.brand_kit(user).await? {
        Some(kit) => Ok(Some(view(deps, kit).await?)),
        None => Ok(None),
    }
}

/// Saves the user's kit. Every key must be one of the user's brand keys in its slot and already
/// uploaded.
///
/// # Errors
/// `VALIDATION_FAILED` for bad colours or keys; `NOT_FOUND` for a key with nothing uploaded;
/// store errors.
pub async fn save_brand_kit(
    deps: &BrandDeps<'_>,
    user: &UserId,
    new: NewBrandKit,
) -> Result<BrandView, AppError> {
    let colors = checked_colors(&new.colors)?;
    let (logo_key, ref_keys) = checked_keys(user, new.logo_key.as_deref(), &new.ref_keys)?;
    for key in logo_key.iter().chain(&ref_keys) {
        uploaded(deps.blobs, key).await?;
    }
    let kit = BrandKit {
        colors,
        title_font: new.title_font,
        logo_key,
        ref_keys,
        updated_at: format_utc(deps.clock.now_millis()),
    };
    deps.brand.put_brand_kit(user, &kit).await?;
    view(deps, kit).await
}

async fn uploaded(blobs: &dyn BlobStore, key: &ObjectKey) -> Result<(), AppError> {
    blobs.object_size(key).await.map(|_| ()).map_err(|e| {
        if e.code == ErrorCode::NotFound {
            AppError::new(ErrorCode::NotFound, format!("nothing uploaded at {key}"))
        } else {
            e
        }
    })
}

/// A PUT URL for a logo or style reference of `user`, and the key to save in the kit after.
///
/// # Errors
/// `VALIDATION_FAILED` for a type other than PNG or JPEG, a size of 0 or over 5 MB, or a slot
/// outside 0–3; signing errors.
pub async fn brand_upload(
    deps: &BrandDeps<'_>,
    user: &UserId,
    (slot, content_type, size_bytes): (BrandSlot, &str, u64),
) -> Result<(ObjectKey, String), AppError> {
    let key = upload_key(user, slot, content_type, size_bytes)?;
    let url = deps.blobs.presign_put(&key, UPLOAD_TTL).await?;
    Ok((key, url))
}

/// The owner's brand anchors (logo, then two style references) downloaded into `dir` for an
/// image model; none without a kit. An image that cannot be downloaded is left out.
///
/// # Errors
/// Store errors.
pub async fn local_anchors(
    brand: &dyn BrandStore,
    blobs: &dyn BlobStore,
    user: &UserId,
    dir: &Path,
) -> Result<Vec<PathBuf>, AppError> {
    let kit = brand.brand_kit(user).await?;
    let mut out = Vec::new();
    for key in anchor_keys(kit.as_ref()) {
        let name = key.as_str().rsplit('/').next().unwrap_or("anchor");
        let path = dir.join(format!("brand_{name}"));
        if blobs.get_to_file(&key, &path).await.is_ok() {
            out.push(path);
        }
    }
    Ok(out)
}
