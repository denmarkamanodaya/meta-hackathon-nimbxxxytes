//! Images drawn by an image model: covers, redrawn covers, cut-out cover scenes and key art.

use std::path::PathBuf;

use crate::domain::cover::CoverStyle;
use crate::domain::export::{ExportAspect, Platform};
use crate::error::AppError;
use crate::ports::PortResult;

/// One cover to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct CoverRequest {
    /// Where it is posted.
    pub platform: Platform,
    /// Its frame.
    pub aspect: ExportAspect,
    /// Cover number on this platform (each number is a different variation).
    pub n: u32,
    /// The look asked for (never `redrawn` or `key_art`).
    pub style: CoverStyle,
    /// The post's caption, for the mood.
    pub caption: String,
    /// `#rrggbb` of the title band: the brand accent, else the video accent.
    pub accent: String,
    /// Whether the second anchor is the owner's logo.
    pub has_logo: bool,
    /// A real frame of the short first, then the logo (when `has_logo`), then style references.
    pub anchors: Vec<PathBuf>,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// One cover redrawn from another with the owner's words.
#[derive(Debug, Clone, PartialEq)]
pub struct RedrawRequest {
    /// The cover's frame.
    pub aspect: ExportAspect,
    /// The owner's words (3 to 120 characters).
    pub instruction: String,
    /// The cover to redraw first, then the real frame it was made from (when there is one).
    pub anchors: Vec<PathBuf>,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// The scene behind a cut-out cover's subject: the real frame's place without its subject.
#[derive(Debug, Clone, PartialEq)]
pub struct SceneRequest {
    /// The cover's frame.
    pub aspect: ExportAspect,
    /// The real frame the subject is cut from.
    pub frame: PathBuf,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// Key art for a project.
#[derive(Debug, Clone, PartialEq)]
pub struct ArtRequest {
    /// Shape text, for example `4:5`.
    pub shape: &'static str,
    /// The `size` asked of the model (it sets the aspect only).
    pub size: &'static str,
    /// What the collection is about (the project's name).
    pub theme: String,
    /// `#rrggbb` touch of colour.
    pub accent: String,
    /// Up to 4 frames it is drawn from.
    pub anchors: Vec<PathBuf>,
    /// Variation number: 0 for the automatic drawing, another for "New art".
    pub take: u32,
    /// Where the WebP is written.
    pub out: PathBuf,
}

/// Draws images with an image model.
pub trait ImageMaker: Send + Sync {
    /// Draws every cover at once (the caller bounds the batch), each into its `out` file as
    /// WebP. One result per request, in order; a failed cover never fails the others.
    fn draw_covers<'a>(
        &'a self,
        requests: &'a [CoverRequest],
    ) -> PortResult<'a, Vec<Result<(), AppError>>>;

    /// Redraws one cover into its `out` file as WebP. `MODEL_UNAVAILABLE` on failure.
    fn redraw_cover<'a>(&'a self, request: &'a RedrawRequest) -> PortResult<'a, ()>;

    /// Draws the scene behind a cut-out cover into its `out` file as WebP. `MODEL_UNAVAILABLE`
    /// on failure.
    fn draw_scene<'a>(&'a self, request: &'a SceneRequest) -> PortResult<'a, ()>;

    /// Draws key art into its `out` file as WebP. `MODEL_UNAVAILABLE` on failure.
    fn draw_art<'a>(&'a self, request: &'a ArtRequest) -> PortResult<'a, ()>;
}
