//! Every fake the publish and project-art use cases need, on top of [`ShortsWorld`], plus
//! builders for exports and library moments.

use std::time::Duration;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::cover::CoverInfo;
use nimbytes_core::domain::export::{ExportAspect, ExportStatus, Platform, ShortExport};
use nimbytes_core::domain::ids::{ClipId, SegmentId, ShortId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::keys;
use nimbytes_core::ports::Catalogue;
use nimbytes_core::usecases::exports::ExportDeps;
use nimbytes_core::usecases::project_art::ProjectArtDeps;
use nimbytes_core::usecases::projects::ProjectDeps;

use crate::shorts_world::{ShortsWorld, user};
use crate::{
    InMemoryCatalogue, InMemoryExports, InMemoryProjects, RecordedProgress, RecordingImages,
    Unwired,
};

/// [`ShortsWorld`] plus exports, projects, a library catalogue and an image maker that records
/// what it is asked to draw.
#[derive(Default)]
pub struct PublishWorld {
    /// Shorts, blobs, scratch, brand, clock, renderer and the storage cap.
    pub base: ShortsWorld,
    /// Export rows.
    pub exports: InMemoryExports,
    /// Projects.
    pub projects: InMemoryProjects,
    /// The library (clips, moments, facts).
    pub catalogue: InMemoryCatalogue,
    /// What was drawn.
    pub images: RecordingImages,
    /// Live steps.
    pub progress: RecordedProgress,
    pack: Unwired,
}

impl PublishWorld {
    /// Deps for the export use cases (the platform pack is not wired).
    pub fn export_deps(&self) -> ExportDeps<'_> {
        ExportDeps {
            short: self.base.deps(),
            exports: &self.exports,
            pack: &self.pack,
            images: &self.images,
            renderer: self.base.renderer.as_ref(),
            progress: &self.progress,
            media_ttl: Duration::from_secs(7200),
        }
    }

    /// Deps for the project art use cases.
    pub fn project_art_deps(&self) -> ProjectArtDeps<'_> {
        ProjectArtDeps {
            projects: &self.projects,
            catalogue: &self.catalogue,
            images: &self.images,
            short: self.base.deps(),
        }
    }

    /// Deps for the project use cases.
    pub fn project_deps(&self) -> ProjectDeps<'_> {
        ProjectDeps {
            projects: &self.projects,
            catalogue: &self.catalogue,
            ids: &self.base.ids,
            clock: self.base.clock.as_ref(),
            blobs: self.base.blobs.as_ref(),
            url_ttl: Duration::from_secs(3600),
        }
    }

    /// A ready clip `clip` of `owner` with one moment `segment` (2 s in) scored `hook`.
    ///
    /// # Panics
    /// On an invalid test id.
    pub async fn put_moment(&self, owner: &str, (clip, segment): (&str, &str), hook: Option<u8>) {
        let clip_id = ClipId::parse(clip).unwrap_or_else(|_| unreachable!("valid test id"));
        if self.catalogue.clip(&clip_id).is_none() {
            self.catalogue.put_clip(ready_clip(&clip_id, owner));
        }
        let segment_id = SegmentId::parse(segment).unwrap_or_else(|_| unreachable!("valid id"));
        let mut segments = self
            .catalogue
            .list_segments(&clip_id)
            .await
            .unwrap_or_default();
        segments.push(Segment {
            id: segment_id.clone(),
            clip_id: clip_id.clone(),
            idx: u32::try_from(segments.len()).unwrap_or(0),
            span: Span {
                start_s: 2.0,
                end_s: 6.0,
            },
        });
        let mut facts = crate::world::facts(&format!("moment {segment}"));
        facts.hook_score = hook;
        let stored = self.catalogue.replace_segments(&clip_id, &segments).await;
        let with_facts = self.catalogue.set_segment_facts(&segment_id, &facts).await;
        assert!(stored.is_ok() && with_facts.is_ok(), "moment stored");
    }
}

fn ready_clip(id: &ClipId, owner: &str) -> Clip {
    Clip {
        id: id.clone(),
        user_id: user(owner),
        filename: format!("{id}.mov"),
        ext: MediaExt::Mov,
        size_bytes: 1,
        status: ClipStatus::Ready,
        probe: None,
        created_at: "2026-10-27T01:00:00.000Z".into(),
        title: Some(format!("Clip {id}")),
        last_viewed_at: None,
        content_sha256: None,
        duplicate_of: None,
    }
}

/// The export of `short` on `platform` with `covers` covers (keys as the publish run names
/// them), caption "Nap champion of the street #dog", ready.
pub fn export_with_covers(short: &ShortId, platform: Platform, covers: u32) -> ShortExport {
    let owner = user("u1");
    ShortExport {
        id: format!("{short}-{}", platform.as_str()),
        short_id: short.clone(),
        platform,
        aspect: ExportAspect::Vertical,
        version_n: 1,
        status: ExportStatus::Ready,
        render_key: None,
        caption: "Nap champion of the street #dog".into(),
        hashtags: vec![],
        cover_keys: (0..covers)
            .map(|n| keys::export_cover(&owner, short, platform, n))
            .collect(),
        cover_pick: 0,
        updated_at: "t".into(),
        cover_info: Vec::<CoverInfo>::new(),
        cover_title: None,
        titled_cover_key: None,
    }
}
