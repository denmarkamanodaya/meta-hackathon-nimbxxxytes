//! What the Mac app mirrors: a snapshot of the owner's ready clips, shorts and other library files
//! (recordings with an uploaded file, documents, photos) with an etag that ignores URLs, and a
//! download URL for one clip's or item's original. Owner only.

use std::fmt::Write as _;
use std::time::Duration;

use crate::domain::clip::{Clip, ClipStatus};
use crate::domain::document::{DocStatus, Document};
use crate::domain::ids::{ClipId, UserId};
use crate::domain::item::{ItemRef, shown_title};
use crate::domain::listen::{Listen, ListenSource, ListenStatus};
use crate::domain::photo::{Photo, PhotoStatus};
use crate::domain::short::Short;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{BlobStore, Catalogue, DocumentStore, ListenStore, PhotoStore, ShortStore};

/// Ports and settings the sync endpoints need.
pub struct SyncDeps<'a> {
    /// Clips.
    pub catalogue: &'a dyn Catalogue,
    /// Shorts.
    pub shorts: &'a dyn ShortStore,
    /// iListen recordings.
    pub listens: &'a dyn ListenStore,
    /// iRead documents.
    pub documents: &'a dyn DocumentStore,
    /// Photos.
    pub photos: &'a dyn PhotoStore,
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

/// One non-clip library file the Mac mirrors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncItem {
    /// Kind and id.
    pub item: ItemRef,
    /// The title the library shows.
    pub title: String,
    /// File name as uploaded.
    pub filename: String,
    /// Extension of the stored original.
    pub ext: String,
    /// Size of the stored original in bytes.
    pub size_bytes: u64,
    /// Recording or document added time, photo taken time (else added), ISO-8601 UTC.
    pub dated_at: String,
}

/// A recording the Mac mirrors, with the key of its original: only a ready file listen (a clip
/// listen stores no file of its own). Pure.
pub fn listen_item(l: &Listen) -> Option<(SyncItem, ObjectKey)> {
    if l.status != ListenStatus::Ready || l.source != ListenSource::File {
        return None;
    }
    let item = SyncItem {
        item: ItemRef::Listen(l.id.clone()),
        title: shown_title(&l.title, &l.source_name),
        filename: l.source_name.clone(),
        ext: l.ext.clone(),
        size_bytes: l.size_bytes,
        dated_at: l.created_at.clone(),
    };
    Some((item, keys::listen_source(&l.user_id, &l.id, &l.ext)))
}

/// A ready document the Mac mirrors, with the key of its original. Pure.
pub fn document_item(d: &Document) -> Option<(SyncItem, ObjectKey)> {
    if d.status != DocStatus::Ready {
        return None;
    }
    let item = SyncItem {
        item: ItemRef::Document(d.id.clone()),
        title: shown_title(&d.title, &d.filename),
        filename: d.filename.clone(),
        ext: d.format.ext().to_owned(),
        size_bytes: d.size_bytes,
        dated_at: d.created_at.clone(),
    };
    Some((item, keys::document_source(&d.user_id, &d.id, d.format)))
}

/// A ready photo the Mac mirrors, with the key of its original. Pure.
pub fn photo_item(p: &Photo) -> Option<(SyncItem, ObjectKey)> {
    if p.status != PhotoStatus::Ready {
        return None;
    }
    let item = SyncItem {
        item: ItemRef::Photo(p.id.clone()),
        title: shown_title(&p.title, &p.filename),
        filename: p.filename.clone(),
        ext: p.format.ext().to_owned(),
        size_bytes: p.size_bytes,
        dated_at: p.taken_at.clone().unwrap_or_else(|| p.created_at.clone()),
    };
    Some((item, keys::photo_original(&p.user_id, &p.id, p.format)))
}

/// Newest `dated_at` first; equal dates by kind, then id, so the order (and the etag) is stable.
fn newest_first(items: &mut [SyncItem]) {
    items.sort_by(|a, b| {
        b.dated_at
            .cmp(&a.dated_at)
            .then_with(|| a.item.cmp(&b.item))
    });
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
    /// Recordings, documents and photos, newest first.
    pub items: Vec<SyncItem>,
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
pub fn manifest_etag(
    (clips, shorts, items): (&[Clip], &[Short], &[SyncItem]),
    digest: fn(&[u8]) -> String,
) -> String {
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
    for i in items {
        input.field(i.item.kind().as_str());
        input.field(i.item.id_str());
        input.field(&i.title);
        input.field(&i.filename);
        input.field(&i.ext);
        input.field(&i.size_bytes.to_string());
        input.field(&i.dated_at);
    }
    digest(input.0.as_bytes())
}

/// The owner's mirrored recordings, documents and photos, newest first.
async fn items(deps: &SyncDeps<'_>, user: &UserId) -> Result<Vec<SyncItem>, AppError> {
    let mut out: Vec<SyncItem> = Vec::new();
    let mine = |i: Option<(SyncItem, ObjectKey)>| i.map(|(item, _)| item);
    let listens = deps.listens.list(user).await?;
    out.extend(
        listens
            .iter()
            .filter(|l| &l.user_id == user)
            .filter_map(|l| mine(listen_item(l))),
    );
    let docs = deps.documents.list(user).await?;
    out.extend(
        docs.iter()
            .filter(|d| &d.user_id == user)
            .filter_map(|d| mine(document_item(d))),
    );
    let photos = deps.photos.list(user).await?;
    out.extend(
        photos
            .iter()
            .filter(|p| &p.user_id == user)
            .filter_map(|p| mine(photo_item(p))),
    );
    newest_first(&mut out);
    Ok(out)
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
    let items = items(deps, user).await?;
    let etag = manifest_etag((&clips, &shorts, &items), deps.digest);
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
        items,
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

/// A URL that downloads the item's original as `<title>.<ext>`.
///
/// # Errors
/// `NOT_FOUND` when the item does not exist, belongs to another user or is not mirrored (not
/// ready, or a clip listen); the same answer for all, as for clips. Store and signing errors.
pub async fn item_original_url(
    deps: &SyncDeps<'_>,
    user: &UserId,
    item: &ItemRef,
) -> Result<String, AppError> {
    let found = match item {
        ItemRef::Listen(id) => deps
            .listens
            .get(id)
            .await?
            .filter(|l| &l.user_id == user)
            .and_then(|l| listen_item(&l)),
        ItemRef::Document(id) => deps
            .documents
            .get(id)
            .await?
            .filter(|d| &d.user_id == user)
            .and_then(|d| document_item(&d)),
        ItemRef::Photo(id) => deps
            .photos
            .get(id)
            .await?
            .filter(|p| &p.user_id == user)
            .and_then(|p| photo_item(&p)),
    };
    let (shown, key) = found.ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such item"))?;
    let filename = format!("{}.{}", shown.title, shown.ext);
    deps.blobs
        .presign_download(&key, deps.url_ttl, &filename)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::document::DocFormat;
    use crate::domain::ids::{DocumentId, ListenId, PhotoId, ShortId};
    use crate::domain::media::MediaExt;
    use crate::domain::photo::PhotoFormat;
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
        let etag = manifest_etag((&[clip("c1", Some("Beach"))], &[short("x1")], &[]), plain);
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
        let base = manifest_etag((&[clip("c1", Some("Beach"))], &[short("x1")], &[]), plain);
        let retitled = manifest_etag((&[clip("c1", Some("Pier"))], &[short("x1")], &[]), plain);
        let mut bigger = clip("c1", Some("Beach"));
        bigger.size_bytes = 11;
        let resized = manifest_etag((&[bigger], &[short("x1")], &[]), plain);
        let mut rendered = short("x1");
        rendered.render = Some((keys::ObjectKey::from_stored("k".into()), 2));
        let with_render = manifest_etag((&[clip("c1", Some("Beach"))], &[rendered], &[]), plain);
        let mut failed = short("x1");
        failed.status = ShortStatus::Failed;
        let refailed = manifest_etag((&[clip("c1", Some("Beach"))], &[failed], &[]), plain);

        for other in [retitled, resized, with_render, refailed] {
            assert_ne!(base, other);
        }
    }

    #[test]
    fn fields_cannot_run_into_each_other() {
        let a = manifest_etag((&[clip("c1", Some("ab"))], &[], &[]), plain);
        let mut moved = clip("c1", Some("a"));
        moved.filename = format!("b{}", moved.filename);
        assert_ne!(a, manifest_etag((&[moved], &[], &[]), plain));
    }

    fn listen(id: &str, source: ListenSource, status: ListenStatus) -> Listen {
        let start = crate::domain::listen::ListenStart {
            source,
            clip_id: None,
            source_name: "Voice 3.m4a".into(),
            content_type: "audio/mp4".into(),
            ext: "m4a".into(),
            size_bytes: 40,
            target: "en".into(),
        };
        let ids = (ListenId::parse(id).unwrap(), UserId::parse("u1").unwrap());
        Listen::new(ids, start, status, "2026-10-28T00:00:00.000Z")
    }

    fn photo(id: &str, taken: Option<&str>) -> Photo {
        let req = crate::domain::photo::NewPhoto {
            filename: "IMG_9.png".into(),
            content_type: "image/png".into(),
            size_bytes: 70,
            last_modified: None,
        };
        let ids = (PhotoId::parse(id).unwrap(), UserId::parse("u1").unwrap());
        let mut p = Photo::uploading(ids, req, PhotoFormat::Png, "2026-10-29T00:00:00.000Z");
        p.status = PhotoStatus::Ready;
        p.taken_at = taken.map(str::to_owned);
        p
    }

    fn document(id: &str, status: DocStatus) -> Document {
        let req = crate::domain::document::NewDocument {
            filename: "bill.pdf".into(),
            content_type: "application/pdf".into(),
            size_bytes: 90,
        };
        let ids = (DocumentId::parse(id).unwrap(), UserId::parse("u1").unwrap());
        let mut d = Document::uploading(ids, req, DocFormat::Pdf, "2026-10-27T00:00:00.000Z");
        d.status = status;
        d.title = "Power bill".into();
        d
    }

    #[test]
    fn only_ready_file_listens_are_mirrored_from_their_uploaded_source() {
        assert!(listen_item(&listen("l1", ListenSource::Clip, ListenStatus::Ready)).is_none());
        assert!(listen_item(&listen("l1", ListenSource::File, ListenStatus::Listening)).is_none());
        let (item, key) =
            listen_item(&listen("l1", ListenSource::File, ListenStatus::Ready)).unwrap();
        assert_eq!(key.as_str(), "users/u1/listens/l1/source.m4a");
        assert_eq!(
            (
                item.title.as_str(),
                item.filename.as_str(),
                item.ext.as_str()
            ),
            ("Voice 3", "Voice 3.m4a", "m4a"),
            "an untitled recording shows its file name"
        );
        assert_eq!(item.size_bytes, 40);
    }

    #[test]
    fn documents_and_photos_are_mirrored_once_ready_with_the_photo_dated_when_taken() {
        assert!(document_item(&document("d1", DocStatus::Reading)).is_none());
        let (doc, key) = document_item(&document("d1", DocStatus::Ready)).unwrap();
        assert_eq!(key.as_str(), "users/u1/documents/d1/source.pdf");
        assert_eq!(
            (doc.title.as_str(), doc.ext.as_str()),
            ("Power bill", "pdf")
        );

        let (taken, key) = photo_item(&photo("p1", Some("2026-08-08T06:09:37.000Z"))).unwrap();
        assert_eq!(key.as_str(), "users/u1/photos/p1/original.png");
        assert_eq!(taken.dated_at, "2026-08-08T06:09:37.000Z");
        let (untaken, _) = photo_item(&photo("p1", None)).unwrap();
        assert_eq!(untaken.dated_at, "2026-10-29T00:00:00.000Z");
    }

    #[test]
    fn items_sort_newest_first_and_ties_stay_stable() {
        let mut items: Vec<SyncItem> = [
            document_item(&document("d1", DocStatus::Ready)),
            photo_item(&photo("p1", None)),
            listen_item(&listen("l1", ListenSource::File, ListenStatus::Ready)),
            photo_item(&photo("p0", None)),
        ]
        .into_iter()
        .map(|i| i.unwrap().0)
        .collect();
        newest_first(&mut items);
        let ids: Vec<&str> = items.iter().map(|i| i.item.id_str()).collect();
        assert_eq!(ids, ["p0", "p1", "l1", "d1"]);
    }

    #[test]
    fn the_etag_changes_when_an_item_is_added_renamed_or_resized() {
        let (doc, _) = document_item(&document("d1", DocStatus::Ready)).unwrap();
        let (pic, _) = photo_item(&photo("p1", None)).unwrap();
        let base = manifest_etag((&[], &[], std::slice::from_ref(&doc)), plain);
        let added = manifest_etag((&[], &[], &[pic, doc.clone()]), plain);
        let mut renamed = doc.clone();
        renamed.title = "Water bill".into();
        let mut resized = doc.clone();
        resized.size_bytes += 1;
        let empty = manifest_etag((&[], &[], &[]), plain);
        for other in [
            added,
            manifest_etag((&[], &[], &[renamed]), plain),
            manifest_etag((&[], &[], &[resized]), plain),
            empty,
        ] {
            assert_ne!(base, other);
        }
        assert_eq!(base, manifest_etag((&[], &[], &[doc]), plain), "stable");
    }
}
