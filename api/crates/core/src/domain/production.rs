//! Productions: a brief planned into a shot list in acts, a storyboard frame per shot, and the
//! coverage of each shot by moments of the owner's library. Pure rules only.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ProductionId, SegmentId, ShortId, ShotId, UserId};
use crate::domain::search::Candidate;
use crate::domain::timeline::Aspect;
use crate::error::{AppError, ErrorCode};
use crate::keys::ObjectKey;
use crate::ports::EpochMillis;
use crate::time::parse_utc;

/// Fewest shots a shot list may have.
pub const MIN_SHOTS: usize = 3;
/// Most shots a shot list may have (and so most storyboard images per plan).
pub const MAX_SHOTS: usize = 12;
/// Longest brief, characters.
pub const MAX_BRIEF_CHARS: usize = 1000;
/// Longest title, characters.
pub const MAX_TITLE_CHARS: usize = 48;
/// Most tips kept per shot.
pub const MAX_TIPS: usize = 4;
/// Shortest and longest planned shot, seconds.
pub const SHOT_SECONDS: (f64, f64) = (1.0, 20.0);
/// Storyboard images drawn at once.
pub const BOARD_CONCURRENCY: usize = 4;
/// Library moments a shot is judged against.
pub const COVERAGE_CANDIDATES: usize = 8;
/// Shortest time between two coverage checks of one production, milliseconds.
pub const COVERAGE_MIN_GAP_MS: EpochMillis = 60_000;
/// Fewest covered shots that allow a story cut (or [`CUT_SHARE`] of the shots).
pub const CUT_MIN_SHOTS: usize = 3;
/// Share of covered shots that allows a story cut.
pub const CUT_SHARE: f64 = 0.6;

/// Progress step names a production run publishes (`boards` carries `n/m`, see [`boards_step`]).
pub mod step {
    /// Snapshot step while a plan runs and nothing more precise is known.
    pub const PLANNING: &str = "planning";
    /// Muse Spark writes the shot list.
    pub const SHOT_LIST: &str = "shot_list";
    /// Muse Image draws the storyboards.
    pub const BOARDS: &str = "boards";
    /// The library is matched against the shots.
    pub const COVERAGE: &str = "coverage";
    /// The run finished; the stream ends.
    pub const DONE: &str = "done";
}

/// `boards n/m`: `done` of `total` storyboards drawn.
pub fn boards_step(done: usize, total: usize) -> String {
    format!("{} {done}/{total}", step::BOARDS)
}

macro_rules! text_enum {
    ($(#[$doc:meta])* $name:ident { $($(#[$vdoc:meta])* $variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        pub enum $name {
            $($(#[$vdoc])* #[serde(rename = $text)] $variant),+
        }

        impl $name {
            /// Every value, in order.
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            /// Stored and wire text.
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }

            /// Parses stored or wire text.
            ///
            /// # Errors
            /// `VALIDATION_FAILED` for unknown text.
            pub fn parse(raw: &str) -> Result<Self, AppError> {
                Self::ALL
                    .iter()
                    .copied()
                    .find(|v| v.as_str() == raw)
                    .ok_or_else(|| {
                        AppError::new(
                            ErrorCode::ValidationFailed,
                            format!("unknown {} {raw}", stringify!($name)),
                        )
                    })
            }
        }
    };
}

text_enum!(
    /// The shape of a production.
    Format {
        /// 45-90 s: hook, story, payoff, outro.
        Story => "story",
        /// 10-30 s: one idea.
        Short => "short",
    }
);

impl Format {
    /// Accepted target lengths, seconds.
    pub fn target_range(self) -> (f64, f64) {
        match self {
            Self::Story => (45.0, 90.0),
            Self::Short => (10.0, 30.0),
        }
    }
}

text_enum!(
    /// The part of the story a shot belongs to; shots run in this order.
    Act {
        /// Grabs attention in the first seconds.
        Hook => "hook",
        /// The middle.
        Story => "story",
        /// The moment it builds to.
        Payoff => "payoff",
        /// The close.
        Outro => "outro",
    }
);

text_enum!(
    /// Where a production stands.
    ProductionStatus {
        /// The shot list, storyboards and first coverage are being made.
        Planning => "planning",
        /// Planned; the owner films what is missing.
        Shooting => "shooting",
        /// The story short is being cut.
        Cutting => "cutting",
        /// The story short is ready.
        Ready => "ready",
        /// The owner shared or downloaded it.
        Published => "published",
        /// Planning stopped; a retry resumes it.
        Failed => "failed",
    }
);

text_enum!(
    /// Where an export is posted (the owner posts; nothing is posted for them).
    Platform {
        /// TikTok, 9:16.
        Tiktok => "tiktok",
        /// Instagram Reels, 9:16.
        Reels => "reels",
        /// YouTube Shorts, 9:16.
        Shorts => "shorts",
        /// A feed post at the short's own aspect.
        Feed => "feed",
    }
);

text_enum!(
    /// File type of an image the owner uploads (brand logo, style references).
    ImageExt {
        /// PNG.
        Png => "png",
        /// JPEG.
        Jpg => "jpg",
    }
);

/// A production as stored.
#[derive(Debug, Clone, PartialEq)]
pub struct Production {
    /// Id.
    pub id: ProductionId,
    /// Owner.
    pub user_id: UserId,
    /// Title (from the brief until the shot list names it).
    pub title: String,
    /// The owner's words.
    pub brief: String,
    /// Story or short.
    pub format: Format,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// Whether bystanders' faces are blurred in the cut.
    pub blur_bystanders: bool,
    /// Where it stands.
    pub status: ProductionStatus,
    /// The story short, once cut.
    pub short_id: Option<ShortId>,
    /// Last coverage check (ISO-8601 UTC).
    pub coverage_checked_at: Option<String>,
    /// Why the last run failed or what it could not do.
    pub error: Option<String>,
    /// Creation time (ISO-8601 UTC).
    pub created_at: String,
}

/// What the owner asks for.
#[derive(Debug, Clone, PartialEq)]
pub struct NewProduction {
    /// The owner's words.
    pub brief: String,
    /// Story or short.
    pub format: Format,
    /// Output frame.
    pub aspect: Aspect,
    /// Wanted length, seconds.
    pub target_s: f64,
    /// Blur bystanders' faces.
    pub blur_bystanders: bool,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg.into())
}

/// The request with its brief trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or over-long brief, or a target outside the format's range.
pub fn checked_new(mut new: NewProduction) -> Result<NewProduction, AppError> {
    new.brief = new.brief.trim().to_owned();
    if new.brief.is_empty() || new.brief.chars().count() > MAX_BRIEF_CHARS {
        return Err(invalid(format!(
            "brief must be 1 to {MAX_BRIEF_CHARS} characters"
        )));
    }
    let (lo, hi) = new.format.target_range();
    if !new.target_s.is_finite() || new.target_s < lo || new.target_s > hi {
        return Err(invalid(format!(
            "a {} production is {lo}-{hi} seconds",
            new.format.as_str()
        )));
    }
    Ok(new)
}

/// A title from the brief's first words, until the shot list names the production.
pub fn draft_title(brief: &str) -> String {
    let mut title = String::new();
    for word in brief.split_whitespace().take(6) {
        let next = if title.is_empty() {
            word.to_owned()
        } else {
            format!("{title} {word}")
        };
        if next.chars().count() > MAX_TITLE_CHARS {
            break;
        }
        title = next;
    }
    if title.is_empty() {
        brief.chars().take(MAX_TITLE_CHARS).collect()
    } else {
        title
    }
}

/// One shot as the planner writes it.
#[derive(Debug, Clone, PartialEq)]
pub struct ShotDraft {
    /// Act.
    pub act: Act,
    /// Short title.
    pub title: String,
    /// One line: how to film it.
    pub direction: String,
    /// Short filming tips.
    pub tips: Vec<String>,
    /// Search phrase for coverage.
    pub query: String,
    /// Planned length, seconds.
    pub duration_s: f64,
}

/// The planner's answer.
#[derive(Debug, Clone, PartialEq)]
pub struct ShotList {
    /// Production title.
    pub title: String,
    /// Shots in play order.
    pub shots: Vec<ShotDraft>,
}

/// One stored shot.
#[derive(Debug, Clone, PartialEq)]
pub struct Shot {
    /// Id.
    pub id: ShotId,
    /// 1-based play order.
    pub ord: u32,
    /// Act.
    pub act: Act,
    /// Short title.
    pub title: String,
    /// One line: how to film it.
    pub direction: String,
    /// Filming tips.
    pub tips: Vec<String>,
    /// Search phrase for coverage.
    pub query: String,
    /// Planned length, seconds.
    pub duration_s: f64,
    /// Storyboard image, once drawn.
    pub board_key: Option<ObjectKey>,
    /// The library moment that covers it.
    pub matched_segment_id: Option<SegmentId>,
    /// Why it matched (or why nothing did).
    pub match_reason: Option<String>,
    /// Usable takes the library holds for it.
    pub take_count: u32,
}

fn tidy(text: &str, max: usize) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

/// The shot list checked and tidied: 3 to 12 shots with text, acts in order, at most
/// [`MAX_TIPS`] tips each, and durations fitted to `target_s` (see [`fit_durations`]).
///
/// # Errors
/// What is wrong, worded for the planner's retry.
pub fn checked_shot_list(list: ShotList, target_s: f64) -> Result<ShotList, String> {
    let n = list.shots.len();
    if !(MIN_SHOTS..=MAX_SHOTS).contains(&n) {
        return Err(format!(
            "the list has {n} shots; it must have {MIN_SHOTS} to {MAX_SHOTS}"
        ));
    }
    let title = tidy(&list.title, MAX_TITLE_CHARS);
    if title.is_empty() {
        return Err("the title is empty".to_owned());
    }
    if let Some(i) = list.shots.windows(2).position(|w| w[1].act < w[0].act) {
        return Err(format!(
            "shot {} ({}) comes after shot {} ({}); acts must run hook, story, payoff, outro",
            i + 2,
            list.shots[i + 1].act.as_str(),
            i + 1,
            list.shots[i].act.as_str()
        ));
    }
    let durations: Vec<f64> = list.shots.iter().map(|s| s.duration_s).collect();
    let fitted = fit_durations(&durations, target_s);
    let shots = list
        .shots
        .into_iter()
        .zip(fitted)
        .enumerate()
        .map(|(i, (s, duration_s))| tidy_shot(i + 1, s, duration_s))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ShotList { title, shots })
}

/// Shot number `n` with tidy text, at most [`MAX_TIPS`] tips and its fitted length.
fn tidy_shot(n: usize, s: ShotDraft, duration_s: f64) -> Result<ShotDraft, String> {
    let shot = ShotDraft {
        act: s.act,
        title: tidy(&s.title, 60),
        direction: tidy(&s.direction, 200),
        tips: s
            .tips
            .iter()
            .map(|t| tidy(t, 120))
            .filter(|t| !t.is_empty())
            .take(MAX_TIPS)
            .collect(),
        query: tidy(&s.query, 120),
        duration_s,
    };
    if shot.title.is_empty() || shot.direction.is_empty() || shot.query.is_empty() {
        return Err(format!("shot {n} needs a title, a direction and a query"));
    }
    Ok(shot)
}

/// Shot lengths scaled so they add up to `target_s`, each kept within [`SHOT_SECONDS`] and
/// rounded to 0.1 s. A missing, zero or negative length counts as the shortest shot.
pub fn fit_durations(durations: &[f64], target_s: f64) -> Vec<f64> {
    let (lo, hi) = SHOT_SECONDS;
    let raw: Vec<f64> = durations
        .iter()
        .map(|d| if d.is_finite() && *d > 0.0 { *d } else { lo })
        .collect();
    let sum: f64 = raw.iter().sum();
    let scale = if sum > 0.0 && target_s.is_finite() && target_s > 0.0 {
        target_s / sum
    } else {
        1.0
    };
    raw.iter()
        .map(|d| ((d * scale).clamp(lo, hi) * 10.0).round() / 10.0)
        .collect()
}

/// The moments a shot is judged against: the search pool in its order, each moment once, at most
/// [`COVERAGE_CANDIDATES`].
pub fn select_candidates(pool: Vec<Candidate>) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = Vec::with_capacity(COVERAGE_CANDIDATES);
    for c in pool {
        if out.len() == COVERAGE_CANDIDATES {
            break;
        }
        if !out.iter().any(|o| o.segment_id == c.segment_id) {
            out.push(c);
        }
    }
    out
}

/// One verdict of the coverage judge, as the model wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageAnswer {
    /// The shot's 1-based order.
    pub shot: u32,
    /// The moment that covers it, or `None`.
    pub segment_id: Option<String>,
    /// Why.
    pub reason: String,
    /// Usable takes among the candidates.
    pub take_count: u32,
}

/// The stored result of a coverage check for one shot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageMatch {
    /// The shot.
    pub shot_id: ShotId,
    /// The moment that covers it.
    pub segment_id: Option<SegmentId>,
    /// Why it matched, or why nothing did.
    pub reason: Option<String>,
    /// Usable takes; 0 when not covered.
    pub take_count: u32,
}

/// The judge's verdicts kept only where they hold: a shot is covered only by one of its own
/// candidates, each moment covers at most one shot (the earliest shot keeps it), and the take
/// count is between 1 and the candidate count for a covered shot and 0 otherwise. A shot the
/// judge skipped is not covered. `candidates[i]` belongs to `shots[i]`.
pub fn accept_coverage(
    shots: &[Shot],
    candidates: &[Vec<Candidate>],
    answers: &[CoverageAnswer],
) -> Vec<CoverageMatch> {
    let mut used: Vec<SegmentId> = Vec::new();
    let mut order: Vec<(usize, &Shot)> = shots.iter().enumerate().collect();
    order.sort_by_key(|(_, s)| s.ord);
    let mut out: Vec<(usize, CoverageMatch)> = order
        .into_iter()
        .map(|(i, shot)| {
            let own = candidates.get(i).map_or(&[][..], Vec::as_slice);
            let answer = answers.iter().find(|a| a.shot == shot.ord);
            let segment = answer
                .and_then(|a| a.segment_id.as_deref())
                .and_then(|id| own.iter().find(|c| c.segment_id.as_str() == id))
                .map(|c| c.segment_id.clone())
                .filter(|id| !used.contains(id));
            if let Some(id) = &segment {
                used.push(id.clone());
            }
            let max_takes = u32::try_from(own.len()).unwrap_or(u32::MAX);
            let take_count = match (&segment, answer) {
                (Some(_), Some(a)) => a.take_count.clamp(1, max_takes.max(1)),
                _ => 0,
            };
            let reason = answer
                .map(|a| tidy(&a.reason, 200))
                .filter(|r| !r.is_empty());
            (
                i,
                CoverageMatch {
                    shot_id: shot.id.clone(),
                    segment_id: segment,
                    reason,
                    take_count,
                },
            )
        })
        .collect();
    out.sort_by_key(|(i, _)| *i);
    out.into_iter().map(|(_, m)| m).collect()
}

/// Shots a library moment covers.
pub fn covered_count(shots: &[Shot]) -> usize {
    shots
        .iter()
        .filter(|s| s.matched_segment_id.is_some())
        .count()
}

/// Whether enough is covered to cut the story: at least [`CUT_MIN_SHOTS`] shots, or at least
/// [`CUT_SHARE`] of them.
pub fn can_cut(covered: usize, total: usize) -> bool {
    total > 0 && (covered >= CUT_MIN_SHOTS || covered as f64 >= CUT_SHARE * total as f64)
}

/// Whether a coverage check may run now: never checked, or the last check is at least
/// [`COVERAGE_MIN_GAP_MS`] old (an unreadable time counts as old).
pub fn coverage_allowed(checked_at: Option<&str>, now: EpochMillis) -> bool {
    checked_at
        .and_then(parse_utc)
        .is_none_or(|t| now - t >= COVERAGE_MIN_GAP_MS)
}

/// Whether a clip became ready after the last coverage check.
pub fn coverage_stale(checked_at: Option<&str>, last_ready_at: Option<&str>) -> bool {
    match (
        last_ready_at.and_then(parse_utc),
        checked_at.and_then(parse_utc),
    ) {
        (Some(ready), Some(checked)) => ready > checked,
        (Some(_), None) => true,
        (None, _) => false,
    }
}

/// The status a finished plan leaves: planning (or a failed plan being resumed) becomes
/// shooting; a production that went further keeps its status.
pub fn planned_status(current: ProductionStatus) -> ProductionStatus {
    match current {
        ProductionStatus::Planning | ProductionStatus::Failed => ProductionStatus::Shooting,
        other => other,
    }
}

/// The `size` asked of the image model: it sets the aspect only (the pixels returned differ).
pub fn board_size(aspect: Aspect) -> &'static str {
    match aspect {
        Aspect::Portrait => "1080x1350",
        Aspect::Square => "1080x1080",
    }
}

#[cfg(test)]
mod tests;
