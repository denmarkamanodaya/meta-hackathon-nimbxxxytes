//! Which server a build talks to and where it keeps its data. Both are fixed per build (owner
//! ruling 2026-10-27: never asked). Dev builds never share app data, Keychain items or the sync
//! folder with the installed release app, so a dev run cannot change the owner's real setup.

use std::path::{Path, PathBuf};

use crate::core::server_url::BuildKind;

/// Server of every dev build: the local stack behind Caddy.
pub const DEV_SERVER: &str = "https://localhost";

/// The server and data locations of one build kind.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    /// `scheme://host[:port]` of the API; `None` for a release build made without one.
    pub server: Option<String>,
    /// Folder of `settings.json` and `state.json`.
    pub support_dir: PathBuf,
    /// Keychain service of the session item.
    pub keychain_service: &'static str,
    /// The sync folder.
    pub default_folder: PathBuf,
}

/// The profile for `build` under the home folder `home`. `release_server` is the build-time
/// `NIMBYTES_SERVER_URL`; release builds use only it (never a saved setting).
pub fn profile(build: BuildKind, home: &Path, release_server: Option<&str>) -> Profile {
    let (name, keychain_service, server) = match build {
        BuildKind::Release => (
            "nimbytes",
            "dev.denmarkamanodaya.nimbytes",
            release_server.map(|s| s.trim_end_matches('/').to_owned()),
        ),
        BuildKind::Dev => (
            "nimbytes-dev",
            "dev.denmarkamanodaya.nimbytes.dev",
            Some(DEV_SERVER.to_owned()),
        ),
    };
    Profile {
        server,
        support_dir: home.join("Library/Application Support").join(name),
        keychain_service,
        default_folder: home.join(name),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_and_release_builds_never_share_data() {
        let home = Path::new("/Users/me");
        let release = profile(BuildKind::Release, home, Some("https://judge.example/"));
        let dev = profile(BuildKind::Dev, home, Some("https://judge.example"));
        assert_eq!(release.server.as_deref(), Some("https://judge.example"));
        assert_eq!(dev.server.as_deref(), Some("https://localhost"));
        assert_eq!(profile(BuildKind::Release, home, None).server, None);
        assert_eq!(
            release.support_dir,
            Path::new("/Users/me/Library/Application Support/nimbytes")
        );
        assert_eq!(release.default_folder, Path::new("/Users/me/nimbytes"));
        assert_eq!(release.keychain_service, "dev.denmarkamanodaya.nimbytes");
        assert_eq!(
            dev.support_dir,
            Path::new("/Users/me/Library/Application Support/nimbytes-dev")
        );
        assert_eq!(dev.default_folder, Path::new("/Users/me/nimbytes-dev"));
        assert_eq!(dev.keychain_service, "dev.denmarkamanodaya.nimbytes.dev");
    }
}
