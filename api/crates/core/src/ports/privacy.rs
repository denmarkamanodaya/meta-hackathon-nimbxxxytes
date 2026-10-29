//! Face boxes for the privacy blur and the finish settings of shorts.

use crate::domain::ids::{ClipId, SegmentId, ShortId, TrackId};
use crate::domain::privacy::{FaceBox, HiddenBoxes, ShortFinish};
use crate::ports::PortResult;

/// Stored face boxes and short finishes.
pub trait PrivacyStore: Send + Sync {
    /// Replaces every face box of `clip`'s tracks with `boxes` (tracks must exist).
    fn replace_boxes<'a>(
        &'a self,
        clip: &'a ClipId,
        boxes: &'a [(TrackId, Vec<FaceBox>)],
    ) -> PortResult<'a, ()>;

    /// For each listed segment, the boxes of every hidden track seen in it.
    fn hidden_boxes<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, Vec<HiddenBoxes>>;

    /// The short's stored finish, if one was saved.
    fn finish<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<ShortFinish>>;

    /// Saves the short's finish.
    fn put_finish<'a>(&'a self, short: &'a ShortId, finish: &'a ShortFinish) -> PortResult<'a, ()>;
}
