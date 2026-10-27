//! Fakes for search reasoning and naming.

use std::collections::VecDeque;
use std::sync::Mutex;

use nimbytes_core::domain::critique::Critique;
use nimbytes_core::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use nimbytes_core::domain::index::{SpeakerView, TrackView};
use nimbytes_core::domain::people::PeopleOverviewRows;
use nimbytes_core::domain::search::{Candidate, Rewritten};
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::ports::{
    CritiqueRequest, PeopleStore, Person, PlanRequest, PlannerToolCall, PortResult, Reasoner,
    RewriteRequest, TrackUpdate,
};
use nimbytes_core::{AppError, ErrorCode};

/// [`Reasoner`] with set answers; `None` makes the call fail with `MODEL_UNAVAILABLE`.
#[derive(Debug, Default)]
pub struct ScriptedReasoner {
    rewrite: Mutex<Option<Rewritten>>,
    rerank: Mutex<Option<Vec<(SegmentId, String)>>>,
    seen_rewrites: Mutex<Vec<RewriteRequest>>,
    seen_candidates: Mutex<Vec<Vec<SegmentId>>>,
    plans: Mutex<VecDeque<Result<Timeline, AppError>>>,
    seen_plans: Mutex<Vec<SeenPlan>>,
    critiques: Mutex<VecDeque<Result<Critique, AppError>>>,
    seen_critiques: Mutex<Vec<u32>>,
    tool_calls: Mutex<Vec<PlannerToolCall>>,
    tool_answers: Mutex<Vec<Result<Vec<SegmentId>, String>>>,
}

/// Pops the next scripted answer; the last one repeats; none scripted is `MODEL_UNAVAILABLE`.
fn next<T: Clone>(queue: &Mutex<VecDeque<Result<T, AppError>>>) -> Result<T, AppError> {
    let mut q = crate::lock(queue);
    let answer = if q.len() > 1 {
        q.pop_front()
    } else {
        q.front().cloned()
    };
    answer.unwrap_or_else(|| Err(unavailable()))
}

/// What a `plan_edit` call was asked.
#[derive(Debug, Clone, PartialEq)]
pub struct SeenPlan {
    /// The owner's words.
    pub prompt: String,
    /// Target seconds.
    pub target_s: f64,
    /// Segment ids in the order sent.
    pub segments: Vec<SegmentId>,
    /// `v{n}` of the critiqued version a revision starts from.
    pub previous: Option<String>,
    /// The refusal reason sent with a retry.
    pub rejection: Option<String>,
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

    /// Queues a timeline for the next `plan_edit` (the last one queued repeats).
    pub fn plans(&self, t: Timeline) {
        crate::lock(&self.plans).push_back(Ok(t));
    }

    /// Queues a failing `plan_edit` answer.
    pub fn plan_fails(&self, error: AppError) {
        crate::lock(&self.plans).push_back(Err(error));
    }

    /// Queues a critique for the next `critique` (the last one queued repeats).
    pub fn critiques(&self, c: Critique) {
        crate::lock(&self.critiques).push_back(Ok(c));
    }

    /// Lookups every `plan_edit` makes (when tools are offered) before it answers.
    pub fn calls_tools(&self, calls: Vec<PlannerToolCall>) {
        *crate::lock(&self.tool_calls) = calls;
    }

    /// What each lookup answered: the moment ids, or the error sent back.
    pub fn tool_answers(&self) -> Vec<Result<Vec<SegmentId>, String>> {
        crate::lock(&self.tool_answers).clone()
    }

    /// Versions sent to `critique`, in order.
    pub fn critiqued(&self) -> Vec<u32> {
        crate::lock(&self.seen_critiques).clone()
    }

    /// `plan_edit` requests received.
    pub fn plan_requests(&self) -> Vec<SeenPlan> {
        crate::lock(&self.seen_plans).clone()
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

    fn plan_edit<'a>(&'a self, request: &'a PlanRequest<'a>) -> PortResult<'a, Timeline> {
        Box::pin(async move {
            crate::lock(&self.seen_plans).push(SeenPlan {
                prompt: request.prompt.to_owned(),
                target_s: request.target_s,
                segments: request
                    .segments
                    .iter()
                    .map(|s| s.segment_id.clone())
                    .collect(),
                previous: request.previous.map(|p| format!("v{}", p.critique.version)),
                rejection: request.rejection.map(str::to_owned),
            });
            if let Some(tools) = request.tools {
                let calls = crate::lock(&self.tool_calls).clone();
                for call in calls {
                    let answer = tools.call(call).await;
                    let ids = answer.map(|cards| cards.into_iter().map(|c| c.segment_id).collect());
                    crate::lock(&self.tool_answers).push(ids);
                }
            }
            next(&self.plans)
        })
    }

    fn critique<'a>(&'a self, request: &'a CritiqueRequest<'a>) -> PortResult<'a, Critique> {
        Box::pin(async move {
            crate::lock(&self.seen_critiques).push(request.version);
            next(&self.critiques).map(|c| c.settled(request.version))
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
    overview: Option<PeopleOverviewRows>,
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

    /// The rows `overview` returns (any order; the use case sorts them).
    pub fn set_overview(&self, rows: PeopleOverviewRows) {
        crate::lock(&self.state).overview = Some(rows);
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
    fn overview<'a>(&'a self, _user: &'a UserId) -> PortResult<'a, PeopleOverviewRows> {
        Box::pin(async move {
            let rows = crate::lock(&self.state).overview.clone();
            Ok(rows.unwrap_or(PeopleOverviewRows {
                people: Vec::new(),
                unnamed: Vec::new(),
                hidden: Vec::new(),
            }))
        })
    }

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

    fn name_tracks<'a>(
        &'a self,
        user: &'a UserId,
        (new_id, name): (&'a PersonId, &'a str),
        tracks: &'a [TrackId],
    ) -> PortResult<'a, PersonId> {
        Box::pin(async move {
            let person = self.upsert_person(user, new_id, name).await?;
            let mut s = crate::lock(&self.state);
            for t in s.tracks.iter_mut().filter(|t| tracks.contains(&t.id)) {
                t.person = Some(person.clone());
            }
            Ok(person)
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
