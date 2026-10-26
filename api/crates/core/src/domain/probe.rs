//! What probing a video tells us.

/// Facts from ffprobe about one original.
#[derive(Debug, Clone, PartialEq)]
pub struct ProbeInfo {
    /// Container duration, seconds.
    pub duration_s: f64,
    /// Display width after rotation, pixels.
    pub width: u32,
    /// Display height after rotation, pixels.
    pub height: u32,
    /// Average frame rate, frames per second.
    pub fps: f64,
    /// Display rotation in degrees from the display matrix (e.g. -90 for a portrait phone clip).
    pub rotation: i32,
    /// Video codec name (`hevc`, `h264`, …).
    pub codec: String,
    /// Container `creation_time` (ISO-8601 UTC), when the file has one.
    pub recorded_at: Option<String>,
    /// Whether there is an audio stream to transcribe.
    pub has_audio: bool,
}
