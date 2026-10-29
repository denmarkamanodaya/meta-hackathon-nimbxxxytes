//! Voice requests for the ask box: which recordings are accepted, how much of one is heard, and
//! how the heard turns become one line of text.

use crate::domain::segmenting::Span;
use crate::domain::transcript::RawTurn;
use crate::error::{AppError, ErrorCode};

/// Largest recording accepted, bytes (10 MiB).
pub const MAX_AUDIO_BYTES: usize = 10 * 1024 * 1024;

/// The part of a recording that is transcribed: its first minute (a spoken request is short).
pub const HEARD: Span = Span {
    start_s: 0.0,
    end_s: 60.0,
};

/// A recording format the browser or the Mac app sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioType {
    /// `audio/webm` (Chrome, Firefox).
    Webm,
    /// `audio/mp4` (Safari, the Mac app).
    Mp4,
    /// `audio/ogg`.
    Ogg,
    /// `audio/wav`.
    Wav,
}

impl AudioType {
    /// The type of a `Content-Type` value; parameters such as `;codecs=opus` are ignored.
    pub fn from_content_type(raw: &str) -> Option<Self> {
        let essence = raw.split(';').next().unwrap_or_default().trim();
        match essence.to_ascii_lowercase().as_str() {
            "audio/webm" => Some(Self::Webm),
            "audio/mp4" => Some(Self::Mp4),
            "audio/ogg" => Some(Self::Ogg),
            "audio/wav" => Some(Self::Wav),
            _ => None,
        }
    }

    /// File extension for the temporary copy.
    pub fn ext(self) -> &'static str {
        match self {
            Self::Webm => "webm",
            Self::Mp4 => "m4a",
            Self::Ogg => "ogg",
            Self::Wav => "wav",
        }
    }
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// Checks a recording before it is written anywhere.
///
/// # Errors
/// `VALIDATION_FAILED` when the type is missing or unknown, the body is empty, or it is larger
/// than [`MAX_AUDIO_BYTES`].
pub fn check_audio(content_type: Option<&str>, len: usize) -> Result<AudioType, AppError> {
    let kind = content_type
        .and_then(AudioType::from_content_type)
        .ok_or_else(|| invalid("send audio/webm, audio/mp4, audio/ogg or audio/wav"))?;
    if len == 0 {
        return Err(invalid("the recording is empty"));
    }
    if len > MAX_AUDIO_BYTES {
        return Err(invalid("the recording is larger than 10 MB"));
    }
    Ok(kind)
}

/// The turns' texts joined with single spaces and trimmed; `""` when nothing was said.
pub fn spoken_text(turns: &[RawTurn]) -> String {
    turns
        .iter()
        .map(|t| t.text.trim())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(text: &str) -> RawTurn {
        RawTurn {
            start_ms: 0,
            end_ms: 1,
            text: text.into(),
            speaker: None,
        }
    }

    #[test]
    fn the_four_audio_types_are_accepted_with_or_without_parameters() {
        let cases = [
            ("audio/webm;codecs=opus", AudioType::Webm),
            ("audio/mp4", AudioType::Mp4),
            ("Audio/OGG; codecs=vorbis", AudioType::Ogg),
            ("audio/wav", AudioType::Wav),
        ];
        for (raw, want) in cases {
            assert_eq!(check_audio(Some(raw), 10).unwrap(), want, "{raw}");
        }
        assert_eq!(AudioType::Mp4.ext(), "m4a");
    }

    #[test]
    fn a_missing_or_unknown_type_is_refused() {
        for raw in [None, Some("video/mp4"), Some("application/json"), Some("")] {
            let err = check_audio(raw, 10).unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationFailed, "{raw:?}");
        }
    }

    #[test]
    fn an_empty_or_oversized_recording_is_refused_and_ten_mib_is_accepted() {
        assert!(check_audio(Some("audio/wav"), 0).is_err());
        assert!(check_audio(Some("audio/wav"), MAX_AUDIO_BYTES).is_ok());
        let err = check_audio(Some("audio/wav"), MAX_AUDIO_BYTES + 1).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationFailed);
        assert!(err.message.contains("10 MB"));
    }

    #[test]
    fn turns_join_with_single_spaces_and_silence_is_empty() {
        let turns = [turn("  make a short "), turn(""), turn("of the beach  ")];
        assert_eq!(spoken_text(&turns), "make a short of the beach");
        assert_eq!(spoken_text(&[]), "");
        assert_eq!(spoken_text(&[turn("   ")]), "");
    }

    #[test]
    fn only_the_first_minute_is_heard() {
        assert_eq!((HEARD.start_s, HEARD.end_s), (0.0, 60.0));
    }
}
