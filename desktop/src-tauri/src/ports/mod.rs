//! Driven ports: what the app's services need from the machine. Adapters in `adapters/`
//! implement them; services and commands see only these traits.

use crate::core::error::DesktopResult;

/// Where the signed `nb_session` cookie value is kept (the macOS Keychain in the app).
pub trait SessionStore: Send + Sync {
    /// The saved value, or `None` when signed out.
    ///
    /// # Errors
    /// `KEYCHAIN` when the store cannot be read.
    fn get(&self) -> DesktopResult<Option<String>>;

    /// Saves the value.
    ///
    /// # Errors
    /// `KEYCHAIN` when the store refuses the write.
    fn set(&self, value: &str) -> DesktopResult<()>;

    /// Forgets the value; fine when none was saved.
    ///
    /// # Errors
    /// `KEYCHAIN` when the store refuses the delete.
    fn clear(&self) -> DesktopResult<()>;
}

/// Moves files to the macOS Trash; the app never hard-deletes.
pub trait Trash: Send + Sync {
    /// Moves one file or folder to the Trash.
    ///
    /// # Errors
    /// `IO` when the move fails.
    fn trash(&self, path: &std::path::Path) -> DesktopResult<()>;
}

/// Wall-clock time, injected so the pure rules stay testable.
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch.
    fn now_ms(&self) -> u64;
}

/// Shows a macOS notification.
pub trait Notifier: Send + Sync {
    /// Posts one notification; failures are ignored (a notification is a courtesy).
    fn notify(&self, title: &str, body: &str);
}

/// Finder and app launching.
pub trait Desktop: Send + Sync {
    /// Whether an app with this name is installed (for example `Final Cut Pro`).
    fn has_app(&self, name: &str) -> bool;

    /// Opens a file with the named app.
    ///
    /// # Errors
    /// `IO` when the app does not start.
    fn open_with(&self, path: &std::path::Path, app: &str) -> DesktopResult<()>;

    /// Selects the file (or opens the folder) in Finder.
    ///
    /// # Errors
    /// `IO` when Finder cannot be asked.
    fn reveal(&self, path: &std::path::Path) -> DesktopResult<()>;
}

/// The bytes of a streamed file of the drive (a clip's original or a short's render).
#[async_trait::async_trait]
pub trait RangeSource: Send + Sync {
    /// Bytes `[start, start + len)`.
    ///
    /// # Errors
    /// `NETWORK`, `BAD_STATUS`, `URL_EXPIRED` or `SIZE_MISMATCH` when the bytes do not arrive whole.
    async fn range(
        &self,
        media: &crate::core::drive::Media,
        start: u64,
        len: u64,
    ) -> DesktopResult<Vec<u8>>;

    /// The full size of a file, for media the manifest has no size for (renders).
    ///
    /// # Errors
    /// Same as [`Self::range`].
    async fn size(&self, media: &crate::core::drive::Media) -> DesktopResult<u64>;
}

/// Mounts the drive's NFS export as a folder.
pub trait Mounter: Send + Sync {
    /// Whether something is mounted at `path`.
    fn is_mounted(&self, path: &std::path::Path) -> bool;

    /// Mounts `127.0.0.1:/<export>` served on `port` at `path` (an existing, empty folder).
    ///
    /// # Errors
    /// `IO` when the mount fails.
    fn mount(&self, port: u16, export: &str, path: &std::path::Path) -> DesktopResult<()>;

    /// Unmounts `path`; `force` also drops a mount whose server is gone.
    ///
    /// # Errors
    /// `IO` when the unmount fails.
    fn unmount(&self, path: &std::path::Path, force: bool) -> DesktopResult<()>;
}

/// Free and total bytes of the disk that holds a folder.
pub trait DiskSpace: Send + Sync {
    /// `(free, total)` bytes, or `None` when the disk can't be asked.
    fn space(&self, path: &std::path::Path) -> Option<(u64, u64)>;
}
