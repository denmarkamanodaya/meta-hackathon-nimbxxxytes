//! Fakes for search reasoning and naming.

use std::sync::Mutex;

use nimbytes_core::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::domain::index::{SpeakerView, TrackView};
use nimbytes_core::domain::search::{Candidate, Rewritten};
use nimbytes_core::ports::{
    PeopleStore, Person, PortResult, Reasoner, RewriteRequest, TrackUpdate,
};
use nimbytes_core::{AppError, ErrorCode};

/// [`Reasoner`] with set answers; `None` makes the call fail with `MODEL_UNAVAILABLE`.
#[derive(Debug, Default)]
pub struct ScriptedReasoner {
    rewrite: Mutex<Option<Rewritten>>,
    rerank: Mutex<Option<Vec<(SegmentId, String)>>>,
    seen_rewrites: Mutex<Vec<RewriteRequest>>,
    seen_candidates: Mutex<Vec<Vec<SegmentId>>>,
}

impl ScriptedReasoner {
    /// The rewrite every call returns.
    pub fn rewrites_to(&self, r: Rewritten) {
        *crate::lock(&self.rewrite) = Some(r);
    }

    /// The rerank picks every call returns.
    pub fn reranks_to(&self, picks: Vec<(&str, &str)>) {
        let picks = picks
            .into_iter()
            .filter_map(|(id, why)| Some((SegmentId::parse(id).ok()?, why.to_owned())))
            .collect();
        *crate::lock(&self.rerank) = Some(picks);
    }

    /// Rewrite requests received.
    pub fn rewrite_requests(&self) -> Vec<RewriteRequest> {
        crate::lock(&self.seen_rewrites).clone()
    }

    /// Candidate ids sent to each rerank call.
    pub fn rerank_candidates(&self) -> Vec<Vec<SegmentId>> {
        crate::lock(&self.seen_candidates).clone()
    }
}

fn unavailable() -> AppError {
    AppError::new(ErrorCode::ModelUnavailable, "scripted failure")
}

impl Reasoner for ScriptedReasoner {
    fn rewrite<'a>(&'a self, request: &'a RewriteRequest) -> PortResult<'a, Rewritten> {
        Box::pin(async move {
            crate::lock(&self.seen_rewrites).push(request.clone());
            crate::lock(&self.rewrite).clone().ok_or_else(unavailable)
        })
    }

    fn rerank<'a>(
        &'a self,
        _query: &'a str,
        candidates: &'a [Candidate],
    ) -> PortResult<'a, Vec<(SegmentId, String)>> {
        Box::pin(async move {
            crate::lock(&self.seen_candidates)
                .push(candidates.iter().map(|c| c.segment_id.clone()).collect());
            crate::lock(&self.rerank).clone().ok_or_else(unavailable)
        })
    }
}

/// A face track in the fake store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FakeTrack {
    /// Track id.
    pub id: TrackId,
    /// Owner of its clip.
    pub owner: UserId,
    /// Segments it appears in.
    pub segments: Vec<SegmentId>,
    /// Linked person.
    pub person: Option<PersonId>,
    /// Hidden flag.
    pub hidden: bool,
}

/// A speaker in the fake store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FakeSpeaker {
    /// Speaker id.
    pub id: SpeakerId,
    /// Owner of its clip.
    pub owner: UserId,
    /// Segments where it speaks.
    pub segments: Vec<SegmentId>,
    /// Raw label.
    pub label: String,
    /// Display name.
    pub name: Option<String>,
}

#[derive(Debug, Default)]
struct PeopleState {
    people: Vec<(UserId, Person)>,
    tracks: Vec<FakeTrack>,
    speakers: Vec<FakeSpeaker>,
}

/// [`PeopleStore`] over in-memory tracks and speakers set up by the test.
#[derive(Debug, Default)]
pub struct InMemoryPeople {
    state: Mutex<PeopleState>,
}

impl InMemoryPeople {
    /// Adds a track.
    pub fn add_track(&self, track: FakeTrack) {
        crate::lock(&self.state).tracks.push(track);
    }

    /// Adds a speaker.
    pub fn add_speaker(&self, speaker: FakeSpeaker) {
        crate::lock(&self.state).speakers.push(speaker);
    }

    /// All people.
    pub fn all_people(&self) -> Vec<Person> {
        crate::lock(&self.state)
            .people
            .iter()
            .map(|(_, p)| p.clone())
            .collect()
    }
}

impl PeopleStore for InMemoryPeople {
    fn known_names<'a>(&'a self, user: &'a UserId) -> PortResult<'a, (Vec<String>, Vec<String>)> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let people = s
                .people
                .iter()
                .filter(|(u, _)| u == user)
                .map(|(_, p)| p.name.clone())
                .collect();
            let speakers = s
                .speakers
                .iter()
                .filter(|sp| &sp.owner == user)
                .filter_map(|sp| sp.name.clone())
                .collect();
            Ok((people, speakers))
        })
    }

    fn people_with_prefix<'a>(
        &'a self,
        user: &'a UserId,
        prefix: &'a str,
        limit: u32,
    ) -> PortResult<'a, Vec<Person>> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let p = prefix.to_lowercase();
            let hits = s
                .people
                .iter()
                .filter(|(u, x)| u == user && x.name.to_lowercase().starts_with(&p));
            Ok(hits.take(limit as usize).map(|(_, x)| x.clone()).collect())
        })
    }

    fn upsert_person<'a>(
        &'a self,
        user: &'a UserId,
        new_id: &'a PersonId,
        name: &'a str,
    ) -> PortResult<'a, PersonId> {
        Box::pin(async move {
            let mut s = crate::lock(&self.state);
            if let Some((_, p)) = s
                .people
                .iter()
                .find(|(u, p)| u == user && p.name.eq_ignore_ascii_case(name))
            {
                return Ok(p.id.clone());
            }
            s.people.push((
                user.clone(),
                Person {
                    id: new_id.clone(),
                    name: name.to_owned(),
                },
            ));
            Ok(new_id.clone())
        })
    }

    fn track_owner<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<UserId>> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .tracks
                .iter()
                .find(|t| &t.id == id)
                .map(|t| t.owner.clone()))
        })
    }

    fn update_track<'a>(&'a self, id: &'a TrackId, update: &'a TrackUpdate) -> PortResult<'a, ()> {
        Box::pin(async move {
            if let Some(t) = crate::lock(&self.state)
                .tracks
                .iter_mut()
                .find(|t| &t.id == id)
            {
                if let Some(p) = &update.person {
                    t.person = Some(p.clone());
                }
                if let Some(h) = update.hidden {
                    t.hidden = h;
                }
            }
            Ok(())
        })
    }

    fn track<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Option<TrackView>> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let name_of = |pid: &PersonId| {
                s.people
                    .iter()
                    .find(|(_, p)| &p.id == pid)
                    .map(|(_, p)| p.name.clone())
            };
            Ok(s.tracks.iter().find(|t| &t.id == id).map(|t| TrackView {
                id: t.id.clone(),
                first_s: 0.0,
                last_s: 1.0,
                crop_key: Some(format!("users/{}/faces/c1/{}.jpg", t.owner, t.id)),
                person_name: t.person.as_ref().and_then(name_of),
                hidden: t.hidden,
            }))
        })
    }

    fn track_segments<'a>(&'a self, id: &'a TrackId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .tracks
                .iter()
                .find(|t| &t.id == id)
                .map(|t| t.segments.clone())
                .unwrap_or_default())
        })
    }

    fn speaker_owner<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<UserId>> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .speakers
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.owner.clone()))
        })
    }

    fn rename_speaker<'a>(&'a self, id: &'a SpeakerId, name: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            if let Some(s) = crate::lock(&self.state)
                .speakers
                .iter_mut()
                .find(|s| &s.id == id)
            {
                s.name = Some(name.to_owned());
            }
            Ok(())
        })
    }

    fn speaker<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Option<SpeakerView>> {
        Box::pin(async move {
            let s = crate::lock(&self.state);
            let view = |x: &FakeSpeaker| SpeakerView {
                id: x.id.clone(),
                label: x.label.clone(),
                display_name: x.name.clone(),
            };
            Ok(s.speakers.iter().find(|x| &x.id == id).map(view))
        })
    }

    fn speaker_segments<'a>(&'a self, id: &'a SpeakerId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(async move {
            Ok(crate::lock(&self.state)
                .speakers
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.segments.clone())
                .unwrap_or_default())
        })
    }
}
