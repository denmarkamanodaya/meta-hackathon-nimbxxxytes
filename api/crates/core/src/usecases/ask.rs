//! The ask box: a spoken request becomes text, and a request becomes an intent the box can run.

use std::path::Path;
use std::sync::Arc;

use crate::domain::clip::ClipStatus;
use crate::domain::ids::{ClipId, UserId};
use crate::domain::intent::{
    AskClip, AskProject, Intent, IntentRequest, checked_clips, checked_text, settle,
};
use crate::domain::voice::{HEARD, check_audio, spoken_text};
use crate::error::{AppError, ErrorCode};
use crate::ports::{
    Catalogue, IdGenerator, IntentReader, MediaTool, ProjectStore, Scratch, Transcriber,
};
use crate::usecases::clips::owned_clip;

/// Every port the ask box uses, bound once by the composition root.
#[derive(Clone)]
pub struct AskPorts {
    /// Clips (ownership, titles, the library count).
    pub catalogue: Arc<dyn Catalogue>,
    /// The caller's projects.
    pub projects: Arc<dyn ProjectStore>,
    /// Where a recording waits while it is transcribed.
    pub scratch: Arc<dyn Scratch>,
    /// Recording to 16 kHz WAV.
    pub media: Arc<dyn MediaTool>,
    /// Voice Transcribe.
    pub transcriber: Arc<dyn Transcriber>,
    /// Muse Spark reads the request.
    pub intents: Arc<dyn IntentReader>,
    /// Names the temporary files.
    pub ids: Arc<dyn IdGenerator>,
}

/// A recording as it arrived.
#[derive(Debug, Clone, Copy)]
pub struct VoiceNote<'a> {
    /// The `Content-Type` header, if any.
    pub content_type: Option<&'a str>,
    /// The raw bytes.
    pub bytes: &'a [u8],
}

/// What was said in the recording's first minute, turns joined with spaces; `""` for silence.
/// The temporary files are removed whatever happens.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty, oversized or unknown recording, or one ffmpeg cannot read;
/// `MODEL_UNAVAILABLE` when Transcribe fails.
pub async fn transcribe_voice(p: &AskPorts, note: VoiceNote<'_>) -> Result<String, AppError> {
    let kind = check_audio(note.content_type, note.bytes.len())?;
    let dir = p.scratch.voice_dir().await?;
    let id = p.ids.new_id();
    let src = dir.join(format!("{id}.{}", kind.ext()));
    let wav = dir.join(format!("{id}.wav"));
    let heard = listen(p, note.bytes, &src, &wav).await;
    let cleaned = (
        p.scratch.remove_file(&src).await,
        p.scratch.remove_file(&wav).await,
    );
    let text = heard?;
    cleaned.0?;
    cleaned.1?;
    Ok(text)
}

async fn listen(p: &AskPorts, bytes: &[u8], src: &Path, wav: &Path) -> Result<String, AppError> {
    p.scratch.write_file(src, bytes).await?;
    p.media
        .extract_wav(src, HEARD, wav)
        .await
        .map_err(|e| match e.code {
            ErrorCode::MediaFailed => AppError::new(
                ErrorCode::ValidationFailed,
                "the recording could not be read",
            ),
            _ => e,
        })?;
    let turns = p.transcriber.transcribe(wav).await?;
    Ok(spoken_text(&turns))
}

/// What the request asks for, held to the intent rules.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long request or more than 20 clips; `NOT_FOUND` /
/// `FORBIDDEN` when an added clip is missing or another user's; `MODEL_UNAVAILABLE` when Spark
/// fails.
pub async fn read_intent(
    p: &AskPorts,
    user: &UserId,
    (text, clips): (&str, &[ClipId]),
) -> Result<Intent, AppError> {
    let text = checked_text(text)?;
    let clips = added_clips(p, user, &checked_clips(clips)?).await?;
    let projects = p
        .projects
        .list(user)
        .await?
        .into_iter()
        .map(|s| AskProject {
            id: s.project.id,
            name: s.project.name,
            clip_count: s.clip_count,
        })
        .collect();
    let request = IntentRequest {
        text,
        projects,
        clips,
        library_clips: library_count(p, user).await?,
    };
    let draft = p.intents.read_intent(&request).await?;
    Ok(settle(&draft, &request))
}

/// Each added clip, checked to be the caller's, as the model sees it.
async fn added_clips(
    p: &AskPorts,
    user: &UserId,
    ids: &[ClipId],
) -> Result<Vec<AskClip>, AppError> {
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let clip = owned_clip(p.catalogue.as_ref(), user, id).await?;
        out.push(AskClip {
            title: clip.title.clone().unwrap_or_else(|| clip.filename.clone()),
            duration_s: clip.probe.as_ref().map(|pr| pr.duration_s),
            id: clip.id,
        });
    }
    Ok(out)
}

/// The caller's clips, leaving out failed ones and duplicates.
async fn library_count(p: &AskPorts, user: &UserId) -> Result<u32, AppError> {
    let clips = p.catalogue.list_clips(user).await?;
    let n = clips
        .iter()
        .filter(|c| !matches!(c.status, ClipStatus::Failed | ClipStatus::Duplicate))
        .count();
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}
