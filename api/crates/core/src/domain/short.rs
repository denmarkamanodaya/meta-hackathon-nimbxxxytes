//! Shorts: a cut made from picked moments, its versions and the step log that explains them.

use serde::{Deserialize, Serialize};

use crate::domain::captions::SpokenTurn;
use crate::domain::ids::{ClipId, SegmentId, ShortId, UserId};
use crate::domain::media::MediaExt;
use crate::domain::segmenting::Span;
use crate::domain::timeline::{Aspect, Bounds, Timeline};
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;

/// Where a short is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ShortStatus {
    /// The planner is writing a timeline.
    Planning,
    /// A preview or final render runs.
    Rendering,
    /// The agent is reviewing a preview.
    Critiquing,
    /// The agent is writing a new version.
    Revising,
    /// A version is ready to watch and edit.
    Ready,
    /// The short could not be made.
    Failed,
}

const STATUSES: [ShortStatus; 6] = [
    ShortStatus::Planning,
    ShortStatus::Rendering,
    ShortStatus::Critiquing,
    ShortStatus::Revising,
    ShortStatus::Ready,
    ShortStatus::Failed,
];

impl ShortStatus {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planning => "planning",
            Self::Rendering => "rendering",
            Self::Critiquing => "critiquing",
            Self::Revising => "revising",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        STATUSES
            .into_iter()
            .find(|s| s.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad short status {raw}")))
    }
}

/// A stored short.
#[derive(Debug, Clone, PartialEq)]
pub struct Short {
    /// Id.
    pub id: ShortId,
    /// Owner.
    pub user_id: UserId,
    /// The owner's request.
    pub prompt: String,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// Where it is.
    pub status: ShortStatus,
    /// Version the agent rates best.
    pub best_version: Option<u32>,
    /// Final render and the version it shows; `None` until one finished (cleared while a new
    /// one runs).
    pub render: Option<(ObjectKey, u32)>,
    /// Creation time, ISO-8601 UTC.
    pub created_at: String,
}

/// One version of the cut.
#[derive(Debug, Clone, PartialEq)]
pub struct Version {
    /// 1-based.
    pub n: u32,
    /// The fitted timeline.
    pub timeline: Timeline,
    /// Preview MP4, once rendered.
    pub preview_key: Option<ObjectKey>,
}

/// Kind of step in a short's log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    /// A timeline was planned.
    Plan,
    /// A tool started (render, clamp, …).
    ToolCall,
    /// A tool finished or changed something.
    ToolResult,
    /// A preview was reviewed.
    Critique,
    /// A new version was written.
    Revise,
    /// The run ended.
    Final,
}

const KINDS: [StepKind; 6] = [
    StepKind::Plan,
    StepKind::ToolCall,
    StepKind::ToolResult,
    StepKind::Critique,
    StepKind::Revise,
    StepKind::Final,
];

impl StepKind {
    /// Stored text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::ToolCall => "tool_call",
            Self::ToolResult => "tool_result",
            Self::Critique => "critique",
            Self::Revise => "revise",
            Self::Final => "final",
        }
    }

    /// Parses stored text.
    ///
    /// # Errors
    /// `INTERNAL` for unknown text.
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        KINDS
            .into_iter()
            .find(|k| k.as_str() == raw)
            .ok_or_else(|| AppError::new(ErrorCode::Internal, format!("bad step kind {raw}")))
    }
}

/// A step to append to the log.
#[derive(Debug, Clone, PartialEq)]
pub struct NewStep {
    /// Kind.
    pub kind: StepKind,
    /// Tool name, for tool steps.
    pub tool: Option<String>,
    /// Version the step works on.
    pub version: Option<u32>,
    /// One line for the owner.
    pub summary: String,
    /// When, ISO-8601 UTC.
    pub at: String,
}

/// A logged step: its 0-based position and content.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    /// 0-based order within the short.
    pub seq: u32,
    /// Content.
    pub step: NewStep,
}

/// A picked moment with what planning, captions and props need.
#[derive(Debug, Clone, PartialEq)]
pub struct ShortSegment {
    /// Segment.
    pub segment_id: SegmentId,
    /// Its clip.
    pub clip_id: ClipId,
    /// The clip's original file type.
    pub clip_ext: MediaExt,
    /// Span on the clip.
    pub span: Span,
    /// Facts description.
    pub description: Option<String>,
    /// Hook score 0–10.
    pub hook_score: Option<u8>,
    /// Quality 0–10.
    pub quality: Option<u8>,
    /// Turns of the clip that overlap the segment, in time order.
    pub turns: Vec<SpokenTurn>,
}

/// The trim bounds of each picked moment.
pub fn bounds(segments: &[ShortSegment]) -> Vec<Bounds> {
    segments
        .iter()
        .map(|s| Bounds {
            segment_id: s.segment_id.clone(),
            span: s.span,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_and_step_kinds_round_trip_their_stored_text() {
        for s in STATUSES {
            assert_eq!(ShortStatus::parse(s.as_str()).unwrap(), s);
        }
        for k in KINDS {
            assert_eq!(StepKind::parse(k.as_str()).unwrap(), k);
            assert_eq!(serde_json::to_value(k).unwrap(), k.as_str());
        }
        assert!(ShortStatus::parse("done").is_err());
        assert!(StepKind::parse("plan ").is_err());
    }
}
