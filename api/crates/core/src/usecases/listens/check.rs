//! The check loop: Spark checks the newest version line by line (back-translation, scores) and
//! the code's number check caps lines that lost a number. A version that passes is kept; else the
//! fixer translates the flagged lines again and the next version is checked, up to
//! [`MAX_VERSIONS`]. After the last one the best version is kept and marked not passed. Every
//! version is stored with its check, so a restarted step goes on from the last stored one.

use std::ops::Range;

use super::ListenPorts;
use crate::domain::job::Job;
use crate::domain::listen::{
    CheckAnswer, Draft, FixAnswer, Listen, ListenTurn, ListenVersion, MAX_VERSIONS, Overview,
    PASS_SCORE, Scored, best_version, fixed_draft, fixed_in, fixer_notes, flagged_turns,
    language_shares, output_language, part_label, parts, scored,
};
use crate::error::{AppError, ErrorCode};
use crate::ports::{CheckRequest, FixRequest, ListenResult};

/// `draft` cut down to the turns in `range` (summary and key points whole).
fn part_draft(draft: &Draft, turns: &[ListenTurn]) -> Draft {
    Draft {
        turns: turns
            .iter()
            .filter_map(|t| draft.turns.iter().find(|d| d.index == t.index).cloned())
            .collect(),
        ..draft.clone()
    }
}

/// Spark checks `draft` part by part; the summary's score is the lowest any part gave it.
async fn check_draft(
    p: &ListenPorts,
    turns: &[ListenTurn],
    draft: &Draft,
) -> Result<Scored, AppError> {
    let ranges = parts(turns);
    let mut all = CheckAnswer {
        summary_score: 100,
        ..CheckAnswer::default()
    };
    for (n, range) in ranges.iter().enumerate() {
        let part = part_label(n, ranges.len());
        let these = &turns[range.clone()];
        let sub = part_draft(draft, these);
        let request = CheckRequest {
            part: &part,
            turns: these,
            draft: &sub,
        };
        let answer = p.interpreter.check(request).await?;
        all.turns.extend(answer.turns);
        all.summary_score = all.summary_score.min(answer.summary_score);
        for issue in answer.summary_issues {
            if !all.summary_issues.contains(&issue) {
                all.summary_issues.push(issue);
            }
        }
    }
    Ok(scored(turns, draft, &all))
}

/// The parts the fixer is sent: those with a flagged line, or the first one when only the
/// summary was flagged.
fn parts_to_fix(ranges: &[Range<usize>], turns: &[ListenTurn], flagged: &[u32]) -> Vec<usize> {
    let with_lines: Vec<usize> = ranges
        .iter()
        .enumerate()
        .filter(|(_, r)| {
            turns[(*r).clone()]
                .iter()
                .any(|t| flagged.contains(&t.index))
        })
        .map(|(n, _)| n)
        .collect();
    if with_lines.is_empty() && !ranges.is_empty() {
        vec![0]
    } else {
        with_lines
    }
}

/// The next version's draft: the fixer is sent each part to fix with every note.
async fn fix_draft(
    p: &ListenPorts,
    l: &Listen,
    (turns, draft): (&[ListenTurn], &Draft),
    check: &Scored,
) -> Result<Draft, AppError> {
    let target = output_language(&l.target)?;
    let flagged = flagged_turns(check);
    let summary_flagged = check.summary_score < PASS_SCORE;
    let notes = fixer_notes(check);
    let ranges = parts(turns);
    let mut all = FixAnswer::default();
    for n in parts_to_fix(&ranges, turns, &flagged) {
        let these = &turns[ranges[n].clone()];
        let sub = part_draft(draft, these);
        let request = FixRequest {
            target,
            turns: these,
            draft: &sub,
            notes: &notes,
        };
        let answer = p.interpreter.fix(request).await?;
        all.turns.extend(answer.turns);
        if all.summary.trim().is_empty() {
            all.summary = answer.summary;
            all.key_points = answer.key_points;
        }
    }
    Ok(fixed_draft(draft, &all, &flagged, summary_flagged))
}

/// What the listen shows for the kept version: its lines with scores, issues and the version
/// that last changed each, its title, summary and key points.
fn final_result(
    turns: &[ListenTurn],
    versions: &[ListenVersion],
    kept: &ListenVersion,
) -> ListenResult {
    let check = kept.check.as_ref();
    let lines: Vec<ListenTurn> = turns
        .iter()
        .map(|t| {
            let line = check.and_then(|c| c.lines.iter().find(|l| l.index == t.index));
            ListenTurn {
                lang: kept.draft.lang(t.index).to_owned(),
                translation: kept.draft.translation(t.index).to_owned(),
                score: line.map(|l| l.score),
                issue: line.map(|l| l.issue.clone()).unwrap_or_default(),
                fixed_in: fixed_in(versions, kept.version, t.index),
                ..t.clone()
            }
        })
        .collect();
    ListenResult {
        version: kept.version,
        overview: Overview {
            title: kept.draft.title.clone(),
            summary: kept.draft.summary.clone(),
            key_points: kept.draft.key_points.clone(),
        },
        languages: language_shares(&lines),
        confidence: check.map(|c| c.confidence),
        passed: check.is_some_and(|c| c.passed),
        turns: lines,
    }
}

/// `last`'s check: the stored one, or a new one, stored.
async fn checked(
    p: &ListenPorts,
    l: &Listen,
    turns: &[ListenTurn],
    last: &ListenVersion,
) -> Result<Scored, AppError> {
    if let Some(c) = &last.check {
        return Ok(c.clone());
    }
    let c = check_draft(p, turns, &last.draft).await?;
    let stored = ListenVersion {
        check: Some(c.clone()),
        ..last.clone()
    };
    p.store.put_version(&l.id, &stored).await?;
    Ok(c)
}

/// `check`: checks the newest version, fixes and checks again until one passes or
/// [`MAX_VERSIONS`] were made, then keeps the best. The list shows `check` and the version in
/// hand while it runs; a job replaced by a language change stops before its next call.
pub(super) async fn check_loop(p: &ListenPorts, job: &Job, l: &Listen) -> Result<(), AppError> {
    let turns = p.store.turns(&l.id).await?;
    loop {
        if !super::current(p, job).await? {
            return Ok(());
        }
        let versions = p.store.versions(&l.id).await?;
        let last = versions
            .last()
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::Internal, "no version to check"))?;
        p.store.set_step(&l.id, Some("check"), last.version).await?;
        let check = checked(p, l, &turns, &last).await?;
        if check.passed || last.version >= MAX_VERSIONS {
            let versions = p.store.versions(&l.id).await?;
            let kept = best_version(&versions)
                .ok_or_else(|| AppError::new(ErrorCode::Internal, "no checked version"))?;
            let result = final_result(&turns, &versions, kept);
            p.store.set_step(&l.id, Some("check"), kept.version).await?;
            return p.store.set_result(&l.id, &result).await;
        }
        let draft = fix_draft(p, l, (&turns, &last.draft), &check).await?;
        let next = ListenVersion {
            version: last.version + 1,
            draft,
            check: None,
        };
        p.store.put_version(&l.id, &next).await?;
    }
}
