//! Projects: list, create, rename or recolour, delete, add and remove clips, and the library of
//! one project. Every call checks that the project, and every clip named, belong to the user.
//! Projects come back with their key art and the moments it was drawn from, signed.

use std::time::Duration;

use crate::domain::ids::{ClipId, ProjectId, UserId};
use crate::domain::project::{ArtSource, Project, ProjectColor, ProjectSummary, checked_name};
use crate::error::{AppError, ErrorCode};
use crate::keys;
use crate::ports::{BlobStore, Catalogue, Clock, IdGenerator, ProjectStore};
use crate::time::format_utc;
use crate::usecases::clips::owned_clip;
use crate::usecases::library::{LibraryCard, LibraryDeps, library};

/// Ports the project use cases need.
pub struct ProjectDeps<'a> {
    /// Projects and their clip links.
    pub projects: &'a dyn ProjectStore,
    /// Clips, for the ownership check.
    pub catalogue: &'a dyn Catalogue,
    /// New project ids.
    pub ids: &'a dyn IdGenerator,
    /// Created and updated times.
    pub clock: &'a dyn Clock,
    /// Signs the art and its moments' thumbnails.
    pub blobs: &'a dyn BlobStore,
    /// Lifetime of signed URLs.
    pub url_ttl: Duration,
}

/// A project with its signed key art and the moments it was drawn from.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectView {
    /// The project and its totals.
    pub summary: ProjectSummary,
    /// Signed key art.
    pub art_url: Option<String>,
    /// The moments the art was drawn from, each with its signed thumbnail.
    pub art_sources: Vec<(ArtSource, String)>,
}

/// `summary` with its art and moments signed.
async fn view(deps: &ProjectDeps<'_>, summary: ProjectSummary) -> Result<ProjectView, AppError> {
    let (blobs, ttl) = (deps.blobs, deps.url_ttl);
    let art_url = match &summary.art.key {
        Some(k) => Some(blobs.presign_get(k, ttl).await?),
        None => None,
    };
    let user = &summary.project.user_id;
    let mut art_sources = Vec::with_capacity(summary.art.sources.len());
    for s in &summary.art.sources {
        let thumb = keys::thumb(user, &s.clip_id, &s.segment_id);
        art_sources.push((s.clone(), blobs.presign_get(&thumb, ttl).await?));
    }
    Ok(ProjectView {
        summary,
        art_url,
        art_sources,
    })
}

/// A project to create.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProject {
    /// Name as typed.
    pub name: String,
    /// Colour text.
    pub color: String,
    /// Clips to put in it.
    pub clip_ids: Vec<ClipId>,
}

/// A change to a project; `None` keeps the value.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProjectEdit {
    /// New name as typed.
    pub name: Option<String>,
    /// New colour text.
    pub color: Option<String>,
}

/// The project if `user` owns it.
///
/// # Errors
/// `NOT_FOUND` when it does not exist, `FORBIDDEN` when another user owns it.
async fn owned(deps: &ProjectDeps<'_>, user: &UserId, id: &ProjectId) -> Result<Project, AppError> {
    let project = deps
        .projects
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such project"))?;
    if &project.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "project belongs to another user",
        ));
    }
    Ok(project)
}

/// `clips` without repeats, once each is checked to be the user's.
async fn owned_clips(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    clips: &[ClipId],
) -> Result<Vec<ClipId>, AppError> {
    let mut out: Vec<ClipId> = Vec::with_capacity(clips.len());
    for clip in clips {
        if !out.contains(clip) {
            owned_clip(deps.catalogue, user, clip).await?;
            out.push(clip.clone());
        }
    }
    Ok(out)
}

/// Names of the user's projects other than `except`.
async fn other_names(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    except: Option<&ProjectId>,
) -> Result<Vec<String>, AppError> {
    Ok(deps
        .projects
        .list(user)
        .await?
        .into_iter()
        .filter(|s| Some(&s.project.id) != except)
        .map(|s| s.project.name)
        .collect())
}

async fn summary(deps: &ProjectDeps<'_>, id: &ProjectId) -> Result<ProjectView, AppError> {
    let s = deps
        .projects
        .summary(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such project"))?;
    view(deps, s).await
}

/// The user's projects with their totals and art, newest first.
///
/// # Errors
/// Store and signing errors.
pub async fn list_projects(
    deps: &ProjectDeps<'_>,
    user: &UserId,
) -> Result<Vec<ProjectView>, AppError> {
    let mut out = Vec::new();
    for s in deps.projects.list(user).await? {
        out.push(view(deps, s).await?);
    }
    Ok(out)
}

/// Creates a project with the listed clips in it.
///
/// # Errors
/// `VALIDATION_FAILED` for a bad or taken name or a bad colour; `NOT_FOUND` / `FORBIDDEN` for a
/// clip that does not exist or is another user's; store errors.
pub async fn create_project(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    new: NewProject,
) -> Result<ProjectView, AppError> {
    let others = other_names(deps, user, None).await?;
    let name = checked_name(&new.name, others.iter().map(String::as_str))?;
    let color = ProjectColor::parse(&new.color)?;
    let clips = owned_clips(deps, user, &new.clip_ids).await?;
    let now = format_utc(deps.clock.now_millis());
    let project = Project {
        id: ProjectId::parse(deps.ids.new_id())?,
        user_id: user.clone(),
        name,
        color,
        created_at: now.clone(),
        updated_at: now,
    };
    deps.projects.create(&project, &clips).await?;
    summary(deps, &project.id).await
}

/// Renames or recolours the user's project.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` for a bad or taken name or a bad colour; store
/// errors.
pub async fn update_project(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    id: &ProjectId,
    edit: ProjectEdit,
) -> Result<ProjectView, AppError> {
    let current = owned(deps, user, id).await?;
    let name = match edit.name {
        Some(raw) => {
            let others = other_names(deps, user, Some(id)).await?;
            checked_name(&raw, others.iter().map(String::as_str))?
        }
        None => current.name,
    };
    let color = match edit.color {
        Some(raw) => ProjectColor::parse(&raw)?,
        None => current.color,
    };
    let now = format_utc(deps.clock.now_millis());
    deps.projects.update(id, (&name, color), &now).await?;
    summary(deps, id).await
}

/// Deletes the user's project; its clips stay.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; store errors.
pub async fn delete_project(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    id: &ProjectId,
) -> Result<(), AppError> {
    owned(deps, user, id).await?;
    deps.projects.delete(id).await
}

/// Puts the user's clips in the user's project; clips already in it stay as they are.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` for the project or a clip; `VALIDATION_FAILED` for an empty list;
/// store errors.
pub async fn add_project_clips(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    id: &ProjectId,
    clip_ids: &[ClipId],
) -> Result<ProjectView, AppError> {
    owned(deps, user, id).await?;
    if clip_ids.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "clip_ids must name at least one clip",
        ));
    }
    let clips = owned_clips(deps, user, clip_ids).await?;
    let now = format_utc(deps.clock.now_millis());
    deps.projects.add_clips(id, &clips, &now).await?;
    summary(deps, id).await
}

/// Takes a clip out of the user's project; nothing happens when it is not in it.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` for the project; store errors.
pub async fn remove_project_clip(
    deps: &ProjectDeps<'_>,
    user: &UserId,
    id: &ProjectId,
    clip: &ClipId,
) -> Result<(), AppError> {
    owned(deps, user, id).await?;
    deps.projects.remove_clip(id, clip).await
}

/// The library cards of the clips in the user's project, newest first.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` for the project; catalogue and signing errors.
pub async fn project_library(
    deps: &ProjectDeps<'_>,
    lib: &LibraryDeps<'_>,
    user: &UserId,
    id: &ProjectId,
) -> Result<Vec<LibraryCard>, AppError> {
    owned(deps, user, id).await?;
    let mut cards = library(lib, user).await?;
    cards.retain(|c| c.row.project_ids.contains(id));
    Ok(cards)
}
