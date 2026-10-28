//! A stand-in for the studio ports in tests that never reach the productions routes: every call
//! fails with `INTERNAL`, so a test that does reach them fails loudly. The one exception is
//! `list`, which answers "no productions": the shorts list reads it to link story shorts.

use nimbytes_core::domain::cover::{CoverInfo, CoverTitle};
use nimbytes_core::domain::export::{ExportStatus, ShortExport};
use nimbytes_core::domain::ids::{ProductionId, SegmentId, ShortId, ShotId, UserId};
use nimbytes_core::domain::production::{
    CoverageAnswer, CoverageMatch, Platform, Production, ProductionStatus, Shot,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{
    ArtRequest, BoardRequest, CoverRequest, CoverageShot, ExportStore, FootageBoardRequest,
    ImageMaker, LibrarySummary, PackAnswer, PackRequest, PortResult, ProductionStore,
    RedrawRequest, ShotListAttempt, ShotListRequest, StudioPlanner,
};
use nimbytes_core::{AppError, ErrorCode};

/// Production store, planner and image maker that are not wired.
#[derive(Debug, Default)]
pub struct UnwiredStudio;

fn unwired<'a, T: Send + 'a>() -> PortResult<'a, T> {
    Box::pin(async {
        Err(AppError::new(
            ErrorCode::Internal,
            "studio ports are not wired in this test",
        ))
    })
}

impl ProductionStore for UnwiredStudio {
    fn create<'a>(&'a self, _: &'a Production) -> PortResult<'a, ()> {
        unwired()
    }

    fn get<'a>(&'a self, _: &'a ProductionId) -> PortResult<'a, Option<Production>> {
        unwired()
    }

    fn list<'a>(&'a self, _: &'a UserId) -> PortResult<'a, Vec<Production>> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn shots<'a>(&'a self, _: &'a ProductionId) -> PortResult<'a, Vec<Shot>> {
        unwired()
    }

    fn save_plan<'a>(
        &'a self,
        _: &'a ProductionId,
        _: &'a str,
        _: &'a [Shot],
    ) -> PortResult<'a, bool> {
        unwired()
    }

    fn set_board<'a>(&'a self, _: &'a ShotId, _: &'a ObjectKey) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_footage_board<'a>(
        &'a self,
        _: &'a ShotId,
        _: &'a ObjectKey,
        _: &'a SegmentId,
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_art<'a>(&'a self, _: &'a ProductionId, _: &'a ObjectKey) -> PortResult<'a, ()> {
        unwired()
    }

    fn claim_auto_art<'a>(&'a self, _: &'a ProductionId) -> PortResult<'a, bool> {
        unwired()
    }

    fn set_coverage<'a>(
        &'a self,
        _: &'a ProductionId,
        _: &'a [CoverageMatch],
        _: &'a str,
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_status<'a>(
        &'a self,
        _: &'a ProductionId,
        _: ProductionStatus,
        _: Option<&'a str>,
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_cut<'a>(&'a self, _: &'a ProductionId, _: &'a ShortId) -> PortResult<'a, bool> {
        unwired()
    }

    fn by_short<'a>(&'a self, _: &'a ShortId) -> PortResult<'a, Option<Production>> {
        unwired()
    }

    fn fail_planning<'a>(&'a self, _: &'a str) -> PortResult<'a, u64> {
        unwired()
    }

    fn delete<'a>(&'a self, _: &'a ProductionId) -> PortResult<'a, ()> {
        unwired()
    }

    fn library_summary<'a>(&'a self, _: &'a UserId) -> PortResult<'a, LibrarySummary> {
        unwired()
    }

    fn last_ready_at<'a>(&'a self, _: &'a UserId) -> PortResult<'a, Option<String>> {
        unwired()
    }
}

impl StudioPlanner for UnwiredStudio {
    fn shot_list<'a>(&'a self, _: &'a ShotListRequest<'a>) -> PortResult<'a, ShotListAttempt> {
        unwired()
    }

    fn match_coverage<'a>(
        &'a self,
        _: &'a str,
        _: &'a [CoverageShot<'a>],
    ) -> PortResult<'a, Vec<CoverageAnswer>> {
        unwired()
    }

    fn platform_pack<'a>(&'a self, _: &'a PackRequest<'a>) -> PortResult<'a, Vec<PackAnswer>> {
        unwired()
    }
}

impl ImageMaker for UnwiredStudio {
    fn draw_boards<'a>(
        &'a self,
        _: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        unwired()
    }

    fn draw_covers<'a>(
        &'a self,
        _: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        unwired()
    }

    fn redraw_cover<'a>(&'a self, _: &'a RedrawRequest) -> PortResult<'a, ()> {
        unwired()
    }

    fn draw_footage_boards<'a>(
        &'a self,
        _: &'a [FootageBoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        unwired()
    }

    fn draw_art<'a>(&'a self, _: &'a ArtRequest) -> PortResult<'a, ()> {
        unwired()
    }
}

impl ExportStore for UnwiredStudio {
    fn queue_export<'a>(&'a self, _: &'a ShortExport) -> PortResult<'a, ()> {
        unwired()
    }

    fn exports<'a>(&'a self, _: &'a ShortId) -> PortResult<'a, Vec<ShortExport>> {
        unwired()
    }

    fn set_text<'a>(
        &'a self,
        _: &'a ShortId,
        _: Platform,
        _: (&'a str, &'a [String]),
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn add_covers<'a>(
        &'a self,
        _: &'a ShortId,
        _: Platform,
        _: &'a [(ObjectKey, CoverInfo)],
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_cover_title<'a>(
        &'a self,
        _: &'a ShortId,
        _: Platform,
        _: &'a CoverTitle,
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_titled<'a>(
        &'a self,
        _: (&'a ShortId, Platform),
        _: &'a ObjectKey,
        _: (u32, &'a CoverTitle),
    ) -> PortResult<'a, bool> {
        unwired()
    }

    fn set_cover_pick<'a>(&'a self, _: &'a ShortId, _: Platform, _: u32) -> PortResult<'a, ()> {
        unwired()
    }

    fn set_render<'a>(
        &'a self,
        _: &'a ShortId,
        _: &'a [Platform],
        _: (ExportStatus, Option<&'a ObjectKey>),
    ) -> PortResult<'a, ()> {
        unwired()
    }

    fn fail_unfinished(&self) -> PortResult<'_, u64> {
        unwired()
    }
}
