//! Media processing and transcription.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::domain::faces::FrameCrop;
use crate::domain::probe::{AudioProbe, ProbeInfo};
use crate::domain::segmenting::Span;
use crate::domain::transcript::RawTurn;
use crate::ports::PortResult;

/// ffmpeg-style media operations on local files. Every call has a timeout set where the tool is
/// built; `MEDIA_FAILED` on a bad input or a timeout.
pub trait MediaTool: Send + Sync {
    /// Reads duration, display size, frame rate, rotation, codec and creation time.
    fn probe<'a>(&'a self, src: &'a Path) -> PortResult<'a, ProbeInfo>;

    /// Reads the duration and whether there is sound, from any sound file or video (no video
    /// stream needed).
    fn probe_audio<'a>(&'a self, src: &'a Path) -> PortResult<'a, AudioProbe>;

    /// Upright H.264 proxy: long edge 1280, constant 30 fps, AAC, fast start; stopped after
    /// `timeout` (long footage gets longer, see `domain::proxy::encode_timeout`).
    fn make_proxy<'a>(
        &'a self,
        src: &'a Path,
        dst: &'a Path,
        timeout: Duration,
    ) -> PortResult<'a, ()>;

    /// 1 fps H.264 copy without audio (input for face tracking).
    fn make_sam_fps1<'a>(&'a self, src: &'a Path, dst: &'a Path) -> PortResult<'a, ()>;

    /// 16 kHz mono 16-bit PCM WAV of `span` of the source's audio.
    fn extract_wav<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()>;

    /// Pauses in the sound (below -35 dB for at least 0.35 s), in time order; a pause running to
    /// the end has an infinite end.
    fn silences<'a>(&'a self, src: &'a Path) -> PortResult<'a, Vec<Span>>;

    /// Scene-cut times in seconds, ascending.
    fn scene_cuts<'a>(&'a self, src: &'a Path) -> PortResult<'a, Vec<f64>>;

    /// JPEG of the frame at `at_s`, 640 px wide.
    fn thumbnail<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()>;

    /// 256 px square JPEG of a square region of one frame.
    fn crop<'a>(&'a self, src: &'a Path, crop: FrameCrop, dst: &'a Path) -> PortResult<'a, ()>;

    /// 360p H.264 + AAC clip of `span`.
    fn snippet<'a>(&'a self, src: &'a Path, span: Span, dst: &'a Path) -> PortResult<'a, ()>;

    /// `span` of `src` at `fps`, no audio, at `src`'s size (SAM input): frame `f` shows second
    /// `span.start_s + f / fps`.
    fn range_proxy<'a>(
        &'a self,
        src: &'a Path,
        range: (Span, u32),
        dst: &'a Path,
    ) -> PortResult<'a, ()>;

    /// JPEG of the frame at `at_s` at `src`'s size.
    fn frame_at<'a>(&'a self, src: &'a Path, at_s: f64, dst: &'a Path) -> PortResult<'a, ()>;

    /// The first `max` pages of a PDF as 150 dpi JPEGs in `dst_dir` (which must exist), page 1
    /// first.
    fn pdf_pages<'a>(
        &'a self,
        src: &'a Path,
        dst_dir: &'a Path,
        max: usize,
    ) -> PortResult<'a, Vec<PathBuf>>;

    /// An image (JPEG, PNG, WebP) as a JPEG whose long edge is at most 2000 px (never enlarged).
    fn page_jpeg<'a>(&'a self, src: &'a Path, dst: &'a Path) -> PortResult<'a, ()>;
}

/// Speech to text with speaker labels.
pub trait Transcriber: Send + Sync {
    /// Transcribes one WAV (at most 10 minutes); turn times are relative to the file start.
    /// `MODEL_UNAVAILABLE` when the model call fails after retries.
    fn transcribe<'a>(&'a self, wav: &'a Path) -> PortResult<'a, Vec<RawTurn>>;

    /// Transcribes several WAVs, answers in the same order. One after another unless the
    /// adapter runs a few at once.
    fn transcribe_all<'a>(&'a self, wavs: &'a [PathBuf]) -> PortResult<'a, Vec<Vec<RawTurn>>> {
        Box::pin(async move {
            let mut out = Vec::with_capacity(wavs.len());
            for wav in wavs {
                out.push(self.transcribe(wav).await?);
            }
            Ok(out)
        })
    }
}
