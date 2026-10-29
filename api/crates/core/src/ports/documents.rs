//! iRead ports: the document rows and Muse Spark reading the pages and answering questions.

use std::path::PathBuf;

use crate::domain::document::{DocStatus, Document, DocumentPage, Reading};
use crate::domain::ids::{DocumentId, UserId};
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// A document's status change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DocProgress<'a> {
    /// New status.
    pub status: DocStatus,
    /// Why it failed (`None` clears it).
    pub error: Option<&'a str>,
    /// ISO-8601 UTC.
    pub at: &'a str,
}

/// Document rows, their pages and their voice files.
pub trait DocumentStore: Send + Sync {
    /// Inserts a new document.
    fn create<'a>(&'a self, doc: &'a Document) -> PortResult<'a, ()>;

    /// The document, if it exists.
    fn get<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Option<Document>>;

    /// The user's documents, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Document>>;

    /// Sets status and error.
    fn set_progress<'a>(
        &'a self,
        id: &'a DocumentId,
        progress: DocProgress<'a>,
    ) -> PortResult<'a, ()>;

    /// Replaces every page with `pages` and sets the page count.
    fn set_pages<'a>(&'a self, id: &'a DocumentId, pages: &'a [DocumentPage])
    -> PortResult<'a, ()>;

    /// The pages by number.
    fn pages<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<DocumentPage>>;

    /// Stores what Spark read (title, kind, sender, date, text, summary).
    fn set_reading<'a>(&'a self, id: &'a DocumentId, reading: &'a Reading) -> PortResult<'a, ()>;

    /// Points the document at its spoken summary.
    fn set_summary_audio<'a>(
        &'a self,
        id: &'a DocumentId,
        key: &'a ObjectKey,
    ) -> PortResult<'a, ()>;

    /// Sets the title (already checked).
    fn set_title<'a>(
        &'a self,
        id: &'a DocumentId,
        title: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()>;

    /// Records a voice file of the document (a second record of the same key is ignored).
    fn add_voice<'a>(&'a self, id: &'a DocumentId, key: &'a ObjectKey) -> PortResult<'a, ()>;

    /// Every voice file recorded for the document.
    fn voices<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, Vec<ObjectKey>>;

    /// Deletes the document, its pages and voice rows; none is not an error.
    fn delete<'a>(&'a self, id: &'a DocumentId) -> PortResult<'a, ()>;
}

/// The pages Spark reads, in order (JPEG files).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadRequest {
    /// Page images, page 1 first.
    pub pages: Vec<PathBuf>,
}

/// A question about a read document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AnswerRequest<'a> {
    /// The document's text.
    pub text: &'a str,
    /// The question, checked.
    pub question: &'a str,
}

/// Muse Spark reading documents.
pub trait DocumentReader: Send + Sync {
    /// What the pages say. `MODEL_UNAVAILABLE` on failure or an invalid answer.
    fn read_pages<'a>(&'a self, request: &'a ReadRequest) -> PortResult<'a, Reading>;

    /// The answer to a question, from the text only. `MODEL_UNAVAILABLE` on failure or an
    /// invalid answer.
    fn answer<'a>(&'a self, request: AnswerRequest<'a>) -> PortResult<'a, String>;
}
