//! In-memory [`PrivacyStore`]: keeps every clip's latest boxes, serves set hidden boxes and
//! finishes.

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::AppError;
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId, TrackId};
use nimbytes_core::domain::privacy::{FaceBox, HiddenBoxes, ShortFinish};
use nimbytes_core::ports::{PortResult, PrivacyStore};

/// Each track of a clip with its boxes.
pub type TrackBoxes = Vec<(TrackId, Vec<FaceBox>)>;

/// Face boxes and finishes in memory.
#[derive(Debug, Default)]
pub struct InMemoryPrivacy {
    /// The latest boxes written per clip.
    pub boxes: Mutex<HashMap<ClipId, TrackBoxes>>,
    /// Hidden boxes `hidden_boxes` answers from (filtered to the asked segments).
    pub hidden: Mutex<Vec<HiddenBoxes>>,
    /// Saved finishes.
    pub finishes: Mutex<HashMap<ShortId, ShortFinish>>,
    /// Blur choice of the production each story short belongs to.
    pub production_blur: Mutex<HashMap<ShortId, bool>>,
}

fn ready<'a, T: Send + 'a>(value: T) -> PortResult<'a, T> {
    Box::pin(async move { Ok::<T, AppError>(value) })
}

impl PrivacyStore for InMemoryPrivacy {
    fn replace_boxes<'a>(
        &'a self,
        clip: &'a ClipId,
        boxes: &'a [(TrackId, Vec<FaceBox>)],
    ) -> PortResult<'a, ()> {
        if let Ok(mut map) = self.boxes.lock() {
            map.insert(clip.clone(), boxes.to_vec());
        }
        ready(())
    }

    fn hidden_boxes<'a>(&'a self, segments: &'a [SegmentId]) -> PortResult<'a, Vec<HiddenBoxes>> {
        let found = self
            .hidden
            .lock()
            .map(|h| {
                h.iter()
                    .filter(|b| segments.contains(&b.segment_id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        ready(found)
    }

    fn finish<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<ShortFinish>> {
        ready(
            self.finishes
                .lock()
                .ok()
                .and_then(|f| f.get(short).cloned()),
        )
    }

    fn put_finish<'a>(&'a self, short: &'a ShortId, finish: &'a ShortFinish) -> PortResult<'a, ()> {
        if let Ok(mut f) = self.finishes.lock() {
            f.insert(short.clone(), finish.clone());
        }
        ready(())
    }

    fn production_blur<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, Option<bool>> {
        ready(
            self.production_blur
                .lock()
                .ok()
                .and_then(|p| p.get(short).copied()),
        )
    }
}
