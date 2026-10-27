//! Fakes for opt-in face matching: a scripted face store and a scripted Spark matcher.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use nimbytes_core::domain::face_match::{FaceKind, FaceLink, FaceVerdict, NamedTrack};
use nimbytes_core::domain::ids::{TrackId, UserId};
use nimbytes_core::ports::{FaceMatchStore, FaceMatcher, FacePair, FaceToEmbed, PortResult};

#[derive(Debug, Default)]
struct FaceState {
    on: BTreeSet<UserId>,
    unembedded: Vec<FaceToEmbed>,
    vectors: Vec<(TrackId, UserId, Vec<f32>)>,
    proposals: Vec<FacePair>,
    verdicts: Vec<(UserId, TrackId, TrackId, FaceVerdict)>,
    links: Vec<FaceLink>,
    named: Vec<NamedTrack>,
}

/// [`FaceMatchStore`] answering what the test set up and recording writes. Like the real store,
/// writes are dropped while the user's switch is off, and turning it off clears their vectors and
/// verdicts.
#[derive(Debug, Default)]
pub struct InMemoryFaceStore {
    state: Mutex<FaceState>,
}

impl InMemoryFaceStore {
    /// Turns the user's switch on.
    pub fn turn_on(&self, user: &UserId) {
        crate::lock(&self.state).on.insert(user.clone());
    }

    /// Faces `unembedded` returns (every call, minus those embedded since).
    pub fn set_unembedded(&self, faces: Vec<FaceToEmbed>) {
        crate::lock(&self.state).unembedded = faces;
    }

    /// Pairs `proposals` returns, minus those judged since.
    pub fn set_proposals(&self, pairs: Vec<FacePair>) {
        crate::lock(&self.state).proposals = pairs;
    }

    /// What `links` and `named_tracks` return.
    pub fn set_links(&self, links: Vec<FaceLink>, named: Vec<NamedTrack>) {
        let mut s = crate::lock(&self.state);
        (s.links, s.named) = (links, named);
    }

    /// Stored vectors.
    pub fn vectors(&self) -> Vec<(TrackId, UserId, Vec<f32>)> {
        crate::lock(&self.state).vectors.clone()
    }

    /// Stored verdicts.
    pub fn verdicts(&self) -> Vec<(UserId, TrackId, TrackId, FaceVerdict)> {
        crate::lock(&self.state).verdicts.clone()
    }
}

impl FaceMatchStore for InMemoryFaceStore {
    fn matching<'a>(&'a self, user: &'a UserId) -> PortResult<'a, bool> {
        Box::pin(async move { Ok(crate::lock(&self.state).on.contains(user)) })
    }

    fn set_matching<'a>(&'a self, user: &'a UserId, on: bool) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut s = crate::lock(&self.state);
            if on {
                s.on.insert(user.clone());
            } else {
                s.on.remove(user);
                s.vectors.retain(|(_, u, _)| u != user);
                s.verdicts.retain(|(u, ..)| u != user);
            }
            Ok(())
        })
    }

    fn unembedded<'a>(&'a self, _user: &'a UserId) -> PortResult<'a, Vec<FaceToEmbed>> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let done = |f: &&FaceToEmbed| s.vectors.iter().any(|(t, ..)| t == &f.track);
            Ok(s.unembedded.iter().filter(|f| !done(f)).cloned().collect())
        })
    }

    fn put_vector<'a>(
        &'a self,
        track: &'a TrackId,
        user: &'a UserId,
        vector: &'a [f32],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut s = crate::lock(&self.state);
            if s.on.contains(user) {
                s.vectors.retain(|(t, ..)| t != track);
                s.vectors
                    .push((track.clone(), user.clone(), vector.to_vec()));
            }
            Ok(())
        })
    }

    fn proposals<'a>(
        &'a self,
        _user: &'a UserId,
        _min_similarity: f64,
        _k: u32,
    ) -> PortResult<'a, Vec<FacePair>> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let judged = |p: &&FacePair| {
                s.verdicts
                    .iter()
                    .any(|(_, a, b, _)| a == &p.a.0 && b == &p.b.0)
            };
            Ok(s.proposals.iter().filter(|p| !judged(p)).cloned().collect())
        })
    }

    fn put_verdict<'a>(
        &'a self,
        user: &'a UserId,
        (a, b): (&'a TrackId, &'a TrackId),
        verdict: &'a FaceVerdict,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut s = crate::lock(&self.state);
            if s.on.contains(user) {
                s.verdicts
                    .push((user.clone(), a.clone(), b.clone(), *verdict));
            }
            Ok(())
        })
    }

    fn links<'a>(&'a self, _user: &'a UserId, _min: f64) -> PortResult<'a, Vec<FaceLink>> {
        Box::pin(async move { Ok(crate::lock(&self.state).links.clone()) })
    }

    fn named_tracks<'a>(&'a self, _user: &'a UserId) -> PortResult<'a, Vec<NamedTrack>> {
        Box::pin(async move { Ok(crate::lock(&self.state).named.clone()) })
    }
}

/// [`FaceMatcher`] answering "same, 0.9, person" (or a set verdict) and recording each pair of
/// crop paths it was shown.
#[derive(Debug)]
pub struct ScriptedFaceMatcher {
    verdict: Mutex<FaceVerdict>,
    calls: Mutex<Vec<(PathBuf, PathBuf)>>,
}

impl Default for ScriptedFaceMatcher {
    fn default() -> Self {
        Self {
            verdict: Mutex::new(FaceVerdict {
                same: true,
                confidence: 0.9,
                kind: FaceKind::Person,
            }),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl ScriptedFaceMatcher {
    /// The crop pairs compared so far.
    pub fn calls(&self) -> Vec<(PathBuf, PathBuf)> {
        crate::lock(&self.calls).clone()
    }
}

impl FaceMatcher for ScriptedFaceMatcher {
    fn same_face<'a>(&'a self, a: &'a Path, b: &'a Path) -> PortResult<'a, FaceVerdict> {
        Box::pin(async move {
            crate::lock(&self.calls).push((a.to_owned(), b.to_owned()));
            Ok(*crate::lock(&self.verdict))
        })
    }
}
