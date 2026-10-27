//! The build kind and the API path rule: paths from the web layer must stay under `/api/`.

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};

/// Whether a dev build is running (decided once in the composition root).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildKind {
    /// `cargo tauri dev`: http to localhost allowed.
    Dev,
    /// The DMG: https only.
    Release,
}

/// Checks an API path from the web layer: it must start with `/api/` and never climb out.
///
/// # Errors
/// `BAD_PATH` otherwise.
pub fn check_api_path(path: &str) -> DesktopResult<&str> {
    let ok = path.starts_with("/api/") && !path.contains("..") && !path.contains("://");
    if ok {
        Ok(path)
    } else {
        Err(DesktopError::new(
            ErrorCode::BadPath,
            format!("not an API path: {path}"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_paths_stay_under_api() {
        assert!(check_api_path("/api/clips?x=1").is_ok());
        assert!(check_api_path("/apix").is_err());
        assert!(check_api_path("/api/../etc").is_err());
        assert!(check_api_path("https://evil/api/").is_err());
    }
}
