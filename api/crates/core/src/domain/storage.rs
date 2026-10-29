//! The owner's originals: how many bytes, and how recently they were opened. Originals not opened
//! for 30 days count as resting, the rest as frequent. The bucket has one storage class, so the
//! split says only how recently the owner looked, not where or at what price a file is stored.
//! Everything else the account stores is measured separately (see [`super::storage_cap`]).

use crate::domain::clip::{Clip, ClipStatus};
use crate::ports::EpochMillis;
use crate::time::parse_utc;

/// Days without access after which an original counts as resting.
pub const RESTING_AFTER_DAYS: i64 = 30;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Bytes of originals in the cloud and on the phone, split by how recently they were opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StorageSummary {
    /// Every original's size.
    pub cloud_bytes: u64,
    /// Always 0: the app keeps no media on the phone.
    pub phone_bytes: u64,
    /// Originals accessed in the last [`RESTING_AFTER_DAYS`] days.
    pub frequent_bytes: u64,
    /// Originals not accessed for [`RESTING_AFTER_DAYS`] days or more.
    pub resting_bytes: u64,
    /// Originals counted.
    pub clip_count: u32,
}

/// Last access of a clip's original: the later of its upload and its last opening.
/// `None` when neither time can be read.
pub fn last_access(clip: &Clip) -> Option<EpochMillis> {
    let created = parse_utc(&clip.created_at);
    let viewed = clip.last_viewed_at.as_deref().and_then(parse_utc);
    created.max(viewed)
}

/// Whether an original last accessed at `last` rests at `now`. An unreadable time counts as
/// frequent, so nothing is reported as cheaper than it is.
pub fn is_resting(last: Option<EpochMillis>, now: EpochMillis) -> bool {
    last.is_some_and(|t| now - t >= RESTING_AFTER_DAYS * DAY_MS)
}

/// The summary of `clips` at `now`. Clips still uploading have no complete original, and
/// copies (exact or near) are the owner's to remove, so both are left out.
pub fn summarize(clips: &[Clip], now: EpochMillis) -> StorageSummary {
    let mut s = StorageSummary {
        cloud_bytes: 0,
        phone_bytes: 0,
        frequent_bytes: 0,
        resting_bytes: 0,
        clip_count: 0,
    };
    let counted = clips
        .iter()
        .filter(|c| c.status != ClipStatus::Uploading && !c.is_copy());
    for clip in counted {
        s.cloud_bytes += clip.size_bytes;
        s.clip_count += 1;
        if is_resting(last_access(clip), now) {
            s.resting_bytes += clip.size_bytes;
        } else {
            s.frequent_bytes += clip.size_bytes;
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{ClipId, UserId};
    use crate::domain::media::MediaExt;

    /// 2026-10-27T00:00:00Z.
    const NOW: EpochMillis = 1_793_059_200_000;

    fn clip(size: u64, created: &str, viewed: Option<&str>, status: ClipStatus) -> Clip {
        Clip {
            id: ClipId::parse("c1").unwrap(),
            user_id: UserId::parse("u1").unwrap(),
            filename: "a.mp4".into(),
            ext: MediaExt::Mp4,
            size_bytes: size,
            status,
            probe: None,
            created_at: created.into(),
            title: None,
            last_viewed_at: viewed.map(str::to_owned),
            content_sha256: None,
            duplicate_of: None,
        }
    }

    #[test]
    fn an_original_rests_from_30_days_after_its_last_access() {
        let day = |d: i64| Some(NOW - d * DAY_MS);
        assert!(!is_resting(day(29), NOW));
        assert!(is_resting(day(30), NOW));
        assert!(
            !is_resting(None, NOW),
            "an unreadable time is never called resting"
        );
    }

    #[test]
    fn opening_a_clip_counts_as_access() {
        let old = clip(
            1,
            "2026-08-01T00:00:00.000Z",
            Some("2026-10-20T00:00:00.000Z"),
            ClipStatus::Ready,
        );
        assert_eq!(last_access(&old), parse_utc("2026-10-20T00:00:00.000Z"));
    }

    #[test]
    fn the_summary_splits_bytes_by_last_access_and_skips_unfinished_uploads() {
        let clips = [
            clip(100, "2026-08-01T00:00:00.000Z", None, ClipStatus::Ready),
            clip(
                40,
                "2026-08-01T00:00:00.000Z",
                Some("2026-10-26T00:00:00.000Z"),
                ClipStatus::Ready,
            ),
            clip(7, "2026-10-26T00:00:00.000Z", None, ClipStatus::Processing),
            clip(999, "2026-10-26T00:00:00.000Z", None, ClipStatus::Uploading),
        ];
        let s = summarize(&clips, NOW);
        assert_eq!(
            s,
            StorageSummary {
                cloud_bytes: 147,
                phone_bytes: 0,
                frequent_bytes: 47,
                resting_bytes: 100,
                clip_count: 3,
            }
        );
    }

    #[test]
    fn duplicates_are_left_out_of_the_totals() {
        let clips = [
            clip(100, "2026-10-26T00:00:00.000Z", None, ClipStatus::Ready),
            clip(100, "2026-10-26T00:00:00.000Z", None, ClipStatus::Duplicate),
            clip(100, "2026-10-26T00:00:00.000Z", None, ClipStatus::NearCopy),
        ];
        let s = summarize(&clips, NOW);
        assert_eq!(
            (s.cloud_bytes, s.clip_count),
            (100, 1),
            "exact and near copies"
        );
    }
}
