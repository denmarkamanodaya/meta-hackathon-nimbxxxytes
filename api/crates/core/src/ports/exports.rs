//! Exports of shorts: one row per short and platform.

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

    /// Appends covers.
    fn add_covers<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        keys: &'a [ObjectKey],
    ) -> PortResult<'a, ()>;

    /// Sets the chosen cover.
    fn set_cover_pick<'a>(
        &'a self,
        short: &'a ShortId,
        platform: Platform,
        pick: u32,
    ) -> PortResult<'a, ()>;

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
