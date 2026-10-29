//! iRead documents: a photo of a letter or a PDF (1 to [`MAX_PAGES`] page images) and the text
//! Muse Spark read from it. The pure rules: what may be uploaded, the question limit, the title,
//! Spark's reading tidied, and the sentence and part split the voice speaks by.

use crate::domain::ids::{DocumentId, UserId};
use crate::domain::text_enum::text_enum;
use crate::domain::title::owner_title;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

/// Most pages read from one document (a longer PDF is read up to here).
pub const MAX_PAGES: usize = 10;
/// Longest edge of a page image, pixels (enough for Spark to read small print).
pub const PAGE_LONG_EDGE_PX: u32 = 2000;
/// Resolution a PDF page is drawn at, dots per inch (an A4 page is 1240 x 1754 px).
pub const PDF_DPI: u32 = 150;
/// Largest file accepted, bytes (20 MB).
pub const MAX_BYTES: u64 = 20 * 1024 * 1024;
/// Longest client file name, bytes.
pub const MAX_FILENAME_BYTES: usize = 255;
/// Longest question, characters after trimming.
pub const MAX_QUESTION_CHARS: usize = 500;
/// Longest title, characters.
pub const MAX_TITLE_CHARS: usize = 60;
/// About how long one "Read it all" part is, characters (split at sentence ends).
pub const PART_CHARS: usize = 400;
/// The question asked when the request names none.
pub const DEFAULT_QUESTION: &str = "Tell me what this says";
/// The title when Spark gives none.
pub const FALLBACK_TITLE: &str = "My document";

text_enum!(
    /// What was uploaded, by its MIME type.
    DocFormat {
        /// A JPEG photo.
        Jpeg => "image/jpeg",
        /// A PNG image.
        Png => "image/png",
        /// A WebP image.
        Webp => "image/webp",
        /// A PDF.
        Pdf => "application/pdf",
    }
);

impl DocFormat {
    /// The uploaded file's extension.
    pub fn ext(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Pdf => "pdf",
        }
    }
}

text_enum!(
    /// What kind of paper Spark says it is.
    DocKind {
        /// A letter.
        Letter => "letter",
        /// A bill.
        Bill => "bill",
        /// A form to fill in.
        Form => "form",
        /// A notice.
        Notice => "notice",
        /// A label (a medicine box, a jar).
        Label => "label",
        /// Anything else.
        Other => "other",
    }
);

text_enum!(
    /// Where a document is.
    DocStatus {
        /// Created; the client is uploading the file.
        Uploading => "uploading",
        /// The `read` job is making the pages and reading them.
        Reading => "reading",
        /// Read; it can be asked about and read aloud.
        Ready => "ready",
        /// The read job gave up; see the error.
        Failed => "failed",
    }
);

/// A stored document.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    /// Id.
    pub id: DocumentId,
    /// Owner.
    pub user_id: UserId,
    /// The client's file name.
    pub filename: String,
    /// What was uploaded.
    pub format: DocFormat,
    /// Declared size, bytes.
    pub size_bytes: u64,
    /// Where it is.
    pub status: DocStatus,
    /// Empty until read.
    pub title: String,
    /// `other` until read.
    pub kind: DocKind,
    /// Who sent it; may be empty.
    pub sender: String,
    /// The date printed on it; may be empty.
    pub date: String,
    /// Every word in reading order; empty until read.
    pub text: String,
    /// At most 60 words; empty until read.
    pub summary: String,
    /// Pages made so far.
    pub page_count: u32,
    /// The summary spoken.
    pub summary_audio_key: Option<ObjectKey>,
    /// Why the read failed.
    pub error: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

impl Document {
    /// A new document of `user`, `uploading`, with nothing read yet; created and updated `at`.
    pub fn uploading(
        (id, user): (DocumentId, UserId),
        req: NewDocument,
        format: DocFormat,
        at: &str,
    ) -> Self {
        Self {
            id,
            user_id: user,
            filename: req.filename,
            format,
            size_bytes: req.size_bytes,
            status: DocStatus::Uploading,
            title: String::new(),
            kind: DocKind::Other,
            sender: String::new(),
            date: String::new(),
            text: String::new(),
            summary: String::new(),
            page_count: 0,
            summary_audio_key: None,
            error: None,
            created_at: at.to_owned(),
            updated_at: at.to_owned(),
        }
    }
}

/// One page image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentPage {
    /// 1-based.
    pub n: u32,
    /// The JPEG.
    pub image_key: ObjectKey,
}

/// What Spark read from the pages, tidied by [`tidied_reading`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reading {
    /// A short name.
    pub title: String,
    /// The kind of paper.
    pub kind: DocKind,
    /// Who sent it, or empty.
    pub sender: String,
    /// As printed, or empty.
    pub date: String,
    /// Every word in reading order.
    pub text: String,
    /// At most 60 words.
    pub summary: String,
}

/// What the client declares before uploading.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewDocument {
    /// Its name on the device.
    pub filename: String,
    /// Its MIME type.
    pub content_type: String,
    /// Its size, bytes.
    pub size_bytes: u64,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// The format of a file the client may upload.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long name, a type other than JPEG, PNG, WebP or PDF,
/// an empty file or one over [`MAX_BYTES`].
pub fn checked_upload(d: &NewDocument) -> Result<DocFormat, AppError> {
    if d.filename.trim().is_empty() || d.filename.len() > MAX_FILENAME_BYTES {
        return Err(invalid("the file needs a name of at most 255 bytes"));
    }
    let essence = d.content_type.split(';').next().unwrap_or_default().trim();
    let format = DocFormat::parse(&essence.to_ascii_lowercase())
        .map_err(|_| invalid("only a photo (JPEG, PNG, WebP) or a PDF can be read"))?;
    if d.size_bytes == 0 {
        return Err(invalid("the file is empty"));
    }
    if d.size_bytes > MAX_BYTES {
        return Err(invalid("the file is larger than 20 MB"));
    }
    Ok(format)
}

/// The question trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or longer than [`MAX_QUESTION_CHARS`].
pub fn checked_question(raw: &str) -> Result<String, AppError> {
    let q = raw.trim();
    let n = q.chars().count();
    if n == 0 {
        return Err(invalid("ask a question"));
    }
    if n > MAX_QUESTION_CHARS {
        return Err(invalid("keep the question to 500 characters"));
    }
    Ok(q.to_owned())
}

/// A title the owner typed.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or over [`MAX_TITLE_CHARS`].
pub fn document_title(raw: &str) -> Result<String, AppError> {
    owner_title(raw, MAX_TITLE_CHARS, "a document")
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

/// Spark's raw reading tidied: one-line title (or [`FALLBACK_TITLE`]), sender and date; an
/// unknown kind is `other`; text and summary trimmed.
pub fn tidied_reading(r: &Reading) -> Reading {
    let title = one_line(&r.title, MAX_TITLE_CHARS);
    Reading {
        title: if title.is_empty() {
            FALLBACK_TITLE.to_owned()
        } else {
            title
        },
        kind: r.kind,
        sender: one_line(&r.sender, MAX_TITLE_CHARS * 2),
        date: one_line(&r.date, MAX_TITLE_CHARS),
        text: r.text.trim().to_owned(),
        summary: r.summary.trim().to_owned(),
    }
}

/// The kind named by Spark; `other` for anything else.
pub fn kind_of(raw: &str) -> DocKind {
    DocKind::parse(raw.trim()).unwrap_or(DocKind::Other)
}

/// Characters that may close a sentence after its stop: `."` or `.)`.
const CLOSERS: [char; 6] = ['"', '\'', ')', ']', '”', '’'];

/// The sentences of `text`, each trimmed and single-spaced, empty ones dropped. A sentence ends
/// at `.`, `!` or `?` followed by a space or the end (so `$142.60` stays whole), and at every line
/// break (a bill's lines have no stops).
pub fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\n' {
            push_sentence(&mut out, &mut current);
            continue;
        }
        current.push(c);
        if !matches!(c, '.' | '!' | '?') {
            continue;
        }
        while let Some(&close) = chars.peek().filter(|n| CLOSERS.contains(n)) {
            current.push(close);
            chars.next();
        }
        if chars.peek().is_none_or(|n| n.is_whitespace()) {
            push_sentence(&mut out, &mut current);
        }
    }
    push_sentence(&mut out, &mut current);
    out
}

fn push_sentence(out: &mut Vec<String>, current: &mut String) {
    let s = current.split_whitespace().collect::<Vec<_>>().join(" ");
    if !s.is_empty() {
        out.push(s);
    }
    current.clear();
}

/// `text` in parts of about `max` characters: whole sentences, a part closed when the next
/// sentence would take it past `max` (a longer sentence is a part of its own).
pub fn text_parts(text: &str, max: usize) -> Vec<Vec<String>> {
    let mut parts: Vec<Vec<String>> = Vec::new();
    let mut len = 0;
    for s in sentences(text) {
        let n = s.chars().count();
        match parts.last_mut() {
            Some(part) if len + 1 + n <= max => {
                part.push(s);
                len += 1 + n;
            }
            _ => {
                parts.push(vec![s]);
                len = n;
            }
        }
    }
    parts
}

/// A part's sentences as one line of text.
pub fn part_text(part: &[String]) -> String {
    part.join(" ")
}

#[cfg(test)]
mod tests;
