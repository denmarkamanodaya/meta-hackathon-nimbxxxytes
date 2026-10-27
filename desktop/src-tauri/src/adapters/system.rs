//! [`Trash`] on the macOS Trash, [`Clock`] on the system clock and [`Desktop`] on `open`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::{Clock, Desktop, Trash};

/// Moves files to the Trash with the `trash` crate (Finder's "Put Back" works).
pub struct MacTrash;

impl Trash for MacTrash {
    fn trash(&self, path: &Path) -> DesktopResult<()> {
        if !path.exists() {
            return Ok(());
        }
        trash::delete(path).map_err(|e| DesktopError::new(ErrorCode::Io, format!("trash: {e}")))
    }
}

/// The system clock.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
            .unwrap_or(0)
    }
}

/// [`Desktop`] through macOS `open`.
pub struct MacDesktop;

impl MacDesktop {
    fn open(args: &[&std::ffi::OsStr]) -> DesktopResult<()> {
        let status = std::process::Command::new("/usr/bin/open")
            .args(args)
            .status()
            .map_err(|e| DesktopError::new(ErrorCode::Io, format!("open: {e}")))?;
        if status.success() {
            Ok(())
        } else {
            Err(DesktopError::new(
                ErrorCode::Io,
                format!("open exited with {status}"),
            ))
        }
    }
}

impl Desktop for MacDesktop {
    fn has_app(&self, name: &str) -> bool {
        let bundle = format!("{name}.app");
        let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
        let mut dirs = vec![std::path::PathBuf::from("/Applications")];
        dirs.extend(home.map(|h| h.join("Applications")));
        dirs.iter().any(|d| d.join(&bundle).is_dir())
    }

    fn open_with(&self, path: &Path, app: &str) -> DesktopResult<()> {
        Self::open(&["-a".as_ref(), app.as_ref(), path.as_os_str()])
    }

    fn reveal(&self, path: &Path) -> DesktopResult<()> {
        if path.is_dir() {
            Self::open(&[path.as_os_str()])
        } else {
            Self::open(&["-R".as_ref(), path.as_os_str()])
        }
    }
}
