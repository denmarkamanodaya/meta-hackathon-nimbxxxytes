//! [`Scratch`] on the local file system under `DATA_DIR/work/`.

use std::path::{Path, PathBuf};

use nimbytes_core::domain::ids::{ClipId, DocumentId, ListenId, ShortId, UserId};
use nimbytes_core::ports::{ChunkSource, PortResult, Scratch};
use nimbytes_core::{AppError, ErrorCode};
use tokio::io::AsyncWriteExt;

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

    /// Document ids are safe path segments too; `documents/` keeps them apart from clip ids.
    fn document_path(&self, doc: &DocumentId) -> PathBuf {
        self.root.join("documents").join(doc.as_str())
    }

    /// Listen ids are safe path segments too; `listens/` keeps them apart from clip ids.
    fn listen_path(&self, listen: &ListenId) -> PathBuf {
        self.root.join("listens").join(listen.as_str())
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

/// Writes `source` to `path` until it ends or more than `max` bytes were written.
async fn stream_to(path: &Path, source: &mut dyn ChunkSource, max: u64) -> Result<u64, AppError> {
    let mut file = tokio::fs::File::create(path).await.map_err(io_err)?;
    let mut written = 0u64;
    while let Some(chunk) = source.next_chunk().await? {
        file.write_all(&chunk).await.map_err(io_err)?;
        written += u64::try_from(chunk.len()).unwrap_or(u64::MAX);
        if written > max {
            break;
        }
    }
    file.flush().await.map_err(io_err)?;
    Ok(written)
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
    fn write_file<'a>(&'a self, path: &'a Path, bytes: &'a [u8]) -> PortResult<'a, ()> {
        Box::pin(async move { tokio::fs::write(path, bytes).await.map_err(io_err) })
    }

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

    fn voice_dir(&self) -> PortResult<'_, PathBuf> {
        Box::pin(async move {
            let dir = self.root.join("voice");
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn document_dir<'a>(&'a self, doc: &'a DocumentId) -> PortResult<'a, PathBuf> {
        Box::pin(async move {
            let dir = self.document_path(doc);
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn remove_document_dir<'a>(&'a self, doc: &'a DocumentId) -> PortResult<'a, ()> {
        Box::pin(remove_dir(self.document_path(doc)))
    }

    fn remove_file<'a>(&'a self, path: &'a Path) -> PortResult<'a, ()> {
        Box::pin(async move {
            match tokio::fs::remove_file(path).await {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io_err(e)),
                _ => Ok(()),
            }
        })
    }

    fn listen_dir<'a>(&'a self, listen: &'a ListenId) -> PortResult<'a, PathBuf> {
        Box::pin(async move {
            let dir = self.listen_path(listen);
            tokio::fs::create_dir_all(&dir).await.map_err(io_err)?;
            Ok(dir)
        })
    }

    fn remove_listen_dir<'a>(&'a self, listen: &'a ListenId) -> PortResult<'a, ()> {
        Box::pin(remove_dir(self.listen_path(listen)))
    }

    fn write_stream<'a>(
        &'a self,
        path: &'a Path,
        source: &'a mut dyn ChunkSource,
        max_bytes: u64,
    ) -> PortResult<'a, u64> {
        Box::pin(stream_to(path, source, max_bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hands out `chunks` in order.
    struct Chunks(Vec<Vec<u8>>);

    impl ChunkSource for Chunks {
        fn next_chunk(
            &mut self,
        ) -> nimbytes_core::ports::BoxFuture<'_, Result<Option<Vec<u8>>, AppError>> {
            let next = (!self.0.is_empty()).then(|| self.0.remove(0));
            Box::pin(async move { Ok(next) })
        }
    }

    #[tokio::test]
    async fn a_stream_is_written_whole_or_stopped_just_past_the_limit() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let listen = ListenId::parse("l1").unwrap();
        let dir = scratch.listen_dir(&listen).await.unwrap();
        assert_eq!(dir, root.path().join("work/listens/l1"));
        let path = dir.join("source.mp3");

        let mut whole = Chunks(vec![b"abc".to_vec(), b"de".to_vec()]);
        assert_eq!(scratch.write_stream(&path, &mut whole, 5).await.unwrap(), 5);
        assert_eq!(std::fs::read(&path).unwrap(), b"abcde");

        let mut over = Chunks(vec![b"abc".to_vec(), b"def".to_vec(), b"never".to_vec()]);
        assert_eq!(scratch.write_stream(&path, &mut over, 5).await.unwrap(), 6);
        assert_eq!(over.0, [b"never".to_vec()], "the rest is never read");

        scratch.remove_listen_dir(&listen).await.unwrap();
        scratch.remove_listen_dir(&listen).await.unwrap();
        assert!(!dir.exists());
    }

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

    #[tokio::test]
    async fn the_voice_dir_is_created_and_a_file_in_it_removed_twice_without_error() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));

        let dir = scratch.voice_dir().await.unwrap();
        let file = dir.join("a.webm");
        std::fs::write(&file, b"x").unwrap();
        scratch.remove_file(&file).await.unwrap();

        assert_eq!(dir, root.path().join("work/voice"));
        assert!(!file.exists());
        scratch.remove_file(&file).await.unwrap();
    }

    #[tokio::test]
    async fn a_document_dir_is_created_apart_from_clips_and_removed_twice_without_error() {
        let root = tempfile::tempdir().unwrap();
        let scratch = FsScratch::new(root.path().join("work"));
        let doc = DocumentId::parse("d1").unwrap();

        let dir = scratch.document_dir(&doc).await.unwrap();
        std::fs::write(dir.join("page-1.jpg"), b"x").unwrap();

        assert_eq!(dir, root.path().join("work/documents/d1"));
        scratch.remove_document_dir(&doc).await.unwrap();
        assert!(!dir.exists());
        scratch.remove_document_dir(&doc).await.unwrap();
    }
}
