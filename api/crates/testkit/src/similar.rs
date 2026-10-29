//! In-memory [`ClipLinkStore`].

use std::sync::Mutex;

use nimbytes_core::domain::ids::{ClipId, UserId};
use nimbytes_core::domain::similar::{ClipLink, LinkKind};
use nimbytes_core::ports::{ClipLinkStore, PortResult};

/// Vec-backed links with the same semantics as the SQLite store (one link per ordered pair).
#[derive(Debug, Default)]
pub struct InMemoryClipLinks {
    rows: Mutex<Vec<(UserId, ClipLink)>>,
}

impl InMemoryClipLinks {
    /// Every stored link.
    pub fn all(&self) -> Vec<ClipLink> {
        crate::lock(&self.rows)
            .iter()
            .map(|(_, l)| l.clone())
            .collect()
    }

    /// Stores a link directly (test setup).
    pub fn put(&self, user: &UserId, link: ClipLink) {
        crate::lock(&self.rows).push((user.clone(), link));
    }
}

impl ClipLinkStore for InMemoryClipLinks {
    fn save<'a>(
        &'a self,
        user: &'a UserId,
        links: &'a [ClipLink],
        _now: &'a str,
    ) -> PortResult<'a, ()> {
        Box::pin(async move {
            let mut rows = crate::lock(&self.rows);
            for link in links {
                rows.retain(|(_, l)| !(l.clip == link.clip && l.other == link.other));
                rows.push((user.clone(), link.clone()));
            }
            Ok(())
        })
    }

    fn of_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Vec<ClipLink>> {
        Box::pin(async move {
            Ok(self
                .all()
                .into_iter()
                .filter(|l| &l.clip == clip || &l.other == clip)
                .collect())
        })
    }

    fn of_user<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ClipLink>> {
        Box::pin(async move {
            Ok(crate::lock(&self.rows)
                .iter()
                .filter(|(u, _)| u == user)
                .map(|(_, l)| l.clone())
                .collect())
        })
    }

    fn keep<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(async move {
            for (_, l) in crate::lock(&self.rows).iter_mut() {
                if &l.clip == clip && l.kind == LinkKind::NearCopyOf {
                    l.kind = LinkKind::Kept;
                }
            }
            Ok(())
        })
    }
}
