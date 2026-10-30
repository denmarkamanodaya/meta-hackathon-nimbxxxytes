//! Fakes for iListen: listen rows in memory and a scripted Spark interpreter. Calls are recorded
//! so tests can assert what was asked.

use std::collections::VecDeque;
use std::sync::Mutex;

use nimbytes_core::domain::ids::{ListenId, UserId};
use nimbytes_core::domain::listen::{
    CheckAnswer, Draft, FixAnswer, HeardBy, Listen, ListenTurn, ListenVersion, Overview,
    speaker_count,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{
    CheckRequest, FixRequest, ListenInterpreter, ListenProgress, ListenResult, ListenStore,
    MergeRequest, PortResult, UnderstandRequest,
};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct Rows {
    listens: Vec<Listen>,
    turns: Vec<(ListenId, Vec<ListenTurn>)>,
    versions: Vec<(ListenId, ListenVersion)>,
    voices: Vec<(ListenId, ObjectKey)>,
    steps: Vec<(String, u32)>,
}

/// [`ListenStore`] over vectors.
#[derive(Debug, Default)]
pub struct InMemoryListens {
    rows: Mutex<Rows>,
}

impl InMemoryListens {
    /// The stored listen.
    pub fn listen(&self, id: &str) -> Option<Listen> {
        crate::lock(&self.rows)
            .listens
            .iter()
            .find(|l| l.id.as_str() == id)
            .cloned()
    }

    /// Puts a listen, its turns and versions in place, as an earlier run would have.
    pub fn put(&self, listen: Listen, turns: Vec<ListenTurn>, versions: Vec<ListenVersion>) {
        let mut rows = crate::lock(&self.rows);
        rows.turns.push((listen.id.clone(), turns));
        rows.versions
            .extend(versions.into_iter().map(|v| (listen.id.clone(), v)));
        rows.listens.push(listen);
    }

    /// The stored turns of a listen.
    pub fn turns_of(&self, id: &str) -> Vec<ListenTurn> {
        crate::lock(&self.rows)
            .turns
            .iter()
            .find(|(l, _)| l.as_str() == id)
            .map(|(_, t)| t.clone())
            .unwrap_or_default()
    }

    /// The stored versions of a listen, oldest first.
    pub fn versions_of(&self, id: &str) -> Vec<ListenVersion> {
        let mut v: Vec<ListenVersion> = crate::lock(&self.rows)
            .versions
            .iter()
            .filter(|(l, _)| l.as_str() == id)
            .map(|(_, v)| v.clone())
            .collect();
        v.sort_by_key(|v| v.version);
        v
    }

    /// Voice keys recorded for a listen.
    pub fn voices_of(&self, id: &str) -> Vec<String> {
        crate::lock(&self.rows)
            .voices
            .iter()
            .filter(|(l, _)| l.as_str() == id)
            .map(|(_, k)| k.as_str().to_owned())
            .collect()
    }

    /// Every `set_step` so far as `step@version` (`-` for none), in order.
    pub fn steps(&self) -> Vec<String> {
        crate::lock(&self.rows)
            .steps
            .iter()
            .map(|(s, v)| format!("{s}@{v}"))
            .collect()
    }

    fn edit(&self, id: &ListenId, f: impl FnOnce(&mut Listen)) {
        if let Some(l) = crate::lock(&self.rows)
            .listens
            .iter_mut()
            .find(|l| &l.id == id)
        {
            f(l);
        }
    }

    fn edit_turns(&self, id: &ListenId, f: impl FnOnce(&mut Vec<ListenTurn>)) {
        let mut rows = crate::lock(&self.rows);
        match rows.turns.iter_mut().find(|(l, _)| l == id) {
            Some((_, t)) => f(t),
            None => {
                let mut t = Vec::new();
                f(&mut t);
                rows.turns.push((id.clone(), t));
            }
        }
    }
}

fn done() -> PortResult<'static, ()> {
    Box::pin(async { Ok(()) })
}

impl ListenStore for InMemoryListens {
    fn create<'a>(&'a self, listen: &'a Listen) -> PortResult<'a, ()> {
        crate::lock(&self.rows).listens.push(listen.clone());
        done()
    }

    fn get<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Option<Listen>> {
        Box::pin(async move { Ok(self.listen(id.as_str())) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Listen>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            let mut mine: Vec<Listen> = rows
                .listens
                .iter()
                .filter(|l| &l.user_id == user)
                .cloned()
                .collect();
            mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn set_progress<'a>(&'a self, id: &'a ListenId, p: ListenProgress<'a>) -> PortResult<'a, ()> {
        self.edit(id, |l| {
            l.status = p.status;
            l.error = p.error.map(str::to_owned);
            l.updated_at = p.at.to_owned();
        });
        done()
    }

    fn set_step<'a>(
        &'a self,
        id: &'a ListenId,
        step: Option<&'a str>,
        version: u32,
    ) -> PortResult<'a, ()> {
        crate::lock(&self.rows)
            .steps
            .push((step.unwrap_or("-").to_owned(), version));
        self.edit(id, |l| {
            l.step = step.map(str::to_owned);
            l.version = version;
        });
        done()
    }

    fn set_duration<'a>(&'a self, id: &'a ListenId, duration_ms: u64) -> PortResult<'a, ()> {
        self.edit(id, |l| l.duration_ms = Some(duration_ms));
        done()
    }

    fn set_turns<'a>(
        &'a self,
        id: &'a ListenId,
        turns: &'a [ListenTurn],
        heard_by: HeardBy,
    ) -> PortResult<'a, ()> {
        self.edit_turns(id, |t| *t = turns.to_vec());
        self.edit(id, |l| {
            l.speakers = speaker_count(turns);
            l.heard_by = Some(heard_by);
        });
        done()
    }

    fn turns<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenTurn>> {
        Box::pin(async move { Ok(self.turns_of(id.as_str())) })
    }

    fn set_result<'a>(&'a self, id: &'a ListenId, r: &'a ListenResult) -> PortResult<'a, ()> {
        self.edit(id, |l| {
            l.version = r.version;
            l.title = r.overview.title.clone();
            l.summary = r.overview.summary.clone();
            l.key_points = r.overview.key_points.clone();
            l.languages = r.languages.clone();
            l.confidence = r.confidence;
            l.passed = r.passed;
        });
        self.edit_turns(id, |t| *t = r.turns.clone());
        done()
    }

    fn put_version<'a>(&'a self, id: &'a ListenId, v: &'a ListenVersion) -> PortResult<'a, ()> {
        let mut rows = crate::lock(&self.rows);
        rows.versions
            .retain(|(l, old)| !(l == id && old.version == v.version));
        rows.versions.push((id.clone(), v.clone()));
        done()
    }

    fn versions<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenVersion>> {
        Box::pin(async move { Ok(self.versions_of(id.as_str())) })
    }

    fn clear_understanding<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()> {
        crate::lock(&self.rows).versions.retain(|(l, _)| l != id);
        self.edit_turns(id, |turns| {
            for t in turns {
                *t = ListenTurn::heard(t.index, (t.start_ms, t.end_ms), t.speaker.clone(), &t.text);
            }
        });
        self.edit(id, |l| {
            l.version = 0;
            l.title.clear();
            l.summary.clear();
            l.key_points.clear();
            l.languages.clear();
            l.confidence = None;
            l.passed = false;
            l.summary_audio_key = None;
        });
        done()
    }

    fn set_target<'a>(
        &'a self,
        id: &'a ListenId,
        target: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        self.edit(id, |l| {
            l.target = target.to_owned();
            l.updated_at = at.to_owned();
        });
        done()
    }

    fn set_title<'a>(
        &'a self,
        id: &'a ListenId,
        title: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()> {
        self.edit(id, |l| {
            l.title = title.to_owned();
            l.updated_at = at.to_owned();
        });
        done()
    }

    fn set_summary_audio<'a>(
        &'a self,
        id: &'a ListenId,
        key: Option<&'a ObjectKey>,
    ) -> PortResult<'a, ()> {
        self.edit(id, |l| l.summary_audio_key = key.cloned());
        done()
    }

    fn add_voice<'a>(&'a self, id: &'a ListenId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        let mut rows = crate::lock(&self.rows);
        if !rows.voices.iter().any(|(l, k)| l == id && k == key) {
            rows.voices.push((id.clone(), key.clone()));
        }
        done()
    }

    fn voices<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ObjectKey>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            Ok(rows
                .voices
                .iter()
                .filter(|(l, _)| l == id)
                .map(|(_, k)| k.clone())
                .collect())
        })
    }

    fn delete<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()> {
        let mut rows = crate::lock(&self.rows);
        rows.listens.retain(|l| &l.id != id);
        rows.turns.retain(|(l, _)| l != id);
        rows.versions.retain(|(l, _)| l != id);
        rows.voices.retain(|(l, _)| l != id);
        done()
    }
}

/// One call the interpreter saw.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeenListenCall {
    /// Understand: target code and the turn indexes sent.
    Understand(String, Vec<u32>),
    /// Merge: target code and how many parts.
    Merge(String, usize),
    /// Check: the part label, the turn indexes and the translations sent.
    Check(String, Vec<u32>, Vec<String>),
    /// Fix: the turn indexes and the notes sent.
    Fix(Vec<u32>, Vec<String>),
}

/// [`ListenInterpreter`] answering scripted answers in order; the last one of each kind
/// repeats, and a kind with none is `MODEL_UNAVAILABLE`. Understand answers are cut down to the
/// turns of each request, so one script serves a transcript sent in parts.
#[derive(Debug, Default)]
pub struct ScriptedInterpreter {
    understand: Mutex<VecDeque<Draft>>,
    merge: Mutex<VecDeque<Overview>>,
    checks: Mutex<VecDeque<CheckAnswer>>,
    fixes: Mutex<VecDeque<FixAnswer>>,
    seen: Mutex<Vec<SeenListenCall>>,
}

fn next<T: Clone>(q: &Mutex<VecDeque<T>>) -> Result<T, AppError> {
    let mut q = crate::lock(q);
    let item = if q.len() > 1 {
        q.pop_front()
    } else {
        q.front().cloned()
    };
    item.ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "nothing scripted"))
}

impl ScriptedInterpreter {
    /// Every understand from now on answers `draft` (cut down to the turns asked about).
    pub fn understands(&self, draft: Draft) {
        *crate::lock(&self.understand) = VecDeque::from([draft]);
    }

    /// Every merge from now on answers `overview`.
    pub fn merges(&self, overview: Overview) {
        *crate::lock(&self.merge) = VecDeque::from([overview]);
    }

    /// The next check answers `answer`.
    pub fn checks(&self, answer: CheckAnswer) {
        crate::lock(&self.checks).push_back(answer);
    }

    /// The next fix answers `answer`.
    pub fn fixes(&self, answer: FixAnswer) {
        crate::lock(&self.fixes).push_back(answer);
    }

    /// Every call so far.
    pub fn seen(&self) -> Vec<SeenListenCall> {
        crate::lock(&self.seen).clone()
    }

    fn record(&self, call: SeenListenCall) {
        crate::lock(&self.seen).push(call);
    }
}

fn indexes(turns: &[ListenTurn]) -> Vec<u32> {
    turns.iter().map(|t| t.index).collect()
}

impl ListenInterpreter for ScriptedInterpreter {
    fn understand<'a>(&'a self, r: UnderstandRequest<'a>) -> PortResult<'a, Draft> {
        Box::pin(async move {
            self.record(SeenListenCall::Understand(
                r.target.code.to_owned(),
                indexes(r.turns),
            ));
            let mut d = next(&self.understand)?;
            d.turns
                .retain(|t| r.turns.iter().any(|x| x.index == t.index));
            Ok(d)
        })
    }

    fn merge<'a>(&'a self, r: MergeRequest<'a>) -> PortResult<'a, Overview> {
        Box::pin(async move {
            self.record(SeenListenCall::Merge(
                r.target.code.to_owned(),
                r.parts.len(),
            ));
            next(&self.merge)
        })
    }

    fn check<'a>(&'a self, r: CheckRequest<'a>) -> PortResult<'a, CheckAnswer> {
        Box::pin(async move {
            let sent = r
                .draft
                .turns
                .iter()
                .map(|t| t.translation.clone())
                .collect();
            self.record(SeenListenCall::Check(
                r.part.to_owned(),
                indexes(r.turns),
                sent,
            ));
            next(&self.checks)
        })
    }

    fn fix<'a>(&'a self, r: FixRequest<'a>) -> PortResult<'a, FixAnswer> {
        Box::pin(async move {
            self.record(SeenListenCall::Fix(indexes(r.turns), r.notes.to_vec()));
            next(&self.fixes)
        })
    }
}
