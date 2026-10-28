//! A project's key art: one Muse Image edit anchored on the frames of the 4 moments with the
//! highest hook score across the project's clips, with no text. Drawn once automatically when
//! the project first holds 3 clips, then again only when the owner asks for new art. Art that
//! cannot be drawn never fails anything.

use std::path::PathBuf;

use crate::domain::brand::theme_for;
use crate::domain::cover::{AUTO_ART_CLIPS, PROJECT_ART_FRAME, art_moments};
use crate::domain::ids::{ProjectId, UserId};
use crate::domain::project::{ArtSource, Project};
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{ArtRequest, Catalogue, ImageMaker, ProjectStore, PutFile};
use crate::usecases::shorts::ShortDeps;

/// Ports the project art needs.
pub struct ProjectArtDeps<'a> {
    /// Projects (art and the auto-art claim).
    pub projects: &'a dyn ProjectStore,
    /// The clips and their moments.
    pub catalogue: &'a dyn Catalogue,
    /// Muse Image.
    pub images: &'a dyn ImageMaker,
    /// Blobs, scratch space, the brand kit and the storage cap.
    pub short: ShortDeps<'a>,
}

async fn project(deps: &ProjectArtDeps<'_>, id: &ProjectId) -> Result<Project, AppError> {
    deps.projects
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such project"))
}

/// Checks that `user` may ask for new art of project `id`; the caller then runs
/// [`draw_project_art`] in the background.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `STORAGE_FULL`.
pub async fn project_art_requested(
    deps: &ProjectArtDeps<'_>,
    user: &UserId,
    id: &ProjectId,
) -> Result<(), AppError> {
    if &project(deps, id).await?.user_id != user {
        return Err(AppError::new(
            ErrorCode::Forbidden,
            "project belongs to another user",
        ));
    }
    deps.short.ensure_room(user, images_estimate(1)).await
}

/// Whether the automatic first art of project `id` should run now: it holds at least 3 clips and
/// it never ran. `true` only once.
///
/// # Errors
/// Store errors.
pub async fn auto_project_art_due(
    projects: &dyn ProjectStore,
    id: &ProjectId,
) -> Result<bool, AppError> {
    let enough = projects
        .summary(id)
        .await?
        .is_some_and(|s| s.clip_count >= AUTO_ART_CLIPS);
    Ok(enough && projects.claim_auto_art(id).await?)
}

/// The project's moments, strongest hook first, at most 4.
async fn strongest_moments(
    deps: &ProjectArtDeps<'_>,
    p: &Project,
) -> Result<Vec<ArtSource>, AppError> {
    let rows = deps.catalogue.library(&p.user_id).await?;
    let mut moments = Vec::new();
    for row in rows.iter().filter(|r| r.project_ids.contains(&p.id)) {
        let Some(detail) = deps.catalogue.clip_detail(&row.clip.id).await? else {
            continue;
        };
        let clip_title = row
            .clip
            .title
            .clone()
            .unwrap_or_else(|| row.clip.filename.clone());
        for s in detail.segments {
            let facts = s.facts.as_ref();
            moments.push((
                ArtSource {
                    clip_id: row.clip.id.clone(),
                    segment_id: s.segment.id.clone(),
                    clip_title: clip_title.clone(),
                    title: facts.map(|f| f.description.clone()).unwrap_or_default(),
                    start_s: s.segment.span.start_s,
                },
                facts.and_then(|f| f.hook_score),
            ));
        }
    }
    Ok(art_moments(moments, |m| m.1)
        .into_iter()
        .map(|m| m.0)
        .collect())
}

/// Draws project `id`'s key art as variation `take` from its strongest moments, uploads it and
/// records it with those moments.
///
/// # Errors
/// `NOT_FOUND`; `VALIDATION_FAILED` when no moment's frame could be fetched; storage, model and
/// store errors. The caller only logs them.
pub async fn draw_project_art(
    deps: &ProjectArtDeps<'_>,
    id: &ProjectId,
    take: u32,
) -> Result<(), AppError> {
    let p = project(deps, id).await?;
    let (sources, anchors) = fetched(deps, &p).await?;
    if anchors.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "nothing to draw the art from yet",
        ));
    }
    let dir = deps.short.scratch.user_dir(&p.user_id).await?;
    let kit = deps.short.brand.brand_kit(&p.user_id).await?;
    let (shape, size) = PROJECT_ART_FRAME;
    let request = ArtRequest {
        shape,
        size,
        theme: p.name.clone(),
        accent: theme_for(kit.as_ref()).accent,
        anchors,
        take,
        out: dir.join(format!("project_art_{}.webp", p.id)),
    };
    deps.short
        .ensure_room(&p.user_id, images_estimate(1))
        .await?;
    deps.images.draw_art(&request).await?;
    let key = keys::project_art(&p.user_id, &p.id);
    let put = PutFile {
        key: &key,
        path: &request.out,
        content_type: "image/webp",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    deps.short.blobs.put_file(put).await?;
    deps.projects.set_art(&p.id, &key, &sources).await
}

/// The strongest moments whose frames could be fetched, with those local frames.
async fn fetched(
    deps: &ProjectArtDeps<'_>,
    p: &Project,
) -> Result<(Vec<ArtSource>, Vec<PathBuf>), AppError> {
    let dir = deps.short.scratch.user_dir(&p.user_id).await?;
    let mut sources = Vec::new();
    let mut anchors = Vec::new();
    for (i, m) in strongest_moments(deps, p).await?.into_iter().enumerate() {
        let path = dir.join(format!("project_art_{}_{i}.jpg", p.id));
        let thumb = keys::thumb(&p.user_id, &m.clip_id, &m.segment_id);
        if deps.short.blobs.get_to_file(&thumb, &path).await.is_ok() {
            sources.push(m);
            anchors.push(path);
        }
    }
    Ok((sources, anchors))
}
