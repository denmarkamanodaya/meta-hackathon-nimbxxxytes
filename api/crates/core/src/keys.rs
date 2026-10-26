//! The only place that builds S3 object keys. Every key lives under `users/{user_id}/`, so an
//! ownership check on the user id covers the object. Ids are validated types, so no segment can
//! contain `/` or `..`.
//!
//! Lifecycle rules in the bucket match on the object tag [`CLASS_TAG_KEY`]; [`ObjectClass`] gives
//! the tag value an upload must carry.

use crate::domain::ids::{ClipId, SegmentId, ShortId, TrackId, UserId};
use crate::domain::media::MediaExt;

/// Object tag key the bucket's lifecycle rules filter on (set by the storage Terraform module).
pub const CLASS_TAG_KEY: &str = "nimbytes-class";

/// Storage class of an object, as far as lifecycle rules care.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectClass {
    /// Uploaded original: moved to Intelligent-Tiering.
    Original,
    /// Agent preview render: expires after 7 days.
    Preview,
}

impl ObjectClass {
    /// The tag value for [`CLASS_TAG_KEY`].
    pub fn tag_value(self) -> &'static str {
        match self {
            Self::Original => "original",
            Self::Preview => "preview",
        }
    }

    /// The tag set in S3's URL-encoded form, e.g. `nimbytes-class=original`.
    pub fn tagging(self) -> String {
        format!("{CLASS_TAG_KEY}={}", self.tag_value())
    }
}

/// A full S3 object key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ObjectKey(String);

impl ObjectKey {
    /// The key text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Rebuilds a key read back from storage; only keys this module built are ever stored.
    pub fn from_stored(raw: String) -> Self {
        Self(raw)
    }
}

impl std::fmt::Display for ObjectKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn under(user: &UserId, rest: std::fmt::Arguments<'_>) -> ObjectKey {
    ObjectKey(format!("users/{user}/{rest}"))
}

/// `users/{user}/originals/{clip}.{ext}`: the uploaded file, untouched.
pub fn original(user: &UserId, clip: &ClipId, ext: MediaExt) -> ObjectKey {
    under(user, format_args!("originals/{clip}.{}", ext.as_str()))
}

/// `users/{user}/proxies/{clip}_720p.mp4`: 720p constant-fps H.264, rotation applied.
pub fn proxy_720p(user: &UserId, clip: &ClipId) -> ObjectKey {
    under(user, format_args!("proxies/{clip}_720p.mp4"))
}

/// `users/{user}/proxies/{clip}_fps1.mp4`: 1 fps H.264, input for face tracking.
pub fn proxy_fps1(user: &UserId, clip: &ClipId) -> ObjectKey {
    under(user, format_args!("proxies/{clip}_fps1.mp4"))
}

/// `users/{user}/snippets/{clip}/{segment}.mp4`: 360p per-segment clip.
pub fn snippet(user: &UserId, clip: &ClipId, segment: &SegmentId) -> ObjectKey {
    under(user, format_args!("snippets/{clip}/{segment}.mp4"))
}

/// `users/{user}/thumbs/{clip}/{segment}.jpg`: one thumbnail per segment.
pub fn thumb(user: &UserId, clip: &ClipId, segment: &SegmentId) -> ObjectKey {
    under(user, format_args!("thumbs/{clip}/{segment}.jpg"))
}

/// `users/{user}/faces/{clip}/{track}.jpg`: best crop per face track.
pub fn face(user: &UserId, clip: &ClipId, track: &TrackId) -> ObjectKey {
    under(user, format_args!("faces/{clip}/{track}.jpg"))
}

/// `users/{user}/audio/{clip}.wav`: 16 kHz mono PCM.
pub fn audio(user: &UserId, clip: &ClipId) -> ObjectKey {
    under(user, format_args!("audio/{clip}.wav"))
}

/// `users/{user}/previews/{short}/v{n}.mp4`: low-res agent preview number `n`.
pub fn preview(user: &UserId, short: &ShortId, n: u32) -> ObjectKey {
    under(user, format_args!("previews/{short}/v{n}.mp4"))
}

/// `users/{user}/renders/{short}.mp4`: final short.
pub fn render(user: &UserId, short: &ShortId) -> ObjectKey {
    under(user, format_args!("renders/{short}.mp4"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids() -> (UserId, ClipId, SegmentId, TrackId, ShortId) {
        (
            UserId::parse("u1").unwrap(),
            ClipId::parse("c1").unwrap(),
            SegmentId::parse("s1").unwrap(),
            TrackId::parse("t1").unwrap(),
            ShortId::parse("x1").unwrap(),
        )
    }

    #[test]
    fn builds_every_key_in_the_layout() {
        let (u, c, s, t, x) = ids();
        let cases = [
            (original(&u, &c, MediaExt::Mov), "users/u1/originals/c1.mov"),
            (proxy_720p(&u, &c), "users/u1/proxies/c1_720p.mp4"),
            (proxy_fps1(&u, &c), "users/u1/proxies/c1_fps1.mp4"),
            (snippet(&u, &c, &s), "users/u1/snippets/c1/s1.mp4"),
            (thumb(&u, &c, &s), "users/u1/thumbs/c1/s1.jpg"),
            (face(&u, &c, &t), "users/u1/faces/c1/t1.jpg"),
            (audio(&u, &c), "users/u1/audio/c1.wav"),
            (preview(&u, &x, 2), "users/u1/previews/x1/v2.mp4"),
            (render(&u, &x), "users/u1/renders/x1.mp4"),
        ];
        for (key, want) in cases {
            assert_eq!(key.as_str(), want);
        }
    }

    #[test]
    fn ids_with_path_tricks_never_reach_a_key() {
        assert!(UserId::parse("../other").is_err());
        assert!(ClipId::parse("a/b").is_err());
    }

    #[test]
    fn class_tags_use_the_lifecycle_tag_key() {
        assert_eq!(ObjectClass::Original.tagging(), "nimbytes-class=original");
        assert_eq!(ObjectClass::Preview.tagging(), "nimbytes-class=preview");
    }

    /// The bucket's lifecycle rules live in Terraform; this keeps the tag key and values here
    /// equal to the ones the rules filter on.
    #[test]
    fn class_tags_match_the_storage_terraform_module() {
        let tf = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../infra/modules/storage/main.tf"
        ));
        let local = |name: &str| -> String {
            let line = tf
                .lines()
                .map(str::trim)
                .find(|l| l.split_whitespace().next() == Some(name))
                .unwrap_or_else(|| panic!("{name} missing from main.tf"));
            line.split('"').nth(1).unwrap().to_owned()
        };
        assert_eq!(local("class_tag_key"), CLASS_TAG_KEY);
        assert_eq!(
            local("class_tag_original"),
            ObjectClass::Original.tag_value()
        );
        assert_eq!(local("class_tag_preview"), ObjectClass::Preview.tag_value());
    }
}
