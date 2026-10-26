//! The agent's review of a preview, and the rules a revised timeline must follow: every v2+ cut
//! says which version it changed and which critique note each change answers.

use serde::{Deserialize, Serialize};

use crate::domain::timeline::Timeline;
use crate::error::{AppError, ErrorCode};

/// Scores of the five dimensions, each 0–10.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scores {
    /// First two seconds.
    pub hook: u8,
    /// Shot rhythm.
    pub pacing: u8,
    /// Flow between shots.
    pub continuity: u8,
    /// Caption quality (10 when none are needed).
    pub captions: u8,
    /// Closeness to the target length.
    pub length: u8,
}

impl Scores {
    /// Sum of the five scores, 0–50.
    pub fn total(self) -> u32 {
        [
            self.hook,
            self.pacing,
            self.continuity,
            self.captions,
            self.length,
        ]
        .into_iter()
        .map(u32::from)
        .sum()
    }
}

/// One timestamped problem in a preview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CritiqueNote {
    /// Seconds on the preview.
    pub at: f64,
    /// What is wrong.
    pub issue: String,
    /// The proposed edit.
    pub fix: String,
}

/// Keep the cut or change it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    /// Good enough to show.
    Accept,
    /// Should be revised.
    Revise,
}

impl Verdict {
    /// Wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Revise => "revise",
        }
    }
}

/// The review of one version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Critique {
    /// Version reviewed (1-based).
    pub version: u32,
    /// Five scores.
    pub scores: Scores,
    /// Sum of the scores.
    pub total: u32,
    /// Problems, most important first.
    pub notes: Vec<CritiqueNote>,
    /// Keep or change.
    pub verdict: Verdict,
}

impl Critique {
    /// The critique as stored: the version it reviewed and a total that equals the score sum
    /// (models add up wrongly now and then; the best version is chosen by this number).
    pub fn settled(mut self, version: u32) -> Self {
        self.version = version;
        self.total = self.scores.total();
        self
    }

    /// One line for the step log: score, verdict and the most important note.
    pub fn summary(&self) -> String {
        let top = self.notes.first().map_or(String::new(), |n| {
            format!(" First note at {:.1} s: {}", n.at, n.issue)
        });
        format!(
            "Version {}: {}/50, {}.{top}",
            self.version,
            self.total,
            self.verdict.as_str()
        )
    }
}

fn rejected(msg: String) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// Checks that a planned v`n` (n ≥ 2) is a proper revision of v`n − 1` reviewed by `critique`:
/// it names that version and every change cites one of its notes.
///
/// # Errors
/// `VALIDATION_FAILED` naming what is missing, for the planner's retry.
pub fn check_revision(timeline: &Timeline, n: u32, critique: &Critique) -> Result<(), AppError> {
    let revision = timeline
        .revision
        .as_ref()
        .ok_or_else(|| rejected(format!("version {n} must say what it revised")))?;
    let previous = n.saturating_sub(1);
    if revision.from_version != previous {
        return Err(rejected(format!(
            "version {n} must revise version {previous}, not {}",
            revision.from_version
        )));
    }
    if revision.changes.is_empty() {
        return Err(rejected(format!("version {n} lists no changes")));
    }
    let notes = critique.notes.len();
    for (i, change) in revision.changes.iter().enumerate() {
        match change.note_index {
            Some(k) if usize::try_from(k).is_ok_and(|k| k < notes) => {}
            Some(k) => {
                return Err(rejected(format!(
                    "change {i} cites note {k}, but the critique has {notes} notes"
                )));
            }
            None => return Err(rejected(format!("change {i} cites no critique note"))),
        }
    }
    Ok(())
}

/// What the planner sees as `{previous}` when revising: the last timeline (as JSON) and its
/// critique, with the notes numbered as a revision must cite them.
pub fn previous_text(timeline_json: &str, critique: &Critique) -> String {
    let notes: Vec<String> = critique
        .notes
        .iter()
        .enumerate()
        .map(|(i, n)| format!("note {i} at {:.1} s: {} Fix: {}", n.at, n.issue, n.fix))
        .collect();
    let notes = if notes.is_empty() {
        "(no notes)".to_owned()
    } else {
        notes.join("\n")
    };
    format!(
        "Version {} timeline:\n{timeline_json}\nCritique (total {}/50, verdict {}):\n{notes}",
        critique.version,
        critique.total,
        critique.verdict.as_str()
    )
}

#[cfg(test)]
mod tests;
