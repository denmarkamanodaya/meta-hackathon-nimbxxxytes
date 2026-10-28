//! Fakes for shorts: an in-memory [`ShortStore`] and a [`Renderer`] that records its calls.

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::domain::critique::Critique;
use nimbytes_core::domain::ids::{SegmentId, ShortId, UserId};
use nimbytes_core::domain::render::{CoverStillProps, Quality, ShortProps};
use nimbytes_core::domain::short::{NewStep, Short, ShortSegment, ShortStatus, Step, Version};
use nimbytes_core::domain::timeline::Timeline;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{PortResult, RenderOutput, Renderer, ShortStore};
use nimbytes_core::{AppError, ErrorCode};

#[derive(Debug, Default)]
struct State {
    moments: Vec<(ShortSegment, UserId)>,
    shorts: HashMap<ShortId, Short>,
    picks: HashMap<ShortId, Vec<SegmentId>>,
    versions: HashMap<ShortId, Vec<Version>>,
    steps: HashMap<ShortId, Vec<NewStep>>,
}

/// [`ShortStore`] in memory. Moments must be added with [`InMemoryShorts::add_moment`] first.
#[derive(Debug, Default)]
pub struct InMemoryShorts {
    state: Mutex<State>,
}

impl InMemoryShorts {
    /// Makes `segment` (owned by `owner`) pickable.
    pub fn add_moment(&self, segment: ShortSegment, owner: &UserId) {
        crate::lock(&self.state)
            .moments
            .push((segment, owner.clone()));
    }

    /// The stored short, for assertions.
    pub fn short(&self, id: &ShortId) -> Option<Short> {
        crate::lock(&self.state).shorts.get(id).cloned()
    }

    /// The logged step summaries, for assertions.
    pub fn summaries(&self, id: &ShortId) -> Vec<String> {
        let state = crate::lock(&self.state);
        let steps = state.steps.get(id).into_iter().flatten();
        steps.map(|s| s.summary.clone()).collect()
    }

    fn edit(&self, id: &ShortId, f: impl FnOnce(&mut Short)) -> Result<(), AppError> {
        let mut state = crate::lock(&self.state);
        let short = state
            .shorts
            .get_mut(id)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "no such short row"))?;
        f(short);
        Ok(())
    }
}

impl ShortStore for InMemoryShorts {
    fn segment_owners<'a>(
        &'a self,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<(SegmentId, UserId)>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let known = state
                .moments
                .iter()
                .filter(|(s, _)| ids.contains(&s.segment_id));
            Ok(known
                .map(|(s, u)| (s.segment_id.clone(), u.clone()))
                .collect())
        })
    }

    fn create<'a>(&'a self, short: &'a Short, segments: &'a [SegmentId]) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.shorts.insert(short.id.clone(), short.clone());
            state.picks.insert(short.id.clone(), segments.to_vec());
            Ok(())
        })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Short>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let mut mine: Vec<Short> = state
                .shorts
                .values()
                .filter(|s| &s.user_id == user)
                .cloned()
                .collect();
            mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn get<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Option<Short>> {
        Box::pin(async move { Ok(self.short(id)) })
    }

    fn segments<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<ShortSegment>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let picks = state.picks.get(id).cloned().unwrap_or_default();
            let found = picks.iter().filter_map(|p| {
                let hit = state.moments.iter().find(|(s, _)| &s.segment_id == p);
                hit.map(|(s, _)| s.clone())
            });
            Ok(found.collect())
        })
    }

    fn moments<'a>(
        &'a self,
        user: &'a UserId,
        ids: &'a [SegmentId],
    ) -> PortResult<'a, Vec<ShortSegment>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let found = ids.iter().filter_map(|id| {
                let hit = state
                    .moments
                    .iter()
                    .find(|(s, u)| &s.segment_id == id && u == user);
                hit.map(|(s, _)| s.clone())
            });
            Ok(found.collect())
        })
    }

    fn library<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<SegmentId>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let own = state.moments.iter().filter(|(_, u)| u == user);
            Ok(own.map(|(s, _)| s.segment_id.clone()).collect())
        })
    }

    fn add_segments<'a>(
        &'a self,
        id: &'a ShortId,
        segments: &'a [SegmentId],
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let picks = state.picks.entry(id.clone()).or_default();
            for s in segments {
                if !picks.contains(s) {
                    picks.push(s.clone());
                }
            }
            Ok(())
        })
    }

    fn add_version<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        timeline: &'a Timeline,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let versions = state.versions.entry(id.clone()).or_default();
            if versions.iter().any(|v| v.n == n) {
                return Err(AppError::new(ErrorCode::Internal, "version exists"));
            }
            versions.push(Version {
                n,
                timeline: timeline.clone(),
                preview_key: None,
                critique: None,
            });
            Ok(())
        })
    }

    fn versions<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Version>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            Ok(state.versions.get(id).cloned().unwrap_or_default())
        })
    }

    fn set_preview<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        key: &'a ObjectKey,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let versions = state.versions.entry(id.clone()).or_default();
            for v in versions.iter_mut().filter(|v| v.n == n) {
                v.preview_key = Some(key.clone());
            }
            Ok(())
        })
    }

    fn set_critique<'a>(
        &'a self,
        id: &'a ShortId,
        n: u32,
        critique: &'a Critique,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let versions = state.versions.entry(id.clone()).or_default();
            for v in versions.iter_mut().filter(|v| v.n == n) {
                v.critique = Some(critique.clone());
            }
            Ok(())
        })
    }

    fn set_status<'a>(&'a self, id: &'a ShortId, status: ShortStatus) -> PortResult<'a, ()> {
        Box::pin(async move { self.edit(id, |s| s.status = status) })
    }

    fn set_best_version<'a>(&'a self, id: &'a ShortId, n: u32) -> PortResult<'a, ()> {
        Box::pin(async move { self.edit(id, |s| s.best_version = Some(n)) })
    }

    fn set_render<'a>(
        &'a self,
        id: &'a ShortId,
        render: Option<(&'a ObjectKey, u32)>,
    ) -> PortResult<'a, ()> {
        Box::pin(async move { self.edit(id, |s| s.render = render.map(|(k, n)| (k.clone(), n))) })
    }

    fn add_step<'a>(&'a self, id: &'a ShortId, step: &'a NewStep) -> PortResult<'a, u32> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            let steps = state.steps.entry(id.clone()).or_default();
            steps.push(step.clone());
            u32::try_from(steps.len() - 1).map_err(|_| AppError::new(ErrorCode::Internal, "seq"))
        })
    }

    fn steps<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, Vec<Step>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let steps = state.steps.get(id).cloned().unwrap_or_default();
            Ok((0..)
                .zip(steps)
                .map(|(seq, step)| Step { seq, step })
                .collect())
        })
    }

    fn created_before<'a>(&'a self, cutoff: &'a str) -> PortResult<'a, Vec<Short>> {
        Box::pin(async move {
            let state = crate::lock(&self.state);
            let mut old: Vec<Short> = state
                .shorts
                .values()
                .filter(|s| s.created_at.as_str() < cutoff)
                .cloned()
                .collect();
            old.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
            Ok(old)
        })
    }

    fn clear_preview<'a>(&'a self, id: &'a ShortId, n: u32) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            if let Some(versions) = state.versions.get_mut(id) {
                for v in versions.iter_mut().filter(|v| v.n == n) {
                    v.preview_key = None;
                }
            }
            Ok(())
        })
    }

    fn delete<'a>(&'a self, id: &'a ShortId) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut state = crate::lock(&self.state);
            state.shorts.remove(id);
            state.picks.remove(id);
            state.versions.remove(id);
            state.steps.remove(id);
            Ok(())
        })
    }
}

/// One recorded render call.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderCall {
    /// Props sent.
    pub props: ShortProps,
    /// Size asked for.
    pub quality: Quality,
    /// Upload URL given.
    pub out_url: String,
}

/// [`Renderer`] that records calls and answers 12.5 s / 2 MB, or fails when told to.
#[derive(Debug, Default)]
pub struct FakeRenderer {
    calls: Mutex<Vec<RenderCall>>,
    stills: Mutex<Vec<(CoverStillProps, String)>>,
    failing: Mutex<bool>,
}

impl FakeRenderer {
    /// Makes every later call fail with `RENDER_FAILED`.
    pub fn fail(&self) {
        *crate::lock(&self.failing) = true;
    }

    /// Calls so far.
    pub fn calls(&self) -> Vec<RenderCall> {
        crate::lock(&self.calls).clone()
    }

    /// Cover stills so far: props and upload URL.
    pub fn stills(&self) -> Vec<(CoverStillProps, String)> {
        crate::lock(&self.stills).clone()
    }
}

impl Renderer for FakeRenderer {
    fn render<'a>(
        &'a self,
        props: &'a ShortProps,
        quality: Quality,
        out_url: &'a str,
    ) -> PortResult<'a, RenderOutput> {
        Box::pin(async move {
            crate::lock(&self.calls).push(RenderCall {
                props: props.clone(),
                quality,
                out_url: out_url.to_owned(),
            });
            if *crate::lock(&self.failing) {
                return Err(AppError::new(ErrorCode::RenderFailed, "renderer is down"));
            }
            Ok(RenderOutput {
                duration_s: 12.5,
                bytes: 2_000_000,
            })
        })
    }

    fn still<'a>(&'a self, props: &'a CoverStillProps, out_url: &'a str) -> PortResult<'a, ()> {
        Box::pin(async move {
            crate::lock(&self.stills).push((props.clone(), out_url.to_owned()));
            if *crate::lock(&self.failing) {
                return Err(AppError::new(ErrorCode::RenderFailed, "renderer is down"));
            }
            Ok(())
        })
    }
}
