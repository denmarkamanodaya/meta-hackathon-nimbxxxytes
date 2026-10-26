//! Accepted upload media: file extension and MIME type checks.

use crate::error::{AppError, ErrorCode};

/// Container extension of an original upload; lower case, one of the accepted video types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaExt {
    /// MPEG-4 (`.mp4`), what the glasses and most phones export.
    Mp4,
    /// QuickTime (`.mov`), iPhone camera originals.
    Mov,
    /// Apple MPEG-4 variant (`.m4v`).
    M4v,
}

impl MediaExt {
    /// Reads the extension from a client file name, case-insensitive.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` when the name has no extension or it is not `mp4`, `mov` or `m4v`.
    pub fn from_filename(filename: &str) -> Result<Self, AppError> {
        let ext = filename
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase());
        match ext.as_deref() {
            Some("mp4") => Ok(Self::Mp4),
            Some("mov") => Ok(Self::Mov),
            Some("m4v") => Ok(Self::M4v),
            _ => Err(AppError::new(
                ErrorCode::ValidationFailed,
                "only .mp4, .mov and .m4v videos are accepted",
            )),
        }
    }

    /// Parses a stored extension (`mp4`, `mov`, `m4v`).
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for anything else.
    pub fn parse(ext: &str) -> Result<Self, AppError> {
        Self::from_filename(&format!(".{ext}"))
    }

    /// The extension without the dot.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mov => "mov",
            Self::M4v => "m4v",
        }
    }
}

/// Checks the client's MIME type is a video type.
///
/// # Errors
/// `VALIDATION_FAILED` when `content_type` does not start with `video/`.
pub fn check_video_content_type(content_type: &str) -> Result<(), AppError> {
    if content_type.starts_with("video/") && content_type.len() <= 100 {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::ValidationFailed,
            "content_type must be a video/* type",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_extension_case_insensitively() {
        assert_eq!(
            MediaExt::from_filename("IMG_0001.MOV").unwrap(),
            MediaExt::Mov
        );
        assert_eq!(
            MediaExt::from_filename("clip.v2.mp4").unwrap(),
            MediaExt::Mp4
        );
        assert_eq!(MediaExt::parse("m4v").unwrap().as_str(), "m4v");
    }

    #[test]
    fn rejects_other_or_missing_extensions() {
        for name in ["clip", "clip.webm", "clip.mp4.exe", ".", "mp4"] {
            assert!(MediaExt::from_filename(name).is_err(), "{name}");
        }
    }

    #[test]
    fn content_type_must_be_video() {
        assert!(check_video_content_type("video/quicktime").is_ok());
        assert!(check_video_content_type("image/png").is_err());
    }
}
