//! The `read` job, one step per stage. `pages` makes up to [`MAX_PAGES`] page JPEGs (a PDF's
//! pages by pdftoppm, a photo shrunk to 2000 px) and stores them; `read` has Spark read them;
//! `voice` speaks the summary (no narrator, or a failure, leaves it silent); `ready` marks it
//! done and clears the working files. A deleted document does nothing. Each stage may run again
//! after a crash and rewrites the same files.

use std::path::PathBuf;

use super::{DocumentPorts, now, voice::voice_of};
use crate::domain::document::{
    DocFormat, DocStatus, Document, DocumentPage, MAX_PAGES, tidied_reading,
};
use crate::domain::ids::DocumentId;
use crate::domain::job::Job;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{DocProgress, PortResult, PutFile, ReadRequest, StepRunner};

impl DocumentPorts {
    async fn set_status(
        &self,
        doc: &Document,
        status: DocStatus,
        error: Option<&str>,
    ) -> Result<(), AppError> {
        let at = now(self);
        let progress = DocProgress {
            status,
            error,
            at: &at,
        };
        self.store.set_progress(&doc.id, progress).await
    }

    /// The uploaded file in the working directory (downloaded once).
    async fn source(&self, doc: &Document) -> Result<PathBuf, AppError> {
        let dir = self.scratch.document_dir(&doc.id).await?;
        let path = dir.join(format!("source.{}", doc.format.ext()));
        if !self.scratch.exists(&path).await? {
            let key = keys::document_source(&doc.user_id, &doc.id, doc.format);
            self.blobs.get_to_file(&key, &path).await?;
        }
        Ok(path)
    }
}

/// The page images to shrink, page 1 first: a PDF's first [`MAX_PAGES`] pages, or the photo.
async fn raw_pages(p: &DocumentPorts, doc: &Document) -> Result<Vec<PathBuf>, AppError> {
    let src = p.source(doc).await?;
    if doc.format != DocFormat::Pdf {
        return Ok(vec![src]);
    }
    let dir = p.scratch.document_dir(&doc.id).await?;
    let mut pages = p.media.pdf_pages(&src, &dir, MAX_PAGES).await?;
    // The cap holds whatever the tool returned: Spark is never sent more than 10 pages.
    pages.truncate(MAX_PAGES);
    Ok(pages)
}

/// `pages`: every page as a JPEG of at most 2000 px, stored.
async fn make_pages(p: &DocumentPorts, doc: &Document) -> Result<(), AppError> {
    let dir = p.scratch.document_dir(&doc.id).await?;
    let mut stored = Vec::new();
    for (i, raw) in raw_pages(p, doc).await?.iter().enumerate() {
        let n = u32::try_from(i + 1).unwrap_or(u32::MAX);
        let page = dir.join(format!("page_{n}.jpg"));
        p.media.page_jpeg(raw, &page).await?;
        let key = keys::document_page(&doc.user_id, &doc.id, n);
        let put = PutFile {
            key: &key,
            path: &page,
            content_type: "image/jpeg",
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        p.blobs.put_file(put).await?;
        stored.push(DocumentPage { n, image_key: key });
    }
    if stored.is_empty() {
        return Err(AppError::new(
            ErrorCode::MediaFailed,
            "the file has no pages",
        ));
    }
    p.store.set_pages(&doc.id, &stored).await
}

/// `read`: Spark reads the stored pages in order.
async fn read_pages(p: &DocumentPorts, doc: &Document) -> Result<(), AppError> {
    let dir = p.scratch.document_dir(&doc.id).await?;
    let mut pages = Vec::new();
    for page in p.store.pages(&doc.id).await? {
        let path = dir.join(format!("page_{}.jpg", page.n));
        if !p.scratch.exists(&path).await? {
            p.blobs.get_to_file(&page.image_key, &path).await?;
        }
        pages.push(path);
    }
    let reading = p.reader.read_pages(&ReadRequest { pages }).await?;
    p.store
        .set_reading(&doc.id, &tidied_reading(&reading))
        .await
}

/// `voice`: the summary spoken, so "Read it to me" plays at once. Silent when it cannot be made.
async fn speak_summary(p: &DocumentPorts, doc: &Document) -> Result<(), AppError> {
    if p.narrator.is_none() || doc.summary.trim().is_empty() {
        return Ok(());
    }
    if let Ok(key) = voice_of(p, doc, &doc.summary).await {
        p.store.set_summary_audio(&doc.id, &key).await?;
    }
    Ok(())
}

async fn run_read(p: &DocumentPorts, job: &Job, step: &str) -> Result<(), AppError> {
    let id = DocumentId::parse(job.subject_id.as_str())?;
    let Some(doc) = p.store.get(&id).await? else {
        return Ok(());
    };
    match step {
        "pages" => make_pages(p, &doc).await,
        "read" => read_pages(p, &doc).await,
        "voice" => speak_summary(p, &doc).await,
        "ready" => {
            p.set_status(&doc, DocStatus::Ready, None).await?;
            p.scratch.remove_document_dir(&doc.id).await
        }
        other => Err(AppError::new(
            ErrorCode::Internal,
            format!("bad read step {other}"),
        )),
    }
}

async fn read_failed(p: &DocumentPorts, job: &Job, error: &AppError) -> Result<(), AppError> {
    let id = DocumentId::parse(job.subject_id.as_str())?;
    let Some(doc) = p.store.get(&id).await? else {
        return Ok(());
    };
    p.set_status(&doc, DocStatus::Failed, Some(&error.message))
        .await
}

impl StepRunner for DocumentPorts {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(run_read(self, job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(read_failed(self, job, error))
    }
}
