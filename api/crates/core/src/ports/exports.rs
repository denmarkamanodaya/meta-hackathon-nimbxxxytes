//! Exports of shorts: one row per short and platform.

use crate::domain::cover::{CoverInfo, CoverTitle};
use crate::domain::export::{ExportStatus, ShortExport};
use crate::domain::ids::ShortId;
use crate::domain::production::Platform;
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// Short exports.
pub trait ExportStore: Send + Sync {
    /// Starts (or restarts) the export: inserts the row, or resets an existing one's aspect,
    /// version and status while keeping its caption, hashtags and covers.
    fn queue_export<'a>(&'a self, export: &'a ShortExport) -> PortResult<'a, ()>;

    /// The short's exports, in platform order.
    fn exports<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Vec<ShortExport>>;

    /// Sets the caption and hashtags.
    fn set_text<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        text: (&'a str, &'a [String]),
    ) -> PortResult<'a, ()>;

    /// Appends covers with how each was made (a key already stored is skipped). Covers stored
    /// before infos existed get their legacy info first, so infos stay aligned with keys.
    fn add_covers<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        covers: &'a [(ObjectKey, CoverInfo)],
    ) -> PortResult<'a, ()>;

    /// Sets the chosen cover and forgets the titled still (it shows the old pick).
    fn set_cover_pick<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        pick: u32,
    ) -> PortResult<'a, ()>;

    /// Sets the cover title and forgets the titled still (it shows the old title).
    fn set_cover_title<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        title: &'a CoverTitle,
    ) -> PortResult<'a, ()>;

    /// Records the titled still `key`, made for `baked` (the pick and title it shows), only
    /// while the export still has that pick and title. Returns whether it was recorded.
    fn set_titled<'a>(
        &'a self,
        export: (&'a ShortId, Platform),
        key: &'a ObjectKey,
        baked: (u32, &'a CoverTitle),
    ) -> PortResult<'a, bool>;

    /// Sets the render status (and video, when given) of these platforms.
    fn set_render<'a>(
        &'a self,
        short: &'a ShortId,
        platforms: &'a [Platform],
        render: (ExportStatus, Option<&'a ObjectKey>),
    ) -> PortResult<'a, ()>;

    /// Marks every export still `queued` or `rendering` failed (a restart stopped it), except
    /// feed exports, which follow the short's own render; returns how many.
    fn fail_unfinished(&self) -> PortResult<'_, u64>;
}
