//! Speech to text for audio of any length: one Voice Transcribe call per chunk of at most
//! [`MAX_CHUNK_S`](crate::domain::transcript::MAX_CHUNK_S), turns placed back on the whole
//! recording's timeline. Ingest and iListen both hear their WAV this way.

use std::path::Path;

use crate::domain::segmenting::Span;
use crate::domain::transcript::{RawTurn, Turn, chunks, clip_turns};
use crate::error::AppError;
use crate::ports::{MediaTool, Transcriber};

/// The turns of `wav` (16 kHz mono, `duration_s` long). A WAV longer than one chunk is cut into
/// `dir/audio_{i}.wav` pieces first.
///
/// # Errors
/// Media and transcriber errors.
pub async fn chunked_turns(
    (media, transcriber): (&dyn MediaTool, &dyn Transcriber),
    wav: &Path,
    duration_s: f64,
    dir: &Path,
) -> Result<Vec<Turn>, AppError> {
    let pieces: Vec<Span> = chunks(duration_s);
    let mut per_chunk: Vec<Vec<RawTurn>> = Vec::with_capacity(pieces.len());
    if pieces.len() == 1 {
        per_chunk.push(transcriber.transcribe(wav).await?);
    } else {
        for (i, piece) in pieces.iter().enumerate() {
            let chunk = dir.join(format!("audio_{i}.wav"));
            media.extract_wav(wav, *piece, &chunk).await?;
            per_chunk.push(transcriber.transcribe(&chunk).await?);
        }
    }
    Ok(clip_turns(&pieces, &per_chunk))
}
