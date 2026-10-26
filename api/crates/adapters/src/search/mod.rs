//! [`TextIndex`] on Tantivy: one document per segment, BM25 over the text fields with
//! per-field boosts, always filtered to one user. One writer behind a mutex; every upsert
//! commits and reloads the reader. Work runs on the blocking thread pool.

mod schema;

use std::path::Path;
use std::sync::{Arc, Mutex};

use nimbytes_core::domain::ids::{SegmentId, UserId};
use nimbytes_core::domain::index::SegmentDoc;
use nimbytes_core::ports::{PortResult, TextIndex};
use nimbytes_core::time::parse_utc;
use nimbytes_core::{AppError, ErrorCode};
use tantivy::collector::TopDocs;
use tantivy::directory::MmapDirectory;
use tantivy::query::{BooleanQuery, Occur, Query, QueryParser, TermQuery};
use tantivy::schema::{IndexRecordOption, Value};
use tantivy::{DateTime, Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument, Term};

use schema::Fields;
pub use schema::TEXT_FIELDS;

/// Writer memory budget.
const WRITER_HEAP: usize = 50_000_000;

fn err(e: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("search index: {e}"))
}

struct Inner {
    index: Index,
    reader: IndexReader,
    writer: Mutex<IndexWriter>,
    fields: Fields,
}

/// Segment text search.
#[derive(Clone)]
pub struct TantivySearchIndex {
    inner: Arc<Inner>,
}

impl TantivySearchIndex {
    /// Opens or creates the index in `dir`.
    ///
    /// # Errors
    /// `INTERNAL` when the directory cannot be used.
    pub fn open(dir: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(dir).map_err(err)?;
        let (schema, fields) = schema::build();
        let index =
            Index::open_or_create(MmapDirectory::open(dir).map_err(err)?, schema).map_err(err)?;
        Self::from_index(index, fields)
    }

    /// An index in memory (tests).
    ///
    /// # Errors
    /// `INTERNAL` when the writer cannot start.
    pub fn in_memory() -> Result<Self, AppError> {
        let (schema, fields) = schema::build();
        Self::from_index(Index::create_in_ram(schema), fields)
    }

    fn from_index(index: Index, fields: Fields) -> Result<Self, AppError> {
        let writer = index.writer(WRITER_HEAP).map_err(err)?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(err)?;
        Ok(Self {
            inner: Arc::new(Inner {
                index,
                reader,
                writer: Mutex::new(writer),
                fields,
            }),
        })
    }
}

impl Inner {
    fn document(&self, d: &SegmentDoc) -> TantivyDocument {
        let f = &self.fields;
        let mut doc = TantivyDocument::default();
        doc.add_text(f.segment_id, d.segment_id.as_str());
        doc.add_text(f.clip_id, d.clip_id.as_str());
        doc.add_text(f.user_id, d.user_id.as_str());
        let texts = [
            &d.description,
            &d.actions,
            &d.objects,
            &d.place,
            &d.mood,
            &d.transcript,
            &d.people,
            &d.speakers,
        ];
        for (field, text) in f.text.iter().zip(texts) {
            doc.add_text(*field, text);
        }
        if let Some(ms) = d.recorded_at.as_deref().and_then(parse_utc) {
            doc.add_date(f.recorded_at, DateTime::from_timestamp_millis(ms));
        }
        if let Some(q) = d.quality {
            doc.add_f64(f.quality, f64::from(q));
        }
        if let Some(h) = d.hook_score {
            doc.add_f64(f.hook_score, f64::from(h));
        }
        doc
    }

    fn upsert(&self, docs: &[SegmentDoc]) -> Result<(), AppError> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| err("writer lock poisoned"))?;
        for d in docs {
            writer.delete_term(Term::from_field_text(
                self.fields.segment_id,
                d.segment_id.as_str(),
            ));
            writer.add_document(self.document(d)).map_err(err)?;
        }
        writer.commit().map_err(err)?;
        self.reader.reload().map_err(err)
    }

    fn search(
        &self,
        user: &UserId,
        query: &str,
        k: u32,
    ) -> Result<Vec<(SegmentId, f32)>, AppError> {
        let mut parser = QueryParser::for_index(&self.index, self.fields.text.clone());
        for (field, (_, boost)) in self.fields.text.iter().zip(TEXT_FIELDS) {
            parser.set_field_boost(*field, boost);
        }
        let (text_query, _ignored) = parser.parse_query_lenient(query);
        let owner: Box<dyn Query> = Box::new(TermQuery::new(
            Term::from_field_text(self.fields.user_id, user.as_str()),
            IndexRecordOption::Basic,
        ));
        let q = BooleanQuery::new(vec![(Occur::Must, owner), (Occur::Must, text_query)]);
        let searcher = self.reader.searcher();
        let hits = searcher
            .search(&q, &TopDocs::with_limit(k as usize).order_by_score())
            .map_err(err)?;
        hits.into_iter()
            .map(|(score, addr)| {
                let doc: TantivyDocument = searcher.doc(addr).map_err(err)?;
                let id = doc
                    .get_first(self.fields.segment_id)
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| err("hit without id"))?;
                Ok((SegmentId::parse(id)?, score))
            })
            .collect()
    }
}

impl TextIndex for TantivySearchIndex {
    fn upsert<'a>(&'a self, docs: &'a [SegmentDoc]) -> PortResult<'a, ()> {
        let (inner, docs) = (self.inner.clone(), docs.to_vec());
        Box::pin(async move {
            tokio::task::spawn_blocking(move || inner.upsert(&docs))
                .await
                .map_err(err)?
        })
    }

    fn search<'a>(
        &'a self,
        user: &'a UserId,
        query: &'a str,
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f32)>> {
        let (inner, user, query) = (self.inner.clone(), user.clone(), query.to_owned());
        Box::pin(async move {
            tokio::task::spawn_blocking(move || inner.search(&user, &query, k))
                .await
                .map_err(err)?
        })
    }
}

#[cfg(test)]
mod tests;
