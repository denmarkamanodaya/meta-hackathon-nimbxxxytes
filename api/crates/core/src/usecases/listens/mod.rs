//! iListen: the owner drops in a sound file or a video (or picks a clip), a `listen` job keeps
//! only its audio, transcribes it, has Spark name each line's language, translate it into the
//! output language and summarise it, then checks the translation line by line until it passes
//! (up to [`MAX_VERSIONS`](crate::domain::listen::MAX_VERSIONS) versions). The owner can change
//! the output language later; only understanding, the check and the voice run again.

mod check;
mod hear;
mod run;

use std::sync::Arc;
use std::time::Duration;

use crate::domain::ids::{ClipId, JobId, ListenId, UserId};
use crate::domain::job::JobKind;
use crate::domain::listen::{
    Listen, ListenSource, ListenStart, ListenStatus, ListenTurn, MAX_BYTES, NewListenFile,
    accepted_type, checked_duration, checked_file, checker_notes, listen_title, output_language,
};
use crate::domain::storage_cap::StorageCap;
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{
    BlobStore, Catalogue, ChunkSource, Clock, IdGenerator, JobQueue, ListenInterpreter,
    ListenProgress, ListenStore, MediaTool, Narrator, NewJob, PutFile, Scratch, Transcriber,
    UsageStore,
};
use crate::time::format_utc;
use crate::usecases::storage::{Quota, ensure_room};

/// Every port iListen uses, bound once by the composition root; the request handlers and the
/// `listen` job share it.
#[derive(Clone)]
pub struct ListenPorts {
    /// Listen rows.
    pub store: Arc<dyn ListenStore>,
    /// Private objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Working files.
    pub scratch: Arc<dyn Scratch>,
    /// ffprobe and the WAV.
    pub media: Arc<dyn MediaTool>,
    /// Voice Transcribe.
    pub transcriber: Arc<dyn Transcriber>,
    /// Spark understands, checks and fixes.
    pub interpreter: Arc<dyn ListenInterpreter>,
    /// Clips listened to.
    pub catalogue: Arc<dyn Catalogue>,
    /// The `listen` job.
    pub jobs: Arc<dyn JobQueue>,
    /// MMS-TTS; `None` when `TTS_MODEL_DIR` is unset (no spoken summary then).
    pub narrator: Option<Arc<dyn Narrator>>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Storage measurements for the cap.
    pub usage: Arc<dyn UsageStore>,
    /// The per-account cap.
    pub cap: StorageCap,
    /// Lifetime of the GET URLs handed out.
    pub url_ttl: Duration,
}

/// `POST /api/listens` as the client sent it: a file, or a clip.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenRequest {
    /// The file's name (file only).
    pub filename: Option<String>,
    /// The file's type (file only).
    pub content_type: Option<String>,
    /// The file's size (file only).
    pub size_bytes: Option<u64>,
    /// The clip to listen to instead of a file.
    pub clip_id: Option<String>,
    /// Output language code.
    pub target: String,
}

/// One version as the detail shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionView {
    /// 1 to 3.
    pub version: u32,
    /// Lowest score; `None` while checking.
    pub confidence: Option<u32>,
    /// Summary score; `None` while checking.
    pub summary_score: Option<u32>,
    /// Whether it passed.
    pub passed: bool,
    /// Flagged lines and summary issues.
    pub notes: Vec<String>,
}

/// A whole listen.
#[derive(Debug, Clone, PartialEq)]
pub struct ListenDetailView {
    /// The row.
    pub listen: Listen,
    /// Every line.
    pub turns: Vec<ListenTurn>,
    /// Every version, oldest first.
    pub versions: Vec<VersionView>,
    /// The spoken summary, signed.
    pub summary_audio_url: Option<String>,
}

/// A body the client sent through the API.
pub struct SourceBody<'a> {
    /// The request's `Content-Type`, if any.
    pub content_type: Option<&'a str>,
    /// The body, read piece by piece.
    pub chunks: &'a mut dyn ChunkSource,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

fn now(p: &ListenPorts) -> String {
    format_utc(p.clock.now_millis())
}

/// `user`'s listen.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn owned_listen(
    store: &dyn ListenStore,
    user: &UserId,
    id: &ListenId,
) -> Result<Listen, AppError> {
    let listen = store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such recording"))?;
    if &listen.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "recording belongs to another user",
        ));
    }
    Ok(listen)
}

/// The start of a listen of `clip`: `user`'s clip, with sound, at most 2 hours long.
async fn clip_start(
    p: &ListenPorts,
    user: &UserId,
    clip: &str,
    target: String,
) -> Result<ListenStart, AppError> {
    let id = ClipId::parse(clip)?;
    let clip = p
        .catalogue
        .get_clip(&id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such clip"))?;
    if &clip.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "clip belongs to another user",
        ));
    }
    let probe = clip
        .probe
        .as_ref()
        .ok_or_else(|| invalid("the clip is still being processed"))?;
    if !probe.has_audio {
        return Err(invalid("the clip has no sound"));
    }
    checked_duration(probe.duration_s)?;
    Ok(ListenStart {
        source: ListenSource::Clip,
        clip_id: Some(id),
        source_name: clip.title.clone().unwrap_or(clip.filename),
        content_type: String::new(),
        ext: String::new(),
        size_bytes: 0,
        target,
    })
}

/// The start of a listen of a file, after its checks and the account's room for it.
async fn file_start(
    p: &ListenPorts,
    user: &UserId,
    req: ListenRequest,
    target: String,
) -> Result<ListenStart, AppError> {
    let (Some(filename), Some(content_type), Some(size_bytes)) =
        (req.filename, req.content_type, req.size_bytes)
    else {
        return Err(invalid(
            "send filename, content_type and size_bytes, or a clip_id",
        ));
    };
    let file = NewListenFile {
        filename,
        content_type,
        size_bytes,
    };
    let ext = checked_file(&file)?;
    let quota = Quota {
        usage: p.usage.as_ref(),
        cap: p.cap,
    };
    ensure_room(
        quota,
        (p.blobs.as_ref(), p.clock.as_ref()),
        user,
        file.size_bytes,
    )
    .await?;
    Ok(ListenStart {
        source: ListenSource::File,
        clip_id: None,
        source_name: file.filename,
        content_type: file.content_type,
        ext,
        size_bytes: file.size_bytes,
        target,
    })
}

/// Creates a listen: a file starts `uploading` (PUT the source next); a clip starts
/// `listening` at once.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad language, file or clip; `NOT_FOUND` / `FORBIDDEN` for the clip;
/// `STORAGE_FULL` past the cap; store and queue errors.
pub async fn create_listen(
    p: &ListenPorts,
    user: &UserId,
    req: ListenRequest,
) -> Result<Listen, AppError> {
    let target = output_language(&req.target)?.code.to_owned();
    let start = match req.clip_id.clone() {
        Some(clip) => clip_start(p, user, &clip, target).await?,
        None => file_start(p, user, req, target).await?,
    };
    let status = match start.source {
        ListenSource::File => ListenStatus::Uploading,
        ListenSource::Clip => ListenStatus::Listening,
    };
    let id = ListenId::parse(p.ids.new_id())?;
    let listen = Listen::new((id, user.clone()), start, status, &now(p));
    p.store.create(&listen).await?;
    if status == ListenStatus::Listening {
        queue_listen(p, &listen.id).await?;
    }
    Ok(listen)
}

/// Marks the listen `listening` and queues its job (a finished or failed one runs again from its
/// first step; the audio and transcript steps skip what is already there).
async fn queue_listen(p: &ListenPorts, id: &ListenId) -> Result<(), AppError> {
    set_listening(p, id).await?;
    let ms = p.clock.now_millis();
    enqueue(p, id).await?;
    p.jobs.restart(JobKind::Listen, id.as_str(), ms).await
}

async fn set_listening(p: &ListenPorts, id: &ListenId) -> Result<(), AppError> {
    let at = now(p);
    let progress = ListenProgress {
        status: ListenStatus::Listening,
        error: None,
        at: &at,
    };
    p.store.set_progress(id, progress).await
}

async fn enqueue(p: &ListenPorts, id: &ListenId) -> Result<(), AppError> {
    let job = JobId::parse(p.ids.new_id())?;
    let new = NewJob {
        id: &job,
        kind: JobKind::Listen,
        subject_id: id.as_str(),
    };
    p.jobs.enqueue(new, p.clock.now_millis()).await
}

/// The file is uploaded: checks it is there and at most 300 MB, then queues the job.
/// Idempotent: a listen in progress or done answers its status; a failed one runs again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` when nothing was uploaded or the file is too
/// large; store and queue errors.
pub async fn complete_listen(
    p: &ListenPorts,
    user: &UserId,
    id: &ListenId,
) -> Result<ListenStatus, AppError> {
    let listen = owned_listen(p.store.as_ref(), user, id).await?;
    match listen.status {
        ListenStatus::Listening | ListenStatus::Ready => return Ok(listen.status),
        ListenStatus::Failed => {}
        ListenStatus::Uploading => {
            let key = keys::listen_source(user, id, &listen.ext);
            let size = match p.blobs.object_size(&key).await {
                Err(e) if e.code == ErrorCode::NotFound => {
                    return Err(invalid("upload the file before completing"));
                }
                other => other?,
            };
            if size > MAX_BYTES {
                return Err(invalid("the file is larger than 300 MB"));
            }
        }
    }
    queue_listen(p, id).await?;
    Ok(ListenStatus::Listening)
}

/// The client sends the file through the API, read piece by piece into the working directory
/// (never whole in memory) and stored at the listen's source key; then the listen is completed.
/// A listen in progress or done answers its status and keeps its file.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a clip, a type iListen does not take, an
/// empty file or one over 300 MB; scratch, storage, store and queue errors.
pub async fn upload_listen_source(
    p: &ListenPorts,
    user: &UserId,
    id: &ListenId,
    body: SourceBody<'_>,
) -> Result<ListenStatus, AppError> {
    let listen = owned_listen(p.store.as_ref(), user, id).await?;
    if matches!(listen.status, ListenStatus::Listening | ListenStatus::Ready) {
        return Ok(listen.status);
    }
    if listen.source == ListenSource::Clip {
        return Err(invalid("a clip needs no upload"));
    }
    if !body.content_type.is_some_and(accepted_type) {
        return Err(invalid("only a sound file or a video can be listened to"));
    }
    let path = p
        .scratch
        .listen_dir(id)
        .await?
        .join(format!("source.{}", listen.ext));
    let written = p
        .scratch
        .write_stream(&path, body.chunks, MAX_BYTES)
        .await?;
    if written == 0 || written > MAX_BYTES {
        p.scratch.remove_file(&path).await?;
        return Err(invalid(if written == 0 {
            "the file is empty"
        } else {
            "the file is larger than 300 MB"
        }));
    }
    let key = keys::listen_source(user, id, &listen.ext);
    let put = PutFile {
        key: &key,
        path: &path,
        content_type: &listen.content_type,
        class: None,
        cache_control: None,
    };
    p.blobs.put_file(put).await?;
    complete_listen(p, user, id).await
}

/// `user`'s listens, newest first.
///
/// # Errors
/// Store errors.
pub async fn list_listens(p: &ListenPorts, user: &UserId) -> Result<Vec<Listen>, AppError> {
    p.store.list(user).await
}

/// `user`'s listen with its lines, versions and spoken summary.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store and storage errors.
pub async fn get_listen(
    p: &ListenPorts,
    user: &UserId,
    id: &ListenId,
) -> Result<ListenDetailView, AppError> {
    let listen = owned_listen(p.store.as_ref(), user, id).await?;
    let turns = p.store.turns(id).await?;
    let versions = p
        .store
        .versions(id)
        .await?
        .into_iter()
        .map(|v| VersionView {
            version: v.version,
            confidence: v.check.as_ref().map(|c| c.confidence),
            summary_score: v.check.as_ref().map(|c| c.summary_score),
            passed: v.check.as_ref().is_some_and(|c| c.passed),
            notes: v.check.as_ref().map(checker_notes).unwrap_or_default(),
        })
        .collect();
    let summary_audio_url = match &listen.summary_audio_key {
        Some(k) => Some(p.blobs.presign_get(k, p.url_ttl).await?),
        None => None,
    };
    Ok(ListenDetailView {
        listen,
        turns,
        versions,
        summary_audio_url,
    })
}

/// Renames `user`'s listen and answers it in full.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for an empty or too-long title; store errors.
pub async fn rename_listen(
    p: &ListenPorts,
    user: &UserId,
    id: &ListenId,
    title: &str,
) -> Result<ListenDetailView, AppError> {
    owned_listen(p.store.as_ref(), user, id).await?;
    let title = listen_title(title)?;
    p.store.set_title(id, &title, &now(p)).await?;
    get_listen(p, user, id).await
}

/// Deletes `user`'s listen: its job first (so a running step stops recording), every object it
/// owns (a clip's audio stays with the clip), its rows and its working files.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; storage, store and queue errors.
pub async fn delete_listen(p: &ListenPorts, user: &UserId, id: &ListenId) -> Result<(), AppError> {
    let listen = owned_listen(p.store.as_ref(), user, id).await?;
    p.jobs.cancel(JobKind::Listen, id.as_str()).await?;
    let voices = p.store.voices(id).await?;
    let file_ext = (listen.source == ListenSource::File).then_some(listen.ext.as_str());
    let objects = keys::listen_objects(&listen.user_id, id, file_ext, &voices);
    p.blobs.delete(&objects).await?;
    p.store.delete(id).await?;
    p.scratch.remove_listen_dir(id).await
}

/// Writes the summary in another output language. Never refused for being busy:
/// - the same language as now changes nothing;
/// - before the transcript exists (uploading, or still hearing it) only the language is recorded,
///   and the job uses it when it reaches `understand`;
/// - otherwise the job is replaced: the translation, versions and spoken summary are dropped and
///   a fresh job runs, whose `audio` and `transcribe` steps keep what is stored, so it starts
///   over at `understand`. A step of the replaced job still running stops at its next check.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a bad language; store and queue errors.
pub async fn change_language(
    p: &ListenPorts,
    user: &UserId,
    id: &ListenId,
    target: &str,
) -> Result<ListenDetailView, AppError> {
    let listen = owned_listen(p.store.as_ref(), user, id).await?;
    let target = output_language(target)?.code;
    let heard = !p.store.turns(id).await?.is_empty();
    if listen.target == target && listen.status != ListenStatus::Failed {
        // Nothing to change.
    } else if listen.status == ListenStatus::Uploading
        || (listen.status == ListenStatus::Listening && !heard)
    {
        p.store.set_target(id, target, &now(p)).await?;
    } else {
        p.jobs.cancel(JobKind::Listen, id.as_str()).await?;
        p.store.clear_understanding(id).await?;
        p.store.set_target(id, target, &now(p)).await?;
        set_listening(p, id).await?;
        enqueue(p, id).await?;
    }
    get_listen(p, user, id).await
}

/// Whether `job` is still the listen's job (a language change replaces it).
pub(crate) async fn current(
    p: &ListenPorts,
    job: &crate::domain::job::Job,
) -> Result<bool, AppError> {
    let state = p.jobs.find(JobKind::Listen, &job.subject_id).await?;
    Ok(state.is_some_and(|s| s.id == job.id))
}
