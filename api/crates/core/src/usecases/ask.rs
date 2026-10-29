//! The ask box: a spoken request becomes text, and a request becomes an intent the box can run.

use std::path::Path;
use std::sync::Arc;

use crate::domain::clip::ClipStatus;
use crate::domain::document::Document;
use crate::domain::ids::{ClipId, DocumentId, UserId};
use crate::domain::intent::{
    AskClip, AskDocument, AskProject, Intent, IntentRequest, LISTED_DOCUMENTS, checked_clips,
    checked_documents, checked_text, settle,
};
use crate::domain::voice::{HEARD, check_audio, spoken_text};
use crate::error::{AppError, ErrorCode};
use crate::ports::{
    Catalogue, DocumentStore, IdGenerator, IntentReader, MediaTool, ProjectStore, Scratch,
    Transcriber,
};
use crate::usecases::clips::owned_clip;
use crate::usecases::documents::owned_document;

/// Every port the ask box uses, bound once by the composition root.
#[derive(Clone)]
pub struct AskPorts {
    /// Clips (ownership, titles, the library count).
    pub catalogue: Arc<dyn Catalogue>,
    /// The caller's projects.
    pub projects: Arc<dyn ProjectStore>,
    /// The caller's iRead documents.
    pub documents: Arc<dyn DocumentStore>,
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

/// What was typed or said, and what was added to the box with +.
#[derive(Debug, Clone, Copy)]
pub struct Ask<'a> {
    /// The request.
    pub text: &'a str,
    /// The added clips.
    pub clips: &'a [ClipId],
    /// The added documents.
    pub documents: &'a [DocumentId],
}

/// What the request asks for, held to the intent rules.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long request, more than 20 clips or more than 5
/// documents; `NOT_FOUND` / `FORBIDDEN` when an added clip or document is missing or another
/// user's; `MODEL_UNAVAILABLE` when Spark fails.
pub async fn read_intent(p: &AskPorts, user: &UserId, ask: Ask<'_>) -> Result<Intent, AppError> {
    let text = checked_text(ask.text)?;
    let clips = added_clips(p, user, &checked_clips(ask.clips)?).await?;
    let documents = ask_documents(p, user, &checked_documents(ask.documents)?).await?;
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
        documents,
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

fn ask_document(d: Document, added: bool) -> AskDocument {
    AskDocument {
        id: d.id,
        title: d.title,
        kind: d.kind,
        sender: d.sender,
        date: d.date,
        added,
    }
}

/// The caller's newest [`LISTED_DOCUMENTS`] documents plus every added one (each checked to be
/// the caller's), the added ones marked.
async fn ask_documents(
    p: &AskPorts,
    user: &UserId,
    added: &[DocumentId],
) -> Result<Vec<AskDocument>, AppError> {
    let mut out = Vec::new();
    for id in added {
        out.push(ask_document(
            owned_document(p.documents.as_ref(), user, id).await?,
            true,
        ));
    }
    let newest = p
        .documents
        .list(user)
        .await?
        .into_iter()
        .take(LISTED_DOCUMENTS);
    for d in newest.filter(|d| !added.contains(&d.id)) {
        out.push(ask_document(d, false));
    }
    Ok(out)
}

/// The caller's clips, leaving out failed ones and copies (exact or near).
async fn library_count(p: &AskPorts, user: &UserId) -> Result<u32, AppError> {
    let clips = p.catalogue.list_clips(user).await?;
    let n = clips
        .iter()
        .filter(|c| c.status != ClipStatus::Failed && !c.is_copy())
        .count();
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}
