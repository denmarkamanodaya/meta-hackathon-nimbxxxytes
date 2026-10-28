//! The owner's brand kit: colours, title font, logo and style references. It themes renders and
//! anchors generated images; without a kit renders keep the app's defaults.

use crate::domain::ids::UserId;
use crate::domain::render::{Theme, VIDEO_ACCENT, VIDEO_FONT};
use crate::domain::text_enum::text_enum;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};

/// Most brand colours.
pub const MAX_COLORS: usize = 3;
/// Most style references.
pub const MAX_REFS: u32 = 4;
/// Largest logo or reference upload, bytes.
pub const MAX_UPLOAD_BYTES: u64 = 5 * 1024 * 1024;
/// Style references passed to the image model with the logo (the rest stay for the owner).
pub const ANCHOR_REFS: usize = 2;
/// Font stack of the `bricolage` title font.
pub const BRICOLAGE_FONT: &str =
    "'Bricolage Grotesque', Geist, Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif";
/// Font stack of the `geist` title font.
pub const GEIST_FONT: &str = "Geist, Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif";

text_enum!(
    /// File type of an image the owner uploads (brand logo, style references).
    ImageExt {
        /// PNG.
        Png => "png",
        /// JPEG.
        Jpg => "jpg",
    }
);

/// The kit's title font.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TitleFont {
    /// Bricolage Grotesque, bold.
    Bricolage,
    /// Geist, clean.
    Geist,
}

impl TitleFont {
    /// Stored and wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Bricolage => "bricolage",
            Self::Geist => "geist",
        }
    }

    /// Parses stored or wire text.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for anything else.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Bricolage, Self::Geist]
            .into_iter()
            .find(|f| f.as_str() == raw)
            .ok_or_else(|| invalid("title_font must be bricolage or geist"))
    }

    /// The CSS font stack drawn in the video.
    pub fn stack(self) -> &'static str {
        match self {
            Self::Bricolage => BRICOLAGE_FONT,
            Self::Geist => GEIST_FONT,
        }
    }
}

/// A saved brand kit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrandKit {
    /// 1–3 `#rrggbb` colours, lower case; the first is the accent.
    pub colors: Vec<String>,
    /// Title font.
    pub title_font: TitleFont,
    /// Logo object.
    pub logo_key: Option<ObjectKey>,
    /// Style reference objects, at most [`MAX_REFS`].
    pub ref_keys: Vec<ObjectKey>,
    /// Last save (ISO-8601 UTC).
    pub updated_at: String,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

/// The colours in lower case when there are 1 to 3 and each is `#rrggbb`.
///
/// # Errors
/// `VALIDATION_FAILED` otherwise.
pub fn checked_colors(colors: &[String]) -> Result<Vec<String>, AppError> {
    if colors.is_empty() || colors.len() > MAX_COLORS {
        return Err(invalid("colors must be 1 to 3 #rrggbb values"));
    }
    colors
        .iter()
        .map(|c| {
            let c = c.trim().to_ascii_lowercase();
            let hex = c.strip_prefix('#').unwrap_or_default();
            if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                Ok(c)
            } else {
                Err(invalid(format!("{c} is not a #rrggbb colour")))
            }
        })
        .collect()
}

/// The video theme of a kit: its first colour and its title font; without a kit, the defaults.
pub fn theme_for(kit: Option<&BrandKit>) -> Theme {
    match kit {
        Some(k) => Theme {
            accent: k
                .colors
                .first()
                .cloned()
                .unwrap_or_else(|| VIDEO_ACCENT.to_owned()),
            font: k.title_font.stack().to_owned(),
        },
        None => Theme {
            accent: VIDEO_ACCENT.to_owned(),
            font: VIDEO_FONT.to_owned(),
        },
    }
}

/// What a brand object is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrandSlot {
    /// The logo.
    Logo,
    /// Style reference `n` (0-based, below [`MAX_REFS`]).
    Ref(u32),
}

/// The slot of `raw` when it is one of `user`'s brand keys, else `None`.
pub fn brand_slot(user: &UserId, raw: &str) -> Option<BrandSlot> {
    [ImageExt::Png, ImageExt::Jpg].into_iter().find_map(|ext| {
        if keys::brand_logo(user, ext).as_str() == raw {
            return Some(BrandSlot::Logo);
        }
        (0..MAX_REFS).find_map(|n| {
            (keys::brand_ref(user, n, ext).as_str() == raw).then_some(BrandSlot::Ref(n))
        })
    })
}

/// The logo and reference keys checked: each one of `user`'s brand keys in the right slot, the
/// references distinct and at most [`MAX_REFS`].
///
/// # Errors
/// `VALIDATION_FAILED` for another user's key, a key in the wrong slot, a repeat or too many.
pub fn checked_keys(
    user: &UserId,
    logo: Option<&str>,
    refs: &[String],
) -> Result<(Option<ObjectKey>, Vec<ObjectKey>), AppError> {
    let logo = match logo {
        Some(raw) if brand_slot(user, raw) == Some(BrandSlot::Logo) => {
            Some(ObjectKey::from_stored(raw.to_owned()))
        }
        Some(_) => return Err(invalid("logo_key is not your brand logo")),
        None => None,
    };
    if refs.len() > MAX_REFS as usize {
        return Err(invalid("at most 4 style references"));
    }
    let mut slots = Vec::with_capacity(refs.len());
    for raw in refs {
        match brand_slot(user, raw) {
            Some(BrandSlot::Ref(n)) if !slots.contains(&n) => slots.push(n),
            Some(BrandSlot::Ref(_)) => return Err(invalid("a style reference slot is repeated")),
            _ => return Err(invalid("a ref_key is not one of your style references")),
        }
    }
    let refs = refs
        .iter()
        .map(|r| ObjectKey::from_stored(r.clone()))
        .collect();
    Ok((logo, refs))
}

/// The key a brand upload goes to.
///
/// # Errors
/// `VALIDATION_FAILED` for a content type other than PNG or JPEG, a size of 0 or over 5 MB, or a
/// reference slot outside 0–3.
pub fn upload_key(
    user: &UserId,
    slot: BrandSlot,
    content_type: &str,
    size_bytes: u64,
) -> Result<ObjectKey, AppError> {
    let ext = match content_type {
        "image/png" => ImageExt::Png,
        "image/jpeg" => ImageExt::Jpg,
        _ => return Err(invalid("content_type must be image/png or image/jpeg")),
    };
    if size_bytes == 0 || size_bytes > MAX_UPLOAD_BYTES {
        return Err(invalid("brand images are 1 byte to 5 MB"));
    }
    Ok(match slot {
        BrandSlot::Logo => keys::brand_logo(user, ext),
        BrandSlot::Ref(n) if n < MAX_REFS => keys::brand_ref(user, n, ext),
        BrandSlot::Ref(_) => return Err(invalid("slot must be 0 to 3")),
    })
}

/// The images a generated frame follows: the logo, then the first [`ANCHOR_REFS`] references.
pub fn anchor_keys(kit: Option<&BrandKit>) -> Vec<ObjectKey> {
    let Some(k) = kit else {
        return Vec::new();
    };
    k.logo_key
        .iter()
        .chain(k.ref_keys.iter().take(ANCHOR_REFS))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests;
