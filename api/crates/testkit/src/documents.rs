//! Fakes for iRead: document rows in memory and a scripted Spark reader. Calls are recorded so
//! tests can assert what was asked.

use std::sync::Mutex;

use nimbytes_core::domain::document::{Document, DocumentPage, Reading};
use nimbytes_core::domain::ids::{DocumentId, UserId};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{
    AnswerRequest, DocProgress, DocumentReader, DocumentStore, PortResult, ReadRequest,
};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct Rows {
    docs: Vec<Document>,
    pages: Vec<(DocumentId, DocumentPage)>,
    voices: Vec<(DocumentId, ObjectKey)>,
}

/// [`DocumentStore`] over vectors.
#[derive(Debug, Default)]
pub struct InMemoryDocuments {
    rows: Mutex<Rows>,
}

impl InMemoryDocuments {
    /// The stored document.
    pub fn doc(&self, id: &str) -> Option<Document> {
        crate::lock(&self.rows)
            .docs
            .iter()
            .find(|d| d.id.as_str() == id)
            .cloned()
    }

    /// Puts a document and its pages in place, as an earlier run would have.
    pub fn put(&self, doc: Document, pages: Vec<DocumentPage>) {
        let mut rows = crate::lock(&self.rows);
        rows.pages
            .extend(pages.into_iter().map(|p| (doc.id.clone(), p)));
        rows.docs.push(doc);
    }

    /// Voice keys recorded for a document, in the order recorded.
    pub fn voices_of(&self, id: &str) -> Vec<String> {
        crate::lock(&self.rows)
            .voices
            .iter()
            .filter(|(d, _)| d.as_str() == id)
            .map(|(_, k)| k.as_str().to_owned())
            .collect()
    }

    fn edit(&self, id: &DocumentId, f: impl FnOnce(&mut Document)) {
        if let Some(d) = crate::lock(&self.rows)
            .docs
            .iter_mut()
            .find(|d| &d.id == id)
        {
            f(d);
        }
    }
}

impl DocumentStore for InMemoryDocuments {
    fn create<'a>(&'a self, doc: &'a Document) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.rows).docs.push(doc.clone());
            Ok(())
        })
    }

    fn get<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Option<Document>> {
        Box::pin(async move { Ok(self.doc(id.as_str())) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Document>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            let mut mine: Vec<Document> = rows
                .docs
                .iter()
                .filter(|d| &d.user_id == user)
                .cloned()
                .collect();
            mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn set_progress<'a>(&'a self, id: &'a DocumentId, p: DocProgress<'a>) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |d| {
                d.status = p.status;
                d.error = p.error.map(str::to_owned);
                d.updated_at = p.at.to_owned();
            });
            Ok(())
        })
    }

    fn set_pages<'a>(
        &'a self,
        id: &'a DocumentId,
        pages: &'a [DocumentPage],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |d| {
                d.page_count = u32::try_from(pages.len()).unwrap_or(0)
            });
            let mut rows = crate::lock(&self.rows);
            rows.pages.retain(|(d, _)| d != id);
            rows.pages
                .extend(pages.iter().map(|p| (id.clone(), p.clone())));
            Ok(())
        })
    }

    fn pages<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<DocumentPage>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            let mut pages: Vec<DocumentPage> = rows
                .pages
                .iter()
                .filter(|(d, _)| d == id)
                .map(|(_, p)| p.clone())
                .collect();
            pages.sort_by_key(|p| p.n);
            Ok(pages)
        })
    }

    fn set_reading<'a>(&'a self, id: &'a DocumentId, r: &'a Reading) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |d| {
                d.title = r.title.clone();
                d.kind = r.kind;
                d.sender = r.sender.clone();
                d.date = r.date.clone();
                d.text = r.text.clone();
                d.summary = r.summary.clone();
            });
            Ok(())
        })
    }

    fn set_summary_audio<'a>(
        &'a self,
        id: &'a DocumentId,
        key: &'a ObjectKey,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |d| d.summary_audio_key = Some(key.clone()));
            Ok(())
        })
    }

    fn set_title<'a>(
        &'a self,
        id: &'a DocumentId,
        title: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |d| {
                d.title = title.to_owned();
                d.updated_at = at.to_owned();
            });
            Ok(())
        })
    }

    fn add_voice<'a>(&'a self, id: &'a DocumentId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            if !rows.voices.iter().any(|(d, k)| d == id && k == key) {
                rows.voices.push((id.clone(), key.clone()));
            }
            Ok(())
        })
    }

    fn voices<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<ObjectKey>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            Ok(rows
                .voices
                .iter()
                .filter(|(d, _)| d == id)
                .map(|(_, k)| k.clone())
                .collect())
        })
    }

    fn delete<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            rows.docs.retain(|d| &d.id != id);
            rows.pages.retain(|(d, _)| d != id);
            rows.voices.retain(|(d, _)| d != id);
            Ok(())
        })
    }
}

/// [`DocumentReader`] answering a scripted reading and answer (`MODEL_UNAVAILABLE` until set).
#[derive(Debug, Default)]
pub struct ScriptedDocumentReader {
    reading: Mutex<Option<Reading>>,
    answer: Mutex<Option<String>>,
    read_pages: Mutex<Vec<Vec<String>>>,
    questions: Mutex<Vec<(String, String)>>,
}

impl ScriptedDocumentReader {
    /// Every read answers `reading`.
    pub fn reads(&self, reading: Reading) {
        *crate::lock(&self.reading) = Some(reading);
    }

    /// Every question answers `answer`.
    pub fn answers(&self, answer: &str) {
        *crate::lock(&self.answer) = Some(answer.to_owned());
    }

    /// The page file names of each read so far.
    pub fn reads_seen(&self) -> Vec<Vec<String>> {
        crate::lock(&self.read_pages).clone()
    }

    /// Each question so far: the document text and the question.
    pub fn questions(&self) -> Vec<(String, String)> {
        crate::lock(&self.questions).clone()
    }
}

fn unscripted() -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, "nothing scripted")
}

impl DocumentReader for ScriptedDocumentReader {
    fn read_pages<'a>(&'a self, request: &'a ReadRequest) -> PortResult<'a, Reading> {
        Box::pin(async move {
            let names = request
                .pages
                .iter()
                .map(|p| p.display().to_string())
                .collect();
            crate::lock(&self.read_pages).push(names);
            crate::lock(&self.reading).clone().ok_or_else(unscripted)
        })
    }

    fn answer<'a>(&'a self, request: AnswerRequest<'a>) -> PortResult<'a, String> {
        Box::pin(async move {
            let seen = (request.text.to_owned(), request.question.to_owned());
            crate::lock(&self.questions).push(seen);
            crate::lock(&self.answer).clone().ok_or_else(unscripted)
        })
    }
}
