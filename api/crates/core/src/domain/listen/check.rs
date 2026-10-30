//! The check loop's pure rules: Spark's draft tidied, a checker's answer scored (the number check
//! on top), the lines to fix, a fix merged into the next version, the best version and the
//! version that last changed each line.

use super::{
    CheckAnswer, Draft, DraftTurn, FALLBACK_TITLE, FixAnswer, LineScore, ListenTurn, ListenVersion,
    MAX_KEY_POINTS, MAX_TITLE_CHARS, NUMBER_CAP, PASS_SCORE, Scored, numbers_kept,
};

fn one_line(raw: &str, max: usize) -> String {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .chars()
        .take(max)
        .collect::<String>()
        .trim_end()
        .to_owned()
}

fn key_points(raw: &[String]) -> Vec<String> {
    raw.iter()
        .map(|k| one_line(k, 200))
        .filter(|k| !k.is_empty())
        .take(MAX_KEY_POINTS)
        .collect()
}

/// A language code as stored: lower case, 2 or 3 letters, else empty.
fn lang_code(raw: &str) -> String {
    let code = raw.trim().to_ascii_lowercase();
    if (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase()) {
        code
    } else {
        String::new()
    }
}

/// Spark's draft made safe: a one-line title (or [`FALLBACK_TITLE`]), exactly one line per turn
/// in turn order (a turn Spark skipped gets an empty translation, which the check then fails),
/// clean language codes, the summary trimmed and at most [`MAX_KEY_POINTS`] key points.
pub fn tidied_draft(draft: &Draft, turns: &[ListenTurn]) -> Draft {
    let title = one_line(&draft.title, MAX_TITLE_CHARS);
    Draft {
        title: if title.is_empty() {
            FALLBACK_TITLE.to_owned()
        } else {
            title
        },
        turns: turns
            .iter()
            .map(|t| DraftTurn {
                index: t.index,
                lang: lang_code(draft.lang(t.index)),
                translation: draft.translation(t.index).trim().to_owned(),
            })
            .collect(),
        summary: draft.summary.trim().to_owned(),
        key_points: key_points(&draft.key_points),
    }
}

/// One line's score: the checker's (0 when it skipped the line), capped at [`NUMBER_CAP`] when
/// the translation lost a number of the original.
fn line_score(t: &ListenTurn, draft: &Draft, answer: &CheckAnswer) -> LineScore {
    let (mut score, mut issue) = answer
        .turns
        .iter()
        .find(|c| c.index == t.index)
        .map_or((0, "not checked".to_owned()), |c| {
            (c.score.min(100), one_line(&c.issue, 300))
        });
    if !numbers_kept(&t.text, draft.translation(t.index)) {
        score = score.min(NUMBER_CAP);
        if issue.is_empty() {
            issue = "A number from the original is missing.".to_owned();
        }
    }
    LineScore {
        index: t.index,
        score,
        issue,
    }
}

/// A checker's answer on `draft` scored line by line. A line the checker skipped scores 0; a
/// line whose translation lost a number of the original is capped at [`NUMBER_CAP`]. The
/// confidence is the lowest score; the version passes when every line and the summary reach
/// [`PASS_SCORE`].
pub fn scored(turns: &[ListenTurn], draft: &Draft, answer: &CheckAnswer) -> Scored {
    let lines: Vec<LineScore> = turns.iter().map(|t| line_score(t, draft, answer)).collect();
    let summary_score = answer.summary_score.min(100);
    let confidence = lines
        .iter()
        .map(|l| l.score)
        .chain(std::iter::once(summary_score))
        .min()
        .unwrap_or(summary_score);
    Scored {
        passed: confidence >= PASS_SCORE,
        lines,
        summary_score,
        summary_issues: answer
            .summary_issues
            .iter()
            .map(|i| one_line(i, 300))
            .filter(|i| !i.is_empty())
            .collect(),
        confidence,
    }
}

/// The lines the fixer must translate again: every line below [`PASS_SCORE`].
pub fn flagged_turns(check: &Scored) -> Vec<u32> {
    check
        .lines
        .iter()
        .filter(|l| l.score < PASS_SCORE)
        .map(|l| l.index)
        .collect()
}

/// The checker's notes as shown and sent to the fixer: `line N: issue` for each flagged line
/// (numbered from 1), then the summary's issues when the summary is flagged or has any.
pub fn checker_notes(check: &Scored) -> Vec<String> {
    let mut notes: Vec<String> = check
        .lines
        .iter()
        .filter(|l| l.score < PASS_SCORE)
        .map(|l| {
            let issue = if l.issue.is_empty() {
                "low score"
            } else {
                l.issue.as_str()
            };
            format!("line {}: {issue}", l.index + 1)
        })
        .collect();
    notes.extend(check.summary_issues.iter().cloned());
    if check.summary_score < PASS_SCORE && check.summary_issues.is_empty() {
        notes.push("summary: low score".to_owned());
    }
    notes
}

/// The checker's notes as the fixer is sent them: `turn N: issue` with the turn's own index (the
/// numbering of the prompt's turn lines), then the summary's issues.
pub fn fixer_notes(check: &Scored) -> Vec<String> {
    let mut notes: Vec<String> = check
        .lines
        .iter()
        .filter(|l| l.score < PASS_SCORE)
        .map(|l| format!("turn {}: {}", l.index, l.issue))
        .collect();
    notes.extend(check.summary_issues.iter().cloned());
    if check.summary_score < PASS_SCORE && check.summary_issues.is_empty() {
        notes.push("The summary or key points are not faithful to the turns.".to_owned());
    }
    notes
}

/// The next version: only the flagged lines take the fixer's translation (a flagged line the
/// fixer left out keeps its old one); the summary and key points change only when the summary was
/// flagged. Title and languages stay.
pub fn fixed_draft(prev: &Draft, fix: &FixAnswer, flagged: &[u32], summary_flagged: bool) -> Draft {
    let turns = prev
        .turns
        .iter()
        .map(|t| {
            let new = fix
                .turns
                .iter()
                .find(|f| f.index == t.index && flagged.contains(&t.index))
                .map(|f| f.translation.trim())
                .filter(|s| !s.is_empty());
            DraftTurn {
                index: t.index,
                lang: t.lang.clone(),
                translation: new.map_or_else(|| t.translation.clone(), str::to_owned),
            }
        })
        .collect();
    let rewrite = summary_flagged && !fix.summary.trim().is_empty();
    Draft {
        title: prev.title.clone(),
        turns,
        summary: if rewrite {
            fix.summary.trim().to_owned()
        } else {
            prev.summary.clone()
        },
        key_points: if rewrite {
            key_points(&fix.key_points)
        } else {
            prev.key_points.clone()
        },
    }
}

/// The version to keep: the highest confidence among checked versions; on a tie, the later one.
pub fn best_version(versions: &[ListenVersion]) -> Option<&ListenVersion> {
    versions
        .iter()
        .filter_map(|v| v.check.as_ref().map(|c| (c.confidence, v)))
        .max_by_key(|(confidence, v)| (*confidence, v.version))
        .map(|(_, v)| v)
}

/// The version up to `upto` that last changed turn `index`'s translation (1 when never fixed).
pub fn fixed_in(versions: &[ListenVersion], upto: u32, index: u32) -> u32 {
    let mut last = 1;
    let mut prev: Option<&str> = None;
    for v in versions.iter().filter(|v| v.version <= upto) {
        let now = v.draft.translation(index);
        if prev.is_some_and(|p| p != now) {
            last = v.version;
        }
        prev = Some(now);
    }
    last
}
