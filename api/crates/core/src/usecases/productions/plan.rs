//! The plan run: shot list (once; stored shots are kept), storyboard frames for the shots that
//! have none (a few at a time; frames already in storage are only recorded), then the first
//! coverage check. Every step can rerun after a crash without repeating paid work.

use std::path::Path;

use super::{StudioDeps, coverage};
use crate::domain::ids::{ProductionId, ShotId};
use crate::domain::job::StepStatus;
use crate::domain::production::{
    BOARD_CONCURRENCY, Production, ProductionStatus, Shot, ShotList, boards_step,
    checked_shot_list, planned_status, step,
};
use crate::error::{AppError, ErrorCode};
use crate::keys::{self, DERIVED_CACHE_CONTROL, ObjectKey};
use crate::ports::{BoardRequest, PutFile, ShotListAttempt, ShotListRequest};

/// Runs the plan of production `id` and records how it ended: `shooting` (with a note when some
/// frames or the coverage check failed) or `failed` with the reason. Progress goes to the
/// production's event stream and ends with `done` or a failed step.
///
/// # Errors
/// Only store errors while recording the outcome; the run's own failure is recorded, not returned.
pub async fn plan_production(deps: &StudioDeps<'_>, id: &ProductionId) -> Result<(), AppError> {
    match run(deps, id).await {
        Ok(notes) => {
            let Some(p) = deps.store.get(id).await? else {
                return Ok(());
            };
            let note = (!notes.is_empty()).then(|| notes.join("; "));
            deps.store
                .set_status(id, planned_status(p.status), note.as_deref())
                .await?;
            deps.emit(id, step::DONE, StepStatus::Done);
            Ok(())
        }
        Err(err) => {
            if deps.store.get(id).await?.is_some() {
                let status = ProductionStatus::Failed;
                deps.store
                    .set_status(id, status, Some(&err.message))
                    .await?;
            }
            deps.emit(id, step::PLANNING, StepStatus::Failed);
            Ok(())
        }
    }
}

/// The steps; returns notes on what could not be done (the plan still counts as made).
async fn run(deps: &StudioDeps<'_>, id: &ProductionId) -> Result<Vec<String>, AppError> {
    let p = deps
        .store
        .get(id)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "production was deleted"))?;
    let shots = ensure_shots(deps, &p).await?;
    let mut notes = Vec::new();
    let failed = draw_missing_boards(deps, &p, &shots).await?;
    if failed > 0 {
        notes.push(format!(
            "{failed} storyboard frame(s) could not be drawn; retry to draw them"
        ));
    }
    if let Err(err) = coverage::run(deps, &p).await {
        notes.push(format!("coverage check failed: {}", err.message));
    }
    Ok(notes)
}

/// The stored shots, or a new shot list from the planner (one retry with the refusal reason).
async fn ensure_shots(deps: &StudioDeps<'_>, p: &Production) -> Result<Vec<Shot>, AppError> {
    let stored = deps.store.shots(&p.id).await?;
    if !stored.is_empty() {
        return Ok(stored);
    }
    deps.emit(&p.id, step::SHOT_LIST, StepStatus::Running);
    let list = ask_shot_list(deps, p).await?;
    let mut shots = Vec::with_capacity(list.shots.len());
    for (i, d) in list.shots.into_iter().enumerate() {
        shots.push(Shot {
            id: ShotId::parse(deps.ids.new_id())?,
            ord: u32::try_from(i + 1).unwrap_or(u32::MAX),
            act: d.act,
            title: d.title,
            direction: d.direction,
            tips: d.tips,
            query: d.query,
            duration_s: d.duration_s,
            board_key: None,
            matched_segment_id: None,
            match_reason: None,
            take_count: 0,
        });
    }
    deps.store.save_plan(&p.id, &list.title, &shots).await?;
    deps.emit(&p.id, step::SHOT_LIST, StepStatus::Done);
    deps.store.shots(&p.id).await
}

/// A shot list that passes the schema and the domain rules, asking once more with the reason
/// when the first answer does not.
async fn ask_shot_list(deps: &StudioDeps<'_>, p: &Production) -> Result<ShotList, AppError> {
    let library = deps.store.library_summary(&p.user_id).await?;
    let mut rejection: Option<String> = None;
    for _ in 0..2 {
        let request = ShotListRequest {
            brief: &p.brief,
            format: p.format,
            aspect: p.aspect,
            target_s: p.target_s,
            library: &library,
            rejection: rejection.as_deref(),
        };
        let why = match deps.planner.shot_list(&request).await? {
            ShotListAttempt::Valid(list) => match checked_shot_list(list, p.target_s) {
                Ok(list) => return Ok(list),
                Err(why) => why,
            },
            ShotListAttempt::Invalid { error } => error,
        };
        rejection = Some(why);
    }
    Err(AppError::new(
        ErrorCode::ModelUnavailable,
        format!(
            "the shot list was refused twice: {}",
            rejection.unwrap_or_default()
        ),
    ))
}

/// Draws the frames shots lack, [`BOARD_CONCURRENCY`] at a time, and returns how many failed.
async fn draw_missing_boards(
    deps: &StudioDeps<'_>,
    p: &Production,
    shots: &[Shot],
) -> Result<usize, AppError> {
    let todo: Vec<&Shot> = shots.iter().filter(|s| s.board_key.is_none()).collect();
    let total = shots.len();
    let mut done = total - todo.len();
    let mut failed = 0;
    let dir = deps.scratch.user_dir(&p.user_id).await?;
    for chunk in todo.chunks(BOARD_CONCURRENCY) {
        deps.emit(&p.id, &boards_step(done, total), StepStatus::Running);
        let (drawn, lost) = draw_chunk(deps, p, &dir, chunk).await?;
        done += drawn;
        failed += lost;
    }
    deps.emit(&p.id, &boards_step(done, total), StepStatus::Done);
    Ok(failed)
}

/// Frames for up to [`BOARD_CONCURRENCY`] shots: a frame already in storage is only recorded, the
/// others are drawn at once, uploaded and recorded. Returns (frames now stored, frames failed).
async fn draw_chunk(
    deps: &StudioDeps<'_>,
    p: &Production,
    dir: &Path,
    chunk: &[&Shot],
) -> Result<(usize, usize), AppError> {
    let mut stored = 0;
    let mut to_draw: Vec<(&Shot, ObjectKey, BoardRequest)> = Vec::new();
    for shot in chunk {
        let key = keys::board(&p.user_id, &p.id, &shot.id);
        if deps.blobs().object_size(&key).await.is_ok() {
            deps.store.set_board(&shot.id, &key).await?;
            stored += 1;
            continue;
        }
        to_draw.push((shot, key, board_request(p, dir, shot)));
    }
    let requests: Vec<BoardRequest> = to_draw.iter().map(|(_, _, r)| r.clone()).collect();
    let results = deps.images.draw_boards(&requests).await?;
    let mut uploaded = Vec::new();
    for ((shot, key, request), result) in to_draw.iter().zip(results) {
        if result.is_err() {
            continue;
        }
        let put = PutFile {
            key,
            path: &request.out,
            content_type: "image/webp",
            class: None,
            cache_control: Some(DERIVED_CACHE_CONTROL),
        };
        deps.blobs().put_file(put).await?;
        deps.store.set_board(&shot.id, key).await?;
        uploaded.push(key.clone());
    }
    if deps.store.get(&p.id).await?.is_none() {
        // Deleted while drawing: these uploads would be orphans.
        deps.blobs().delete(&uploaded).await?;
        return Err(AppError::new(ErrorCode::NotFound, "production was deleted"));
    }
    Ok((stored + uploaded.len(), to_draw.len() - uploaded.len()))
}

/// The frame of `shot`, written to the user's scratch directory (one file per shot, replaced on
/// a redraw).
fn board_request(p: &Production, dir: &Path, shot: &Shot) -> BoardRequest {
    BoardRequest {
        act: shot.act,
        title: shot.title.clone(),
        direction: shot.direction.clone(),
        aspect: p.aspect,
        anchors: Vec::new(),
        out: dir.join(format!("board_{}.webp", shot.id)),
    }
}
