//! The server URL rule: https only, except plain http to the Mac itself in a dev build. The URL is
//! kept as `scheme://host[:port]` with no path, so `/api/...` paths join onto it safely.

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};

/// Whether a dev build is running (decided once in the composition root).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildKind {
    /// `cargo tauri dev`: http to localhost allowed.
    Dev,
    /// The DMG: https only.
    Release,
}

/// Normalises a typed server URL to `scheme://host[:port]`.
///
/// # Errors
/// `BAD_SERVER_URL` for anything but https (or http to localhost in a dev build), a path other
/// than `/`, a query, credentials or an empty host.
pub fn normalise_server_url(raw: &str, build: BuildKind) -> DesktopResult<String> {
    let bad = |why: &str| DesktopError::new(ErrorCode::BadServerUrl, why.to_owned());
    let raw = raw.trim().trim_end_matches('/');
    let (scheme, rest) = raw
        .split_once("://")
        .ok_or_else(|| bad("include https://"))?;
    let scheme = scheme.to_ascii_lowercase();
    if rest.is_empty() || rest.contains(['/', '?', '#', '@', ' ']) {
        return Err(bad("use only the address, like https://example.com"));
    }
    let host = rest
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let local = host == "localhost" || host == "127.0.0.1";
    match (scheme.as_str(), build, local) {
        ("https", _, _) | ("http", BuildKind::Dev, true) => {
            Ok(format!("{scheme}://{}", rest.to_ascii_lowercase()))
        }
        _ => Err(bad("the address must start with https://")),
    }
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
    fn https_urls_are_normalised_and_http_is_dev_localhost_only() {
        assert_eq!(
            normalise_server_url(" https://Example.com/ ", BuildKind::Release).unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalise_server_url("http://localhost:8080", BuildKind::Dev).unwrap(),
            "http://localhost:8080"
        );
        assert!(normalise_server_url("http://localhost", BuildKind::Release).is_err());
        assert!(normalise_server_url("http://example.com", BuildKind::Dev).is_err());
        assert!(normalise_server_url("https://example.com/x", BuildKind::Release).is_err());
        assert!(normalise_server_url("https://u@example.com", BuildKind::Release).is_err());
    }

    #[test]
    fn api_paths_stay_under_api() {
        assert!(check_api_path("/api/clips?x=1").is_ok());
        assert!(check_api_path("/apix").is_err());
        assert!(check_api_path("/api/../etc").is_err());
        assert!(check_api_path("https://evil/api/").is_err());
    }
}
