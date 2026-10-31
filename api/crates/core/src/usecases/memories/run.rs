//! The `memory` job, one step per stage. `find` gathers and ranks the moments and stores a frame
//! of each, taken inside the subject's face track; `write` has Spark write the lines from the
//! moments, faces and frames; `check` has Spark judge every line against the same inputs and
//! keeps only supported ones; `cover` draws the cover once (never failing the job); `ready` marks
//! it done. A deleted session does nothing. Each step skips what is already stored.

use std::path::PathBuf;

use super::{MemoryPorts, named_people, now};
use crate::domain::ids::MemoryId;
use crate::domain::job::Job;
use crate::domain::memory::{
    COVER_EDGE_PX, Memory, MemoryMoment, MemoryStatus, Subject, SubjectKind, apply_checked,
    apply_written, cover_scene, gather, limits, pick,
};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{FaceImage, ListenCoverRequest, MemoryRequest, PortResult, PutFile, StepRunner};
use crate::usecases::subjects::ClipFiles;

/// Long edge of a moment's frame as stored and shown to Spark, pixels.
const FRAME_EDGE_PX: u32 = 640;

fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

impl MemoryPorts {
    /// A file in the session's working directory (the directory is created).
    async fn work_file(&self, id: &MemoryId, name: &str) -> Result<PathBuf, AppError> {
        Ok(self.scratch.memory_dir(id).await?.join(name))
    }

    /// The stored object `key` in the working directory (downloaded once), named after the key's
    /// last part with `prefix` in front.
    async fn local(&self, id: &MemoryId, key: &str, prefix: &str) -> Result<PathBuf, AppError> {
        let last = key.rsplit('/').next().unwrap_or(key);
        let path = self.work_file(id, &format!("{prefix}{last}")).await?;
        if !self.scratch.exists(&path).await? {
            let key = ObjectKey::from_stored(key.to_owned());
            self.blobs.get_to_file(&key, &path).await?;
        }
        Ok(path)
    }

    async fn put_jpeg(&self, key: &ObjectKey, path: &std::path::Path) -> Result<(), AppError> {
        let put = PutFile {
            key,
            path,
            content_type: "image/jpeg",
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        self.blobs.put_file(put).await
    }
}

/// Every candidate moment: a person's described segments in every clip they are visibly in, or
/// every described segment with a visible face in the session's clip. Copies are left out.
async fn candidates(p: &MemoryPorts, m: &Memory) -> Result<Vec<MemoryMoment>, AppError> {
    let clips = match (&m.subject_kind, &m.clip_id) {
        (SubjectKind::Clip, Some(clip)) => vec![clip.clone()],
        (SubjectKind::Clip, None) => Vec::new(),
        (SubjectKind::Person, _) => p
            .catalogue
            .library(&m.user_id)
            .await?
            .into_iter()
            .filter(|r| !r.clip.is_copy())
            .filter(|r| r.people.iter().any(|n| same_name(n, &m.subject_name)))
            .map(|r| r.clip.id)
            .collect(),
    };
    let subject = match m.subject_kind {
        SubjectKind::Person => Subject::Person(&m.subject_name),
        SubjectKind::Clip => Subject::Everyone,
    };
    let mut all = Vec::new();
    for clip in &clips {
        let detail = p.catalogue.clip_detail(clip).await?;
        if let Some(d) = detail.filter(|d| d.row.clip.user_id == m.user_id) {
            all.extend(gather(&d, subject));
        }
    }
    Ok(all)
}

/// `find`: the ranked moments, each person linked to the owner's named person of that name, and
/// a frame of each stored. Skipped once moments are stored.
async fn find(p: &MemoryPorts, m: &mut Memory) -> Result<(), AppError> {
    if !m.moments.is_empty() {
        return Ok(());
    }
    let mut moments = pick(
        candidates(p, m).await?,
        m.viewer_name.as_deref(),
        limits(m.subject_kind),
    );
    if moments.is_empty() {
        return Err(AppError::new(
            ErrorCode::MediaFailed,
            format!("no described moments with {} were found", m.subject_name),
        ));
    }
    let people = named_people(p, &m.user_id).await?;
    let files = ClipFiles {
        blobs: p.blobs.as_ref(),
        scratch: p.scratch.as_ref(),
    };
    for moment in &mut moments {
        for person in &mut moment.people {
            person.person_id = people
                .iter()
                .find(|x| same_name(&x.name, &person.name))
                .map(|x| x.id.clone());
        }
        let proxy = files.proxy(&m.user_id, &moment.clip_id).await?;
        let n = moment.index;
        let raw = p.work_file(&m.id, &format!("raw_{n}.jpg")).await?;
        let small = p.work_file(&m.id, &format!("frame_{n}.jpg")).await?;
        p.media.frame_at(&proxy, moment.frame_s, &raw).await?;
        p.media.fit_jpeg(&raw, FRAME_EDGE_PX, &small).await?;
        let key = keys::memory_frame(&m.user_id, &m.id, n);
        p.put_jpeg(&key, &small).await?;
        moment.frame_key = Some(key.as_str().to_owned());
    }
    m.moments = moments;
    Ok(())
}

/// The images Spark sees: one face per named person present (the first crop of each name), and
/// one frame per moment.
async fn images(p: &MemoryPorts, m: &Memory) -> Result<(Vec<FaceImage>, Vec<PathBuf>), AppError> {
    let mut faces: Vec<FaceImage> = Vec::new();
    for person in m.moments.iter().flat_map(|x| &x.people) {
        let Some(crop) = person.crop_key.as_deref() else {
            continue;
        };
        if faces.iter().any(|f| same_name(&f.name, &person.name)) {
            continue;
        }
        faces.push(FaceImage {
            name: person.name.clone(),
            path: p.local(&m.id, crop, "face_").await?,
        });
    }
    let mut frames = Vec::with_capacity(m.moments.len());
    for moment in &m.moments {
        let key = moment
            .frame_key
            .as_deref()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "a moment has no frame"))?;
        frames.push(p.local(&m.id, key, "").await?);
    }
    Ok((faces, frames))
}

fn no_lines(m: &Memory) -> AppError {
    AppError::new(
        ErrorCode::ModelUnavailable,
        format!("no lines could be written about {}", m.subject_name),
    )
}

/// `write`: the title, lines and questions. Skipped once a title is stored.
async fn write(p: &MemoryPorts, m: &mut Memory) -> Result<(), AppError> {
    if !m.title.is_empty() {
        return Ok(());
    }
    let (faces, frames) = images(p, m).await?;
    let request = MemoryRequest {
        moments: &m.moments,
        viewer: m.viewer_name.as_deref(),
        faces: &faces,
        frames: &frames,
    };
    let answer = p.writer.write(request).await?;
    let title = apply_written(&mut m.moments, &answer, &m.subject_name);
    if m.moments.is_empty() {
        return Err(no_lines(m));
    }
    m.title = title;
    Ok(())
}

/// `check`: every line judged; unsupported ones rewritten or dropped. Skipped once checked.
async fn check(p: &MemoryPorts, m: &mut Memory) -> Result<(), AppError> {
    if m.moments.iter().all(|x| x.checked) {
        return Ok(());
    }
    let (faces, frames) = images(p, m).await?;
    let request = MemoryRequest {
        moments: &m.moments,
        viewer: m.viewer_name.as_deref(),
        faces: &faces,
        frames: &frames,
    };
    let checks = p.writer.check(request).await?;
    m.fixed_count = apply_checked(&mut m.moments, &checks);
    if m.moments.is_empty() {
        return Err(no_lines(m));
    }
    Ok(())
}

/// `cover`: drawn once from the title and the first moments. Any failure leaves the session
/// without a cover and never fails it.
async fn cover(p: &MemoryPorts, m: &mut Memory) -> Result<(), AppError> {
    if m.cover_key.is_some() {
        return Ok(());
    }
    // Deliberately tolerated: the cover is decoration, the session is done without it.
    if let Ok(key) = draw_cover(p, m).await {
        m.cover_key = Some(key.as_str().to_owned());
    }
    Ok(())
}

async fn draw_cover(p: &MemoryPorts, m: &Memory) -> Result<ObjectKey, AppError> {
    let drawn = p.work_file(&m.id, "cover_drawn.jpg").await?;
    let small = p.work_file(&m.id, "cover.jpg").await?;
    let scene = cover_scene(&m.title, &m.moments);
    let request = ListenCoverRequest {
        scene: &scene,
        out: &drawn,
    };
    p.cover_artist.draw_listen_cover(request).await?;
    p.media.fit_jpeg(&drawn, COVER_EDGE_PX, &small).await?;
    let key = keys::memory_cover(&m.user_id, &m.id);
    p.put_jpeg(&key, &small).await?;
    Ok(key)
}

async fn run_memory(p: &MemoryPorts, job: &Job, step: &str) -> Result<(), AppError> {
    let id = MemoryId::parse(job.subject_id.as_str())?;
    let Some(mut m) = p.store.get(&id).await? else {
        return Ok(());
    };
    m.step = (step != "ready").then(|| step.to_owned());
    m.updated_at = now(p);
    p.store.save(&m).await?;
    match step {
        "find" => find(p, &mut m).await?,
        "write" => write(p, &mut m).await?,
        "check" => check(p, &mut m).await?,
        "cover" => cover(p, &mut m).await?,
        "ready" => {
            m.status = MemoryStatus::Ready;
            m.error = None;
            p.scratch.remove_memory_dir(&id).await?;
        }
        other => {
            return Err(AppError::new(
                ErrorCode::Internal,
                format!("bad memory step {other}"),
            ));
        }
    }
    m.updated_at = now(p);
    p.store.save(&m).await
}

async fn memory_failed(p: &MemoryPorts, job: &Job, error: &AppError) -> Result<(), AppError> {
    let id = MemoryId::parse(job.subject_id.as_str())?;
    let Some(mut m) = p.store.get(&id).await? else {
        return Ok(());
    };
    m.status = MemoryStatus::Failed;
    m.step = None;
    m.error = Some(error.message.clone());
    m.updated_at = now(p);
    p.store.save(&m).await
}

impl StepRunner for MemoryPorts {
    fn run<'a>(&'a self, job: &'a Job, step: &'a str) -> PortResult<'a, ()> {
        Box::pin(run_memory(self, job, step))
    }

    fn failed<'a>(&'a self, job: &'a Job, error: &'a AppError) -> PortResult<'a, ()> {
        Box::pin(memory_failed(self, job, error))
    }
}
