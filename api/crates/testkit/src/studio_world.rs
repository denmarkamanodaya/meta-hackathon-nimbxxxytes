//! Every fake the publish, production and project-art use cases need, on top of
//! [`ShortsWorld`], plus builders for exports, productions, shots and library moments.

use std::time::Duration;

use nimbytes_core::domain::clip::{Clip, ClipStatus};
use nimbytes_core::domain::cover::CoverInfo;
use nimbytes_core::domain::export::{ExportAspect, ExportStatus, ShortExport};
use nimbytes_core::domain::ids::{ClipId, ProductionId, SegmentId, ShortId, ShotId};
use nimbytes_core::domain::media::MediaExt;
use nimbytes_core::domain::production::{
    Act, Format, Platform, Production, ProductionStatus, Shot,
};
use nimbytes_core::domain::segment::Segment;
use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::domain::timeline::Aspect;
use nimbytes_core::keys::{self, ObjectKey};
use nimbytes_core::ports::Catalogue;
use nimbytes_core::usecases::exports::ExportDeps;
use nimbytes_core::usecases::productions::StudioDeps;
use nimbytes_core::usecases::project_art::ProjectArtDeps;
use nimbytes_core::usecases::projects::ProjectDeps;
use nimbytes_core::usecases::search::SearchDeps;

use crate::shorts_world::{ShortsWorld, user};
use crate::{
    FakeEmbedder, InMemoryCatalogue, InMemoryExports, InMemoryPeople, InMemoryProductions,
    InMemoryProjects, InMemoryTextIndex, InMemoryVectorIndex, RecordedProgress, RecordingImages,
    UnwiredStudio,
};

/// [`ShortsWorld`] plus exports, productions, projects, a library catalogue and an image maker
/// that records what it is asked to draw.
#[derive(Default)]
pub struct StudioWorld {
    /// Shorts, blobs, scratch, brand, clock, renderer and the storage cap.
    pub base: ShortsWorld,
    /// Export rows.
    pub exports: InMemoryExports,
    /// Productions and shots.
    pub productions: InMemoryProductions,
    /// Projects.
    pub projects: InMemoryProjects,
    /// The library (clips, moments, facts).
    pub catalogue: InMemoryCatalogue,
    /// What was drawn.
    pub images: RecordingImages,
    /// Live steps.
    pub progress: RecordedProgress,
    people: InMemoryPeople,
    text: InMemoryTextIndex,
    vectors: InMemoryVectorIndex,
    planner: UnwiredStudio,
}

impl StudioWorld {
    /// Deps for the export use cases (the platform pack is not wired).
    pub fn export_deps(&self) -> ExportDeps<'_> {
        ExportDeps {
            short: self.base.deps(),
            exports: &self.exports,
            productions: &self.productions,
            planner: &self.planner,
            images: &self.images,
            renderer: self.base.renderer.as_ref(),
            progress: &self.progress,
            media_ttl: Duration::from_secs(7200),
        }
    }

    /// Deps for the productions use cases.
    pub fn studio_deps(&self) -> StudioDeps<'_> {
        StudioDeps {
            store: &self.productions,
            planner: &self.planner,
            images: &self.images,
            scratch: self.base.scratch.as_ref(),
            search: SearchDeps {
                catalogue: &self.catalogue,
                people: &self.people,
                reasoner: self.base.reasoner.as_ref(),
                text: &self.text,
                embedder: &FakeEmbedder,
                vectors: &self.vectors,
                blobs: self.base.blobs.as_ref(),
                clock: self.base.clock.as_ref(),
                url_ttl: Duration::from_secs(3600),
                ledger: self.base.ledger.as_ref(),
            },
            ids: &self.base.ids,
            progress: &self.progress,
            short: self.base.deps(),
            story_brief: "",
            brand: self.base.brand.as_ref(),
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

/// A shooting 4:5 story production `id` of `owner`, linked to `short` when given.
///
/// # Panics
/// On an invalid test id.
pub fn production(id: &str, owner: &str, short: Option<&ShortId>) -> Production {
    Production {
        id: ProductionId::parse(id).unwrap_or_else(|_| unreachable!("valid test id")),
        user_id: user(owner),
        title: "Beach day".into(),
        brief: "A morning at the beach".into(),
        format: Format::Story,
        aspect: Aspect::Portrait,
        target_s: 60.0,
        blur_bystanders: true,
        status: ProductionStatus::Shooting,
        short_id: short.cloned(),
        coverage_checked_at: None,
        error: None,
        created_at: "t".into(),
        art_key: None,
    }
}

/// Shot `id` at `ord`, covered by `matched` when given, with a planned board.
///
/// # Panics
/// On an invalid test id.
pub fn shot(id: &str, ord: u32, matched: Option<&str>) -> Shot {
    Shot {
        id: ShotId::parse(id).unwrap_or_else(|_| unreachable!("valid test id")),
        ord,
        act: Act::Story,
        title: format!("Shot {ord}"),
        direction: "Eye level".into(),
        tips: vec![],
        query: "waves".into(),
        duration_s: 4.0,
        board_key: Some(ObjectKey::from_stored(format!("boards/{id}.webp"))),
        matched_segment_id: matched
            .map(|m| SegmentId::parse(m).unwrap_or_else(|_| unreachable!("valid test id"))),
        match_reason: None,
        take_count: 0,
        footage_board_key: None,
        footage_board_segment: None,
    }
}
