//! The editing agent's pure rules: what to do next given the versions so far, when a budget
//! stops it, and which version is shown as the best.

use crate::domain::critique::Verdict;
use crate::domain::short::Version;

/// Limits of one agent run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AgentBudget {
    /// Model and render calls (plan, render, critique, revise), retries included.
    pub max_tool_calls: u32,
    /// Planner lookups (`search_moments`, `get_segment`), counted apart so they cannot use up
    /// the calls a revision needs.
    pub max_lookups: u32,
    /// Revised versions after the first.
    pub max_revisions: u32,
    /// Wall clock from the start of the run, milliseconds.
    pub max_wall_ms: i64,
    /// Model spend from the start of the run, dollars.
    pub max_cost_usd: f64,
}

impl AgentBudget {
    /// The limits every run uses (owner rulings: 12 model and render calls, 6 planner lookups,
    /// 2 revisions, 240 s wall clock so a 4-core box still reaches a revision, $0.25).
    pub const PRODUCTION: Self = Self {
        max_tool_calls: 12,
        max_lookups: 6,
        max_revisions: 2,
        max_wall_ms: 240_000,
        max_cost_usd: 0.25,
    };

    /// The most versions a run makes: the first cut plus every allowed revision.
    pub fn max_drafts(self) -> u32 {
        self.max_revisions + 1
    }
}

/// What the run has used so far.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Spent {
    /// Calls made.
    pub tool_calls: u32,
    /// Milliseconds since the run started.
    pub wall_ms: i64,
    /// Dollars since the run started.
    pub cost_usd: f64,
}

/// Why a run ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stop {
    /// The critic accepted the newest version.
    Accepted,
    /// The revision limit was reached.
    RevisionLimit,
    /// The tool-call limit was reached.
    ToolCalls,
    /// The time limit was reached.
    Time,
    /// The spend limit was reached.
    Cost,
    /// A preview could not be rendered.
    RenderFailed,
    /// A critique could not be made.
    CritiqueFailed,
    /// The planner gave no usable revision.
    RevisionRefused,
}

impl Stop {
    /// One line for the step log.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Accepted => "the critic accepted it",
            Self::RevisionLimit => "two revisions were made",
            Self::ToolCalls => "the tool-call budget ran out",
            Self::Time => "the time budget ran out",
            Self::Cost => "the cost budget ran out",
            Self::RenderFailed => "a preview could not be rendered",
            Self::CritiqueFailed => "a preview could not be reviewed",
            Self::RevisionRefused => "the revision did not answer the critique",
        }
    }
}

/// The next move of the run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Next {
    /// Plan version 1.
    Plan,
    /// Render the preview of version `n`.
    Render(u32),
    /// Review the preview of version `n`.
    Critique(u32),
    /// Write version `n + 1` from version `n` and its critique.
    Revise(u32),
    /// End the run.
    Finish(Stop),
}

impl AgentBudget {
    /// The budget that is used up, if any.
    pub fn exceeded(&self, spent: Spent) -> Option<Stop> {
        if spent.tool_calls >= self.max_tool_calls {
            Some(Stop::ToolCalls)
        } else if spent.wall_ms >= self.max_wall_ms {
            Some(Stop::Time)
        } else if spent.cost_usd >= self.max_cost_usd {
            Some(Stop::Cost)
        } else {
            None
        }
    }

    /// The next move from the stored versions. A finished run never resumes: the caller stops
    /// on [`Next::Finish`]. Budgets are checked separately before every call.
    pub fn next(&self, versions: &[Version]) -> Next {
        let Some(last) = versions.last() else {
            return Next::Plan;
        };
        match (&last.preview_key, &last.critique) {
            (None, _) => Next::Render(last.n),
            (Some(_), None) => Next::Critique(last.n),
            (Some(_), Some(c)) if c.verdict == Verdict::Accept => Next::Finish(Stop::Accepted),
            _ if last.n > self.max_revisions => Next::Finish(Stop::RevisionLimit),
            _ => Next::Revise(last.n),
        }
    }
}

/// The version to show: the highest critique total (the later one on a tie, since it answers
/// more notes); without any critique, the newest version with a preview, else the newest.
pub fn best_version(versions: &[Version]) -> Option<u32> {
    let scored = versions
        .iter()
        .filter_map(|v| v.critique.as_ref().map(|c| (c.total, v.n)))
        .max();
    scored
        .map(|(_, n)| n)
        .or_else(|| {
            versions
                .iter()
                .rev()
                .find(|v| v.preview_key.is_some())
                .map(|v| v.n)
        })
        .or_else(|| versions.last().map(|v| v.n))
}

#[cfg(test)]
mod tests;
