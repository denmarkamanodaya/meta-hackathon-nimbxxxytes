//! Which agent previews a cleanup removes. On S3 a lifecycle rule expires previews by their tag;
//! R2 has no tags, so the worker applies this rule instead.

use crate::domain::short::{Short, ShortStatus, Version};
use crate::keys::ObjectKey;

/// How long previews are kept, milliseconds: 7 days, as the S3 lifecycle rule keeps them.
pub const PREVIEW_MAX_AGE_MS: i64 = 7 * 24 * 3_600_000;

/// The previews to remove from an old enough `short`, as `(version, key)`, never while the agent
/// may still read them:
/// - ready: every rendered preview except the kept one, which is the best version's; when the best
///   version has none, or no version is best, the newest preview;
/// - failed: every rendered preview (nothing is watched any more);
/// - any other status (still being made): none.
pub fn expired_previews(short: &Short, versions: &[Version]) -> Vec<(u32, ObjectKey)> {
    if !matches!(short.status, ShortStatus::Ready | ShortStatus::Failed) {
        return Vec::new();
    }
    let rendered: Vec<(u32, &ObjectKey)> = versions
        .iter()
        .filter_map(|v| v.preview_key.as_ref().map(|k| (v.n, k)))
        .collect();
    let best = short
        .best_version
        .filter(|b| rendered.iter().any(|(n, _)| n == b));
    let keep = match short.status {
        ShortStatus::Ready => best.or_else(|| rendered.iter().map(|(n, _)| *n).max()),
        _ => None,
    };
    rendered
        .into_iter()
        .filter(|(n, _)| Some(*n) != keep)
        .map(|(n, k)| (n, k.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::{ShortId, UserId};
    use crate::domain::timeline::{
        Aspect, CaptionPlan, CaptionSource, CaptionStyle, Post, Timeline,
    };
    use crate::keys;

    fn short(status: ShortStatus, best: Option<u32>) -> Short {
        Short {
            id: ShortId::parse("x1").unwrap(),
            user_id: UserId::parse("u1").unwrap(),
            prompt: String::new(),
            aspect: Aspect::Portrait,
            target_s: 6.0,
            status,
            best_version: best,
            render: None,
            created_at: "2026-10-01T00:00:00.000Z".into(),
        }
    }

    /// Versions 1..=`count`; those in `with_preview` have a rendered preview.
    fn versions(count: u32, with_preview: &[u32]) -> Vec<Version> {
        let s = short(ShortStatus::Ready, None);
        (1..=count)
            .map(|n| Version {
                n,
                timeline: Timeline {
                    aspect: Aspect::Portrait,
                    target_seconds: 6.0,
                    clips: Vec::new(),
                    captions: CaptionPlan {
                        style: CaptionStyle::Phrase,
                        source: CaptionSource::Transcript,
                    },
                    post: Post {
                        caption: String::new(),
                        hashtags: Vec::new(),
                    },
                    rationale: String::new(),
                    revision: None,
                },
                preview_key: with_preview
                    .contains(&n)
                    .then(|| keys::preview(&s.user_id, &s.id, n)),
                critique: None,
            })
            .collect()
    }

    fn removed(short: &Short, versions: &[Version]) -> Vec<u32> {
        expired_previews(short, versions)
            .into_iter()
            .map(|(n, _)| n)
            .collect()
    }

    #[test]
    fn a_ready_short_keeps_only_its_best_versions_preview() {
        let table: [(Option<u32>, &[u32], &[u32]); 6] = [
            (Some(2), &[1, 2, 3], &[1, 3]),
            (Some(1), &[1, 2], &[2]),
            (None, &[1, 2, 3], &[1, 2]),
            (Some(3), &[1, 2], &[1]),
            (Some(1), &[1], &[]),
            (None, &[], &[]),
        ];
        for (best, with_preview, want) in table {
            let got = removed(&short(ShortStatus::Ready, best), &versions(3, with_preview));
            assert_eq!(got, want, "best {best:?}, previews {with_preview:?}");
        }
    }

    #[test]
    fn a_failed_short_loses_every_preview_even_its_best_versions() {
        for best in [Some(2), None] {
            let got = removed(&short(ShortStatus::Failed, best), &versions(3, &[1, 2, 3]));
            assert_eq!(got, [1, 2, 3], "best {best:?}");
        }
        assert!(removed(&short(ShortStatus::Failed, None), &versions(2, &[])).is_empty());
    }

    #[test]
    fn a_short_still_being_made_loses_nothing() {
        for status in [
            ShortStatus::Planning,
            ShortStatus::Rendering,
            ShortStatus::Critiquing,
            ShortStatus::Revising,
        ] {
            assert!(removed(&short(status, Some(1)), &versions(3, &[1, 2, 3])).is_empty());
        }
    }

    #[test]
    fn the_keys_are_the_versions_preview_keys() {
        let s = short(ShortStatus::Ready, Some(2));

        let got = expired_previews(&s, &versions(2, &[1, 2]));

        assert_eq!(got.len(), 1);
        assert_eq!(got[0].1.as_str(), "users/u1/previews/x1/v1.mp4");
    }
}
