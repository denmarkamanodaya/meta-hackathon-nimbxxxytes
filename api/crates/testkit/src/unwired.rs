//! A stand-in for the publish ports (platform pack, image maker, export rows) in tests that
//! never reach them: every call fails with `INTERNAL`, so a test that does reach them fails
//! loudly.

use nimbytes_core::domain::cover::{CoverInfo, CoverTitle};
use nimbytes_core::domain::export::{ExportStatus, Platform, ShortExport};
use nimbytes_core::domain::ids::ShortId;
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{
    ArtRequest, CoverRequest, ExportStore, ImageMaker, PackAnswer, PackRequest, PackWriter,
    PortResult, RedrawRequest, SceneRequest,
};
use nimbytes_core::{AppError, ErrorCode};

/// Platform pack writer, image maker and export store that are not wired.
#[derive(Debug, Default)]
pub struct Unwired;

fn unwired<'a, T: Send + 'a>() -> PortResult<'a, T> {
    Box::pin(async {
        Err(AppError::new(
            ErrorCode::Internal,
            "publish ports are not wired in this test",
        ))
    })
}

impl PackWriter for Unwired {
    fn platform_pack<'a>(&'a self, _: &'a PackRequest<'a>) -> PortResult<'a, Vec<PackAnswer>> {
        unwired()
    }
}

impl ImageMaker for Unwired {
    fn draw_covers<'a>(
        &'a self,
        _: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        unwired()
    }

    fn redraw_cover<'a>(&'a self, _: &'a RedrawRequest) -> PortResult<'a, ()> {
        unwired()
    }

    fn draw_scene<'a>(&'a self, _: &'a SceneRequest) -> PortResult<'a, ()> {
        unwired()
    }

    fn draw_art<'a>(&'a self, _: &'a ArtRequest) -> PortResult<'a, ()> {
        unwired()
    }
}

impl ExportStore for Unwired {
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
