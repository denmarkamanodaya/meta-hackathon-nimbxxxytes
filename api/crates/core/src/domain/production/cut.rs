//! The story cut: which moments the existing short editor gets and in what order, the request it
//! is given, and the production status its short implies.

use super::{ProductionStatus, Shot};
use crate::domain::ids::SegmentId;
use crate::domain::short::ShortStatus;
use crate::domain::timeline::MAX_SHOTS;

/// Title lengths tried, longest first, until the shot lines leave the brief its room.
const TITLE_STEPS: [usize; 5] = [usize::MAX, 32, 20, 12, 8];
/// Room the brief keeps before titles are shortened further, characters.
const BRIEF_ROOM: usize = 80;
/// Marks text that was cut short.
const ELLIPSIS: char = '…';

/// The covered shots in play order: by act (hook, story, payoff, outro), then by shot order.
/// Uncovered shots are skipped, a moment used twice is kept once, and at most [`MAX_SHOTS`]
/// (the editor's limit) are kept.
pub fn cut_shots(shots: &[Shot]) -> Vec<&Shot> {
    let mut covered: Vec<&Shot> = shots
        .iter()
        .filter(|s| s.matched_segment_id.is_some())
        .collect();
    covered.sort_by_key(|s| (s.act, s.ord));
    let mut seen: Vec<&SegmentId> = Vec::new();
    covered.retain(|s| match &s.matched_segment_id {
        Some(id) if !seen.contains(&id) => {
            seen.push(id);
            true
        }
        _ => false,
    });
    covered.truncate(MAX_SHOTS);
    covered
}

/// The moments of [`cut_shots`], in the same order.
pub fn cut_segments(shots: &[Shot]) -> Vec<SegmentId> {
    cut_shots(shots)
        .into_iter()
        .filter_map(|s| s.matched_segment_id.clone())
        .collect()
}

fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push(ELLIPSIS);
    out
}

/// One line per shot: `1. hook: Doors open (4 s)`, titles shortened to `title_max` characters.
pub fn story_shot_lines(shots: &[&Shot], title_max: usize) -> String {
    shots
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "{}. {}: {} ({:.0} s)",
                i + 1,
                s.act.as_str(),
                shorten(&s.title, title_max),
                s.duration_s
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The editor's request: `template` (the `## user` text of the story brief prompt) with
/// `{brief}` and `{shots}` filled, within `max_chars`. When it is too long the shot titles are
/// shortened first, then the brief, and as a last resort the whole text is cut.
pub fn render_story_brief(
    template: &str,
    brief: &str,
    shots: &[&Shot],
    max_chars: usize,
) -> String {
    let fill = |brief: &str, lines: &str| {
        template
            .replacen("{brief}", brief, 1)
            .replacen("{shots}", lines, 1)
    };
    let brief_len = brief.chars().count();
    let brief_need = brief_len.min(BRIEF_ROOM);
    let lines = TITLE_STEPS
        .iter()
        .map(|max| story_shot_lines(shots, *max))
        .find(|l| fill("", l).chars().count() + brief_need <= max_chars)
        .unwrap_or_else(|| story_shot_lines(shots, TITLE_STEPS[TITLE_STEPS.len() - 1]));
    let room = max_chars.saturating_sub(fill("", &lines).chars().count());
    let brief = match room {
        0 => String::new(),
        n if n < brief_len => shorten(brief, n),
        _ => brief.to_owned(),
    };
    shorten(&fill(&brief, &lines), max_chars)
}

/// The status a production shows given its story short: a cut whose short is ready is `ready`;
/// a cut or ready production whose short was deleted goes back to `shooting`; anything else is
/// unchanged.
pub fn status_with_short(status: ProductionStatus, short: Option<ShortStatus>) -> ProductionStatus {
    match (status, short) {
        (ProductionStatus::Cutting | ProductionStatus::Ready, None) => ProductionStatus::Shooting,
        (ProductionStatus::Cutting, Some(ShortStatus::Ready)) => ProductionStatus::Ready,
        (other, _) => other,
    }
}

#[cfg(test)]
#[path = "cut_tests.rs"]
mod tests;
