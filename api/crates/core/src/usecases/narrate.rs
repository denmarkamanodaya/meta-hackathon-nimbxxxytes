//! The one voice path: every text the narrator speaks (an iGuide step, an iRead answer or
//! document part) is first written out as plain words ([`speakable`]), spoken clause by clause,
//! and joined into one WAV with a pause before each clause and a longer one before each sentence.

use crate::domain::speech::{Clause, speakable};
use crate::domain::wav::join_wavs;
use crate::error::{AppError, ErrorCode};
use crate::ports::Narrator;

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
