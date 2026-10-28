//! Coverage: for each shot, the local search stage (keyword + vector legs fused, no model call)
//! finds up to 8 candidate moments; one Muse Spark call judges every shot at once; the verdicts
//! that hold are stored with the check time. Covered shots then get their storyboard redrawn
//! from the footage (only when due; a board that fails never fails the check).

use super::{StudioDeps, footage};
use crate::domain::ids::ProductionId;
use crate::domain::job::StepStatus;
use crate::domain::production::{Production, accept_coverage, select_candidates, step};
use crate::error::{AppError, ErrorCode};
use crate::ports::CoverageShot;
use crate::usecases::search::local_candidates;

/// Checks the coverage of production `id` now (the caller applied the once-a-minute rule).
/// Progress ends with `done`, or a failed `coverage` step whose reason becomes the production's
/// note; the status never changes.
///
/// # Errors
/// Only store errors while recording a failure.
pub async fn check_coverage(deps: &StudioDeps<'_>, id: &ProductionId) -> Result<(), AppError> {
    let Some(p) = deps.store.get(id).await? else {
        return Ok(());
    };
    match run(deps, &p).await {
        Ok(()) => {
            deps.emit(id, step::DONE, StepStatus::Done);
            Ok(())
        }
        Err(err) => {
            let note = format!("coverage check failed: {}", err.message);
            deps.store.set_status(id, p.status, Some(&note)).await?;
            deps.emit(id, step::COVERAGE, StepStatus::Failed);
            Ok(())
        }
    }
}

/// One check, then the footage storyboards it made due.
pub(super) async fn run(deps: &StudioDeps<'_>, p: &Production) -> Result<(), AppError> {
    judge(deps, p).await?;
    // Boards from the footage are a bonus: their failure is not the check's.
    footage::draw_due(deps, p).await.ok();
    Ok(())
}

/// One check. A failed judge call still records the check time, so a failing model is asked at
/// most once a minute.
async fn judge(deps: &StudioDeps<'_>, p: &Production) -> Result<(), AppError> {
    deps.emit(&p.id, step::COVERAGE, StepStatus::Running);
    let shots = deps.store.shots(&p.id).await?;
    let mut candidates = Vec::with_capacity(shots.len());
    for shot in &shots {
        let pool = local_candidates(&deps.search, &p.user_id, &shot.query).await?;
        candidates.push(select_candidates(pool));
    }
    let answers = if candidates.iter().all(Vec::is_empty) {
        // Nothing in the library resembles any shot: no call needed.
        Vec::new()
    } else {
        let items: Vec<CoverageShot<'_>> = shots
            .iter()
            .zip(&candidates)
            .map(|(s, c)| CoverageShot {
                ord: s.ord,
                act: s.act,
                title: &s.title,
                direction: &s.direction,
                candidates: c,
            })
            .collect();
        match deps.planner.match_coverage(&p.brief, &items).await {
            Ok(answers) => answers,
            Err(err) => {
                deps.store.set_coverage(&p.id, &[], &deps.now()).await?;
                return Err(err);
            }
        }
    };
    let matches = accept_coverage(&shots, &candidates, &answers);
    if deps.store.get(&p.id).await?.is_none() {
        return Err(AppError::new(ErrorCode::NotFound, "production was deleted"));
    }
    deps.store
        .set_coverage(&p.id, &matches, &deps.now())
        .await?;
    deps.emit(&p.id, step::COVERAGE, StepStatus::Done);
    Ok(())
}
