//! The only place that builds S3 object keys. Every key lives under `users/{user_id}/`, so an
//! ownership check on the user id covers the object. Ids are validated types, so no segment can
//! contain `/` or `..`.
//!
//! Lifecycle rules in the bucket match on the object tag [`CLASS_TAG_KEY`]; [`ObjectClass`] gives
//! the tag value an upload must carry.

use crate::domain::brand::ImageExt;
use crate::domain::clip::Clip;
use crate::domain::document::{DocFormat, MAX_PAGES};
use crate::domain::export::Platform;
use crate::domain::guide::GuideStep;
use crate::domain::ids::{
    ClipId, DocumentId, GuideId, ListenId, MemoryId, PhotoId, ProjectId, SegmentId, ShortId,
    TrackId, UserId,
};
use crate::domain::listen::EXTENSIONS;
use crate::domain::media::MediaExt;
use crate::domain::photo::PhotoFormat;

/// Object tag key the bucket's lifecycle rules filter on (set by the storage Terraform module).
pub const CLASS_TAG_KEY: &str = "nimbytes-class";

/// `Cache-Control` of derived media (proxies, thumbnails, face crops, …): a key's content never
/// changes, because a rerun step reproduces the same bytes (model answers are cached and ffmpeg is
/// deterministic), so browsers may keep it for as long as the URL is the same.
pub const DERIVED_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

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

/// `users/{user}/`: the prefix every key of the user starts with (for measuring their usage).
pub fn user_prefix(user: &UserId) -> ObjectKey {
    ObjectKey(format!("users/{user}/"))
}

fn under(user: &UserId, rest: std::fmt::Arguments<'_>) -> ObjectKey {
    ObjectKey(format!("{}{rest}", user_prefix(user)))
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

/// Every object a clip owns: its original, both proxies, its audio, a snippet and thumbnail per
/// segment and a face crop per track. Short previews and renders belong to shorts and stay.
pub fn clip_objects(clip: &Clip, segments: &[SegmentId], tracks: &[TrackId]) -> Vec<ObjectKey> {
    let (user, id) = (&clip.user_id, &clip.id);
    let mut keys = vec![
        original(user, id, clip.ext),
        proxy_720p(user, id),
        proxy_fps1(user, id),
        audio(user, id),
    ];
    for s in segments {
        keys.push(snippet(user, id, s));
        keys.push(thumb(user, id, s));
    }
    keys.extend(tracks.iter().map(|t| face(user, id, t)));
    keys
}

/// `users/{user}/previews/{short}/v{n}.mp4`: low-res agent preview number `n`.
pub fn preview(user: &UserId, short: &ShortId, n: u32) -> ObjectKey {
    under(user, format_args!("previews/{short}/v{n}.mp4"))
}

/// `users/{user}/renders/{short}.mp4`: final short.
pub fn render(user: &UserId, short: &ShortId) -> ObjectKey {
    under(user, format_args!("renders/{short}.mp4"))
}

/// Every object a short owns: the preview of each version in `versions`, then its final render.
/// The clips it was cut from belong to the clips and stay.
pub fn short_objects(user: &UserId, short: &ShortId, versions: &[u32]) -> Vec<ObjectKey> {
    let mut keys: Vec<ObjectKey> = versions.iter().map(|n| preview(user, short, *n)).collect();
    keys.push(render(user, short));
    keys
}

/// `users/{user}/projects/{project}/art.webp`: a project's key art.
pub fn project_art(user: &UserId, project: &ProjectId) -> ObjectKey {
    under(user, format_args!("projects/{project}/art.webp"))
}

/// `users/{user}/brand/logo.{png|jpg}`: the brand kit's logo.
pub fn brand_logo(user: &UserId, ext: ImageExt) -> ObjectKey {
    under(user, format_args!("brand/logo.{}", ext.as_str()))
}

/// `users/{user}/brand/ref_{n}.{png|jpg}`: brand style reference number `n`.
pub fn brand_ref(user: &UserId, n: u32, ext: ImageExt) -> ObjectKey {
    under(user, format_args!("brand/ref_{n}.{}", ext.as_str()))
}

/// `users/{user}/exports/{short}/{platform}.mp4`: a short rendered for one platform.
pub fn export_render(user: &UserId, short: &ShortId, platform: Platform) -> ObjectKey {
    under(
        user,
        format_args!("exports/{short}/{}.mp4", platform.as_str()),
    )
}

/// `users/{user}/exports/{short}/{platform}_cover_{n}.webp`: cover number `n` for one platform
/// (WebP, as the image model returns it; PNG would be about 4 MB).
pub fn export_cover(user: &UserId, short: &ShortId, platform: Platform, n: u32) -> ObjectKey {
    under(
        user,
        format_args!("exports/{short}/{}_cover_{n}.webp", platform.as_str()),
    )
}

/// `users/{user}/exports/{short}/{platform}_cover_titled.jpg`: the picked cover with its title
/// laid over it, as published (JPEG, as the renderer writes stills).
pub fn titled_cover(user: &UserId, short: &ShortId, platform: Platform) -> ObjectKey {
    under(
        user,
        format_args!("exports/{short}/{}_cover_titled.jpg", platform.as_str()),
    )
}

/// `users/{user}/exports/{short}/vertical.mp4`: the one 9:16 render TikTok, Reels and Shorts
/// share.
pub fn export_vertical(user: &UserId, short: &ShortId) -> ObjectKey {
    under(user, format_args!("exports/{short}/vertical.mp4"))
}

/// Every object a short's exports can own: the shared 9:16 render and every possible cover of
/// every platform (keys that were never written are ignored by a delete).
pub fn export_objects(user: &UserId, short: &ShortId) -> Vec<ObjectKey> {
    let mut keys = vec![export_vertical(user, short)];
    for p in Platform::ALL {
        for n in 0..crate::domain::export::MAX_COVERS {
            keys.push(export_cover(user, short, *p, n));
            keys.push(cutout_cover(user, short, *p, n));
            keys.push(cutout_layer(user, short, (*p, n), CutoutPart::Frame));
            keys.push(cutout_layer(user, short, (*p, n), CutoutPart::Scene));
        }
        keys.push(titled_cover(user, short, *p));
    }
    keys
}

/// `users/{user}/exports/{short}/{platform}_cover_{n}.jpg`: a cut-out cover number `n` (a JPEG
/// still from the renderer).
pub fn cutout_cover(user: &UserId, short: &ShortId, platform: Platform, n: u32) -> ObjectKey {
    under(
        user,
        format_args!("exports/{short}/{}_cover_{n}.jpg", platform.as_str()),
    )
}

/// A layer a cut-out cover is made from, kept so the published cover can be made again with a
/// new title.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CutoutPart {
    /// The real frame the subject is cut from (JPEG).
    Frame,
    /// The Muse Image scene behind the subject (WebP).
    Scene,
}

/// `users/{user}/exports/{short}/{platform}_cutout_{n}_frame.jpg` or `…_scene.webp`.
pub fn cutout_layer(
    user: &UserId,
    short: &ShortId,
    (platform, n): (Platform, u32),
    part: CutoutPart,
) -> ObjectKey {
    let file = match part {
        CutoutPart::Frame => "frame.jpg",
        CutoutPart::Scene => "scene.webp",
    };
    under(
        user,
        format_args!("exports/{short}/{}_cutout_{n}_{file}", platform.as_str()),
    )
}

/// `users/{user}/cutouts/{clip}/{id}_frame.jpg`: the frame a cut-out was made from.
pub fn cutout_frame(user: &UserId, clip: &ClipId, id: &str) -> ObjectKey {
    under(user, format_args!("cutouts/{clip}/{id}_frame.jpg"))
}

/// `users/{user}/cutouts/{clip}/{id}.png` (`sticker` false) or `{id}_sticker.png`: a transparent
/// cut-out PNG.
pub fn cutout_png(user: &UserId, clip: &ClipId, id: &str, sticker: bool) -> ObjectKey {
    let suffix = if sticker { "_sticker" } else { "" };
    under(user, format_args!("cutouts/{clip}/{id}{suffix}.png"))
}

/// `users/{user}/guides/{guide}/step_{n}_frame.jpg`: the frame at step `n`'s key second.
pub fn guide_frame(user: &UserId, guide: &GuideId, n: u32) -> ObjectKey {
    under(user, format_args!("guides/{guide}/step_{n}_frame.jpg"))
}

/// `users/{user}/guides/{guide}/step_{n}.jpg`: step `n`'s frame with its control circled.
pub fn guide_still(user: &UserId, guide: &GuideId, n: u32) -> ObjectKey {
    under(user, format_args!("guides/{guide}/step_{n}.jpg"))
}

/// `users/{user}/guides/{guide}/voice_{hash}.wav`: one spoken sentence (`hash` from
/// [`crate::domain::guide::narration_hash`]), so an edit writes a new file and an unchanged
/// sentence is found again.
pub fn guide_audio(user: &UserId, guide: &GuideId, hash: &str) -> ObjectKey {
    under(user, format_args!("guides/{guide}/voice_{hash}.wav"))
}

/// `users/{user}/guides/{guide}/step_{n}.mp4`: step `n`'s replay clip.
pub fn guide_clip(user: &UserId, guide: &GuideId, n: u32) -> ObjectKey {
    under(user, format_args!("guides/{guide}/step_{n}.mp4"))
}

/// Every private object a guide owns: each step's frame, still and clip, and the voice files its
/// steps point at.
pub fn guide_objects(user: &UserId, guide: &GuideId, steps: &[GuideStep]) -> Vec<ObjectKey> {
    let mut keys = Vec::with_capacity(steps.len() * 4);
    for s in steps {
        keys.push(guide_frame(user, guide, s.n));
        keys.push(guide_still(user, guide, s.n));
        keys.push(guide_clip(user, guide, s.n));
        keys.extend(s.audio_key.clone());
    }
    keys
}

/// `users/{user}/documents/{doc}/source.{ext}`: the photo or PDF as uploaded.
pub fn document_source(user: &UserId, doc: &DocumentId, format: DocFormat) -> ObjectKey {
    under(
        user,
        format_args!("documents/{doc}/source.{}", format.ext()),
    )
}

/// `users/{user}/documents/{doc}/page_{n}.jpg`: page `n` as a JPEG of at most 2000 px.
pub fn document_page(user: &UserId, doc: &DocumentId, n: u32) -> ObjectKey {
    under(user, format_args!("documents/{doc}/page_{n}.jpg"))
}

/// `users/{user}/documents/{doc}/voice_{hash}.wav`: one spoken text (the summary, an answer or a
/// part; `hash` from [`crate::domain::guide::narration_hash`]), so the same text is spoken once.
pub fn document_voice(user: &UserId, doc: &DocumentId, hash: &str) -> ObjectKey {
    under(user, format_args!("documents/{doc}/voice_{hash}.wav"))
}

/// Every private object a document owns: its source, every page it could have (up to
/// [`MAX_PAGES`], so a read that stopped half way leaves nothing behind) and its voice files.
pub fn document_objects(
    user: &UserId,
    doc: &DocumentId,
    format: DocFormat,
    voices: &[ObjectKey],
) -> Vec<ObjectKey> {
    let mut keys = vec![document_source(user, doc, format)];
    let pages = u32::try_from(MAX_PAGES).unwrap_or(u32::MAX);
    keys.extend((1..=pages).map(|n| document_page(user, doc, n)));
    keys.extend(voices.iter().cloned());
    keys
}

/// `users/{user}/listens/{listen}/source.{ext}`: the sound file or video as uploaded. An
/// extension outside the accepted list (never stored) becomes `bin`.
pub fn listen_source(user: &UserId, listen: &ListenId, ext: &str) -> ObjectKey {
    let ext = if EXTENSIONS.contains(&ext) {
        ext
    } else {
        "bin"
    };
    under(user, format_args!("listens/{listen}/source.{ext}"))
}

/// `users/{user}/listens/{listen}/audio.wav`: 16 kHz mono PCM of the uploaded file.
pub fn listen_audio(user: &UserId, listen: &ListenId) -> ObjectKey {
    under(user, format_args!("listens/{listen}/audio.wav"))
}

/// `users/{user}/listens/{listen}/voice_{hash}.wav`: the summary spoken.
pub fn listen_voice(user: &UserId, listen: &ListenId, hash: &str) -> ObjectKey {
    under(user, format_args!("listens/{listen}/voice_{hash}.wav"))
}

/// `users/{user}/listens/{listen}/cover.jpg`: the cover drawn from the summary.
pub fn listen_cover(user: &UserId, listen: &ListenId) -> ObjectKey {
    under(user, format_args!("listens/{listen}/cover.jpg"))
}

/// Every private object a listen owns: its cover, its source and audio when it was a file (a
/// clip's audio belongs to the clip and stays) and its voice files.
pub fn listen_objects(
    user: &UserId,
    listen: &ListenId,
    file_ext: Option<&str>,
    voices: &[ObjectKey],
) -> Vec<ObjectKey> {
    let mut keys = vec![listen_cover(user, listen)];
    if let Some(ext) = file_ext {
        keys.push(listen_source(user, listen, ext));
        keys.push(listen_audio(user, listen));
    }
    keys.extend(voices.iter().cloned());
    keys
}

/// `users/{user}/memories/{memory}/frame_{n}.jpg`: the frame of moment `n` as found.
pub fn memory_frame(user: &UserId, memory: &MemoryId, n: u32) -> ObjectKey {
    under(user, format_args!("memories/{memory}/frame_{n}.jpg"))
}

/// `users/{user}/memories/{memory}/cover.jpg`: the cover drawn from the title and moments.
pub fn memory_cover(user: &UserId, memory: &MemoryId) -> ObjectKey {
    under(user, format_args!("memories/{memory}/cover.jpg"))
}

/// Every private object a session owns: its cover and the frames of the `found` moments.
pub fn memory_objects(user: &UserId, memory: &MemoryId, found: u32) -> Vec<ObjectKey> {
    let mut keys = vec![memory_cover(user, memory)];
    keys.extend((0..found).map(|n| memory_frame(user, memory, n)));
    keys
}

/// `users/{user}/photos/{photo}/original.{ext}`: the photo as uploaded.
pub fn photo_original(user: &UserId, photo: &PhotoId, format: PhotoFormat) -> ObjectKey {
    under(
        user,
        format_args!("photos/{photo}/original.{}", format.ext()),
    )
}

/// `users/{user}/photos/{photo}/view.jpg`: upright JPEG, long edge 2048 px.
pub fn photo_view(user: &UserId, photo: &PhotoId) -> ObjectKey {
    under(user, format_args!("photos/{photo}/view.jpg"))
}

/// `users/{user}/photos/{photo}/thumb.jpg`: upright JPEG, long edge 480 px.
pub fn photo_thumb(user: &UserId, photo: &PhotoId) -> ObjectKey {
    under(user, format_args!("photos/{photo}/thumb.jpg"))
}

/// Every private object a photo owns.
pub fn photo_objects(user: &UserId, photo: &PhotoId, format: PhotoFormat) -> Vec<ObjectKey> {
    vec![
        photo_original(user, photo, format),
        photo_view(user, photo),
        photo_thumb(user, photo),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_memory_keys() {
        let (u, m) = (UserId::parse("u1").unwrap(), MemoryId::parse("m1").unwrap());
        let all: Vec<String> = memory_objects(&u, &m, 2)
            .iter()
            .map(|k| k.as_str().to_owned())
            .collect();
        assert_eq!(
            all,
            [
                "users/u1/memories/m1/cover.jpg",
                "users/u1/memories/m1/frame_0.jpg",
                "users/u1/memories/m1/frame_1.jpg"
            ]
        );
    }

    #[test]
    fn builds_the_private_photo_keys() {
        let (u, p) = (UserId::parse("u1").unwrap(), PhotoId::parse("p1").unwrap());
        let all: Vec<String> = photo_objects(&u, &p, PhotoFormat::Png)
            .iter()
            .map(|k| k.as_str().to_owned())
            .collect();
        assert_eq!(
            all,
            [
                "users/u1/photos/p1/original.png",
                "users/u1/photos/p1/view.jpg",
                "users/u1/photos/p1/thumb.jpg"
            ]
        );
    }

    #[test]
    fn builds_the_private_listen_keys_and_every_object_of_one() {
        let (u, l) = (UserId::parse("u1").unwrap(), ListenId::parse("l1").unwrap());
        assert_eq!(
            listen_source(&u, &l, "m4a").as_str(),
            "users/u1/listens/l1/source.m4a"
        );
        assert_eq!(
            listen_source(&u, &l, "../x").as_str(),
            "users/u1/listens/l1/source.bin"
        );
        assert_eq!(
            listen_audio(&u, &l).as_str(),
            "users/u1/listens/l1/audio.wav"
        );
        let voice = listen_voice(&u, &l, "ab");
        assert_eq!(voice.as_str(), "users/u1/listens/l1/voice_ab.wav");
        let cover = listen_cover(&u, &l);
        assert_eq!(cover.as_str(), "users/u1/listens/l1/cover.jpg");
        let file = listen_objects(&u, &l, Some("mp3"), std::slice::from_ref(&voice));
        assert_eq!(file.len(), 4);
        assert_eq!(file[1].as_str(), "users/u1/listens/l1/source.mp3");
        let clip = listen_objects(&u, &l, None, std::slice::from_ref(&voice));
        assert_eq!(clip, [cover, voice], "a clip's audio is the clip's");
    }

    #[test]
    fn builds_the_private_document_keys_and_every_object_of_one() {
        let u = UserId::parse("u1").unwrap();
        let d = DocumentId::parse("d1").unwrap();
        assert_eq!(
            document_source(&u, &d, DocFormat::Pdf).as_str(),
            "users/u1/documents/d1/source.pdf"
        );
        assert_eq!(
            document_page(&u, &d, 3).as_str(),
            "users/u1/documents/d1/page_3.jpg"
        );
        let voice = document_voice(&u, &d, "ab12");
        assert_eq!(voice.as_str(), "users/u1/documents/d1/voice_ab12.wav");

        let all = document_objects(&u, &d, DocFormat::Jpeg, std::slice::from_ref(&voice));

        assert_eq!(all.len(), 1 + MAX_PAGES + 1);
        assert_eq!(all[0].as_str(), "users/u1/documents/d1/source.jpg");
        assert_eq!(all[MAX_PAGES].as_str(), "users/u1/documents/d1/page_10.jpg");
        assert_eq!(all.last(), Some(&voice));
        assert!(
            all.iter()
                .all(|k| k.as_str().starts_with("users/u1/documents/d1/"))
        );
    }

    #[test]
    fn builds_the_private_guide_keys() {
        let (u, ..) = ids();
        let g = GuideId::parse("g1").unwrap();
        let cases = [
            (
                guide_frame(&u, &g, 2),
                "users/u1/guides/g1/step_2_frame.jpg",
            ),
            (guide_still(&u, &g, 2), "users/u1/guides/g1/step_2.jpg"),
            (
                guide_audio(&u, &g, "ab12"),
                "users/u1/guides/g1/voice_ab12.wav",
            ),
            (guide_clip(&u, &g, 2), "users/u1/guides/g1/step_2.mp4"),
        ];
        for (key, want) in cases {
            assert_eq!(key.as_str(), want);
        }
    }

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
            (user_prefix(&u), "users/u1/"),
        ];
        for (key, want) in cases {
            assert_eq!(key.as_str(), want);
        }
    }

    #[test]
    fn builds_the_brand_and_export_keys() {
        let (u, _, _, _, x) = ids();
        let cases = [
            (brand_logo(&u, ImageExt::Png), "users/u1/brand/logo.png"),
            (brand_ref(&u, 2, ImageExt::Jpg), "users/u1/brand/ref_2.jpg"),
            (
                export_render(&u, &x, Platform::Tiktok),
                "users/u1/exports/x1/tiktok.mp4",
            ),
            (
                export_cover(&u, &x, Platform::Feed, 3),
                "users/u1/exports/x1/feed_cover_3.webp",
            ),
            (export_vertical(&u, &x), "users/u1/exports/x1/vertical.mp4"),
        ];
        for (key, want) in cases {
            assert_eq!(key.as_str(), want);
        }
    }

    #[test]
    fn builds_the_muse_image_keys() {
        let (u, _, _, _, x) = ids();
        let project = ProjectId::parse("pr1").unwrap();
        let cases = [
            (project_art(&u, &project), "users/u1/projects/pr1/art.webp"),
            (
                titled_cover(&u, &x, Platform::Reels),
                "users/u1/exports/x1/reels_cover_titled.jpg",
            ),
        ];
        for (key, want) in cases {
            assert_eq!(key.as_str(), want);
        }
        let exports = export_objects(&u, &x);
        assert!(
            exports
                .iter()
                .any(|k| k.as_str() == "users/u1/exports/x1/feed_cover_titled.jpg"),
            "deleting a short removes its titled covers"
        );
    }

    #[test]
    fn builds_the_cutout_keys_and_a_deleted_short_takes_its_cutout_covers() {
        let (u, _, _, _, x) = ids();
        let exports = export_objects(&u, &x);
        let cutouts = [
            (
                cutout_cover(&u, &x, Platform::Reels, 4),
                "users/u1/exports/x1/reels_cover_4.jpg",
            ),
            (
                cutout_layer(&u, &x, (Platform::Reels, 4), CutoutPart::Frame),
                "users/u1/exports/x1/reels_cutout_4_frame.jpg",
            ),
            (
                cutout_layer(&u, &x, (Platform::Reels, 4), CutoutPart::Scene),
                "users/u1/exports/x1/reels_cutout_4_scene.webp",
            ),
            (
                cutout_frame(&u, &ClipId::parse("c1").unwrap(), "k9"),
                "users/u1/cutouts/c1/k9_frame.jpg",
            ),
            (
                cutout_png(&u, &ClipId::parse("c1").unwrap(), "k9", false),
                "users/u1/cutouts/c1/k9.png",
            ),
            (
                cutout_png(&u, &ClipId::parse("c1").unwrap(), "k9", true),
                "users/u1/cutouts/c1/k9_sticker.png",
            ),
        ];
        for (key, want) in &cutouts[..3] {
            assert_eq!(key.as_str(), *want);
            assert!(exports.contains(key), "deleting a short removes {want}");
        }
        for (key, want) in &cutouts[3..] {
            assert_eq!(key.as_str(), *want);
        }
    }

    #[test]
    fn a_short_owns_each_versions_preview_and_its_render_only() {
        let (u, _, _, _, x) = ids();

        let keys: Vec<String> = short_objects(&u, &x, &[1, 3])
            .into_iter()
            .map(|k| k.as_str().to_owned())
            .collect();

        assert_eq!(
            keys,
            [
                "users/u1/previews/x1/v1.mp4",
                "users/u1/previews/x1/v3.mp4",
                "users/u1/renders/x1.mp4",
            ]
        );
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
