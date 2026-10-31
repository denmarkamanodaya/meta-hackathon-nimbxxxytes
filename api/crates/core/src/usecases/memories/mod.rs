//! Memory Lane: the owner picks one named person (or one clip, a day) and, optionally, who will
//! watch. A `memory` job finds the moments, has Muse Spark write one gentle line and one question
//! per moment from the moment's facts, the faces of the people in it and a frame of it, has Spark
//! check every line against the same inputs, and draws a cover.

mod run;

use std::sync::Arc;
use std::time::Duration;

use crate::domain::ids::{ClipId, JobId, MemoryId, PersonId, UserId};
use crate::domain::job::JobKind;
use crate::domain::memory::{
    CLIP_MOMENTS, MAX_PEOPLE, Memory, MemoryMoment, MemoryStatus, SubjectKind,
};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, ObjectKey};
use crate::ports::{
    BlobStore, Catalogue, Clock, IdGenerator, JobQueue, ListenCoverArtist, MediaTool, MemoryStore,
    MemoryWriter, NewJob, PeopleStore, Person, Scratch,
};
use crate::time::format_utc;

/// Every port Memory Lane uses, bound once by the composition root; the request handlers and the
/// `memory` job share it.
#[derive(Clone)]
pub struct MemoryPorts {
    /// Session rows.
    pub store: Arc<dyn MemoryStore>,
    /// Clips, their segments, tracks and turns.
    pub catalogue: Arc<dyn Catalogue>,
    /// The owner's named people.
    pub people: Arc<dyn PeopleStore>,
    /// Private objects.
    pub blobs: Arc<dyn BlobStore>,
    /// Working files.
    pub scratch: Arc<dyn Scratch>,
    /// Frames from the proxy.
    pub media: Arc<dyn MediaTool>,
    /// Spark writes and checks the lines.
    pub writer: Arc<dyn MemoryWriter>,
    /// Muse Image draws the cover.
    pub cover_artist: Arc<dyn ListenCoverArtist>,
    /// The `memory` job.
    pub jobs: Arc<dyn JobQueue>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// Ids.
    pub ids: Arc<dyn IdGenerator>,
    /// Lifetime of the GET URLs handed out.
    pub url_ttl: Duration,
}

/// `POST /api/memories` as the client sent it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryStart {
    /// The person to remember.
    pub person_id: Option<String>,
    /// Or the clip (a day) to remember.
    pub clip_id: Option<String>,
    /// Who watches: one of the owner's named people.
    pub viewer_id: Option<String>,
}

/// One row of the list: the session and its cover, signed.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryView {
    /// The row.
    pub memory: Memory,
    /// The cover, signed; `None` before it is drawn or when it could not be.
    pub cover_url: Option<String>,
}

/// A moment with its media signed.
#[derive(Debug, Clone, PartialEq)]
pub struct MomentView {
    /// The moment.
    pub moment: MemoryMoment,
    /// The clip's 720p proxy.
    pub proxy_url: Option<String>,
    /// The frame of the moment.
    pub thumb_url: Option<String>,
    /// Each person's face crop, in the order of `moment.people`.
    pub crop_urls: Vec<Option<String>>,
}

/// A whole session.
#[derive(Debug, Clone, PartialEq)]
pub struct MemoryDetailView {
    /// The row and its cover.
    pub view: MemoryView,
    /// The moments, in session order.
    pub moments: Vec<MomentView>,
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

fn not_found(msg: &str) -> AppError {
    AppError::new(ErrorCode::NotFound, msg)
}

fn now(p: &MemoryPorts) -> String {
    format_utc(p.clock.now_millis())
}

/// `user`'s session; another user's answers `NOT_FOUND` as a missing one does.
///
/// # Errors
/// `NOT_FOUND`; store errors.
pub async fn owned_memory(
    store: &dyn MemoryStore,
    user: &UserId,
    id: &MemoryId,
) -> Result<Memory, AppError> {
    store
        .get(id)
        .await?
        .filter(|m| &m.user_id == user)
        .ok_or_else(|| not_found("no such memory session"))
}

/// The owner's named people.
pub(crate) async fn named_people(p: &MemoryPorts, user: &UserId) -> Result<Vec<Person>, AppError> {
    p.people.people_with_prefix(user, "", MAX_PEOPLE).await
}

/// `raw` as one of `people`; `NOT_FOUND` for anyone else (another user's person too).
fn one_of(people: &[Person], raw: &str, what: &str) -> Result<Person, AppError> {
    let id = PersonId::parse(raw)?;
    people
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or_else(|| not_found(what))
}

/// What the session is about: the person's name, or the clip's title.
async fn subject(
    p: &MemoryPorts,
    user: &UserId,
    people: &[Person],
    start: &MemoryStart,
) -> Result<(SubjectKind, Option<PersonId>, Option<ClipId>, String), AppError> {
    match (start.person_id.as_deref(), start.clip_id.as_deref()) {
        (Some(person), None) => {
            let found = one_of(people, person, "no such person")?;
            Ok((SubjectKind::Person, Some(found.id), None, found.name))
        }
        (None, Some(clip)) => {
            let id = ClipId::parse(clip)?;
            let clip = p
                .catalogue
                .get_clip(&id)
                .await?
                .filter(|c| &c.user_id == user)
                .ok_or_else(|| not_found("no such clip"))?;
            Ok((SubjectKind::Clip, None, Some(id), clip.display_title()))
        }
        _ => Err(invalid("send exactly one of person_id and clip_id")),
    }
}

/// Creates a session `making` and queues its job.
///
/// # Errors
/// `VALIDATION_FAILED` without exactly one of person and clip, or for a malformed id;
/// `NOT_FOUND` for a person, viewer or clip that is not the caller's; store and queue errors.
pub async fn create_memory(
    p: &MemoryPorts,
    user: &UserId,
    start: MemoryStart,
) -> Result<Memory, AppError> {
    let people = named_people(p, user).await?;
    let (subject_kind, person_id, clip_id, subject_name) =
        subject(p, user, &people, &start).await?;
    let viewer = match start.viewer_id.as_deref() {
        Some(v) => Some(one_of(&people, v, "no such viewer")?),
        None => None,
    };
    let at = now(p);
    let memory = Memory {
        id: MemoryId::parse(p.ids.new_id())?,
        user_id: user.clone(),
        subject_kind,
        person_id,
        clip_id,
        subject_name,
        viewer_id: viewer.as_ref().map(|v| v.id.clone()),
        viewer_name: viewer.map(|v| v.name),
        title: String::new(),
        status: MemoryStatus::Making,
        step: None,
        moments: Vec::new(),
        fixed_count: 0,
        cover_key: None,
        error: None,
        created_at: at.clone(),
        updated_at: at,
    };
    p.store.create(&memory).await?;
    let job = JobId::parse(p.ids.new_id())?;
    let new = NewJob {
        id: &job,
        kind: JobKind::Memory,
        subject_id: memory.id.as_str(),
    };
    p.jobs.enqueue(new, p.clock.now_millis()).await?;
    Ok(memory)
}

async fn signed(p: &MemoryPorts, key: Option<&str>) -> Result<Option<String>, AppError> {
    match key {
        Some(k) => {
            let key = ObjectKey::from_stored(k.to_owned());
            Ok(Some(p.blobs.presign_get(&key, p.url_ttl).await?))
        }
        None => Ok(None),
    }
}

async fn view(p: &MemoryPorts, memory: Memory) -> Result<MemoryView, AppError> {
    Ok(MemoryView {
        cover_url: signed(p, memory.cover_key.as_deref()).await?,
        memory,
    })
}

/// `user`'s sessions, newest first, with their covers.
///
/// # Errors
/// Store and storage errors.
pub async fn list_memories(p: &MemoryPorts, user: &UserId) -> Result<Vec<MemoryView>, AppError> {
    let mut out = Vec::new();
    for m in p.store.list(user).await? {
        out.push(view(p, m).await?);
    }
    Ok(out)
}

/// `user`'s session with every moment's proxy, frame and faces signed.
///
/// # Errors
/// `NOT_FOUND`; store and storage errors.
pub async fn get_memory(
    p: &MemoryPorts,
    user: &UserId,
    id: &MemoryId,
) -> Result<MemoryDetailView, AppError> {
    let memory = owned_memory(p.store.as_ref(), user, id).await?;
    let mut moments = Vec::with_capacity(memory.moments.len());
    for m in &memory.moments {
        let proxy = keys::proxy_720p(user, &m.clip_id);
        let mut crop_urls = Vec::with_capacity(m.people.len());
        for person in &m.people {
            crop_urls.push(signed(p, person.crop_key.as_deref()).await?);
        }
        moments.push(MomentView {
            proxy_url: Some(p.blobs.presign_get(&proxy, p.url_ttl).await?),
            thumb_url: signed(p, m.frame_key.as_deref()).await?,
            crop_urls,
            moment: m.clone(),
        });
    }
    Ok(MemoryDetailView {
        view: view(p, memory).await?,
        moments,
    })
}

/// Deletes `user`'s session: its job first (so a running step stops saving), its cover and
/// frames, its row and its working files. The clips and their crops stay.
///
/// # Errors
/// `NOT_FOUND`; storage, store and queue errors.
pub async fn delete_memory(p: &MemoryPorts, user: &UserId, id: &MemoryId) -> Result<(), AppError> {
    owned_memory(p.store.as_ref(), user, id).await?;
    p.jobs.cancel(JobKind::Memory, id.as_str()).await?;
    let found = u32::try_from(CLIP_MOMENTS).unwrap_or(u32::MAX);
    p.blobs
        .delete(&keys::memory_objects(user, id, found))
        .await?;
    p.store.delete(id).await?;
    p.scratch.remove_memory_dir(id).await
}
