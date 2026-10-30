//! Rules for `Exports/`: which files are finished edits, when a file NLEs write progressively is
//! done (its size held still for 5 s), and which multipart parts are left after a restart.

use std::collections::BTreeMap;

use nimbytes_contracts::uploads::CompletedPart;

use crate::core::state::UploadProgress;

/// A size must hold this long before the file counts as finished, milliseconds.
pub const STABLE_FOR_MS: u64 = 5_000;
/// Extensions the server accepts.
pub const VIDEO_EXTENSIONS: [&str; 3] = ["mp4", "mov", "m4v"];
/// Photo extensions the server accepts (`POST /api/photos`); never export candidates.
pub const IMAGE_EXTENSIONS: [&str; 6] = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
/// The largest photo the Mac app sends across the bridge, bytes (50 MB; the API takes 40 MB).
pub const MAX_PICKED_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

/// The photo type of a picked file, from its extension; `None` for anything else.
pub fn image_type(name: &str) -> Option<&'static str> {
    let (_, ext) = name.rsplit_once('.')?;
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        _ => None,
    }
}

/// Whether a top-level file name in `Exports/` is an edit to upload (not hidden, temp or partial).
pub fn is_export_candidate(name: &str) -> bool {
    if name.starts_with('.') || name.starts_with('~') {
        return false;
    }
    let Some((_, ext)) = name.rsplit_once('.') else {
        return false;
    };
    VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str())
}

/// `video/mp4` or `video/quicktime`, from the file name.
pub fn content_type(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".mov") {
        "video/quicktime"
    } else {
        "video/mp4"
    }
}

/// The last size seen for a file and since when it has held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SizeWatch {
    /// Last size, bytes.
    pub size: u64,
    /// When that size was first seen, ms since the epoch.
    pub since_ms: u64,
}

/// Records a new size reading: the clock restarts whenever the size changes.
pub fn observe(previous: Option<SizeWatch>, size: u64, now_ms: u64) -> SizeWatch {
    match previous {
        Some(watch) if watch.size == size => watch,
        _ => SizeWatch {
            size,
            since_ms: now_ms,
        },
    }
}

/// True once a non-empty file kept the same size for [`STABLE_FOR_MS`].
pub fn is_stable(watch: SizeWatch, now_ms: u64) -> bool {
    watch.size > 0 && now_ms.saturating_sub(watch.since_ms) >= STABLE_FOR_MS
}

/// Number of parts for `size` bytes in `part_size` parts (at least one).
pub fn part_count(size: u64, part_size: u64) -> u32 {
    if part_size == 0 {
        return 1;
    }
    u32::try_from(size.div_ceil(part_size).max(1)).unwrap_or(u32::MAX)
}

/// Byte offset and length of part `n` (1-based); the last part may be shorter.
pub fn part_range(n: u32, part_size: u64, size: u64) -> (u64, u64) {
    let offset = u64::from(n.saturating_sub(1)) * part_size;
    let len = part_size.min(size.saturating_sub(offset));
    (offset, len)
}

/// Parts still to upload, ascending.
pub fn remaining_parts(progress: &UploadProgress) -> Vec<u32> {
    (1..=part_count(progress.size_bytes, progress.part_size))
        .filter(|n| !progress.done.contains_key(n))
        .collect()
}

/// Parts presigned at once. Part links live 15 minutes on the server, so they are asked for a
/// batch at a time (16 parts of 16 MiB is 256 MiB, a few minutes on a slow line), never all at
/// the start of a long upload.
pub const PRESIGN_BATCH: usize = 16;

/// The next parts to presign: up to `max` of the remaining ones, ascending.
pub fn next_batch(progress: &UploadProgress, max: usize) -> Vec<u32> {
    remaining_parts(progress).into_iter().take(max).collect()
}

/// Seconds to wait before retry `attempt` (1-based) of a failed upload; `None` after the last.
pub fn retry_delay_s(attempt: u32) -> Option<u64> {
    [10, 30, 60, 120, 300]
        .get(usize::try_from(attempt).ok()?.checked_sub(1)?)
        .copied()
}

/// Whether saved progress still belongs to the file (same size), else the upload restarts.
pub fn can_resume(progress: &UploadProgress, file_size: u64) -> bool {
    progress.size_bytes == file_size
}

/// The completion body: every part once, ascending `n`.
pub fn completed_parts(done: &BTreeMap<u32, String>) -> Vec<CompletedPart> {
    done.iter()
        .map(|(n, etag)| CompletedPart {
            n: *n,
            etag: etag.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_photo_is_typed_by_its_extension_and_is_never_an_export() {
        assert_eq!(super::image_type("IMG_1.HEIC"), Some("image/heic"));
        assert_eq!(super::image_type("a.JPG"), Some("image/jpeg"));
        assert_eq!(super::image_type("clip.mov"), None);
        assert_eq!(super::image_type("noext"), None);
        for ext in super::IMAGE_EXTENSIONS {
            assert!(!super::is_export_candidate(&format!("a.{ext}")));
        }
    }

    use super::*;

    #[test]
    fn only_visible_video_files_are_exports() {
        assert!(is_export_candidate("Final cut.MOV"));
        assert!(is_export_candidate("a.m4v"));
        assert!(!is_export_candidate(".a.mp4"));
        assert!(!is_export_candidate("~a.mp4"));
        assert!(!is_export_candidate("a.mp4.part"));
        assert!(!is_export_candidate("a.mp4.tmp"));
        assert!(!is_export_candidate("mp4"));
        assert_eq!(content_type("x.MOV"), "video/quicktime");
        assert_eq!(content_type("x.m4v"), "video/mp4");
    }

    #[test]
    fn a_file_is_finished_only_after_its_size_holds_for_five_seconds() {
        let w = observe(None, 100, 1_000);
        assert!(!is_stable(w, 5_999));
        let w = observe(Some(w), 200, 4_000);
        assert!(!is_stable(w, 8_999));
        let w = observe(Some(w), 200, 8_000);
        assert_eq!(w.since_ms, 4_000);
        assert!(is_stable(w, 9_000));
        assert!(!is_stable(observe(None, 0, 0), 60_000));
    }

    #[test]
    fn resume_uploads_only_the_parts_without_an_etag() {
        let mut progress = UploadProgress {
            upload_id: "u".into(),
            clip_id: "c".into(),
            part_size: 10,
            size_bytes: 35,
            done: BTreeMap::new(),
        };
        assert_eq!(remaining_parts(&progress), vec![1, 2, 3, 4]);
        progress.done.insert(3, "\"c\"".into());
        progress.done.insert(1, "\"a\"".into());
        assert_eq!(remaining_parts(&progress), vec![2, 4]);
        assert_eq!(part_range(4, 10, 35), (30, 5));
        assert_eq!(part_range(1, 10, 35), (0, 10));
        assert!(can_resume(&progress, 35));
        assert!(!can_resume(&progress, 36));
        let body = completed_parts(&progress.done);
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"[{"n":1,"etag":"\"a\""},{"n":3,"etag":"\"c\""}]"#
        );
    }

    #[test]
    fn part_count_covers_the_whole_file() {
        assert_eq!(part_count(0, 10), 1);
        assert_eq!(part_count(10, 10), 1);
        assert_eq!(part_count(11, 10), 2);
    }

    #[test]
    fn batches_take_the_lowest_missing_parts() {
        let mut progress = UploadProgress {
            upload_id: "u".into(),
            clip_id: "c".into(),
            part_size: 10,
            size_bytes: 55,
            done: BTreeMap::new(),
        };
        progress.done.insert(1, "e1".into());
        progress.done.insert(3, "e3".into());
        assert_eq!(next_batch(&progress, 2), vec![2, 4]);
        assert_eq!(next_batch(&progress, 16), vec![2, 4, 5, 6]);
    }

    #[test]
    fn retries_back_off_then_stop() {
        assert_eq!(retry_delay_s(0), None);
        assert_eq!(retry_delay_s(1), Some(10));
        assert_eq!(retry_delay_s(5), Some(300));
        assert_eq!(retry_delay_s(6), None);
    }
}
