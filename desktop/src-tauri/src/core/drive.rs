//! Rules of the nimbytes drive: the `~/nimbytes` folder the app serves itself, where every clip
//! shows at full size but takes only the bytes actually read. Files are split into 1 MiB chunks;
//! a read fetches only its missing chunks (plus a little read-ahead) and the cache keeps them.
//!
//! Finder previews (thumbnail, Quick Look, Get Info) read a file's head, its index and a poster
//! frame. Those reads pass through without caching, so browsing keeps a clip at zero bytes on
//! disk; a file starts caching only once it is read like playback.

use std::collections::BTreeMap;

use nimbytes_contracts::sync::SyncManifest;

use crate::core::naming::{original_file, render_file};

/// Bytes per cached chunk.
pub const CHUNK: u64 = 1024 * 1024;
/// Chunks fetched beyond a read in the same request once a file caches (playback read-ahead).
pub const READ_AHEAD: u64 = 4;
/// Pass-through reads above this many bytes within [`PROMOTE_WINDOW_MS`] look like playback.
pub const PROMOTE_BYTES: u64 = 8 * 1024 * 1024;
/// How far back pass-through reads count toward promotion, milliseconds.
pub const PROMOTE_WINDOW_MS: u64 = 30_000;

/// Number of chunks of a file of `size` bytes.
pub fn chunk_count(size: u64) -> u64 {
    size.div_ceil(CHUNK)
}

/// Bytes a set of cached chunks holds; the last chunk of a file may be short.
pub fn cached_bytes(have: &[bool], size: u64) -> u64 {
    have.iter()
        .enumerate()
        .filter(|(_, has)| **has)
        .map(|(i, _)| chunk_len(i as u64, size))
        .sum()
}

/// Length of chunk `n` of a file of `size` bytes (0 past the end).
pub fn chunk_len(n: u64, size: u64) -> u64 {
    let start = n.saturating_mul(CHUNK);
    size.saturating_sub(start).min(CHUNK)
}

/// The byte span a read covers, clamped to the file, and its first and last chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    /// First byte.
    pub start: u64,
    /// One past the last byte.
    pub end: u64,
    /// First chunk.
    pub first: u64,
    /// Last chunk (inclusive).
    pub last: u64,
}

/// The span of a read of `count` bytes at `offset`, or `None` when it starts at or past the end.
pub fn span(offset: u64, count: u64, size: u64) -> Option<Span> {
    if offset >= size || count == 0 {
        return None;
    }
    let end = offset.saturating_add(count).min(size);
    Some(Span {
        start: offset,
        end,
        first: offset / CHUNK,
        last: (end - 1) / CHUNK,
    })
}

/// Chunk runs `[from, to)` to fetch so chunks `first..=last` are cached: one run per stretch of
/// missing chunks, the last run extended by up to `read_ahead` missing chunks after `last`.
pub fn fetch_runs(have: &[bool], first: u64, last: u64, read_ahead: u64) -> Vec<(u64, u64)> {
    let total = have.len() as u64;
    let missing = |c: u64| c < total && !have[c as usize];
    let mut runs = Vec::new();
    let mut chunk = first;
    while chunk <= last && chunk < total {
        if !missing(chunk) {
            chunk += 1;
            continue;
        }
        let mut stop = chunk + 1;
        while stop <= last && missing(stop) {
            stop += 1;
        }
        if stop > last {
            while stop < total && stop <= last + read_ahead && missing(stop) {
                stop += 1;
            }
        }
        runs.push((chunk, stop));
        chunk = stop;
    }
    runs
}

/// Splits runs into runs of at most `max` chunks, so one request never holds a whole file in
/// memory.
pub fn split_runs(runs: &[(u64, u64)], max: u64) -> Vec<(u64, u64)> {
    let max = max.max(1);
    runs.iter()
        .flat_map(|&(from, to)| {
            (from..to)
                .step_by(max as usize)
                .map(move |s| (s, (s + max).min(to)))
        })
        .collect()
}

/// Whether recent pass-through reads `(at_ms, bytes)` look like playback rather than a Finder
/// preview: more than [`PROMOTE_BYTES`] (or half of a smaller file) within the window.
pub fn looks_like_playback(recent: &[(u64, u64)], now_ms: u64, size: u64) -> bool {
    let bytes: u64 = recent
        .iter()
        .filter(|(at, _)| now_ms.saturating_sub(*at) <= PROMOTE_WINDOW_MS)
        .map(|(_, n)| n)
        .sum();
    bytes > PROMOTE_BYTES.min(size / 2)
}

/// What a file of the drive streams from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Media {
    /// A clip's original (a fresh presigned URL is asked for when needed).
    Original {
        /// Clip id.
        clip_id: String,
    },
    /// A short's final render, at the manifest's presigned URL.
    Render {
        /// Short id.
        short_id: String,
        /// Presigned GET.
        url: String,
    },
}

/// One streamed file of the drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriveFile {
    /// Cache key: stays the same while the bytes stay the same.
    pub key: String,
    /// File name in its folder.
    pub name: String,
    /// Full size, bytes; `None` until known (a render's size is probed).
    pub size: Option<u64>,
    /// Where the bytes come from.
    pub media: Media,
}

/// The drive's streamed files, from the manifest.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DriveListing {
    /// `Library/`: every clip's original.
    pub library: Vec<DriveFile>,
    /// `Shorts/`: every short's final render.
    pub shorts: Vec<DriveFile>,
}

/// The cache key of a clip's original.
pub fn original_key(clip_id: &str) -> String {
    format!("clip-{clip_id}")
}

/// The cache key of a short's render of `version` (a new best version is new bytes).
pub fn render_key(short_id: &str, version: Option<u32>) -> String {
    format!("render-{short_id}-v{}", version.unwrap_or(0))
}

/// Lists the drive's files. Names are the app's readable, id-suffixed names, so they are unique.
/// `render_sizes` holds probed render sizes by cache key.
pub fn listing(manifest: &SyncManifest, render_sizes: &BTreeMap<String, u64>) -> DriveListing {
    let library = manifest
        .clips
        .iter()
        .map(|c| DriveFile {
            key: original_key(&c.clip_id),
            name: original_file(c.recorded_at.as_deref(), &c.title, &c.clip_id, &c.ext),
            size: Some(c.size_bytes),
            media: Media::Original {
                clip_id: c.clip_id.clone(),
            },
        })
        .collect();
    let shorts = manifest
        .shorts
        .iter()
        .filter_map(|s| {
            let url = s.render_url.clone()?;
            let key = render_key(&s.short_id, s.best_version);
            Some(DriveFile {
                size: render_sizes.get(&key).copied(),
                name: render_file(&s.created_at, &s.prompt, &s.short_id),
                media: Media::Render {
                    short_id: s.short_id.clone(),
                    url,
                },
                key,
            })
        })
        .collect();
    DriveListing { library, shorts }
}

/// How long a cached file is kept when the cache needs space.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Keep {
    /// Plain footage: evicted first, least recently used first.
    Normal,
    /// Used by a short's render or an editor project: evicted only after every normal file.
    Late,
    /// Pinned ("Make available offline"): never evicted.
    Always,
}

/// A cached file as eviction sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evictable {
    /// Cache key.
    pub key: String,
    /// Bytes cached.
    pub bytes: u64,
    /// Last read or write, ms since the epoch.
    pub last_used_ms: u64,
    /// Its tier.
    pub keep: Keep,
}

/// Keys to evict, so the rest fit in `budget`: normal files before late ones, least recently
/// used first within a tier; pinned files never go, even when the budget can't be met.
pub fn evictions(files: &[Evictable], budget: u64) -> Vec<String> {
    let mut total: u64 = files.iter().map(|f| f.bytes).sum();
    let mut order: Vec<&Evictable> = files.iter().filter(|f| f.keep != Keep::Always).collect();
    order.sort_by(|a, b| (a.keep, a.last_used_ms, &a.key).cmp(&(b.keep, b.last_used_ms, &b.key)));
    let mut out = Vec::new();
    for file in order {
        if total <= budget {
            break;
        }
        total = total.saturating_sub(file.bytes);
        out.push(file.key.clone());
    }
    out
}

/// Share of the disk kept free: below it the cache shrinks.
pub const MIN_FREE_PERCENT: u64 = 15;

/// The cache budget: the owner's cap, shrunk while the disk has less than
/// [`MIN_FREE_PERCENT`] free, by as much as is missing (never below zero).
pub fn cache_budget(cap: u64, used: u64, free: u64, disk: u64) -> u64 {
    let want_free = disk / 100 * MIN_FREE_PERCENT;
    if free >= want_free {
        return cap;
    }
    cap.min(used.saturating_sub(want_free - free))
}

/// Where the folder that used to hold real copies moves before the drive mounts on its path:
/// `~/nimbytes (old copies)`, or `~/nimbytes (old copies 2)` and so on when that is taken.
pub fn old_copies_path(
    mount: &std::path::Path,
    taken: impl Fn(&std::path::Path) -> bool,
) -> std::path::PathBuf {
    let name = mount
        .file_name()
        .map_or_else(|| "nimbytes".into(), |n| n.to_string_lossy().into_owned());
    let candidate = |n: u32| {
        let suffix = if n == 1 {
            String::new()
        } else {
            format!(" {n}")
        };
        mount.with_file_name(format!("{name} (old copies{suffix})"))
    };
    (1..)
        .map(candidate)
        .find(|p| !taken(p))
        .unwrap_or_else(|| candidate(1))
}

/// Stable file ids: a key keeps its id across manifest refreshes, so Finder and editors holding
/// a file keep reading the same file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIds {
    next: u64,
    by_key: BTreeMap<String, u64>,
}

impl FileIds {
    /// Ids start at `first`; lower ids are the fixed folders.
    pub fn new(first: u64) -> Self {
        Self {
            next: first,
            by_key: BTreeMap::new(),
        }
    }

    /// The id of `key`, given a new one on first sight.
    pub fn id(&mut self, key: &str) -> u64 {
        if let Some(id) = self.by_key.get(key) {
            return *id;
        }
        let id = self.next;
        self.next += 1;
        self.by_key.insert(key.to_owned(), id);
        id
    }
}

#[cfg(test)]
mod tests {
    use nimbytes_contracts::shorts::{Aspect, ShortStatus};
    use nimbytes_contracts::sync::{SyncClip, SyncShort};

    use super::*;

    const MB: u64 = 1024 * 1024;

    #[test]
    fn spans_clamp_to_the_file_and_name_their_chunks() {
        assert_eq!(span(0, 10, 0), None);
        assert_eq!(span(5, 0, 10), None);
        assert_eq!(span(10, 4, 10), None);
        assert_eq!(
            span(MB - 1, 2, 3 * MB),
            Some(Span {
                start: MB - 1,
                end: MB + 1,
                first: 0,
                last: 1
            })
        );
        assert_eq!(
            span(2 * MB, 5 * MB, 2 * MB + 10),
            Some(Span {
                start: 2 * MB,
                end: 2 * MB + 10,
                first: 2,
                last: 2
            })
        );
    }

    #[test]
    fn the_last_chunk_counts_only_its_real_bytes() {
        assert_eq!(chunk_count(0), 0);
        assert_eq!(chunk_count(2 * MB + 1), 3);
        assert_eq!(chunk_len(2, 2 * MB + 1), 1);
        assert_eq!(chunk_len(3, 2 * MB + 1), 0);
        assert_eq!(cached_bytes(&[true, false, true], 2 * MB + 1), MB + 1);
    }

    #[test]
    fn fetch_runs_cover_only_missing_chunks_and_read_ahead_after_the_read() {
        let have = [
            true, false, false, true, false, false, false, false, false, false,
        ];
        // Chunks 1..=4: runs 1..3 and 4..; the last run reads ahead up to 2 more missing chunks.
        assert_eq!(fetch_runs(&have, 1, 4, 2), vec![(1, 3), (4, 7)]);
        // Read-ahead stops at a cached chunk and at the end of the file.
        assert_eq!(fetch_runs(&[false, false, true], 0, 0, 5), vec![(0, 2)]);
        assert_eq!(fetch_runs(&[true, false], 1, 1, 5), vec![(1, 2)]);
        // Nothing to fetch when every chunk is there.
        assert!(fetch_runs(&[true, true], 0, 1, 4).is_empty());
    }

    #[test]
    fn long_runs_split_into_bounded_requests() {
        assert_eq!(
            split_runs(&[(0, 5), (7, 8)], 2),
            vec![(0, 2), (2, 4), (4, 5), (7, 8)]
        );
        assert_eq!(split_runs(&[(3, 4)], 0), vec![(3, 4)]);
    }

    #[test]
    fn a_preview_burst_passes_through_and_playback_promotes() {
        let now = 100_000;
        assert!(!looks_like_playback(
            &[(now, 2 * MB), (now, 3 * MB)],
            now,
            50 * MB
        ));
        assert!(looks_like_playback(
            &[(now, 5 * MB), (now, 4 * MB)],
            now,
            50 * MB
        ));
        assert!(!looks_like_playback(
            &[(now - PROMOTE_WINDOW_MS - 1, 9 * MB)],
            now,
            50 * MB
        ));
        // A clip smaller than the threshold promotes once more than half of it is read.
        assert!(looks_like_playback(&[(now, 2 * MB)], now, 3 * MB));
    }

    fn clip(id: &str, title: &str) -> SyncClip {
        SyncClip {
            clip_id: id.into(),
            title: title.into(),
            filename: format!("{title}.mov"),
            ext: "mov".into(),
            size_bytes: 48_845_297,
            duration_s: Some(17.0),
            fps: Some(30.0),
            width: Some(1920),
            height: Some(1080),
            recorded_at: Some("2026-10-26T05:00:00Z".into()),
            proxy_url: "https://cdn/p".into(),
            proxy_size_bytes: Some(1),
        }
    }

    fn short(id: &str, url: Option<&str>, version: Option<u32>) -> SyncShort {
        SyncShort {
            short_id: id.into(),
            prompt: "beach day".into(),
            aspect: Aspect::Portrait,
            status: ShortStatus::Ready,
            best_version: version,
            render_url: url.map(Into::into),
            created_at: "2026-10-27T01:00:00Z".into(),
        }
    }

    #[test]
    fn the_listing_has_every_original_and_every_finished_render() {
        let manifest = SyncManifest {
            etag: "e".into(),
            clips: vec![clip(
                "0192aaaa-0000-7000-8000-00000000c1a1",
                "Walking past supercars",
            )],
            shorts: vec![
                short("s1", Some("https://cdn/r1"), Some(2)),
                short("s2", None, None),
            ],
        };
        let sizes = BTreeMap::from([(render_key("s1", Some(2)), 900)]);

        let listing = listing(&manifest, &sizes);

        assert_eq!(listing.library.len(), 1);
        let original = &listing.library[0];
        assert_eq!(original.key, "clip-0192aaaa-0000-7000-8000-00000000c1a1");
        assert_eq!(original.size, Some(48_845_297));
        assert!(
            original.name.contains("Walking past supercars") && original.name.ends_with(".mov")
        );
        assert_eq!(
            listing.shorts.len(),
            1,
            "a short without a render is not listed"
        );
        assert_eq!(listing.shorts[0].key, "render-s1-v2");
        assert_eq!(listing.shorts[0].size, Some(900));
        assert_eq!(
            listing.shorts[0].media,
            Media::Render {
                short_id: "s1".into(),
                url: "https://cdn/r1".into()
            }
        );
    }

    #[test]
    fn the_old_folder_moves_to_the_first_free_old_copies_name() {
        let mount = std::path::Path::new("/Users/me/nimbytes");
        assert_eq!(
            old_copies_path(mount, |_| false),
            std::path::Path::new("/Users/me/nimbytes (old copies)")
        );
        let taken = |p: &std::path::Path| p.ends_with("nimbytes (old copies)");
        assert_eq!(
            old_copies_path(mount, taken),
            std::path::Path::new("/Users/me/nimbytes (old copies 2)")
        );
    }

    fn cached(key: &str, bytes: u64, last_used_ms: u64, keep: Keep) -> Evictable {
        Evictable {
            key: key.into(),
            bytes,
            last_used_ms,
            keep,
        }
    }

    #[test]
    fn eviction_takes_plain_footage_first_oldest_first_and_never_pinned() {
        let files = [
            cached("pinned", 50, 1, Keep::Always),
            cached("in-a-short", 30, 2, Keep::Late),
            cached("old", 20, 3, Keep::Normal),
            cached("recent", 20, 9, Keep::Normal),
        ];
        assert!(evictions(&files, 120).is_empty());
        assert_eq!(evictions(&files, 100), vec!["old"]);
        assert_eq!(evictions(&files, 80), vec!["old", "recent"]);
        assert_eq!(evictions(&files, 60), vec!["old", "recent", "in-a-short"]);
        // The pinned file stays even when the budget is below it.
        assert_eq!(evictions(&files, 0), vec!["old", "recent", "in-a-short"]);
    }

    #[test]
    fn the_budget_shrinks_only_while_the_disk_is_short_of_free_space() {
        const GB: u64 = 1_000_000_000;
        // 100 GB disk wants 15 GB free.
        assert_eq!(cache_budget(5 * GB, 3 * GB, 20 * GB, 100 * GB), 5 * GB);
        // 14 GB free: the cache gives back the missing 1 GB.
        assert_eq!(cache_budget(5 * GB, 3 * GB, 14 * GB, 100 * GB), 2 * GB);
        assert_eq!(cache_budget(5 * GB, GB / 2, 10 * GB, 100 * GB), 0);
    }

    #[test]
    fn a_key_keeps_its_id_and_new_keys_get_new_ones() {
        let mut ids = FileIds::new(1000);
        assert_eq!(ids.id("clip-a"), 1000);
        assert_eq!(ids.id("clip-b"), 1001);
        assert_eq!(ids.id("clip-a"), 1000);
    }
}
