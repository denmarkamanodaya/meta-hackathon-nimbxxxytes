//! A document's texts spoken through the shared voice path ([`narrate`]), stored once per text
//! (`voice_{hash}.wav`) and recorded so Delete finds it.

use super::DocumentPorts;
use crate::domain::document::Document;
use crate::domain::guide::{VOICE, narration_hash};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::usecases::narrate::{VoiceFile, store_voice};

/// A text's voice: its signed URL, or why there is none (no narrator, nothing speakable, a
/// failed pass), so the caller still answers with the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Spoken {
    /// The WAV, signed.
    Url(String),
    /// Why no voice was made.
    Skipped(String),
}

impl Spoken {
    /// The URL, if there is one.
    pub fn url(&self) -> Option<&str> {
        match self {
            Self::Url(u) => Some(u),
            Self::Skipped(_) => None,
        }
    }
}

/// The stored voice of `text` (made and stored when it is new) and its key.
///
/// # Errors
/// `INTERNAL` without a narrator; narrator, scratch, storage and store errors.
pub(crate) async fn voice_of(
    p: &DocumentPorts,
    doc: &Document,
    text: &str,
) -> Result<ObjectKey, AppError> {
    let narrator = p
        .narrator
        .as_deref()
        .ok_or_else(|| AppError::new(ErrorCode::Internal, "the narrator is off"))?;
    let hash = narration_hash(VOICE, text);
    let key = keys::document_voice(&doc.user_id, &doc.id, &hash);
    let work = p
        .scratch
        .document_dir(&doc.id)
        .await?
        .join(format!("voice_{hash}.wav"));
    let file = VoiceFile {
        key: &key,
        work: &work,
    };
    store_voice(narrator, (p.blobs.as_ref(), p.scratch.as_ref()), file, text).await?;
    p.store.add_voice(&doc.id, &key).await?;
    Ok(key)
}

/// [`voice_of`] signed; any failure becomes [`Spoken::Skipped`] with its message.
pub(crate) async fn spoken(p: &DocumentPorts, doc: &Document, text: &str) -> Spoken {
    let signed = async {
        let key = voice_of(p, doc, text).await?;
        p.blobs.presign_get(&key, p.url_ttl).await
    };
    match signed.await {
        Ok(url) => Spoken::Url(url),
        Err(e) => Spoken::Skipped(e.message),
    }
}
