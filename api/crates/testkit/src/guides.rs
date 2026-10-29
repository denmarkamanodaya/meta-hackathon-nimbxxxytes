//! Fakes for MyWay: guide rows in memory, a scripted Spark writer and a narrator. Calls are
//! recorded so tests can assert what was asked.

use std::sync::Mutex;

use nimbytes_core::domain::guide::{Guide, GuideDraft, GuideStep};
use nimbytes_core::domain::ids::{ClipId, GuideId, UserId};
use nimbytes_core::ports::{
    GuideProgress, GuideRequest, GuideStore, GuideVerdict, GuideWriter, Narrator, PortResult,
};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct Rows {
    guides: Vec<Guide>,
    steps: Vec<(GuideId, GuideStep)>,
}

/// [`GuideStore`] over vectors; `create` is ignored for a clip that has a guide.
#[derive(Debug, Default)]
pub struct InMemoryGuides {
    rows: Mutex<Rows>,
}

impl InMemoryGuides {
    /// The stored guide.
    pub fn guide(&self, id: &str) -> Option<Guide> {
        crate::lock(&self.rows)
            .guides
            .iter()
            .find(|g| g.id.as_str() == id)
            .cloned()
    }

    /// The stored steps of a guide by number.
    pub fn steps_of(&self, id: &str) -> Vec<GuideStep> {
        let rows = crate::lock(&self.rows);
        let mut steps: Vec<GuideStep> = rows
            .steps
            .iter()
            .filter(|(g, _)| g.as_str() == id)
            .map(|(_, s)| s.clone())
            .collect();
        steps.sort_by_key(|s| s.n);
        steps
    }

    /// Puts a guide and its steps in place, as an earlier run would have.
    pub fn put(&self, guide: Guide, steps: Vec<GuideStep>) {
        let mut rows = crate::lock(&self.rows);
        rows.steps
            .extend(steps.into_iter().map(|s| (guide.id.clone(), s)));
        rows.guides.push(guide);
    }

    fn edit(&self, id: &GuideId, f: impl FnOnce(&mut Guide)) {
        if let Some(g) = crate::lock(&self.rows)
            .guides
            .iter_mut()
            .find(|g| &g.id == id)
        {
            f(g);
        }
    }
}

impl GuideStore for InMemoryGuides {
    fn create<'a>(&'a self, guide: &'a Guide) -> PortResult<'a, bool> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            if rows.guides.iter().any(|g| g.clip_id == guide.clip_id) {
                return Ok(false);
            }
            rows.guides.push(guide.clone());
            Ok(true)
        })
    }

    fn get<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Option<Guide>> {
        Box::pin(async move { Ok(self.guide(id.as_str())) })
    }

    fn for_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Option<Guide>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            Ok(rows.guides.iter().find(|g| &g.clip_id == clip).cloned())
        })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Guide>> {
        Box::pin(async move {
            let rows = crate::lock(&self.rows);
            let mut mine: Vec<Guide> = rows
                .guides
                .iter()
                .filter(|g| &g.user_id == user)
                .cloned()
                .collect();
            mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn steps<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, Vec<GuideStep>> {
        Box::pin(async move { Ok(self.steps_of(id.as_str())) })
    }

    fn set_progress<'a>(
        &'a self,
        id: &'a GuideId,
        progress: GuideProgress<'a>,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |g| {
                g.status = progress.status;
                g.stage = progress.stage;
                g.error = progress.error.map(str::to_owned);
                g.updated_at = progress.at.to_owned();
            });
            Ok(())
        })
    }

    fn set_title<'a>(&'a self, id: &'a GuideId, title: &'a str, at: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |g| {
                g.title = title.to_owned();
                g.updated_at = at.to_owned();
            });
            Ok(())
        })
    }

    fn set_plan<'a>(
        &'a self,
        id: &'a GuideId,
        verdict: GuideVerdict<'a>,
        steps: &'a [GuideStep],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            self.edit(id, |g| {
                g.title = verdict.title.to_owned();
                g.safety = Some(verdict.safety);
                g.safety_reason = Some(verdict.reason.to_owned());
            });
            let mut rows = crate::lock(&self.rows);
            rows.steps.retain(|(g, _)| g != id);
            rows.steps
                .extend(steps.iter().map(|s| (id.clone(), s.clone())));
            Ok(())
        })
    }

    fn put_step<'a>(&'a self, id: &'a GuideId, step: &'a GuideStep) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            rows.steps.retain(|(g, s)| !(g == id && s.n == step.n));
            rows.steps.push((id.clone(), step.clone()));
            Ok(())
        })
    }

    fn delete<'a>(&'a self, id: &'a GuideId) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            rows.guides.retain(|g| &g.id != id);
            rows.steps.retain(|(g, _)| g != id);
            Ok(())
        })
    }
}

/// One request the writer saw: the video file name, duration and transcript.
pub type SeenGuideRequest = (String, f64, String);

/// [`GuideWriter`] answering a scripted draft (`MODEL_UNAVAILABLE` until one is set).
#[derive(Debug, Default)]
pub struct ScriptedGuideWriter {
    draft: Mutex<Option<GuideDraft>>,
    seen: Mutex<Vec<SeenGuideRequest>>,
}

impl ScriptedGuideWriter {
    /// Every call answers `draft`.
    pub fn answers(&self, draft: GuideDraft) {
        *crate::lock(&self.draft) = Some(draft);
    }

    /// Requests so far.
    pub fn seen(&self) -> Vec<SeenGuideRequest> {
        crate::lock(&self.seen).clone()
    }
}

impl GuideWriter for ScriptedGuideWriter {
    fn write_steps<'a>(&'a self, request: &'a GuideRequest<'a>) -> PortResult<'a, GuideDraft> {
        Box::pin(async move {
            let name = request
                .video
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            crate::lock(&self.seen).push((name, request.duration_s, request.transcript.clone()));
            crate::lock(&self.draft)
                .clone()
                .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "no draft scripted"))
        })
    }
}

/// [`Narrator`] answering `wav:{text}` bytes and recording every sentence; `fail` makes it fail.
#[derive(Debug, Default)]
pub struct FakeNarrator {
    spoken: Mutex<Vec<String>>,
    fail: Mutex<bool>,
}

impl FakeNarrator {
    /// Sentences spoken so far.
    pub fn spoken(&self) -> Vec<String> {
        crate::lock(&self.spoken).clone()
    }

    /// Every call fails from now on.
    pub fn fail(&self) {
        *crate::lock(&self.fail) = true;
    }
}

impl Narrator for FakeNarrator {
    fn speak<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<u8>> {
        Box::pin(async move {
            crate::lock(&self.spoken).push(text.to_owned());
            if *crate::lock(&self.fail) {
                return Err(AppError::new(ErrorCode::Internal, "tts failed"));
            }
            Ok(format!("wav:{text}").into_bytes())
        })
    }
}
