//! Fakes for the model-backed understanding ports and the two search indexes.

use std::path::Path;
use std::sync::Mutex;

use nimbytes_core::domain::faces::Detection;
use nimbytes_core::domain::ids::{SegmentId, UserId};
use nimbytes_core::domain::index::SegmentDoc;
use nimbytes_core::ports::{
    Embedder, FaceTracker, FactsAttempt, PortResult, SegmentDescriber, SegmentPrompt, TextIndex,
    Titler, VectorIndex,
};
use nimbytes_core::{AppError, ErrorCode};

/// [`SegmentDescriber`] answering from a script: call `n` gets `script[n]` (answer `i` per prompt,
/// else that call's last answer). Unscripted calls answer every prompt with valid facts
/// describing "a described moment". Records every prompt batch.
#[derive(Debug, Default)]
pub struct ScriptedDescriber {
    script: Mutex<Vec<Vec<FactsAttempt>>>,
    calls: Mutex<Vec<Vec<SegmentPrompt>>>,
}

impl ScriptedDescriber {
    /// Answers for the next call, in prompt order.
    pub fn then(&self, answers: Vec<FactsAttempt>) {
        crate::lock(&self.script).push(answers);
    }

    /// Prompt batches received so far.
    pub fn calls(&self) -> Vec<Vec<SegmentPrompt>> {
        crate::lock(&self.calls).clone()
    }
}

impl SegmentDescriber for ScriptedDescriber {
    fn describe_all<'a>(
        &'a self,
        prompts: &'a [SegmentPrompt],
    ) -> PortResult<'a, Vec<FactsAttempt>> {
        Box::pin(async move {
            let n = {
                let mut calls = crate::lock(&self.calls);
                calls.push(prompts.to_vec());
                calls.len() - 1
            };
            let script = crate::lock(&self.script);
            let Some(answers) = script.get(n) else {
                let valid = FactsAttempt::Valid(crate::world::facts("a described moment"));
                return Ok(vec![valid; prompts.len()]);
            };
            let pick = |i: usize| answers.get(i).or(answers.last()).cloned();
            let fallback = || FactsAttempt::Invalid {
                text: String::new(),
                error: "empty script".into(),
            };
            Ok((0..prompts.len())
                .map(|i| pick(i).unwrap_or_else(fallback))
                .collect())
        })
    }
}

/// [`FaceTracker`] returning set detections.
#[derive(Debug, Default)]
pub struct FakeFaceTracker {
    detections: Mutex<Vec<Detection>>,
    calls: Mutex<usize>,
}

impl FakeFaceTracker {
    /// Detections every call returns.
    pub fn returns(&self, detections: Vec<Detection>) {
        *crate::lock(&self.detections) = detections;
    }

    /// How many times `track_faces` ran.
    pub fn calls(&self) -> usize {
        *crate::lock(&self.calls)
    }
}

impl FaceTracker for FakeFaceTracker {
    fn track_faces<'a>(&'a self, _video: &'a Path) -> PortResult<'a, Vec<Detection>> {
        Box::pin(async move {
            *crate::lock(&self.calls) += 1;
            Ok(crate::lock(&self.detections).clone())
        })
    }
}

/// [`Embedder`] returning a 4-d vector derived from the input's text, so tests can tell inputs apart.
#[derive(Debug, Default)]
pub struct FakeEmbedder;

fn vector_of(text: &str) -> Vec<f32> {
    let n = f32::from(u16::try_from(text.len() % 1000).unwrap_or(0));
    vec![1.0, n, 0.0, 0.0]
}

impl Embedder for FakeEmbedder {
    fn embed_image<'a>(&'a self, image: &'a Path) -> PortResult<'a, Vec<f32>> {
        Box::pin(async move { Ok(vector_of(&image.to_string_lossy())) })
    }

    fn embed_text<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<f32>> {
        Box::pin(async move { Ok(vector_of(text)) })
    }
}

/// [`VectorIndex`] that stores vectors and answers `nearest` by insertion order.
#[derive(Debug, Default)]
pub struct InMemoryVectorIndex {
    rows: Mutex<Vec<(SegmentId, UserId, Vec<f32>)>>,
}

impl InMemoryVectorIndex {
    /// Stored rows.
    pub fn rows(&self) -> Vec<(SegmentId, UserId, Vec<f32>)> {
        crate::lock(&self.rows).clone()
    }
}

impl VectorIndex for InMemoryVectorIndex {
    fn remove<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.rows).retain(|(s, _, _)| !segments.contains(s));
            Ok(())
        })
    }

    fn upsert<'a>(
        &'a self,
        segment: &'a SegmentId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            rows.retain(|(s, _, _)| s != segment);
            rows.push((segment.clone(), user.clone(), vector.to_vec()));
            Ok(())
        })
    }

    fn nearest<'a>(
        &'a self,
        user: &'a UserId,
        _vector: &'a [f32],
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f64)>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            Ok(rows
                .iter()
                .filter(|(_, u, _)| u == user)
                .take(k as usize)
                .map(|(s, _, _)| (s.clone(), 0.0))
                .collect())
        })
    }
}

/// [`TextIndex`] that stores documents and matches `query` as a substring of the description.
#[derive(Debug, Default)]
pub struct InMemoryTextIndex {
    docs: Mutex<Vec<SegmentDoc>>,
}

impl InMemoryTextIndex {
    /// Stored documents.
    pub fn docs(&self) -> Vec<SegmentDoc> {
        crate::lock(&self.docs).clone()
    }
}

impl TextIndex for InMemoryTextIndex {
    fn remove<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.docs).retain(|d| !segments.contains(&d.segment_id));
            Ok(())
        })
    }

    fn upsert<'a>(&'a self, docs: &'a [SegmentDoc]) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut stored = crate::lock(&self.docs);
            for d in docs {
                stored.retain(|s| s.segment_id != d.segment_id);
                stored.push(d.clone());
            }
            Ok(())
        })
    }

    fn search<'a>(
        &'a self,
        user: &'a UserId,
        query: &'a str,
        k: u32,
    ) -> PortResult<'a, Vec<(SegmentId, f32)>> {
        Box::pin(async move {
            let docs = crate::lock(&self.docs);
            Ok(docs
                .iter()
                .filter(|d| &d.user_id == user && d.description.contains(query))
                .take(k as usize)
                .map(|d| (d.segment_id.clone(), 1.0))
                .collect())
        })
    }
}

/// [`Titler`] that answers a set title (or fails when none is set) and records what it was sent.
#[derive(Debug, Default)]
pub struct ScriptedTitler {
    title: Mutex<Option<String>>,
    seen: Mutex<Vec<Vec<String>>>,
}

impl ScriptedTitler {
    /// The raw title every call answers.
    pub fn answers(&self, title: &str) {
        *crate::lock(&self.title) = Some(title.to_owned());
    }

    /// The descriptions each call was sent.
    pub fn calls(&self) -> Vec<Vec<String>> {
        crate::lock(&self.seen).clone()
    }
}

impl Titler for ScriptedTitler {
    fn title<'a>(&'a self, descriptions: &'a [String]) -> PortResult<'a, String> {
        Box::pin(async move {
            crate::lock(&self.seen).push(descriptions.to_vec());
            crate::lock(&self.title)
                .clone()
                .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "scripted failure"))
        })
    }
}
