//! The one voice path: every text the narrator speaks (an iGuide step, an iRead answer or
//! document part) is first written out as plain words ([`speakable`]), spoken clause by clause,
//! and joined into one WAV with a pause before each clause and a longer one before each sentence.

use std::path::Path;

use crate::domain::speech::{Clause, speakable};
use crate::domain::wav::join_wavs;
use crate::error::{AppError, ErrorCode};
use crate::keys::{DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{BlobStore, Narrator, PutFile, Scratch};

/// `text` spoken as one WAV.
///
/// # Errors
/// `VALIDATION_FAILED` when nothing in `text` can be said; narrator and join errors.
pub async fn narrate(narrator: &dyn Narrator, text: &str) -> Result<Vec<u8>, AppError> {
    let clauses: Vec<Clause> = speakable(text);
    if clauses.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "nothing to read aloud",
        ));
    }
    let mut parts = Vec::with_capacity(clauses.len());
    for c in clauses {
        parts.push((c.pause_ms, narrator.speak(&c.text).await?));
    }
    join_wavs(&parts)
}

/// Where a stored voice goes: its key and the working file it is written to first.
#[derive(Debug, Clone, Copy)]
pub struct VoiceFile<'a> {
    /// The WAV's key; a key that is already stored is not spoken again (the key names the text).
    pub key: &'a ObjectKey,
    /// The working file, removed once uploaded.
    pub work: &'a Path,
}

/// `text` spoken and stored at `file.key`, unless that key is already stored.
///
/// # Errors
/// Narrator, scratch and storage errors.
pub async fn store_voice(
    narrator: &dyn Narrator,
    (blobs, scratch): (&dyn BlobStore, &dyn Scratch),
    file: VoiceFile<'_>,
    text: &str,
) -> Result<(), AppError> {
    match blobs.object_size(file.key).await {
        Ok(_) => return Ok(()),
        Err(e) if e.code == ErrorCode::NotFound => {}
        Err(e) => return Err(e),
    }
    let wav = narrate(narrator, text).await?;
    scratch.write_file(file.work, &wav).await?;
    let put = PutFile {
        key: file.key,
        path: file.work,
        content_type: "audio/wav",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    blobs.put_file(put).await?;
    scratch.remove_file(file.work).await
}
