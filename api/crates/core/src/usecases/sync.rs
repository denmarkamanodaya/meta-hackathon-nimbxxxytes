//! What the Mac app mirrors: a snapshot of the owner's ready clips and shorts with an etag that
//! ignores URLs, and a download URL for one clip's original. Owner only.

use std::fmt::Write as _;
use std::time::Duration;

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::ids::{ClipId, UserId};
use crate::domain::short::Short;
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, Catalogue, ShortStore};

/// Ports and settings the sync endpoints need.
pub struct SyncDeps<'a> {
    /// Clips.
    pub catalogue: &'a dyn Catalogue,
    /// Shorts.
    pub shorts: &'a dyn ShortStore,
    /// URL signing and proxy sizes.
    pub blobs: &'a dyn BlobStore,
    /// Lifetime of every URL handed out.
    pub url_ttl: Duration,
    /// Lower-case hex SHA-256 of bytes (the core has no hash crate, so the server injects it).
    pub digest: fn(&[u8]) -> String,
}

/// A ready clip with its signed proxy.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncClip {
    /// The clip.
    pub clip: Clip,
    /// Signed GET of the 720p proxy.
    pub proxy_url: String,
    /// Proxy size in bytes; `None` when storage could not tell.
    pub proxy_size_bytes: Option<u64>,
}

/// A short with its signed final render.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncShort {
    /// The short.
    pub short: Short,
    /// Signed GET of the final render, once one finished.
    pub render_url: Option<String>,
}

/// The full snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncManifest {
    /// See [`manifest_etag`].
    pub etag: String,
    /// Ready clips, in the catalogue's order (newest upload first).
    pub clips: Vec<SyncClip>,
    /// Shorts, newest first.
    pub shorts: Vec<SyncShort>,
}

/// Answer to a manifest request.
#[derive(Debug, Clone, PartialEq)]
pub enum ManifestOutcome {
    /// The client already holds this etag; nothing was signed.
    Unchanged {
        /// The current etag.
        etag: String,
    },
    /// The snapshot changed (or the client sent no etag).
    Changed(SyncManifest),
}

/// Collision-free text of the etag fields: each value as `len:value;`, a missing one as `!;`.
#[derive(Default)]
struct EtagInput(String);

impl EtagInput {
    fn field(&mut self, value: &str) {
        // Writing to a String never fails.
        let _ = write!(self.0, "{}:{value};", value.len());
    }

    fn opt(&mut self, value: Option<String>) {
        match value {
            Some(v) => self.field(&v),
            None => self.0.push_str("!;"),
        }
    }
}

/// The etag of a snapshot: a digest over every manifest field except URLs (re-signed hourly) and
/// proxy sizes (a proxy key's bytes never change), in manifest order. Pure.
pub fn manifest_etag(clips: &[Clip], shorts: &[Short], digest: fn(&[u8]) -> String) -> String {
    let mut input = EtagInput::default();
    input.field("sync-v1");
    for c in clips {
        input.field("clip");
        input.field(c.id.as_str());
        input.field(&c.display_title());
        input.field(&c.filename);
        input.field(c.ext.as_str());
        input.field(&c.size_bytes.to_string());
        input.field(c.status.as_str());
        let p = c.probe.as_ref();
        input.opt(p.map(|p| p.duration_s.to_string()));
        input.opt(p.map(|p| p.fps.to_string()));
        input.opt(p.map(|p| p.width.to_string()));
        input.opt(p.map(|p| p.height.to_string()));
        input.opt(c.recorded_at().map(str::to_owned));
    }
    for s in shorts {
        input.field("short");
        input.field(s.id.as_str());
        input.field(&s.prompt);
        input.field(s.aspect.as_str());
        input.field(s.status.as_str());
        input.opt(s.best_version.map(|n| n.to_string()));
        input.opt(s.render.as_ref().map(|(_, n)| n.to_string()));
        input.field(&s.created_at);
    }
    digest(input.0.as_bytes())
}

/// The owner's ready clips (duplicates never) and shorts, both newest first (the stores' order).
async fn snapshot(deps: &SyncDeps<'_>, user: &UserId) -> Result<(Vec<Clip>, Vec<Short>), AppError> {
    let clips: Vec<Clip> = deps
        .catalogue
        .list_clips(user)
        .await?
        .into_iter()
        .filter(|c| c.status == ClipStatus::Ready && &c.user_id == user)
        .collect();
    let shorts: Vec<Short> = deps
        .shorts
        .list(user)
        .await?
        .into_iter()
        .filter(|s| &s.user_id == user)
        .collect();
    Ok((clips, shorts))
}

/// The owner's sync snapshot, or [`ManifestOutcome::Unchanged`] when `known` (the client's
/// `If-None-Match` etags) holds the current etag; URLs are signed only for a changed snapshot.
///
/// # Errors
/// Catalogue, short store and signing errors pass through. A failed proxy size lookup is not an
/// error: that clip's size is `None`.
pub async fn sync_manifest(
    deps: &SyncDeps<'_>,
    user: &UserId,
    known: &[String],
) -> Result<ManifestOutcome, AppError> {
    let (clips, shorts) = snapshot(deps, user).await?;
    let etag = manifest_etag(&clips, &shorts, deps.digest);
    if known.contains(&etag) {
        return Ok(ManifestOutcome::Unchanged { etag });
    }
    let mut synced = Vec::with_capacity(clips.len());
    for clip in clips {
        let key = keys::proxy_720p(&clip.user_id, &clip.id);
        let proxy_url = deps.blobs.presign_get(&key, deps.url_ttl).await?;
        // Recovery: the size is a hint; the client falls back to `Content-Length`.
        let proxy_size_bytes = deps.blobs.object_size(&key).await.ok();
        synced.push(SyncClip {
            clip,
            proxy_url,
            proxy_size_bytes,
        });
    }
    let mut signed = Vec::with_capacity(shorts.len());
    for short in shorts {
        let render_url = match &short.render {
            Some((key, _)) => Some(deps.blobs.presign_get(key, deps.url_ttl).await?),
            None => None,
        };
        signed.push(SyncShort { short, render_url });
    }
    Ok(ManifestOutcome::Changed(SyncManifest {
        etag,
        clips: synced,
        shorts: signed,
    }))
}

/// A URL that downloads the clip's original as `<title>.<ext>`.
///
/// # Errors
/// `NOT_FOUND` when the clip does not exist, belongs to another user or is not ready (the same
/// answer for all three, so ids of other users' clips cannot be probed); signing errors.
pub async fn original_url(
    deps: &SyncDeps<'_>,
    user: &UserId,
    id: &ClipId,
) -> Result<String, AppError> {
    let clip = deps
        .catalogue
        .get_clip(id)
        .await?
        .filter(|c| &c.user_id == user && c.status == ClipStatus::Ready)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such clip"))?;
    let key = keys::original(&clip.user_id, &clip.id, clip.ext);
    let filename = format!("{}.{}", clip.display_title(), clip.ext.as_str());
    deps.blobs
        .presign_download(&key, deps.url_ttl, &filename)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ids::ShortId;
    use crate::domain::media::MediaExt;
    use crate::domain::short::ShortStatus;
    use crate::domain::timeline::Aspect;

    /// Readable stand-in digest: the input itself.
    fn plain(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).into_owned()
    }

    fn clip(id: &str, title: Option<&str>) -> Clip {
        Clip {
            id: ClipId::parse(id).unwrap(),
            user_id: UserId::parse("u1").unwrap(),
            filename: "IMG_1.MOV".into(),
            ext: MediaExt::Mov,
            size_bytes: 10,
            status: ClipStatus::Ready,
            probe: None,
            created_at: "2026-10-27T00:00:00.000Z".into(),
            title: title.map(str::to_owned),
            last_viewed_at: None,
            content_sha256: None,
            duplicate_of: None,
        }
    }

    fn short(id: &str) -> Short {
        Short {
            id: ShortId::parse(id).unwrap(),
            user_id: UserId::parse("u1").unwrap(),
            prompt: "calm".into(),
            aspect: Aspect::Portrait,
            target_s: 10.0,
            status: ShortStatus::Ready,
            best_version: Some(2),
            render: None,
            created_at: "2026-10-27T01:00:00.000Z".into(),
        }
    }

    #[test]
    fn the_etag_input_length_prefixes_every_field_and_marks_missing_ones() {
        let etag = manifest_etag(&[clip("c1", Some("Beach"))], &[short("x1")], plain);
        assert_eq!(
            etag,
            concat!(
                "7:sync-v1;4:clip;2:c1;5:Beach;9:IMG_1.MOV;3:mov;2:10;5:ready;!;!;!;!;!;",
                "5:short;2:x1;4:calm;3:4:5;5:ready;1:2;!;24:2026-10-27T01:00:00.000Z;"
            )
        );
    }

    #[test]
    fn the_etag_changes_with_a_title_status_size_or_new_render() {
        let base = manifest_etag(&[clip("c1", Some("Beach"))], &[short("x1")], plain);
        let retitled = manifest_etag(&[clip("c1", Some("Pier"))], &[short("x1")], plain);
        let mut bigger = clip("c1", Some("Beach"));
        bigger.size_bytes = 11;
        let resized = manifest_etag(&[bigger], &[short("x1")], plain);
        let mut rendered = short("x1");
        rendered.render = Some((keys::ObjectKey::from_stored("k".into()), 2));
        let with_render = manifest_etag(&[clip("c1", Some("Beach"))], &[rendered], plain);
        let mut failed = short("x1");
        failed.status = ShortStatus::Failed;
        let refailed = manifest_etag(&[clip("c1", Some("Beach"))], &[failed], plain);

        for other in [retitled, resized, with_render, refailed] {
            assert_ne!(base, other);
        }
    }

    #[test]
    fn fields_cannot_run_into_each_other() {
        let a = manifest_etag(&[clip("c1", Some("ab"))], &[], plain);
        let mut moved = clip("c1", Some("a"));
        moved.filename = format!("b{}", moved.filename);
        assert_ne!(a, manifest_etag(&[moved], &[], plain));
    }
}
