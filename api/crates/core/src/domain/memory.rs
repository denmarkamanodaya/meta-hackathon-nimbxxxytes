//! Memory Lane: a short, gentle reminiscence session made from the owner's footage of one named
//! person (or of one clip, a day), for a named viewer. [`gather`] turns a clip's segments, face
//! tracks and turns into candidate moments, [`pick`] ranks and spreads them, and
//! [`apply_written`] / [`apply_checked`] hold Muse Spark's lines to the rules.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{ClipId, MemoryId, PersonId, UserId};
use crate::domain::index::{ClipDetailRows, TrackView};
use crate::domain::segmenting::Span;
use crate::domain::text_enum::text_enum;

/// Moments kept for a person session.
pub const PERSON_MOMENTS: usize = 6;
/// Moments kept for a clip (one day) session.
pub const CLIP_MOMENTS: usize = 8;
/// Most moments of one clip in a person session.
pub const PER_CLIP: usize = 3;
/// Two moments of one clip start at least this far apart, seconds.
pub const MIN_GAP_S: f64 = 25.0;
/// Longest speech excerpt per moment sent to Spark, characters.
pub const SAID_CHARS: usize = 500;
/// Longest line or question kept, characters.
pub const LINE_CHARS: usize = 300;
/// Longest title kept, characters.
pub const TITLE_CHARS: usize = 60;
/// Most named people of one user a session looks through.
pub const MAX_PEOPLE: u32 = 1000;
/// Long edge of the stored cover, pixels.
pub const COVER_EDGE_PX: u32 = 1080;

text_enum!(
    /// What a session is about.
    SubjectKind {
        /// One named person, across every clip they are in.
        Person => "person",
        /// Everyone visible in one clip.
        Clip => "clip",
    }
);

text_enum!(
    /// Where a session is.
    MemoryStatus {
        /// The `memory` job is running.
        Making => "making",
        /// Every step finished.
        Ready => "ready",
        /// The job gave up.
        Failed => "failed",
    }
);

/// A named person seen in a moment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MomentPerson {
    /// The person; `None` when the name no longer matches one of the owner's people.
    pub person_id: Option<PersonId>,
    /// Their name.
    pub name: String,
    /// Stored key of one of their face crops in the library.
    pub crop_key: Option<String>,
}

/// One moment of a session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MemoryMoment {
    /// 0-based order in the session.
    pub index: u32,
    /// The clip.
    pub clip_id: ClipId,
    /// The clip's title (the event).
    pub clip_title: String,
    /// When the clip was recorded (ISO-8601 UTC).
    pub recorded_at: Option<String>,
    /// Start, clip seconds.
    pub start_s: f64,
    /// End, clip seconds.
    pub end_s: f64,
    /// Seconds the subject is on screen in it.
    pub on_screen_s: f64,
    /// A second inside the subject's face track, where the frame is taken.
    pub frame_s: f64,
    /// The named people present, by name.
    pub people: Vec<MomentPerson>,
    /// The segment's description.
    pub description: String,
    /// What was said in it.
    pub said: String,
    /// Stored key of the frame of the moment.
    pub frame_key: Option<String>,
    /// The caption line read aloud; empty until written.
    pub line: String,
    /// The gentle question to the viewer; empty until written.
    pub prompt: String,
    /// Whether the check ran on the line.
    pub checked: bool,
    /// What the check changed, when it rewrote the line.
    pub fixed_note: Option<String>,
}

impl MemoryMoment {
    /// Names of the people present.
    pub fn names(&self) -> Vec<&str> {
        self.people.iter().map(|p| p.name.as_str()).collect()
    }
}

/// A session row.
#[derive(Debug, Clone, PartialEq)]
pub struct Memory {
    /// Id.
    pub id: MemoryId,
    /// Owner.
    pub user_id: UserId,
    /// Person or clip.
    pub subject_kind: SubjectKind,
    /// The person (person sessions).
    pub person_id: Option<PersonId>,
    /// The clip (clip sessions).
    pub clip_id: Option<ClipId>,
    /// The person's name or the clip's title.
    pub subject_name: String,
    /// Who watches (one of the owner's named people).
    pub viewer_id: Option<PersonId>,
    /// Their name.
    pub viewer_name: Option<String>,
    /// Title; empty until written.
    pub title: String,
    /// Where it is.
    pub status: MemoryStatus,
    /// The step running.
    pub step: Option<String>,
    /// The moments, in session order.
    pub moments: Vec<MemoryMoment>,
    /// Lines the check rewrote or dropped.
    pub fixed_count: u32,
    /// Stored cover.
    pub cover_key: Option<String>,
    /// Why it failed.
    pub error: Option<String>,
    /// ISO-8601 UTC.
    pub created_at: String,
    /// ISO-8601 UTC.
    pub updated_at: String,
}

/// Whom a moment search is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subject<'a> {
    /// The tracks named this person (case-insensitive).
    Person(&'a str),
    /// Every visible track.
    Everyone,
}

fn same_name(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// A face track's span: frames are 1 fps and each stands for a whole second.
fn track_span(t: &TrackView) -> Span {
    Span {
        start_s: t.first_s,
        end_s: t.last_s + 1.0,
    }
}

fn is_subject(t: &TrackView, subject: Subject<'_>) -> bool {
    if t.hidden {
        return false;
    }
    match subject {
        Subject::Person(name) => t.person_name.as_deref().is_some_and(|n| same_name(n, name)),
        Subject::Everyone => true,
    }
}

/// `text` cut to `max` characters on a whole word, single spaces.
fn cut(text: &str, max: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() <= max {
        return joined;
    }
    let head: String = joined.chars().take(max).collect();
    match head.rfind(' ') {
        Some(i) => head[..i].to_owned(),
        None => head,
    }
}

/// The named people visible in `span`, by name, each once, with a crop.
fn present(tracks: &[TrackView], span: Span) -> Vec<MomentPerson> {
    let mut out: Vec<MomentPerson> = Vec::new();
    for t in tracks.iter().filter(|t| !t.hidden) {
        let Some(name) = t.person_name.as_deref() else {
            continue;
        };
        if track_span(t).overlap(span) <= 0.0 || out.iter().any(|p| same_name(&p.name, name)) {
            continue;
        }
        out.push(MomentPerson {
            person_id: None,
            name: name.to_owned(),
            crop_key: t.crop_key.clone(),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// A second inside the subject's track that overlaps `span` most (the middle of the overlap).
fn frame_in(own: &[Span], span: Span) -> f64 {
    own.iter()
        .max_by(|a, b| a.overlap(span).total_cmp(&b.overlap(span)))
        .map_or(span.mid(), |t| {
            Span {
                start_s: t.start_s.max(span.start_s),
                end_s: t.end_s.min(span.end_s),
            }
            .mid()
        })
}

/// Shortest stretch a moment plays, seconds.
pub const MIN_PLAY_S: f64 = 3.0;

/// The part of `span` a moment plays: from the first to the last second a named person present
/// is on screen (the subject's own tracks when nobody named is), at least [`MIN_PLAY_S`], never
/// outside the segment. A segment can hold several shots; this keeps the picture on the people
/// the line is about.
fn play_window(tracks: &[TrackView], own: &[Span], span: Span) -> Span {
    let named: Vec<Span> = tracks
        .iter()
        .filter(|t| !t.hidden && t.person_name.is_some())
        .map(track_span)
        .filter(|t| t.overlap(span) > 0.0)
        .collect();
    let pool: Vec<Span> = if named.is_empty() {
        own.iter()
            .copied()
            .filter(|t| t.overlap(span) > 0.0)
            .collect()
    } else {
        named
    };
    let start = pool
        .iter()
        .map(|t| t.start_s)
        .fold(f64::INFINITY, f64::min)
        .max(span.start_s);
    let end = pool
        .iter()
        .map(|t| t.end_s)
        .fold(f64::NEG_INFINITY, f64::max)
        .min(span.end_s);
    if end <= start {
        return span;
    }
    let short = MIN_PLAY_S - (end - start);
    if short <= 0.0 {
        return Span {
            start_s: start,
            end_s: end,
        };
    }
    let start = (start - short / 2.0).max(span.start_s);
    let end = (start + MIN_PLAY_S).min(span.end_s);
    Span {
        start_s: (end - MIN_PLAY_S).max(span.start_s),
        end_s: end,
    }
}

/// What was said during `span`, cut to [`SAID_CHARS`].
fn said_in(d: &ClipDetailRows, span: Span) -> String {
    let said: Vec<&str> = d
        .turns
        .iter()
        .filter(|t| t.span.overlap(span) > 0.0)
        .map(|t| t.text.as_str())
        .collect();
    cut(&said.join(" "), SAID_CHARS)
}

/// Every described segment of the clip where the subject is on screen: its people, its speech
/// and a second inside the subject's longest track in it. Not yet ranked; lines empty.
pub fn gather(d: &ClipDetailRows, subject: Subject<'_>) -> Vec<MemoryMoment> {
    let clip = &d.row.clip;
    let own: Vec<Span> = d
        .tracks
        .iter()
        .filter(|t| is_subject(t, subject))
        .map(track_span)
        .collect();
    let mut out = Vec::new();
    for s in &d.segments {
        let description = s
            .facts
            .as_ref()
            .map(|f| f.description.trim().to_owned())
            .unwrap_or_default();
        let span = s.segment.span;
        let on: f64 = own.iter().map(|t| t.overlap(span)).sum();
        if description.is_empty() || on <= 0.0 {
            continue;
        }
        let play = play_window(&d.tracks, &own, span);
        out.push(MemoryMoment {
            index: 0,
            clip_id: clip.id.clone(),
            clip_title: clip.display_title(),
            recorded_at: clip.recorded_at().map(str::to_owned),
            start_s: play.start_s,
            end_s: play.end_s,
            on_screen_s: on,
            frame_s: frame_in(&own, play),
            people: present(&d.tracks, span),
            description,
            said: said_in(d, span),
            frame_key: None,
            line: String::new(),
            prompt: String::new(),
            checked: false,
            fixed_note: None,
        });
    }
    out
}

/// Rank: named people present (the viewer counts double), then seconds on screen.
fn rank(m: &MemoryMoment, viewer: Option<&str>) -> (usize, f64) {
    let seen = m.people.len();
    let bonus = viewer.map_or(0, |v| {
        usize::from(m.people.iter().any(|p| same_name(&p.name, v)))
    });
    (seen + bonus, m.on_screen_s)
}

/// The session's moments: ranked (see [`rank`]), at most `per_clip` of one clip, never two of one
/// clip within [`MIN_GAP_S`], at most `keep`; then in time order (recorded, clip, start) and
/// numbered from 0.
pub fn pick(
    mut all: Vec<MemoryMoment>,
    viewer: Option<&str>,
    (per_clip, keep): (usize, usize),
) -> Vec<MemoryMoment> {
    all.sort_by(|a, b| {
        let (ra, rb) = (rank(a, viewer), rank(b, viewer));
        rb.0.cmp(&ra.0).then(rb.1.total_cmp(&ra.1))
    });
    let mut picked: Vec<MemoryMoment> = Vec::new();
    for m in all {
        if picked.len() == keep {
            break;
        }
        let same: Vec<&MemoryMoment> = picked.iter().filter(|p| p.clip_id == m.clip_id).collect();
        let near = same
            .iter()
            .any(|p| (p.start_s - m.start_s).abs() < MIN_GAP_S);
        if same.len() < per_clip && !near {
            picked.push(m);
        }
    }
    picked.sort_by(|a, b| {
        a.recorded_at
            .as_deref()
            .unwrap_or("")
            .cmp(b.recorded_at.as_deref().unwrap_or(""))
            .then_with(|| a.clip_id.cmp(&b.clip_id))
            .then(a.start_s.total_cmp(&b.start_s))
    });
    for (i, m) in (0u32..).zip(picked.iter_mut()) {
        m.index = i;
    }
    picked
}

/// The per-clip and total limits of a session of `kind`.
pub fn limits(kind: SubjectKind) -> (usize, usize) {
    match kind {
        SubjectKind::Person => (PER_CLIP, PERSON_MOMENTS),
        SubjectKind::Clip => (CLIP_MOMENTS, CLIP_MOMENTS),
    }
}

/// One written moment as Spark answered it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrittenLine {
    /// The moment.
    pub index: u32,
    /// The caption line.
    pub line: String,
    /// The question.
    pub prompt: String,
}

/// Spark's session draft.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WriteAnswer {
    /// Session title.
    pub title: String,
    /// One line per moment.
    pub moments: Vec<WrittenLine>,
}

/// One line as the checker judged it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineCheck {
    /// The moment.
    pub index: u32,
    /// Every claim is supported by the inputs.
    pub supported: bool,
    /// The claims that are not.
    pub unsupported_claims: Vec<String>,
    /// The line keeping only supported facts (empty when nothing is left).
    pub line: String,
}

/// The draft's lines on the moments. A moment Spark wrote nothing for is dropped, the rest are
/// numbered again from 0. Returns the cleaned title (`fallback` when Spark gave none).
pub fn apply_written(
    moments: &mut Vec<MemoryMoment>,
    answer: &WriteAnswer,
    fallback: &str,
) -> String {
    for m in moments.iter_mut() {
        if let Some(w) = answer.moments.iter().find(|w| w.index == m.index) {
            m.line = cut(&w.line, LINE_CHARS);
            m.prompt = cut(&w.prompt, LINE_CHARS);
        }
    }
    moments.retain(|m| !m.line.is_empty());
    renumber(moments);
    let title = cut(&answer.title, TITLE_CHARS);
    if title.is_empty() {
        cut(fallback, TITLE_CHARS)
    } else {
        title
    }
}

fn renumber(moments: &mut [MemoryMoment]) {
    for (i, m) in (0u32..).zip(moments.iter_mut()) {
        m.index = i;
    }
}

/// The checker's verdicts on the moments: an unsupported line becomes the corrected one with a
/// note of what was removed, an empty correction drops the moment. Every moment is marked
/// checked; the rest are numbered again from 0. Returns how many lines were rewritten or dropped.
pub fn apply_checked(moments: &mut Vec<MemoryMoment>, checks: &[LineCheck]) -> u32 {
    let mut fixed = 0;
    for m in moments.iter_mut() {
        m.checked = true;
        let Some(c) = checks.iter().find(|c| c.index == m.index) else {
            continue;
        };
        if c.supported {
            continue;
        }
        fixed += 1;
        m.line = cut(&c.line, LINE_CHARS);
        let claims: Vec<String> = c
            .unsupported_claims
            .iter()
            .map(|s| cut(s, LINE_CHARS))
            .filter(|s| !s.is_empty())
            .collect();
        m.fixed_note = Some(if claims.is_empty() {
            "Reworded to keep only what the footage shows.".to_owned()
        } else {
            format!("Removed: {}", claims.join("; "))
        });
    }
    moments.retain(|m| !m.line.is_empty());
    renumber(moments);
    fixed
}

/// What the cover is drawn from: the title and the first moments' descriptions.
pub fn cover_scene(title: &str, moments: &[MemoryMoment]) -> String {
    let scenes: Vec<&str> = moments
        .iter()
        .take(3)
        .map(|m| m.description.as_str())
        .collect();
    cut(&format!("{title}. {}", scenes.join(" ")), 600)
}

#[cfg(test)]
mod tests;
