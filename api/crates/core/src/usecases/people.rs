//! Naming face tracks and speakers; every change re-indexes the segments it touches so names
//! become searchable at once.

use std::time::Duration;

use crate::domain::ids::{PersonId, SegmentId, SpeakerId, TrackId, UserId};
use crate::domain::index::{SpeakerView, TrackView};
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::{
    BlobStore, Catalogue, IdGenerator, PeopleStore, Person, TextIndex, TrackUpdate,
};
use crate::usecases::library::reindex_segment;

/// Longest person or speaker name, characters.
pub const MAX_NAME_CHARS: usize = 60;
/// Autocomplete suggestions returned.
pub const SUGGESTIONS: u32 = 20;

/// Ports naming needs.
pub struct PeopleDeps<'a> {
    /// People, tracks, speakers.
    pub people: &'a dyn PeopleStore,
    /// Search documents of the touched segments.
    pub catalogue: &'a dyn Catalogue,
    /// Re-indexing.
    pub text: &'a dyn TextIndex,
    /// New person ids.
    pub ids: &'a dyn IdGenerator,
    /// Crop URLs.
    pub blobs: &'a dyn BlobStore,
    /// Lifetime of crop URLs.
    pub url_ttl: Duration,
}

/// A requested track change: only the fields the client sent.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrackChange {
    /// New name.
    pub name: Option<String>,
    /// New hidden flag.
    pub hidden: Option<bool>,
}

/// Trims a name; empty or longer than 60 characters is `VALIDATION_FAILED`.
///
/// # Errors
/// `VALIDATION_FAILED` as above.
pub fn clean_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "name must be 1 to 60 characters",
        ));
    }
    Ok(name.to_owned())
}

fn owned(owner: Option<UserId>, user: &UserId, what: &str) -> Result<(), AppError> {
    match owner {
        None => Err(AppError::new(
            ErrorCode::NotFound,
            format!("no such {what}"),
        )),
        Some(o) if &o != user => Err(AppError::new(
            ErrorCode::Forbidden,
            format!("{what} belongs to another user"),
        )),
        Some(_) => Ok(()),
    }
}

async fn reindex(deps: &PeopleDeps<'_>, segments: &[SegmentId]) -> Result<(), AppError> {
    for s in segments {
        reindex_segment(deps.catalogue, deps.text, s).await?;
    }
    Ok(())
}

/// Names a track (one person per name per user) and/or hides it, then re-indexes its segments.
/// Returns the track and its crop URL.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty change or a bad name; `NOT_FOUND` / `FORBIDDEN` per owner.
pub async fn change_track(
    deps: &PeopleDeps<'_>,
    user: &UserId,
    id: &TrackId,
    change: TrackChange,
) -> Result<(TrackView, Option<String>), AppError> {
    if change.name.is_none() && change.hidden.is_none() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "send name or hidden",
        ));
    }
    let name = change.name.as_deref().map(clean_name).transpose()?;
    owned(deps.people.track_owner(id).await?, user, "track")?;
    let person = match name {
        Some(n) => Some(
            deps.people
                .upsert_person(user, &PersonId::parse(deps.ids.new_id())?, &n)
                .await?,
        ),
        None => None,
    };
    deps.people
        .update_track(
            id,
            &TrackUpdate {
                person,
                hidden: change.hidden,
            },
        )
        .await?;
    reindex(deps, &deps.people.track_segments(id).await?).await?;
    signed_track(deps, id).await
}

async fn signed_track(
    deps: &PeopleDeps<'_>,
    id: &TrackId,
) -> Result<(TrackView, Option<String>), AppError> {
    let track = deps
        .people
        .track(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such track"))?;
    let crop_url = match &track.crop_key {
        Some(k) => Some(
            deps.blobs
                .presign_get(&ObjectKey::from_stored(k.clone()), deps.url_ttl)
                .await?,
        ),
        None => None,
    };
    Ok((track, crop_url))
}

/// Renames a speaker, then re-indexes the segments where they speak.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad name; `NOT_FOUND` / `FORBIDDEN` per owner.
pub async fn rename_speaker(
    deps: &PeopleDeps<'_>,
    user: &UserId,
    id: &SpeakerId,
    raw: &str,
) -> Result<SpeakerView, AppError> {
    let name = clean_name(raw)?;
    owned(deps.people.speaker_owner(id).await?, user, "speaker")?;
    deps.people.rename_speaker(id, &name).await?;
    reindex(deps, &deps.people.speaker_segments(id).await?).await?;
    deps.people
        .speaker(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such speaker"))
}

/// Autocomplete: the user's people whose name starts with `prefix` (trimmed; empty lists all).
///
/// # Errors
/// Store errors pass through.
pub async fn suggest_people(
    people: &dyn PeopleStore,
    user: &UserId,
    prefix: &str,
) -> Result<Vec<Person>, AppError> {
    people
        .people_with_prefix(user, prefix.trim(), SUGGESTIONS)
        .await
}
