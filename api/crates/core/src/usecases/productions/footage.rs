//! Storyboards from the footage: once a library moment covers a shot, its storyboard is redrawn
//! from that moment's real frame in the same sketch style. The planned storyboard is kept. A
//! board that cannot be drawn is skipped and never fails the production.

use super::{StudioDeps, owned};
use crate::domain::cover::{footage_board_due, footage_step};
use crate::domain::ids::{ProductionId, ShotId, UserId};
use crate::domain::job::StepStatus;
use crate::domain::production::{Production, Shot, step};
use crate::domain::storage_cap::images_estimate;
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL};
use crate::ports::{FootageBoardRequest, PutFile};

/// Draws the footage storyboards the production's covered shots are due (none yet, or the
/// covering moment changed). Progress: `footage_boards n/m`. Returns how many failed.
///
/// # Errors
/// Store, scratch and `STORAGE_FULL` errors; a failed board is only counted.
pub(super) async fn draw_due(deps: &StudioDeps<'_>, p: &Production) -> Result<usize, AppError> {
    let shots = deps.store.shots(&p.id).await?;
    let due: Vec<&Shot> = shots
        .iter()
        .filter(|s| {
            footage_board_due(
                s.matched_segment_id.as_ref(),
                s.footage_board_segment.as_ref(),
                s.footage_board_key.is_some(),
            )
        })
        .collect();
    draw(deps, p, &due, 0).await
}

/// Checks that `user` may redraw shot `shot`'s storyboard from its footage; the caller then runs
/// [`redraw_footage_board`] in the background.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN` for the production; `NOT_FOUND` for a shot it does not have;
/// `VALIDATION_FAILED` for a shot no moment covers; `STORAGE_FULL`.
pub async fn footage_board_requested(
    deps: &StudioDeps<'_>,
    user: &UserId,
    (id, shot): (&ProductionId, &ShotId),
) -> Result<(), AppError> {
    owned(deps.store, user, id).await?;
    let shots = deps.store.shots(id).await?;
    let found = shots
        .iter()
        .find(|s| &s.id == shot)
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "no such shot"))?;
    if found.matched_segment_id.is_none() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "this shot has no footage yet; film it or recheck coverage first",
        ));
    }
    deps.short.ensure_room(user, images_estimate(1)).await
}

/// Redraws one shot's footage storyboard as variation `take` and records how it ended:
/// `footage_boards`, then `done` (a board that could not be drawn is skipped).
///
/// # Errors
/// Only store errors while recording the outcome.
pub async fn redraw_footage_board(
    deps: &StudioDeps<'_>,
    (id, shot): (&ProductionId, &ShotId),
    take: u32,
) -> Result<(), AppError> {
    let Some(p) = deps.store.get(id).await? else {
        return Ok(());
    };
    let shots = deps.store.shots(id).await?;
    let one: Vec<&Shot> = shots.iter().filter(|s| &s.id == shot).collect();
    if draw(deps, &p, &one, take).await.is_err() {
        deps.emit(id, &footage_step(0, one.len()), StepStatus::Failed);
        return Ok(());
    }
    deps.emit(id, step::DONE, StepStatus::Done);
    Ok(())
}

/// Draws the footage storyboards of `shots` (each must be covered) all at once and records each
/// one drawn; returns how many failed.
async fn draw(
    deps: &StudioDeps<'_>,
    p: &Production,
    shots: &[&Shot],
    take: u32,
) -> Result<usize, AppError> {
    let total = shots.len();
    if total == 0 {
        return Ok(0);
    }
    deps.emit(&p.id, &footage_step(0, total), StepStatus::Running);
    deps.short
        .ensure_room(&p.user_id, images_estimate(total))
        .await?;
    let requests = requests(deps, p, shots, take).await?;
    let boards: Vec<FootageBoardRequest> = requests.iter().map(|(_, r)| r.clone()).collect();
    let results = deps.images.draw_footage_boards(&boards).await?;
    let mut done = 0;
    for ((shot, request), result) in requests.iter().zip(results) {
        if result.is_ok() && record(deps, p, shot, request).await? {
            done += 1;
        }
    }
    deps.emit(&p.id, &footage_step(done, total), StepStatus::Done);
    Ok(total - done)
}

/// A request per shot whose covering moment's frame could be fetched.
async fn requests<'s>(
    deps: &StudioDeps<'_>,
    p: &Production,
    shots: &[&'s Shot],
    take: u32,
) -> Result<Vec<(&'s Shot, FootageBoardRequest)>, AppError> {
    let ids: Vec<_> = shots
        .iter()
        .filter_map(|s| s.matched_segment_id.clone())
        .collect();
    let moments = deps.search.catalogue.candidates(&p.user_id, &ids).await?;
    let dir = deps.scratch.user_dir(&p.user_id).await?;
    let mut out = Vec::new();
    for shot in shots {
        let Some(m) = moments
            .iter()
            .find(|c| Some(&c.segment_id) == shot.matched_segment_id.as_ref())
        else {
            continue;
        };
        let frame = dir.join(format!("footage_frame_{}.jpg", shot.id));
        let thumb = keys::thumb(&p.user_id, &m.clip_id, &m.segment_id);
        if deps.blobs().get_to_file(&thumb, &frame).await.is_err() {
            continue;
        }
        out.push((
            *shot,
            FootageBoardRequest {
                act: shot.act,
                title: shot.title.clone(),
                direction: shot.direction.clone(),
                aspect: p.aspect,
                frame,
                take,
                out: dir.join(format!("footage_board_{}.webp", shot.id)),
            },
        ));
    }
    Ok(out)
}

/// Uploads one drawn board and records it with the moment it shows; `false` when the upload
/// failed.
async fn record(
    deps: &StudioDeps<'_>,
    p: &Production,
    shot: &Shot,
    request: &FootageBoardRequest,
) -> Result<bool, AppError> {
    let Some(segment) = &shot.matched_segment_id else {
        return Ok(false);
    };
    let key = keys::footage_board(&p.user_id, &p.id, &shot.id);
    let put = PutFile {
        key: &key,
        path: &request.out,
        content_type: "image/webp",
        class: None,
        cache_control: Some(DERIVED_CACHE_CONTROL),
    };
    if deps.blobs().put_file(put).await.is_err() {
        return Ok(false);
    }
    deps.store
        .set_footage_board(&shot.id, &key, segment)
        .await?;
    Ok(true)
}
