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

/// Facts from ffprobe about a sound file or a video, needing no video stream.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioProbe {
    /// Container duration, seconds.
    pub duration_s: f64,
    /// Whether there is an audio stream.
    pub has_audio: bool,
}

/// What reading a still image tells, before the photo rules apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageProbe {
    /// Pixels after orientation.
    pub width: u32,
    /// Pixels after orientation.
    pub height: u32,
    /// The date the camera wrote, as ISO-8601 UTC, when there is one.
    pub taken_at: Option<String>,
    /// Make and model, when the image names them.
    pub camera: Option<String>,
}
