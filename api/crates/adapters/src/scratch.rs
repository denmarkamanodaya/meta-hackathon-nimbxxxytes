//! [`Scratch`] on the local file system under `DATA_DIR/work/`.

use std::path::{Path, PathBuf};

use nimbytes_core::domain::ids::{ClipId, ShortId, UserId};
use nimbytes_core::ports::{PortResult, Scratch};
use nimbytes_core::{AppError, ErrorCode};

/// Per-clip working directories under one root.
#[derive(Debug, Clone)]
pub struct FsScratch {
    root: PathBuf,
}

impl FsScratch {
    /// Uses `root` (created on demand) for clip directories.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// User ids are safe path segments too; `users/` keeps them apart from clip ids.
    fn user_path(&self, user: &UserId) -> PathBuf {
        self.root.join("users").join(user.as_str())
    }

    /// Short ids are safe path segments too; `shorts/` keeps them apart from clip ids.
    fn short_path(&self, short: &ShortId) -> PathBuf {
        self.root.join("shorts").join(short.as_str())
    }
}

/// Removes a directory tree; one that is already gone is fine.
async fn remove_dir(dir: PathBuf) -> Result<(), AppError> {
    match tokio::fs::remove_dir_all(dir).await {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_err(e)),
        _ => Ok(()),
    }
}

fn io_err(err: std::io::Error) -> AppError {
    AppError::new(ErrorCode::Internal, format!("scratch: {err}"))
}

/// SHA-256 of a file read in 1 MiB chunks, so a large original never sits in memory.
fn file_sha256(path: &Path) -> Result<String, AppError> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(io_err)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf).map_err(io_err)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

impl Scratch for FsScratch {
    fn clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, PathBuf> {
        Box::pin(async move {
            // Clip ids are safe path segments (validated type), so this stays under the root.
            let dir = self.root.join(clip.as_str());
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn short_dir<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, PathBuf> {
        Box::pin(async move {
            let dir = self.short_path(short);
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn sha256<'a>(&'a self, path: &'a Path) -> PortResult<'a, String> {
        Box::pin(async move {
            let path = path.to_owned();
            tokio::task::spawn_blocking(move || file_sha256(&path))
                .await
                .map_err(|e| AppError::new(ErrorCode::Internal, format!("hashing: {e}")))?
        })
    }

    fn exists<'a>(&'a self, path: &'a Path) -> PortResult<'a, bool> {
        Box::pin(async move {
            match tokio::fs::metadata(path).await {
                Ok(meta) => Ok(meta.is_file() && meta.len() > 0),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
                Err(e) => Err(io_err(e)),
            }
        })
    }

    fn remove_clip_dir<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()> {
        Box::pin(remove_dir(self.root.join(clip.as_str())))
    }

    fn user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, PathBuf> {
        Box::pin(async move {
            let dir = self.user_path(user);
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn remove_user_dir<'a>(&'a self, user: &'a UserId) -> PortResult<'a, ()> {
        Box::pin(remove_dir(self.user_path(user)))
    }

    fn remove_short_dir<'a>(&'a self, short: &'a ShortId) -> PortResult<'a, ()> {
        Box::pin(remove_dir(self.short_path(short)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn clip_dirs_are_created_checked_and_removed() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let clip = ClipId::parse("c1").unwrap();

        let dir = scratch.clip_dir(&clip).await.unwrap();
        let file = dir.join("audio.wav");
        assert!(!scratch.exists(&file).await.unwrap());
        std::fs::write(&file, b"").unwrap();
        assert!(
            !scratch.exists(&file).await.unwrap(),
            "an empty file counts as missing"
        );
        std::fs::write(&file, b"RIFF").unwrap();
        assert!(scratch.exists(&file).await.unwrap());

        scratch.remove_clip_dir(&clip).await.unwrap();
        assert!(!dir.exists());
        scratch.remove_clip_dir(&clip).await.unwrap();
    }

    #[tokio::test]
    async fn the_sha256_of_a_file_is_lower_case_hex_across_chunks() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let small = root.path().join("abc");
        std::fs::write(&small, b"abc").unwrap();
        let big = root.path().join("big");
        std::fs::write(&big, vec![b'a'; 1_000_000 * 3]).unwrap();

        assert_eq!(
            scratch.sha256(&small).await.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let expected = {
            use sha2::{Digest, Sha256};
            hex::encode(Sha256::digest(vec![b'a'; 1_000_000 * 3]))
        };
        assert_eq!(
            scratch.sha256(&big).await.unwrap(),
            expected,
            "3 MB spans 3 chunks"
        );
        let missing = scratch.sha256(&root.path().join("nope")).await;
        assert!(missing.is_err());
    }

    #[tokio::test]
    async fn user_dirs_are_created_apart_from_clips_and_removed() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let user = UserId::parse("u1").unwrap();

        let dir = scratch.user_dir(&user).await.unwrap();
        std::fs::write(dir.join("t.jpg"), b"x").unwrap();

        assert_eq!(dir, root.path().join("work/users/u1"));
        scratch.remove_user_dir(&user).await.unwrap();
        assert!(!dir.exists());
        scratch.remove_user_dir(&user).await.unwrap();
    }

    #[tokio::test]
    async fn a_short_dir_and_its_files_are_removed_and_a_missing_one_is_fine() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let short = ShortId::parse("x1").unwrap();
        let other = ShortId::parse("x2").unwrap();
        let dir = scratch.short_dir(&short).await.unwrap();
        let kept = scratch.short_dir(&other).await.unwrap();
        std::fs::write(dir.join("v1.mp4"), b"x").unwrap();

        scratch.remove_short_dir(&short).await.unwrap();

        assert_eq!(dir, root.path().join("work/shorts/x1"));
        assert!(!dir.exists());
        assert!(kept.exists(), "only that short's directory goes");
        scratch.remove_short_dir(&short).await.unwrap();
    }
}
