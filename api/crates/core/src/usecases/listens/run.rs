//! The `listen` job, one step per stage. `audio` probes the file (no video needed) and stores a
//! 16 kHz mono WAV, or, for a clip, takes the clip's length; `transcribe` hears it in 570 s
//! chunks, or copies the clip's transcript; `understand` has Spark name each line's language,
//! translate it and summarise (in parts, then merged, when long); `check` runs the check loop
//! ([`super::check`]); `cover` draws the cover once; `voice` speaks an English summary; `ready` marks it done. A deleted listen
//! does nothing. Each step skips what is already stored, so a crash or a language change reruns
//! only what is missing.

use std::path::PathBuf;

use super::hear::{FirstPass, hear, ms};
use super::{ListenPorts, now};
use crate::domain::guide::{VOICE, narration_hash};
use crate::domain::ids::ListenId;
use crate::domain::job::Job;
use crate::domain::listen::{
    Draft, Listen, ListenSource, ListenStatus, ListenTurn, ListenVersion, Overview, SPOKEN_TARGET,
    checked_duration, language_shares, output_language, parts, tidied_draft,
};
use crate::domain::segmenting::Span;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{
    ListenCoverRequest, ListenProgress, ListenResult, MergeRequest, PortResult, PutFile,
    StepRunner, UnderstandRequest,
};
use crate::usecases::narrate::{VoiceFile, store_voice};

/// Milliseconds to seconds; durations are at most 2 hours, so the cast is exact.
fn secs(ms: u64) -> f64 {
    ms as f64 / 1000.0
}

impl ListenPorts {
    /// A file in the listen's working directory (the directory is created).
    async fn work_file(&self, id: &ListenId, name: &str) -> Result<PathBuf, AppError> {
        Ok(self.scratch.listen_dir(id).await?.join(name))
    }

    /// The object at `key` in the working directory as `name` (downloaded once).
    async fn local(
        &self,
        id: &ListenId,
        key: &keys::ObjectKey,
        name: &str,
    ) -> Result<PathBuf, AppError> {
        let path = self.work_file(id, name).await?;
        if !self.scratch.exists(&path).await? {
            self.blobs.get_to_file(key, &path).await?;
        }
        Ok(path)
    }

    /// The clip a clip listen hears; `MEDIA_FAILED` once the clip is deleted.
    async fn clip_of(&self, l: &Listen) -> Result<crate::domain::clip::Clip, AppError> {
        let gone = || AppError::new(ErrorCode::MediaFailed, "the clip was deleted");
        let id = l.clip_id.as_ref().ok_or_else(gone)?;
        self.catalogue.get_clip(id).await?.ok_or_else(gone)
    }
}

/// `audio`: the length, and for a file its WAV stored. Skipped once the length is known.
async fn audio(p: &ListenPorts, l: &Listen) -> Result<(), AppError> {
    if l.duration_ms.is_some() {
        return Ok(());
    }
    let duration_ms = match l.source {
        ListenSource::Clip => {
            let clip = p.clip_of(l).await?;
            let probe = clip.probe.ok_or_else(|| {
                AppError::new(ErrorCode::MediaFailed, "the clip was never probed")
            })?;
            checked_duration(probe.duration_s)?
        }
        ListenSource::File => file_audio(p, l).await?,
    };
    p.store.set_duration(&l.id, duration_ms).await
}

/// A file's length, after its sound is stored as a 16 kHz mono WAV.
async fn file_audio(p: &ListenPorts, l: &Listen) -> Result<u64, AppError> {
    let key = keys::listen_source(&l.user_id, &l.id, &l.ext);
    let src = p.local(&l.id, &key, &format!("source.{}", l.ext)).await?;
    let probe = p.media.probe_audio(&src).await?;
    if !probe.has_audio {
        return Err(AppError::new(
            ErrorCode::MediaFailed,
            "the file has no sound",
        ));
    }
    let duration_ms = checked_duration(probe.duration_s)?;
    let wav = p.work_file(&l.id, "audio.wav").await?;
    let whole = Span {
        start_s: 0.0,
        end_s: probe.duration_s,
    };
    p.media.extract_wav(&src, whole, &wav).await?;
    let put = PutFile {
        key: &keys::listen_audio(&l.user_id, &l.id),
        path: &wav,
        content_type: "audio/wav",
        class: None,
        cache_control: None,
    };
    p.blobs.put_file(put).await?;
    Ok(duration_ms)
}

/// A clip's stored transcript as listen lines; empty when the clip has none.
async fn clip_lines(p: &ListenPorts, l: &Listen) -> Result<Vec<ListenTurn>, AppError> {
    let clip = p.clip_of(l).await?;
    let Some(detail) = p.catalogue.clip_detail(&clip.id).await? else {
        return Ok(Vec::new());
    };
    let label = |id: &Option<crate::domain::ids::SpeakerId>| {
        detail
            .speakers
            .iter()
            .find(|s| Some(&s.id) == id.as_ref())
            .map(|s| s.label.clone())
    };
    Ok((0u32..)
        .zip(&detail.turns)
        .map(|(i, t)| {
            let span = (ms(t.span.start_s), ms(t.span.end_s));
            ListenTurn::heard(i, span, label(&t.speaker_id), &t.text)
        })
        .filter(|t| !t.text.is_empty())
        .collect())
}

/// `transcribe`: the lines, kept once stored. The WAV (the clip's own, or the file's) goes through the coverage loop ([`super::hear`]); a clip's
/// ingest transcript stands in for the full pass.
async fn transcribe(p: &ListenPorts, l: &Listen) -> Result<(), AppError> {
    if !p.store.turns(&l.id).await?.is_empty() {
        return Ok(());
    }
    let clip = match l.source {
        ListenSource::Clip => clip_lines(p, l).await?,
        ListenSource::File => Vec::new(),
    };
    let first = if clip.is_empty() {
        FirstPass::Full
    } else {
        FirstPass::Clip(clip)
    };
    let key = match (l.source, &l.clip_id) {
        (ListenSource::Clip, Some(clip)) => keys::audio(&l.user_id, clip),
        _ => keys::listen_audio(&l.user_id, &l.id),
    };
    let wav = p.local(&l.id, &key, "audio.wav").await?;
    let duration = l
        .duration_ms
        .ok_or_else(|| AppError::new(ErrorCode::Internal, "no audio length"))?;
    let dir = p.scratch.listen_dir(&l.id).await?;
    let mut heard = hear(p, (&wav, secs(duration)), &dir, first).await?;
    for (i, t) in (0u32..).zip(heard.lines.iter_mut()) {
        t.index = i;
    }
    p.store.set_turns(&l.id, &heard.lines, heard.by).await
}

/// What a listen shows for `draft` before (or without) its check.
pub(super) fn unchecked_result(turns: &[ListenTurn], draft: &Draft) -> ListenResult {
    let lines: Vec<ListenTurn> = turns
        .iter()
        .map(|t| ListenTurn {
            lang: draft.lang(t.index).to_owned(),
            translation: draft.translation(t.index).to_owned(),
            score: None,
            issue: String::new(),
            fixed_in: 1,
            ..t.clone()
        })
        .collect();
    ListenResult {
        version: 1,
        overview: Overview {
            title: draft.title.clone(),
            summary: draft.summary.clone(),
            key_points: draft.key_points.clone(),
        },
        languages: language_shares(&lines),
        confidence: None,
        passed: false,
        turns: lines,
    }
}

/// Spark's draft of every turn, part by part; the parts' overviews merged into one when there
/// are several.
async fn understood(p: &ListenPorts, l: &Listen, turns: &[ListenTurn]) -> Result<Draft, AppError> {
    let target = output_language(&l.target)?;
    let mut lines = Vec::with_capacity(turns.len());
    let mut overviews = Vec::new();
    for range in parts(turns) {
        let request = UnderstandRequest {
            target,
            turns: &turns[range],
        };
        let d = p.interpreter.understand(request).await?;
        lines.extend(d.turns);
        overviews.push(Overview {
            title: d.title,
            summary: d.summary,
            key_points: d.key_points,
        });
    }
    let overview = match overviews.as_slice() {
        [one] => one.clone(),
        many => {
            let request = MergeRequest {
                target,
                parts: many,
            };
            p.interpreter.merge(request).await?
        }
    };
    Ok(Draft {
        title: overview.title,
        turns: lines,
        summary: overview.summary,
        key_points: overview.key_points,
    })
}

/// `understand`: version 1, from scratch (an earlier attempt's versions are dropped). A long
/// transcript is understood part by part, then the parts' summaries are merged into one.
async fn understand(p: &ListenPorts, l: &Listen) -> Result<(), AppError> {
    let turns = p.store.turns(&l.id).await?;
    if turns.is_empty() {
        return Err(AppError::new(
            ErrorCode::MediaFailed,
            "no speech was heard in the recording",
        ));
    }
    p.store.clear_understanding(&l.id).await?;
    let raw = understood(p, l, &turns).await?;
    let draft = tidied_draft(&raw, &turns);
    let v1 = ListenVersion {
        version: 1,
        draft: draft.clone(),
        check: None,
    };
    p.store.put_version(&l.id, &v1).await?;
    p.store
        .set_result(&l.id, &unchecked_result(&turns, &draft))
        .await
}

/// `cover`: a picture of what the summary describes, drawn once (a language change keeps it),
/// shrunk to 640 px and stored. A cover that cannot be made leaves the listen without one; the
/// failed call is in the model call log.
async fn cover(p: &ListenPorts, l: &Listen) -> Result<(), AppError> {
    if l.cover_key.is_some() || l.summary.trim().is_empty() {
        return Ok(());
    }
    let drawn = p.work_file(&l.id, "cover_drawn.jpg").await?;
    let small = p.work_file(&l.id, "cover.jpg").await?;
    let request = ListenCoverRequest {
        scene: &l.summary,
        out: &drawn,
    };
    if p.cover_artist.draw_listen_cover(request).await.is_err()
        || p.media.thumbnail(&drawn, 0.0, &small).await.is_err()
    {
        return Ok(());
    }
    let key = keys::listen_cover(&l.user_id, &l.id);
    let put = PutFile {
        key: &key,
        path: &small,
        content_type: "image/jpeg",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    p.blobs.put_file(put).await?;
    p.store.set_cover(&l.id, &key).await
}

/// `voice`: an English summary spoken, so read-aloud plays at once; other languages use the
/// device's voice. Silent when it cannot be made.
async fn voice(p: &ListenPorts, l: &Listen) -> Result<(), AppError> {
    let narrator = match p.narrator.as_deref() {
        Some(n) if l.target == SPOKEN_TARGET && !l.summary.trim().is_empty() => n,
        _ => return p.store.set_summary_audio(&l.id, None).await,
    };
    let hash = narration_hash(VOICE, &l.summary);
    let key = keys::listen_voice(&l.user_id, &l.id, &hash);
    let work = p.work_file(&l.id, &format!("voice_{hash}.wav")).await?;
    let file = VoiceFile {
        key: &key,
        work: &work,
    };
    let stores = (p.blobs.as_ref(), p.scratch.as_ref());
    match store_voice(narrator, stores, file, &l.summary).await {
        Ok(()) => {
            p.store.add_voice(&l.id, &key).await?;
            p.store.set_summary_audio(&l.id, Some(&key)).await
        }
        Err(_) => p.store.set_summary_audio(&l.id, None).await,
    }
}

async fn set_status(
    p: &ListenPorts,
    l: &Listen,
    status: ListenStatus,
    error: Option<&str>,
) -> Result<(), AppError> {
    let at = now(p);
    let progress = ListenProgress {
        status,
        error,
        at: &at,
    };
    p.store.set_progress(&l.id, progress).await?;
    p.store.set_step(&l.id, None, l.version).await
}

async fn run_listen(p: &ListenPorts, job: &Job, step: &str) -> Result<(), AppError> {
    let id = ListenId::parse(job.subject_id.as_str())?;
    let Some(l) = p.store.get(&id).await? else {
        return Ok(());
    };
    if !super::current(p, job).await? {
        // Replaced by a language change: the new job does the work.
        return Ok(());
    }
    if step != "ready" {
        p.store.set_step(&id, Some(step), l.version).await?;
    }
    match step {
        "audio" => audio(p, &l).await,
        "transcribe" => transcribe(p, &l).await,
        "understand" => understand(p, &l).await,
        "check" => super::check::check_loop(p, job, &l).await,
        "cover" => cover(p, &l).await,
        "voice" => voice(p, &l).await,
        "ready" => {
            set_status(p, &l, ListenStatus::Ready, None).await?;
            p.scratch.remove_listen_dir(&id).await
        }
        other => Err(AppError::new(
            ErrorCode::Internal,
            format!("bad listen step {other}"),
        )),
    }
}

async fn listen_failed(p: &ListenPorts, job: &Job, error: &AppError) -> Result<(), AppError> {
    let id = ListenId::parse(job.subject_id.as_str())?;
    let Some(l) = p.store.get(&id).await? else {
        return Ok(());
    };
    if !super::current(p, job).await? {
        return Ok(());
    }
    set_status(p, &l, ListenStatus::Failed, Some(&error.message)).await
}

impl StepRunner for ListenPorts {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(run_listen(self, job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(listen_failed(self, job, error))
    }
}
