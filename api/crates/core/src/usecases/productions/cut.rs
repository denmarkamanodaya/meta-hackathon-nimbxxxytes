//! The story cut: the covered shots' moments, in act then shot order, go to the existing
//! create-short use case unchanged, with the story brief as its request. The production's status
//! follows its short on every read.

use super::{StudioDeps, owned};
use crate::domain::ids::{ProductionId, ShortId, UserId};
use crate::domain::production::{
    Production, ProductionStatus, Shot, can_cut, covered_count, cut_segments, cut_shots,
    render_story_brief, status_with_short,
};
use crate::error::{AppError, ErrorCode};
use crate::usecases::shorts::{MAX_PROMPT_CHARS, NewShort, create_short, delete_short};

/// Cuts `user`'s production `id` into its story short and returns the short. A production that
/// already has its short returns it again.
///
/// # Errors
/// `NOT_FOUND` / `FORBIDDEN`; `VALIDATION_FAILED` while planning or when too little is covered
/// (fewer than 3 shots and under 60 %); create-short and store errors.
pub async fn cut_story(
    deps: &StudioDeps<'_>,
    user: &UserId,
    id: &ProductionId,
) -> Result<ShortId, AppError> {
    let p = synced(deps, owned(deps.store, user, id).await?).await?;
    if let Some(short) = p.short_id {
        return Ok(short);
    }
    if p.status == ProductionStatus::Planning {
        return Err(invalid("the shot list is still being planned"));
    }
    let shots = deps.store.shots(id).await?;
    if !can_cut(covered_count(&shots), shots.len()) {
        return Err(invalid(
            "cover at least 3 shots, or 60 % of them, before cutting the story",
        ));
    }
    let cut = cut_shots(&shots);
    let new = NewShort {
        prompt: render_story_brief(deps.story_brief, &p.brief, &cut, MAX_PROMPT_CHARS),
        segment_ids: cut_segments(&shots),
        aspect: p.aspect,
        target_s: p.target_s,
    };
    let short = create_short(&deps.short, user, new).await?;
    if deps.store.set_cut(id, &short).await? {
        return Ok(short);
    }
    // Another cut was linked first: keep that one.
    delete_short(&deps.short, user, &short).await?;
    let linked = owned(deps.store, user, id).await?.short_id;
    linked.ok_or_else(|| AppError::new(ErrorCode::Internal, "story short link was lost"))
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// The production of `user`'s story short `short` with all its shots in play order (act, title,
/// planned length and covering moment of each), so a timeline can be mapped to acts.
///
/// # Errors
/// `NOT_FOUND` when the short is no production's story; `FORBIDDEN` for another user's.
pub async fn short_production(
    deps: &StudioDeps<'_>,
    user: &UserId,
    short: &ShortId,
) -> Result<(Production, Vec<Shot>), AppError> {
    let p = deps
        .store
        .by_short(short)
        .await?
        .ok_or_else(|| AppError::new(ErrorCode::NotFound, "the short has no production"))?;
    let p = owned(deps.store, user, &p.id).await?;
    let shots = deps.store.shots(&p.id).await?;
    Ok((synced(deps, p).await?, shots))
}

/// `p` with the status its story short implies (see [`status_with_short`]), stored when it
/// changed.
pub(super) async fn synced(
    deps: &StudioDeps<'_>,
    mut p: Production,
) -> Result<Production, AppError> {
    if !matches!(
        p.status,
        ProductionStatus::Cutting | ProductionStatus::Ready
    ) {
        return Ok(p);
    }
    let short = match &p.short_id {
        Some(s) => deps.short.shorts.get(s).await?.map(|s| s.status),
        None => None,
    };
    let status = status_with_short(p.status, short);
    if status != p.status {
        deps.store
            .set_status(&p.id, status, p.error.as_deref())
            .await?;
        p.status = status;
        if short.is_none() {
            p.short_id = None;
        }
    }
    Ok(p)
}
