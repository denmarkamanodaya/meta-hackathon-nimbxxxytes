//! iRead: the owner uploads a photo of a letter or a PDF, a `read` job turns it into page images
//! and Muse Spark reads them; then the owner asks about it and hears the answer, or hears the
//! whole text part by part. Every spoken text is cached by its hash.

mod run;
mod voice;

use std::sync::Arc;
use std::time::Duration;

use crate::domain::document::{
    DocStatus, Document, DocumentPage, NewDocument, PART_CHARS, checked_question, checked_upload,
    document_title, part_text, text_parts,
};
use crate::domain::ids::{DocumentId, JobId, ProjectId, UserId};
use crate::domain::item::{ItemRef, projects_of};
use crate::domain::job::JobKind;
use crate::domain::storage_cap::StorageCap;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{
    AnswerRequest, BlobStore, Clock, DocProgress, DocumentReader, DocumentStore, IdGenerator,
    JobQueue, MediaTool, Narrator, NewJob, ProjectStore, PutFile, Scratch, UsageStore,
};
use crate::time::format_utc;
use crate::usecases::storage::{Quota, ensure_room};

pub use voice::Spoken;

/// Every port iRead uses, bound once by the composition root; the request handlers and the
/// `read` job share it.
#[derive(Clone)]
pub struct DocumentPorts {
    /// Document rows.
    pub store: Arc<dyn DocumentStore>,
    /// Project links (each row shows the projects it is in).
    pub projects: Arc<dyn ProjectStore>,
    /// Private objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Working files.
    pub scratch: Arc<dyn Scratch>,
    /// PDF pages and page JPEGs.
    pub media: Arc<dyn MediaTool>,
    /// The `read` job.
    pub jobs: Arc<dyn JobQueue>,
    /// Spark reads and answers.
    pub reader: Arc<dyn DocumentReader>,
    /// MMS-TTS; `None` when `TTS_MODEL_DIR` is unset (answers then have no audio).
    pub narrator: Option<Arc<dyn Narrator>>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Storage measurements for the cap.
    pub usage: Arc<dyn UsageStore>,
    /// The per-account cap.
    pub cap: StorageCap,
    /// Lifetime of the GET URLs handed out.
    pub url_ttl: Duration,
    /// Lifetime of the upload URL.
    pub upload_ttl: Duration,
}

/// A created document and the URL the client PUTs the file to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedDocument {
    /// The new document.
    pub document_id: DocumentId,
    /// Presigned PUT of the file.
    pub upload_url: String,
}

/// One row of the documents list.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentView {
    /// The row.
    pub doc: Document,
    /// Page 1, signed; `None` before the pages are made.
    pub thumb_url: Option<String>,
    /// Projects it is in.
    pub project_ids: Vec<ProjectId>,
}

/// A whole document.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentDetailView {
    /// The row and its thumbnail.
    pub view: DocumentView,
    /// Each page's number and signed image.
    pub pages: Vec<(u32, String)>,
    /// The spoken summary, signed.
    pub summary_audio_url: Option<String>,
}

/// An answered question.
#[derive(Debug, Clone, PartialEq)]
pub struct Answered {
    /// The question as asked (trimmed).
    pub question: String,
    /// Spark's answer.
    pub answer: String,
    /// The answer spoken.
    pub voice: Spoken,
}

/// One part of the whole text, spoken.
#[derive(Debug, Clone, PartialEq)]
pub struct SpokenPart {
    /// 0-based.
    pub part: u32,
    /// How many parts the text has.
    pub parts: u32,
    /// The part's text.
    pub text: String,
    /// The part spoken.
    pub voice: Spoken,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

fn now(p: &DocumentPorts) -> String {
    format_utc(p.clock.now_millis())
}

/// `user`'s document.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn owned_document(
    store: &dyn DocumentStore,
    user: &UserId,
    id: &DocumentId,
) -> Result<Document, AppError> {
    let doc = store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such document"))?;
    if &doc.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "document belongs to another user",
        ));
    }
    Ok(doc)
}

/// Checks the file, the account's room for it, creates the document (`uploading`) and presigns
/// the PUT of the file.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad name, type or size; `STORAGE_FULL` past the cap; store errors.
pub async fn create_document(
    p: &DocumentPorts,
    user: &UserId,
    req: NewDocument,
) -> Result<CreatedDocument, AppError> {
    let format = checked_upload(&req)?;
    let quota = Quota {
        usage: p.usage.as_ref(),
        cap: p.cap,
    };
    ensure_room(
        quota,
        (p.blobs.as_ref(), p.clock.as_ref()),
        user,
        req.size_bytes,
    )
    .await?;
    let id = DocumentId::parse(p.ids.new_id())?;
    let doc = Document::uploading((id, user.clone()), req, format, &now(p));
    p.store.create(&doc).await?;
    let key = keys::document_source(user, &doc.id, format);
    let upload_url = p.blobs.presign_put(&key, p.upload_ttl).await?;
    Ok(CreatedDocument {
        document_id: doc.id,
        upload_url,
    })
}

/// Queues the document's read job (a finished or failed one runs again from its first step).
async fn queue_read(p: &DocumentPorts, doc: &Document) -> Result<(), AppError> {
    let at = now(p);
    let progress = DocProgress {
        status: DocStatus::Reading,
        error: None,
        at: &at,
    };
    p.store.set_progress(&doc.id, progress).await?;
    let ms = p.clock.now_millis();
    let job = JobId::parse(p.ids.new_id())?;
    let new = NewJob {
        id: &job,
        kind: JobKind::Read,
        subject_id: doc.id.as_str(),
    };
    p.jobs.enqueue(new, ms).await?;
    p.jobs.restart(JobKind::Read, doc.id.as_str(), ms).await
}

/// The file is uploaded: checks it is there and at most 20 MB, then queues the read. Idempotent:
/// a document being read or read answers its status; a failed one is read again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` when nothing was uploaded or the file is too
/// large; store and queue errors.
pub async fn complete_document(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
) -> Result<DocStatus, AppError> {
    let doc = owned_document(p.store.as_ref(), user, id).await?;
    match doc.status {
        DocStatus::Reading | DocStatus::Ready => return Ok(doc.status),
        DocStatus::Failed => {}
        DocStatus::Uploading => {
            let key = keys::document_source(user, id, doc.format);
            let size = match p.blobs.object_size(&key).await {
                Err(e) if e.code == ErrorCode::NotFound => {
                    return Err(invalid("upload the file before completing"));
                }
                other => other?,
            };
            if size > crate::domain::document::MAX_BYTES {
                return Err(invalid("the file is larger than 20 MB"));
            }
        }
    }
    queue_read(p, &doc).await?;
    Ok(DocStatus::Reading)
}

/// A document's file as the client sent it through the API.
#[derive(Debug, Clone, Copy)]
pub struct SourceFile<'a> {
    /// The request's `Content-Type`, if any.
    pub content_type: Option<&'a str>,
    /// The file.
    pub bytes: &'a [u8],
}

/// The client sends the file through the API rather than straight to storage, so no app origin
/// needs storage CORS: checks it as [`create_document`] does and that it is the type the
/// document was added as, stores it at the document's source key, then completes the document
/// with [`complete_document`]. A document being read or read answers its status and keeps its
/// file.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a missing or other type, an empty file or
/// one over 20 MB; scratch, storage, store and queue errors.
pub async fn upload_document_source(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
    file: SourceFile<'_>,
) -> Result<DocStatus, AppError> {
    let doc = owned_document(p.store.as_ref(), user, id).await?;
    if matches!(doc.status, DocStatus::Reading | DocStatus::Ready) {
        return Ok(doc.status);
    }
    let sent = NewDocument {
        filename: doc.filename.clone(),
        content_type: file.content_type.unwrap_or_default().to_owned(),
        size_bytes: u64::try_from(file.bytes.len()).unwrap_or(u64::MAX),
    };
    let format = checked_upload(&sent)?;
    if format != doc.format {
        return Err(invalid(&format!(
            "the file must be {}, the type it was added as",
            doc.format.as_str()
        )));
    }
    let path = p.source_path(id, format).await?;
    p.scratch.write_file(&path, file.bytes).await?;
    let key = keys::document_source(user, id, format);
    let put = PutFile {
        key: &key,
        path: &path,
        content_type: format.as_str(),
        class: None,
        cache_control: None,
    };
    p.blobs.put_file(put).await?;
    complete_document(p, user, id).await
}

async fn signed(p: &DocumentPorts, key: Option<&ObjectKey>) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => Ok(Some(p.blobs.presign_get(k, p.url_ttl).await?)),
        None => Ok(None),
    }
}

async fn view(
    p: &DocumentPorts,
    doc: Document,
    links: &[(ItemRef, ProjectId)],
) -> Result<DocumentView, AppError> {
    let project_ids = projects_of(links, &ItemRef::Document(doc.id.clone()));
    let first = (doc.page_count > 0).then(|| keys::document_page(&doc.user_id, &doc.id, 1));
    Ok(DocumentView {
        thumb_url: signed(p, first.as_ref()).await?,
        doc,
        project_ids,
    })
}

/// `user`'s documents, newest first.
///
/// # Errors
/// Store and storage errors.
pub async fn list_documents(
    p: &DocumentPorts,
    user: &UserId,
) -> Result<Vec<DocumentView>, AppError> {
    let links = p.projects.item_links(user).await?;
    let mut out = Vec::new();
    for doc in p.store.list(user).await? {
        out.push(view(p, doc, &links).await?);
    }
    Ok(out)
}

/// `user`'s document with its pages and spoken summary.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store and storage errors.
pub async fn get_document(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
) -> Result<DocumentDetailView, AppError> {
    let doc = owned_document(p.store.as_ref(), user, id).await?;
    let mut pages = Vec::new();
    for DocumentPage { n, image_key } in p.store.pages(id).await? {
        pages.push((n, p.blobs.presign_get(&image_key, p.url_ttl).await?));
    }
    let summary_key = current_summary_voice(p, &doc).await?;
    let summary_audio_url = signed(p, summary_key.as_ref()).await?;
    Ok(DocumentDetailView {
        view: view(p, doc, &p.projects.item_links(user).await?).await?,
        pages,
        summary_audio_url,
    })
}

/// The summary's voice in the current [`VOICE`](crate::domain::guide::VOICE): a summary spoken
/// before a voice change (for example the old symbol-dropping text) is spoken again, once, and
/// stored. Without a narrator, or when speaking fails, the stored key stays.
///
/// # Errors
/// Store errors when recording a new key.
async fn current_summary_voice(
    p: &DocumentPorts,
    doc: &Document,
) -> Result<Option<ObjectKey>, AppError> {
    if doc.status != DocStatus::Ready || p.narrator.is_none() || doc.summary.trim().is_empty() {
        return Ok(doc.summary_audio_key.clone());
    }
    let Ok(key) = voice::voice_of(p, doc, &doc.summary).await else {
        return Ok(doc.summary_audio_key.clone());
    };
    if doc.summary_audio_key.as_ref() != Some(&key) {
        p.store.set_summary_audio(&doc.id, &key).await?;
    }
    Ok(Some(key))
}

/// Renames `user`'s document and answers it in full./// Renames `user`'s document and answers it in full.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for an empty or too-long title; store errors.
pub async fn rename_document(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
    title: &str,
) -> Result<DocumentDetailView, AppError> {
    owned_document(p.store.as_ref(), user, id).await?;
    let title = document_title(title)?;
    p.store.set_title(id, &title, &now(p)).await?;
    get_document(p, user, id).await
}

/// Deletes `user`'s document: every object (source, pages, voices), its rows, its job and its
/// working files.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; storage, store and queue errors.
pub async fn delete_document(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
) -> Result<(), AppError> {
    let doc = owned_document(p.store.as_ref(), user, id).await?;
    let voices = p.store.voices(id).await?;
    let objects = keys::document_objects(&doc.user_id, id, doc.format, &voices);
    p.blobs.delete(&objects).await?;
    p.store.delete(id).await?;
    p.jobs.cancel(JobKind::Read, id.as_str()).await?;
    p.scratch.remove_document_dir(id).await
}

/// `user`'s document, read.
async fn ready(p: &DocumentPorts, user: &UserId, id: &DocumentId) -> Result<Document, AppError> {
    let doc = owned_document(p.store.as_ref(), user, id).await?;
    match doc.status {
        DocStatus::Ready => Ok(doc),
        DocStatus::Failed => Err(invalid(
            "the document could not be read; try reading it again",
        )),
        DocStatus::Uploading | DocStatus::Reading => {
            Err(invalid("the document is still being read"))
        }
    }
}

/// Spark answers the question from the document's text; the answer is spoken.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a bad question or a document not read
/// yet; `MODEL_UNAVAILABLE` when Spark fails. A voice that cannot be made is not an error.
pub async fn ask_document(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
    question: &str,
) -> Result<Answered, AppError> {
    let question = checked_question(question)?;
    let doc = ready(p, user, id).await?;
    let request = AnswerRequest {
        text: &doc.text,
        question: &question,
    };
    let answer = p.reader.answer(request).await?;
    let voice = voice::spoken(p, &doc, &answer).await;
    Ok(Answered {
        question,
        answer,
        voice,
    })
}

/// Part `part` (0-based) of the document's text, spoken.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a document not read yet or a part past
/// the last. A voice that cannot be made is not an error.
pub async fn speak_part(
    p: &DocumentPorts,
    user: &UserId,
    id: &DocumentId,
    part: u32,
) -> Result<SpokenPart, AppError> {
    let doc = ready(p, user, id).await?;
    let parts = text_parts(&doc.text, PART_CHARS);
    let text = usize::try_from(part)
        .ok()
        .and_then(|i| parts.get(i))
        .map(|s| part_text(s))
        .ok_or_else(|| invalid("no such part"))?;
    let voice = voice::spoken(p, &doc, &text).await;
    Ok(SpokenPart {
        part,
        parts: u32::try_from(parts.len()).unwrap_or(u32::MAX),
        text,
        voice,
    })
}
