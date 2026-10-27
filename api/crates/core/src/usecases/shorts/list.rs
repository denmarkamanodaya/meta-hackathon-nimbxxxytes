//! The shorts list: every short of the owner with its versions count, best score and a cover.

use super::ShortDeps;
use crate::domain::ids::UserId;
use crate::domain::short::{Short, Version};
use crate::error::AppError;
use crate::keys;

/// One row of the shorts list.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortListEntry {
    /// The short.
    pub short: Short,
    /// Versions made so far.
    pub version_count: u32,
    /// Critique total of the best version (else of the highest-scored one), if any was scored.
    pub best_score: Option<f64>,
    /// Thumbnail of the first shot's moment of the best (else latest) version.
    pub thumb_url: Option<String>,
}

/// The version a list row shows: the best one, else the latest.
fn shown(short: &Short, versions: &[Version]) -> Option<usize> {
    let best = short
        .best_version
        .and_then(|n| versions.iter().position(|v| v.n == n));
    best.or_else(|| versions.len().checked_sub(1))
}

/// The score a list row shows: the shown version's total, else the highest total.
fn score(versions: &[Version], shown: Option<usize>) -> Option<f64> {
    let of = |v: &Version| v.critique.as_ref().map(|c| f64::from(c.total));
    shown
        .and_then(|i| of(&versions[i]))
        .or_else(|| versions.iter().filter_map(of).reduce(f64::max))
}

/// The signed-in user's shorts, newest first.
///
/// # Errors
/// Store and signing errors pass through.
pub async fn list_shorts(
    deps: &ShortDeps<'_>,
    user: &UserId,
) -> Result<Vec<ShortListEntry>, AppError> {
    let mut out = Vec::new();
    for short in deps.shorts.list(user).await? {
        let versions = deps.shorts.versions(&short.id).await?;
        let pick = shown(&short, &versions);
        let first = pick.and_then(|i| versions[i].timeline.clips.first());
        let thumb_url = match first {
            Some(shot) => {
                let segments = deps.shorts.segments(&short.id).await?;
                match segments.iter().find(|s| s.segment_id == shot.segment_id) {
                    Some(s) => {
                        let key = keys::thumb(user, &s.clip_id, &s.segment_id);
                        Some(deps.blobs.presign_get(&key, deps.url_ttl).await?)
                    }
                    None => None,
                }
            }
            None => None,
        };
        out.push(ShortListEntry {
            version_count: u32::try_from(versions.len()).unwrap_or(u32::MAX),
            best_score: score(&versions, pick),
            short,
            thumb_url,
        });
    }
    Ok(out)
}
