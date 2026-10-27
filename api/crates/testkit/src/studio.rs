//! A stand-in for the studio ports in tests that never reach the productions routes: every call
//! fails with `INTERNAL`, so a test that does reach them fails loudly.

use nimbytes_core::domain::ids::{ProductionId, ShotId, UserId};
use nimbytes_core::domain::production::{
    CoverageAnswer, CoverageMatch, Production, ProductionStatus, Shot,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{
    BoardRequest, CoverageShot, ImageMaker, LibrarySummary, PortResult, ProductionStore,
    ShotListAttempt, ShotListRequest, StudioPlanner,
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
        unwired()
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
}

impl ImageMaker for UnwiredStudio {
    fn draw_boards<'a>(
        &'a self,
        _: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        unwired()
    }
}
