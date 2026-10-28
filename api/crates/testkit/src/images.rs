//! [`ImageMaker`] that records every request and answers "drawn", or fails when told to. No file
//! is written: the fake blob store uploads paths without reading them.

use std::sync::Mutex;

use nimbytes_core::ports::{
    ArtRequest, BoardRequest, CoverRequest, FootageBoardRequest, ImageMaker, PortResult,
    RedrawRequest, SceneRequest,
};
use nimbytes_core::{AppError, ErrorCode};

/// Every request an [`ImageMaker`] call carried.
#[derive(Debug, Default)]
pub struct RecordingImages {
    /// Storyboard frames.
    pub boards: Mutex<Vec<BoardRequest>>,
    /// Covers.
    pub covers: Mutex<Vec<CoverRequest>>,
    /// Redrawn covers.
    pub redraws: Mutex<Vec<RedrawRequest>>,
    /// Footage storyboards.
    pub footage: Mutex<Vec<FootageBoardRequest>>,
    /// Key art.
    pub art: Mutex<Vec<ArtRequest>>,
    /// Cut-out cover scenes.
    pub scenes: Mutex<Vec<SceneRequest>>,
    failing: Mutex<bool>,
}

impl RecordingImages {
    /// Makes every later drawing fail with `MODEL_UNAVAILABLE`.
    pub fn fail(&self) {
        *crate::lock(&self.failing) = true;
    }

    fn outcome(&self) -> Result<(), AppError> {
        if *crate::lock(&self.failing) {
            Err(AppError::new(ErrorCode::ModelUnavailable, "model is down"))
        } else {
            Ok(())
        }
    }

    fn each<'a, T: Clone>(
        &'a self,
        log: &Mutex<Vec<T>>,
        requests: &[T],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        crate::lock(log).extend(requests.iter().cloned());
        let results = requests.iter().map(|_| self.outcome()).collect();
        Box::pin(async move { Ok(results) })
    }
}

impl ImageMaker for RecordingImages {
    fn draw_boards<'a>(
        &'a self,
        requests: &'a [BoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        self.each(&self.boards, requests)
    }

    fn draw_covers<'a>(
        &'a self,
        requests: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        self.each(&self.covers, requests)
    }

    fn redraw_cover<'a>(&'a self, request: &'a RedrawRequest) -> PortResult<'a, ()> {
        crate::lock(&self.redraws).push(request.clone());
        let outcome = self.outcome();
        Box::pin(async move { outcome })
    }

    fn draw_scene<'a>(&'a self, request: &'a SceneRequest) -> PortResult<'a, ()> {
        crate::lock(&self.scenes).push(request.clone());
        let outcome = self.outcome();
        Box::pin(async move { outcome })
    }

    fn draw_footage_boards<'a>(
        &'a self,
        requests: &'a [FootageBoardRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>> {
        self.each(&self.footage, requests)
    }

    fn draw_art<'a>(&'a self, request: &'a ArtRequest) -> PortResult<'a, ()> {
        crate::lock(&self.art).push(request.clone());
        let outcome = self.outcome();
        Box::pin(async move { outcome })
    }
}
