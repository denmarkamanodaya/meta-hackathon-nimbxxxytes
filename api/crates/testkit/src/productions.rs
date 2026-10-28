//! In-memory [`ProductionStore`].

use std::collections::HashSet;
use std::sync::Mutex;

use nimbytes_core::domain::ids::{ProductionId, SegmentId, ShortId, ShotId, UserId};
use nimbytes_core::domain::production::{CoverageMatch, Production, ProductionStatus, Shot};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{LibrarySummary, PortResult, ProductionStore};

/// Productions and shots in memory.
#[derive(Debug, Default)]
pub struct InMemoryProductions {
    /// Productions in creation order.
    pub productions: Mutex<Vec<Production>>,
    /// Shots of every production, with the production they belong to.
    pub shots: Mutex<Vec<(ProductionId, Shot)>>,
    /// Productions whose automatic first art was claimed.
    pub auto_art: Mutex<HashSet<ProductionId>>,
}

fn done<'a>() -> PortResult<'a, ()> {
    Box::pin(async { Ok(()) })
}

impl InMemoryProductions {
    /// Stores `p` with `shots` as they are (a test's starting state).
    pub fn put(&self, p: Production, shots: Vec<Shot>) {
        let id = p.id.clone();
        crate::lock(&self.productions).push(p);
        crate::lock(&self.shots).extend(shots.into_iter().map(|s| (id.clone(), s)));
    }

    /// The stored shot `id`.
    pub fn shot(&self, id: &ShotId) -> Option<Shot> {
        crate::lock(&self.shots)
            .iter()
            .find(|(_, s)| &s.id == id)
            .map(|(_, s)| s.clone())
    }

    fn update(&self, id: &ProductionId, f: impl FnOnce(&mut Production)) {
        if let Some(p) = crate::lock(&self.productions)
            .iter_mut()
            .find(|p| &p.id == id)
        {
            f(p);
        }
    }

    fn update_shot(&self, id: &ShotId, f: impl FnOnce(&mut Shot)) {
        if let Some((_, s)) = crate::lock(&self.shots)
            .iter_mut()
            .find(|(_, s)| &s.id == id)
        {
            f(s);
        }
    }
}

impl ProductionStore for InMemoryProductions {
    fn create<'a>(&'a self, production: &'a Production) -> PortResult<'a, ()> {
        crate::lock(&self.productions).push(production.clone());
        done()
    }

    fn get<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Option<Production>> {
        let got = crate::lock(&self.productions)
            .iter()
            .find(|p| &p.id == id)
            .cloned();
        Box::pin(async move { Ok(got) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Production>> {
        let mine: Vec<Production> = crate::lock(&self.productions)
            .iter()
            .rev()
            .filter(|p| &p.user_id == user)
            .cloned()
            .collect();
        Box::pin(async move { Ok(mine) })
    }

    fn shots<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, Vec<Shot>> {
        let mut mine: Vec<Shot> = crate::lock(&self.shots)
            .iter()
            .filter(|(p, _)| p == id)
            .map(|(_, s)| s.clone())
            .collect();
        mine.sort_by_key(|s| s.ord);
        Box::pin(async move { Ok(mine) })
    }

    fn save_plan<'a>(
        &'a self,
        id: &'a ProductionId,
        title: &'a str,
        shots: &'a [Shot],
    ) -> PortResult<'a, bool> {
        let mut stored = crate::lock(&self.shots);
        let fresh = !stored.iter().any(|(p, _)| p == id);
        if fresh {
            stored.extend(shots.iter().map(|s| (id.clone(), s.clone())));
        }
        drop(stored);
        if fresh {
            self.update(id, |p| title.clone_into(&mut p.title));
        }
        Box::pin(async move { Ok(fresh) })
    }

    fn set_board<'a>(&'a self, shot: &'a ShotId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        self.update_shot(shot, |s| s.board_key = Some(key.clone()));
        done()
    }

    fn set_footage_board<'a>(
        &'a self,
        shot: &'a ShotId,
        key: &'a ObjectKey,
        segment: &'a SegmentId,
    ) -> PortResult<'a, ()> {
        self.update_shot(shot, |s| {
            s.footage_board_key = Some(key.clone());
            s.footage_board_segment = Some(segment.clone());
        });
        done()
    }

    fn set_title<'a>(&'a self, id: &'a ProductionId, title: &'a str) -> PortResult<'a, ()> {
        self.update(id, |p| title.clone_into(&mut p.title));
        done()
    }

    fn set_art<'a>(&'a self, id: &'a ProductionId, key: &'a ObjectKey) -> PortResult<'a, ()> {
        self.update(id, |p| p.art_key = Some(key.clone()));
        done()
    }

    fn claim_auto_art<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, bool> {
        let first = crate::lock(&self.auto_art).insert(id.clone());
        Box::pin(async move { Ok(first) })
    }

    fn set_coverage<'a>(
        &'a self,
        id: &'a ProductionId,
        matches: &'a [CoverageMatch],
        checked_at: &'a str,
    ) -> PortResult<'a, ()> {
        for m in matches {
            self.update_shot(&m.shot_id, |s| {
                s.matched_segment_id.clone_from(&m.segment_id);
                s.match_reason.clone_from(&m.reason);
                s.take_count = m.take_count;
            });
        }
        self.update(id, |p| p.coverage_checked_at = Some(checked_at.to_owned()));
        done()
    }

    fn set_status<'a>(
        &'a self,
        id: &'a ProductionId,
        status: ProductionStatus,
        error: Option<&'a str>,
    ) -> PortResult<'a, ()> {
        self.update(id, |p| {
            p.status = status;
            p.error = error.map(str::to_owned);
        });
        done()
    }

    fn set_cut<'a>(&'a self, id: &'a ProductionId, short: &'a ShortId) -> PortResult<'a, bool> {
        let mut linked = false;
        self.update(id, |p| {
            if p.short_id.is_none() {
                p.short_id = Some(short.clone());
                p.status = ProductionStatus::Cutting;
                linked = true;
            }
        });
        Box::pin(async move { Ok(linked) })
    }

    fn by_short<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<Production>> {
        let got = crate::lock(&self.productions)
            .iter()
            .find(|p| p.short_id.as_ref() == Some(short))
            .cloned();
        Box::pin(async move { Ok(got) })
    }

    fn fail_planning<'a>(&'a self, _error: &'a str) -> PortResult<'a, u64> {
        Box::pin(async { Ok(0) })
    }

    fn delete<'a>(&'a self, id: &'a ProductionId) -> PortResult<'a, ()> {
        crate::lock(&self.productions).retain(|p| &p.id != id);
        crate::lock(&self.shots).retain(|(p, _)| p != id);
        done()
    }

    fn library_summary<'a>(&'a self, _user: &'a UserId) -> PortResult<'a, LibrarySummary> {
        Box::pin(async { Ok(LibrarySummary::default()) })
    }

    fn last_ready_at<'a>(&'a self, _user: &'a UserId) -> PortResult<'a, Option<String>> {
        Box::pin(async { Ok(None) })
    }
}
