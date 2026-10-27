//! Search indexes.

use crate::domain::ids::{SegmentId, UserId};
use crate::domain::index::SegmentDoc;
use crate::ports::PortResult;

/// Nearest-neighbour index over segment embeddings, partitioned by user.
pub trait VectorIndex: Send + Sync {
    /// Inserts or replaces a segment's vector.
    fn upsert<'a>(
        &'a self,
        segment: &'a SegmentId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()>;

    /// The `k` nearest segments of `user` to `vector`, nearest first, with cosine distance.
    fn nearest<'a>(
        &'a self,
        user: &'a UserId,
        vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f64)>>;

    /// Removes these segments' vectors (unknown ids are ignored).
    fn remove<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, ()>;
}

/// Keyword index over segment documents.
pub trait TextIndex: Send + Sync {
    /// Inserts or replaces the documents (by segment id) and commits.
    fn upsert<'a>(&'a self, docs: &'a [SegmentDoc]) -> PortResult<'a, ()>;

    /// The `k` best segments of `user` for `query`, best first, with BM25 score.
    fn search<'a>(
        &'a self,
        user: &'a UserId,
        query: &'a str,
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f32)>>;

    /// Removes these segments' documents and commits (unknown ids are ignored).
    fn remove<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, ()>;
}
