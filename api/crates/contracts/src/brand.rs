//! `GET/PUT /api/brand` and `POST /api/brand/uploads`: the owner's brand kit.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// A saved kit with signed images.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BrandKitBody {
    /// 1–3 `#rrggbb` colours, lower case; the first is the video accent.
    pub colors: Vec<String>,
    /// `bricolage` or `geist`.
    pub title_font: String,
    /// Logo key (send it back in `PUT`).
    pub logo_key: Option<String>,
    /// Presigned logo.
    pub logo_url: Option<String>,
    /// Style reference keys, at most 4.
    pub ref_keys: Vec<String>,
    /// Presigned references, in `ref_keys` order.
    pub ref_urls: Vec<String>,
    /// Last save, ISO-8601 UTC.
    pub updated_at: String,
}

/// `GET /api/brand`; `kit` is null until the owner saves one (renders use the app defaults).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BrandResponse {
    /// The kit, or null.
    pub kit: Option<BrandKitBody>,
}

/// `PUT /api/brand`: the whole kit (answers with `BrandKitBody`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct SaveBrandRequest {
    /// 1–3 `#rrggbb` colours; the first is the accent.
    pub colors: Vec<String>,
    /// `bricolage` or `geist`.
    pub title_font: String,
    /// A key from `POST /api/brand/uploads` (`kind: logo`), uploaded; null for none.
    #[serde(default)]
    pub logo_key: Option<String>,
    /// Keys from `POST /api/brand/uploads` (`kind: ref`), uploaded, at most 4.
    #[serde(default)]
    pub ref_keys: Vec<String>,
}

/// What a brand upload is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BrandUploadKind {
    /// The logo.
    Logo,
    /// A style reference (needs `slot`).
    Ref,
}

/// `POST /api/brand/uploads`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct BrandUploadRequest {
    /// `logo` or `ref`.
    pub kind: BrandUploadKind,
    /// Reference slot 0–3 (`ref` only).
    #[serde(default)]
    pub slot: Option<u32>,
    /// `image/png` or `image/jpeg`.
    pub content_type: String,
    /// Up to 5 MB.
    pub size_bytes: u64,
}

/// Where to PUT the file, and the key to save in the kit afterwards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct BrandUploadResponse {
    /// Object key.
    pub key: String,
    /// Presigned PUT URL, valid 15 minutes.
    pub url: String,
}
