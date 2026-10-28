//! In-memory [`ExportStore`].

use std::sync::Mutex;

use nimbytes_core::domain::cover::{CoverInfo, CoverTitle, cover_infos};
use nimbytes_core::domain::export::Platform;
use nimbytes_core::domain::export::{ExportStatus, ShortExport};
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{ExportStore, PortResult};

/// Export rows in memory, in insertion order.
#[derive(Debug, Default)]
pub struct InMemoryExports {
    /// The rows.
    pub rows: Mutex<Vec<ShortExport>>,
}

impl InMemoryExports {
    /// Stores `row` as it is (a test's starting state).
    pub fn put(&self, row: ShortExport) {
        let mut rows = crate::lock(&self.rows);
        rows.retain(|r| !(r.short_id == row.short_id && r.platform == row.platform));
        rows.push(row);
    }

    /// The row of `short` on `platform`.
    pub fn row(&self, short: &ShortId, platform: Platform) -> Option<ShortExport> {
        crate::lock(&self.rows)
            .iter()
            .find(|r| &r.short_id == short && r.platform == platform)
            .cloned()
    }

    fn update(&self, short: &ShortId, platform: Platform, f: impl FnOnce(&mut ShortExport)) {
        if let Some(r) = crate::lock(&self.rows)
            .iter_mut()
            .find(|r| &r.short_id == short && r.platform == platform)
        {
            f(r);
        }
    }
}

fn done<'a>() -> PortResult<'a, ()> {
    Box::pin(async { Ok(()) })
}

impl ExportStore for InMemoryExports {
    fn queue_export<'a>(&'a self, export: &'a ShortExport) -> PortResult<'a, ()> {
        let existing = self.row(&export.short_id, export.platform);
        match existing {
            Some(_) => self.update(&export.short_id, export.platform, |r| {
                r.aspect = export.aspect;
                r.version_n = export.version_n;
                r.status = export.status;
                r.render_key = None;
            }),
            None => crate::lock(&self.rows).push(export.clone()),
        }
        done()
    }

    fn exports<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShortExport>> {
        let mut mine: Vec<ShortExport> = crate::lock(&self.rows)
            .iter()
            .filter(|r| &r.short_id == short)
            .cloned()
            .collect();
        mine.sort_by_key(|r| Platform::ALL.iter().position(|p| *p == r.platform));
        Box::pin(async move { Ok(mine) })
    }

    fn set_text<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        (caption, hashtags): (&'a str, &'a [String]),
    ) -> PortResult<'a, ()> {
        self.update(short, platform, |r| {
            caption.clone_into(&mut r.caption);
            r.hashtags = hashtags.to_vec();
        });
        done()
    }

    fn add_covers<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        covers: &'a [(ObjectKey, CoverInfo)],
    ) -> PortResult<'a, ()> {
        self.update(short, platform, |r| {
            r.cover_info = cover_infos(&r.cover_info, r.cover_keys.len());
            for (k, info) in covers {
                if !r.cover_keys.contains(k) {
                    r.cover_keys.push(k.clone());
                    r.cover_info.push(info.clone());
                }
            }
        });
        done()
    }

    fn set_cover_pick<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        pick: u32,
    ) -> PortResult<'a, ()> {
        self.update(short, platform, |r| {
            r.cover_pick = pick;
            r.titled_cover_key = None;
        });
        done()
    }

    fn set_cover_title<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        title: &'a CoverTitle,
    ) -> PortResult<'a, ()> {
        self.update(short, platform, |r| {
            r.cover_title = Some(title.clone());
            r.titled_cover_key = None;
        });
        done()
    }

    fn set_titled<'a>(
        &'a self,
        (short, platform): (&'a ShortId, Platform),
        key: &'a ObjectKey,
        (pick, title): (u32, &'a CoverTitle),
    ) -> PortResult<'a, bool> {
        let mut recorded = false;
        self.update(short, platform, |r| {
            if r.cover_pick == pick && r.cover_title.as_ref() == Some(title) {
                r.titled_cover_key = Some(key.clone());
                recorded = true;
            }
        });
        Box::pin(async move { Ok(recorded) })
    }

    fn set_render<'a>(
        &'a self,
        short: &'a ShortId,
        platforms: &'a [Platform],
        (status, key): (ExportStatus, Option<&'a ObjectKey>),
    ) -> PortResult<'a, ()> {
        for p in platforms {
            self.update(short, *p, |r| {
                r.status = status;
                r.render_key = key.cloned();
            });
        }
        done()
    }

    fn fail_unfinished(&self) -> PortResult<'_, u64> {
        Box::pin(async { Ok(0) })
    }
}
