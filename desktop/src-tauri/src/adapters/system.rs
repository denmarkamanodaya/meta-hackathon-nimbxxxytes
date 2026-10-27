//! [`Trash`] on the macOS Trash, [`Clock`] on the system clock and [`Desktop`] on `open`.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::{Clock, Desktop, DiskSpace, Mounter, Trash};

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

/// NFS mount options: NFS v3 over TCP on the app's port, no lock daemon, and a soft mount
/// (5 s timeout, 3 tries) so Finder gets an error instead of hanging if the app stops serving.
/// Attributes are cached 2 s, so "on disk" sizes follow playback quickly.
const MOUNT_OPTIONS: &str = "vers=3,tcp,nolocks,locallocks,soft,intr,timeo=50,retrans=3,actimeo=2";

/// Whether `mount`'s output lists something mounted at `path`.
pub fn mount_table_has(output: &str, path: &Path) -> bool {
    let on = format!(" on {} (", path.display());
    output.lines().any(|line| line.contains(&on))
}

/// [`Mounter`] through macOS `mount_nfs` and `umount` (no root needed for the user's own folder).
pub struct MacMounter;

fn run(program: &str, args: &[&std::ffi::OsStr]) -> DesktopResult<()> {
    let out = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(|e| DesktopError::new(ErrorCode::Io, format!("{program}: {e}")))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(DesktopError::new(
            ErrorCode::Io,
            format!("{program}: {}", err.trim()),
        ))
    }
}

impl Mounter for MacMounter {
    fn is_mounted(&self, path: &Path) -> bool {
        std::process::Command::new("/sbin/mount")
            .output()
            .is_ok_and(|out| mount_table_has(&String::from_utf8_lossy(&out.stdout), path))
    }

    fn mount(&self, port: u16, export: &str, path: &Path) -> DesktopResult<()> {
        let options = format!("{MOUNT_OPTIONS},port={port},mountport={port}");
        let source = format!("127.0.0.1:/{export}");
        run(
            "/sbin/mount_nfs",
            &[
                "-o".as_ref(),
                options.as_ref(),
                source.as_ref(),
                path.as_os_str(),
            ],
        )
    }

    fn unmount(&self, path: &Path, force: bool) -> DesktopResult<()> {
        if force {
            run("/sbin/umount", &["-f".as_ref(), path.as_os_str()])
        } else {
            run("/sbin/umount", &[path.as_os_str()])
        }
    }
}

/// `(free, total)` bytes from `df -k` output: the last line's available and size columns.
pub fn parse_df(output: &str) -> Option<(u64, u64)> {
    let cols: Vec<&str> = output.lines().last()?.split_whitespace().collect();
    let total: u64 = cols.get(1)?.parse().ok()?;
    let free: u64 = cols.get(3)?.parse().ok()?;
    Some((free * 1024, total * 1024))
}

/// [`DiskSpace`] through `df -k`.
pub struct MacDiskSpace;

impl DiskSpace for MacDiskSpace {
    fn space(&self, path: &Path) -> Option<(u64, u64)> {
        let out = std::process::Command::new("/bin/df")
            .args(["-k".as_ref(), path.as_os_str()])
            .output()
            .ok()?;
        parse_df(&String::from_utf8_lossy(&out.stdout))
    }
}

/// Bytes of every regular file under `dir`, nested folders included. Symlinks are not followed,
/// and an unreadable or missing entry counts as 0, so a half-written download never fails a
/// status push.
pub fn folder_bytes(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => folder_bytes(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_bytes_sums_nested_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Originals/deep")).unwrap();
        std::fs::write(dir.path().join("Originals/a.mov"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.path().join("Originals/deep/b.mov"), vec![0u8; 234]).unwrap();
        std::fs::write(dir.path().join("state.json"), b"{}").unwrap();
        assert_eq!(folder_bytes(dir.path()), 1236);
    }

    #[test]
    fn df_gives_free_and_total_bytes() {
        let out = "Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s5 482797652 367721880 84299968 82% 5090718 842999680 1% /System/Volumes/Data\n";
        assert_eq!(parse_df(out), Some((84_299_968 * 1024, 482_797_652 * 1024)));
        assert_eq!(parse_df(""), None);
    }

    #[test]
    fn the_mount_table_names_the_mounted_folder_only() {
        let out = "/dev/disk3s1s1 on / (apfs, sealed, local)\n127.0.0.1:/nimbytes on /Users/me/nimbytes (nfs, nodev, nosuid, mounted by me)\n";
        assert!(mount_table_has(out, Path::new("/Users/me/nimbytes")));
        assert!(!mount_table_has(out, Path::new("/Users/me/nimbytes-dev")));
        assert!(!mount_table_has(out, Path::new("/Users/me")));
    }

    #[test]
    fn folder_bytes_is_zero_for_an_empty_or_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(folder_bytes(dir.path()), 0);
        assert_eq!(folder_bytes(&dir.path().join("missing")), 0);
    }
}
