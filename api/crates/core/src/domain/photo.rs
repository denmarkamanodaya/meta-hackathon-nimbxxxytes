//! Photos: a still image from the device, analysed once (Muse Spark facts, Perception Encoder
//! embedding) and then found by search next to video moments. The pure rules: what may be
//! uploaded, the date taken, the camera, Spark's facts tidied, the title, and the search key a
//! photo is indexed under.

use crate::domain::ids::{PhotoId, SegmentId, UserId};
use crate::domain::text_enum::text_enum;
use crate::domain::title::owner_title;
use crate::error::{AppError, ErrorCode};
use crate::time::{format_utc, parse_utc};

/// Largest file accepted, bytes (40 MB).
pub const MAX_BYTES: u64 = 40 * 1024 * 1024;
/// Longest client file name, bytes.
pub const MAX_FILENAME_BYTES: usize = 255;
/// Long edge of the viewing copy, pixels.
pub const VIEW_EDGE_PX: u32 = 2048;
/// Long edge of the thumbnail, pixels.
pub const THUMB_EDGE_PX: u32 = 480;
/// Long edge of the copy Spark looks at, pixels.
pub const SPARK_EDGE_PX: u32 = 1280;
/// Longest title, characters.
pub const MAX_TITLE_CHARS: usize = 80;
/// Most things kept.
pub const MAX_THINGS: usize = 8;
/// What a photo's search key starts with; the rest is the photo id. Moment keys never do.
pub const SEARCH_KEY_PREFIX: &str = "photo_";
/// How a photo's search key is written on the wire (`photo:{id}`).
pub const WIRE_KEY_PREFIX: &str = "photo:";

text_enum!(
    /// What was uploaded, by its MIME type.
    PhotoFormat {
        /// A JPEG.
        Jpeg => "image/jpeg",
        /// A PNG.
        Png => "image/png",
        /// A WebP.
        Webp => "image/webp",
    }
);

impl PhotoFormat {
    /// The original's extension.
    pub fn ext(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
        }
    }
}

text_enum!(
    /// Where a photo is.
    PhotoStatus {
        /// Created; the client is uploading the file.
        Uploading => "uploading",
        /// The `photo` job is fitting, describing, embedding and indexing it.
        Analysing => "analysing",
        /// Searchable.
        Ready => "ready",
        /// The job gave up; see the error.
        Failed => "failed",
    }
);

/// What Spark saw in a photo, tidied by [`tidied_facts`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PhotoFacts {
    /// A short name.
    pub title: String,
    /// One or two sentences.
    pub description: String,
    /// At most [`MAX_THINGS`] short nouns.
    pub things: Vec<String>,
    /// The kind of place, or empty.
    pub place: String,
    /// One or two words, or empty.
    pub mood: String,
}

/// What reading the image tells (after orientation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhotoFit {
    /// Pixels after orientation.
    pub width: u32,
    /// Pixels after orientation.
    pub height: u32,
    /// Date taken, ISO-8601 UTC (see [`taken_at`]).
    pub taken_at: String,
    /// Camera make and model.
    pub camera: Option<String>,
}

/// A stored photo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Photo {
    /// Id.
    pub id: PhotoId,
    /// Owner.
    pub user_id: UserId,
    /// The client's file name.
    pub filename: String,
    /// What was uploaded.
    pub format: PhotoFormat,
    /// Declared size, bytes.
    pub size_bytes: u64,
    /// The file's time on the device (ISO-8601 UTC), the date taken when the photo has none.
    pub last_modified: Option<String>,
    /// Where it is.
    pub status: PhotoStatus,
    /// Spark's title (or the owner's); empty until described.
    pub title: String,
    /// Empty until described.
    pub facts: PhotoFacts,
    /// Pixels after orientation, once read.
    pub width: Option<u32>,
    /// Pixels after orientation, once read.
    pub height: Option<u32>,
    /// Date taken, once read.
    pub taken_at: Option<String>,
    /// Camera make and model, when the photo names them.
    pub camera: Option<String>,
    /// Why the job failed.
    pub error: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// What the client declares before uploading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewPhoto {
    /// Its name on the device.
    pub filename: String,
    /// Its MIME type.
    pub content_type: String,
    /// Its size, bytes.
    pub size_bytes: u64,
    /// Its time on the device.
    pub last_modified: Option<String>,
}

impl Photo {
    /// A new photo of `user`, `uploading`, created and updated `at`.
    pub fn uploading(
        (id, user): (PhotoId, UserId),
        req: NewPhoto,
        format: PhotoFormat,
        at: &str,
    ) -> Self {
        Self {
            id,
            user_id: user,
            filename: req.filename,
            format,
            size_bytes: req.size_bytes,
            last_modified: req.last_modified.as_deref().and_then(utc),
            status: PhotoStatus::Uploading,
            title: String::new(),
            facts: PhotoFacts::default(),
            width: None,
            height: None,
            taken_at: None,
            camera: None,
            error: None,
            created_at: at.to_owned(),
            updated_at: at.to_owned(),
        }
    }

    /// The title shown: Spark's or the owner's, else the file name.
    pub fn shown_title(&self) -> &str {
        if self.title.is_empty() {
            &self.filename
        } else {
            &self.title
        }
    }
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// A client time as our fixed-width UTC form; `None` when it is not one.
fn utc(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let with_ms = match raw.split_once('.') {
        Some(_) => raw.to_owned(),
        None => raw.strip_suffix('Z').map(|t| format!("{t}.000Z"))?,
    };
    parse_utc(&with_ms).map(format_utc)
}

/// The format of a file the client may upload.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long name, HEIC/HEIF (not decoded yet), another
/// type, an empty file or one over [`MAX_BYTES`].
pub fn checked_upload(p: &NewPhoto) -> Result<PhotoFormat, AppError> {
    if p.filename.trim().is_empty() || p.filename.len() > MAX_FILENAME_BYTES {
        return Err(invalid("the file needs a name of at most 255 bytes"));
    }
    let essence = p
        .content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(essence.as_str(), "image/heic" | "image/heif") {
        return Err(invalid("HEIC isn't supported yet; export as JPEG"));
    }
    let format = PhotoFormat::parse(&essence)
        .map_err(|_| invalid("only a photo (JPEG, PNG or WebP) can be added"))?;
    if p.size_bytes == 0 {
        return Err(invalid("the file is empty"));
    }
    if p.size_bytes > MAX_BYTES {
        return Err(invalid("the file is larger than 40 MB"));
    }
    Ok(format)
}

/// An EXIF date (`2026:08:08 14:09:37`) with its offset (`+08:00`) as ISO-8601 UTC. Without an
/// offset the camera's clock is taken as UTC. `None` for anything else.
pub fn exif_utc(datetime: &str, offset: Option<&str>) -> Option<String> {
    let d = datetime.trim();
    let b = d.as_bytes();
    let shape_ok = b.len() == 19
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 | 13 | 16 => *c == b':',
            10 => *c == b' ',
            _ => c.is_ascii_digit(),
        });
    if !shape_ok || d.starts_with("0000") {
        return None;
    }
    let iso = format!(
        "{}-{}-{}T{}.000Z",
        &d[0..4],
        &d[5..7],
        &d[8..10],
        &d[11..19]
    );
    let local = parse_utc(&iso)?;
    let shift = offset.and_then(offset_millis).unwrap_or(0);
    Some(format_utc(local - shift))
}

/// `+08:00` / `-05:30` as milliseconds east of UTC.
fn offset_millis(raw: &str) -> Option<i64> {
    let raw = raw.trim();
    let sign = match raw.chars().next()? {
        '+' => 1,
        '-' => -1,
        _ => return None,
    };
    let (h, m) = raw[1..].split_once(':')?;
    let (h, m): (i64, i64) = (h.parse().ok()?, m.parse().ok()?);
    (h <= 14 && m < 60).then_some(sign * (h * 60 + m) * 60_000)
}

/// The date a photo was taken: the photo's own (already UTC), else the device's file time, else
/// when it was added.
pub fn taken_at(own: Option<&str>, last_modified: Option<&str>, created_at: &str) -> String {
    own.or(last_modified).unwrap_or(created_at).to_owned()
}

/// Make and model as one name, without repeating the make (`Canon` + `Canon EOS 200D` is
/// `Canon EOS 200D`); `None` when both are empty.
pub fn camera_name(make: Option<&str>, model: Option<&str>) -> Option<String> {
    let make = make.map(str::trim).filter(|s| !s.is_empty());
    let model = model.map(str::trim).filter(|s| !s.is_empty());
    match (make, model) {
        (Some(mk), Some(md)) if md.to_lowercase().starts_with(&mk.to_lowercase()) => {
            Some(md.to_owned())
        }
        (Some(mk), Some(md)) => Some(format!("{mk} {md}")),
        (one, other) => one.or(other).map(str::to_owned),
    }
}

fn one_line(raw: &str, max: usize) -> String {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .chars()
        .take(max)
        .collect::<String>()
        .trim_end()
        .to_owned()
}

/// Spark's facts made safe: one-line title (at most 6 words), description and place and mood
/// trimmed, at most [`MAX_THINGS`] distinct non-empty things.
pub fn tidied_facts(f: &PhotoFacts) -> PhotoFacts {
    let title = f
        .title
        .split_whitespace()
        .take(6)
        .collect::<Vec<_>>()
        .join(" ");
    let mut things: Vec<String> = Vec::new();
    for t in f
        .things
        .iter()
        .map(|t| one_line(t, 40))
        .filter(|t| !t.is_empty())
    {
        if !things.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
            things.push(t);
        }
    }
    things.truncate(MAX_THINGS);
    PhotoFacts {
        title: one_line(&title, MAX_TITLE_CHARS),
        description: one_line(&f.description, 600),
        things,
        place: one_line(&f.place, 60),
        mood: one_line(&f.mood, 40),
    }
}

/// A title the owner typed.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or over [`MAX_TITLE_CHARS`].
pub fn photo_title(raw: &str) -> Result<String, AppError> {
    owner_title(raw, MAX_TITLE_CHARS, "a photo")
}

/// The key a photo is indexed under for search (`photo_{id}`, a valid segment-style id).
///
/// # Errors
/// Never for a valid photo id short enough (ids are UUIDs).
pub fn search_key(id: &PhotoId) -> Result<SegmentId, AppError> {
    SegmentId::parse(format!("{SEARCH_KEY_PREFIX}{id}"))
}

/// The photo a search key names, or `None` for a moment.
pub fn photo_of(key: &SegmentId) -> Option<PhotoId> {
    key.as_str()
        .strip_prefix(SEARCH_KEY_PREFIX)
        .and_then(|id| PhotoId::parse(id).ok())
}

/// A photo's search key as the wire writes it: `photo:{id}`.
pub fn wire_key(id: &PhotoId) -> String {
    format!("{WIRE_KEY_PREFIX}{id}")
}

#[cfg(test)]
mod tests;
