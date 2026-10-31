//! The ask box: what a typed or spoken request means. Muse Spark reads the request into an
//! [`IntentDraft`]; [`settle`] then holds the draft to the rules below, so the box only ever runs
//! an intent over the caller's own projects, the clips they added and their own documents.

use crate::domain::document::{DEFAULT_QUESTION, DocKind};
use crate::domain::ids::{ClipId, DocumentId, PersonId, ProjectId};
use crate::domain::timeline::Aspect;
use crate::error::{AppError, ErrorCode};

/// Longest request, characters after trimming.
pub const MAX_TEXT_CHARS: usize = 500;
/// Most clips added to one request.
pub const MAX_CLIPS: usize = 20;
/// Most documents added to one request.
pub const MAX_DOCUMENTS: usize = 5;
/// Most of the caller's documents the model is shown (newest first).
pub const LISTED_DOCUMENTS: usize = 30;
/// Longest title, characters.
pub const TITLE_MAX_CHARS: usize = 60;
/// Longest new project name, characters (the project rule).
pub const PROJECT_NAME_MAX_CHARS: usize = 60;
/// Shortest and longest short, seconds.
pub const TARGET_RANGE_S: (f64, f64) = (3.0, 90.0);
/// Length of a short when the request names none, seconds.
pub const DEFAULT_TARGET_S: f64 = 30.0;
/// Most "Did you mean…" choices.
pub const MAX_CHOICES: usize = 3;
/// The choice offered when a guide has no clip.
pub const ADD_TASK_VIDEO: &str = "Add the task video with +";
/// The choice offered when a request needs clips and has none.
pub const ADD_CLIPS: &str = "Add clips with +";
/// The choice offered when a document cannot be told apart, or there is none.
pub const ADD_LETTER: &str = "Add the letter with +";
/// Most of the caller's named people the model is shown.
pub const LISTED_PEOPLE: usize = 200;

/// What the box will do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntentKind {
    /// Show all results for a query.
    Search,
    /// Pick files and upload them.
    Upload,
    /// Cut a short.
    MakeShort,
    /// Make a MyWay guide from one clip.
    MakeGuide,
    /// Put clips in a project.
    AddToProject,
    /// Answer a question about one iRead document, aloud.
    ReadDocument,
    /// Start a Memory Lane session about one named person or one clip (a day).
    MemoryLane,
    /// Ask the person which they meant.
    Unclear,
}

impl IntentKind {
    const ALL: [Self; 8] = [
        Self::Search,
        Self::Upload,
        Self::MakeShort,
        Self::MakeGuide,
        Self::AddToProject,
        Self::ReadDocument,
        Self::MemoryLane,
        Self::Unclear,
    ];

    /// Wire and schema text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Search => "search",
            Self::Upload => "upload",
            Self::MakeShort => "make_short",
            Self::MakeGuide => "make_guide",
            Self::AddToProject => "add_to_project",
            Self::ReadDocument => "read_document",
            Self::MemoryLane => "memory_lane",
            Self::Unclear => "unclear",
        }
    }

    /// The kind named by `raw`; `None` for anything else.
    pub fn parse(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == raw)
    }
}

/// Where a short's moments come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortSource {
    /// The clips added to the box.
    Attached,
    /// A project's clips.
    Project,
    /// A library search.
    Search,
}

impl ShortSource {
    const ALL: [Self; 3] = [Self::Attached, Self::Project, Self::Search];

    /// Wire and schema text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Attached => "attached",
            Self::Project => "project",
            Self::Search => "search",
        }
    }

    /// The source named by `raw`; `None` for anything else.
    pub fn parse(raw: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == raw)
    }
}

/// One "Did you mean…" choice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    /// What the button says.
    pub label: String,
    /// The full request the box sends when it is picked.
    pub text: String,
}

/// A caller's project as the model sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskProject {
    /// Id.
    pub id: ProjectId,
    /// Name.
    pub name: String,
    /// Clips in it.
    pub clip_count: u32,
}

/// A clip added to the box, as the model sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct AskClip {
    /// Id.
    pub id: ClipId,
    /// Title, or the file name before it has one.
    pub title: String,
    /// Length, seconds; `None` before it is probed.
    pub duration_s: Option<f64>,
}

/// One of the caller's documents as the model sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskDocument {
    /// Id.
    pub id: DocumentId,
    /// Title; empty until it is read.
    pub title: String,
    /// What kind of paper it is.
    pub kind: DocKind,
    /// Who sent it; may be empty.
    pub sender: String,
    /// The date printed on it; may be empty.
    pub date: String,
    /// Whether it was added to the box with +.
    pub added: bool,
}

/// One of the caller's named people.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskPerson {
    /// Id.
    pub id: PersonId,
    /// Name.
    pub name: String,
}

/// Everything the model is told about a request.
#[derive(Debug, Clone, PartialEq)]
pub struct IntentRequest {
    /// The request, trimmed.
    pub text: String,
    /// The caller's projects.
    pub projects: Vec<AskProject>,
    /// The clips added to the box, each checked to be the caller's.
    pub clips: Vec<AskClip>,
    /// How many clips the library holds.
    pub library_clips: u32,
    /// The caller's newest documents plus every added one, each checked to be the caller's.
    pub documents: Vec<AskDocument>,
    /// The caller's named people.
    pub people: Vec<AskPerson>,
    /// The caller's library clips by title (never sent to the model; a Memory Lane request
    /// naming a day is matched against them).
    pub library: Vec<AskClip>,
}

/// The model's reading, before the rules: kinds and ids are still raw text.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct IntentDraft {
    /// One of the [`IntentKind`] texts (anything else reads as `unclear`).
    pub kind: String,
    /// Short name of the job.
    pub title: String,
    /// Search words.
    pub query: Option<String>,
    /// One of the [`ShortSource`] texts.
    pub source: Option<String>,
    /// A project id.
    pub project_id: Option<String>,
    /// A project to create.
    pub new_project_name: Option<String>,
    /// Clip ids.
    pub clip_ids: Vec<String>,
    /// Wanted short length, seconds.
    pub target_s: Option<f64>,
    /// `4:5` or `1:1`.
    pub aspect: Option<String>,
    /// "Did you mean…" choices.
    pub choices: Vec<Choice>,
    /// Document ids.
    pub document_ids: Vec<String>,
    /// The question about the document.
    pub question: Option<String>,
    /// The person a Memory Lane session is about, as named in the request.
    pub person_name: Option<String>,
    /// Who watches the session, as named in the request.
    pub viewer_name: Option<String>,
}

/// An intent the box can run. Fields a kind does not use are `None` or empty.
#[derive(Debug, Clone, PartialEq)]
pub struct Intent {
    /// What to do.
    pub kind: IntentKind,
    /// Short name of the job, at most [`TITLE_MAX_CHARS`].
    pub title: String,
    /// Search words: always for `search` and a `make_short` from a search; the optional topic of
    /// a `make_short` from a project (`None` means the whole project).
    pub query: Option<String>,
    /// Where a short's moments come from (`make_short` only).
    pub source: Option<ShortSource>,
    /// One of the caller's projects (`make_short` from a project, `add_to_project`).
    pub project_id: Option<ProjectId>,
    /// A project to create (`add_to_project`).
    pub new_project_name: Option<String>,
    /// Added clips the intent uses, in the order sent.
    pub clip_ids: Vec<ClipId>,
    /// Short length, seconds (`make_short` only).
    pub target_s: Option<f64>,
    /// Short frame (`make_short` only).
    pub aspect: Option<Aspect>,
    /// 1 to [`MAX_CHOICES`] choices (`unclear` only).
    pub choices: Vec<Choice>,
    /// Exactly one of the caller's documents (`read_document` only).
    pub document_ids: Vec<DocumentId>,
    /// What to ask about it, at most [`MAX_TEXT_CHARS`] (`read_document` only).
    pub question: Option<String>,
    /// The caller's person the session is about (`memory_lane` about a person).
    pub person_id: Option<PersonId>,
    /// The caller's person who watches (`memory_lane`, optional).
    pub viewer_id: Option<PersonId>,
    /// The clip (a day) the session is about (`memory_lane` about a clip).
    pub clip_id: Option<ClipId>,
}

impl Intent {
    fn bare(kind: IntentKind, title: String) -> Self {
        Self {
            kind,
            title,
            query: None,
            source: None,
            project_id: None,
            new_project_name: None,
            clip_ids: Vec::new(),
            target_s: None,
            aspect: None,
            choices: Vec::new(),
            document_ids: Vec::new(),
            question: None,
            person_id: None,
            viewer_id: None,
            clip_id: None,
        }
    }

    /// `unclear` with `choices`, keeping only the title.
    fn unclear(self, choices: Vec<Choice>) -> Self {
        Self {
            choices,
            ..Self::bare(IntentKind::Unclear, self.title)
        }
    }
}

fn invalid(msg: &str) -> AppError {
    AppError::new(ErrorCode::ValidationFailed, msg)
}

/// The request trimmed.
///
/// # Errors
/// `VALIDATION_FAILED` when it is empty or longer than [`MAX_TEXT_CHARS`] after trimming.
pub fn checked_text(raw: &str) -> Result<String, AppError> {
    let text = raw.trim();
    let n = text.chars().count();
    if n == 0 {
        return Err(invalid("say what you want to do"));
    }
    if n > MAX_TEXT_CHARS {
        return Err(invalid("keep the request to 500 characters"));
    }
    Ok(text.to_owned())
}

/// The added clips without repeats, in the order sent.
///
/// # Errors
/// `VALIDATION_FAILED` for more than [`MAX_CLIPS`] distinct clips.
pub fn checked_clips(ids: &[ClipId]) -> Result<Vec<ClipId>, AppError> {
    let mut out: Vec<ClipId> = Vec::with_capacity(ids.len());
    for id in ids {
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    if out.len() > MAX_CLIPS {
        return Err(invalid("add at most 20 clips"));
    }
    Ok(out)
}

/// The added documents without repeats, in the order sent.
///
/// # Errors
/// `VALIDATION_FAILED` for more than [`MAX_DOCUMENTS`] distinct documents.
pub fn checked_documents(ids: &[DocumentId]) -> Result<Vec<DocumentId>, AppError> {
    let mut out: Vec<DocumentId> = Vec::with_capacity(ids.len());
    for id in ids {
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    if out.len() > MAX_DOCUMENTS {
        return Err(invalid("add at most 5 documents"));
    }
    Ok(out)
}

/// One line, single spaces, at most `max` characters; `None` when nothing is left.
fn one_line(raw: &str, max: usize) -> Option<String> {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = joined.chars().take(max).collect();
    let cut = cut.trim_end().to_owned();
    (!cut.is_empty()).then_some(cut)
}

/// The draft's title cleaned, or the request itself when the model gave none.
fn title_of(draft: &str, text: &str) -> String {
    one_line(draft, TITLE_MAX_CHARS)
        .or_else(|| one_line(text, TITLE_MAX_CHARS))
        .unwrap_or_default()
}

/// The draft's clip ids that were sent, in the order sent; every sent clip when the draft names
/// none of them (the model can never add a clip).
fn kept_clips(draft: &[String], r: &IntentRequest) -> Vec<ClipId> {
    let named: Vec<ClipId> = r
        .clips
        .iter()
        .filter(|c| draft.iter().any(|d| d == c.id.as_str()))
        .map(|c| c.id.clone())
        .collect();
    if named.is_empty() {
        r.clips.iter().map(|c| c.id.clone()).collect()
    } else {
        named
    }
}

/// The draft's project when it is one of the caller's; else the caller's project with the draft's
/// new name (ignoring case); else `None`.
fn owned_project(d: &IntentDraft, r: &IntentRequest) -> Option<ProjectId> {
    let by_id = d
        .project_id
        .as_deref()
        .and_then(|id| r.projects.iter().find(|p| p.id.as_str() == id));
    let by_name = || {
        let name = d.new_project_name.as_deref()?.trim().to_lowercase();
        r.projects.iter().find(|p| p.name.to_lowercase() == name)
    };
    by_id.or_else(by_name).map(|p| p.id.clone())
}

/// Clamped to [`TARGET_RANGE_S`]; [`DEFAULT_TARGET_S`] when missing or not a number.
pub fn target_of(raw: Option<f64>) -> f64 {
    let (lo, hi) = TARGET_RANGE_S;
    raw.filter(|t| t.is_finite())
        .map_or(DEFAULT_TARGET_S, |t| t.clamp(lo, hi))
}

/// Up to [`MAX_CHOICES`] choices with a label and a request of at most [`MAX_TEXT_CHARS`].
fn clean_choices(raw: &[Choice]) -> Vec<Choice> {
    raw.iter()
        .filter_map(|c| {
            let label = one_line(&c.label, TITLE_MAX_CHARS)?;
            let text = c.text.trim();
            let fits = !text.is_empty() && text.chars().count() <= MAX_TEXT_CHARS;
            fits.then(|| Choice {
                label,
                text: text.to_owned(),
            })
        })
        .take(MAX_CHOICES)
        .collect()
}

fn choice(label: impl Into<String>, text: impl Into<String>) -> Choice {
    Choice {
        label: label.into(),
        text: text.into(),
    }
}

/// Holds the model's draft to the rules: projects must be the caller's, clips must have been
/// sent, every kind gets what it needs or becomes `unclear` with choices, and the title fits.
pub fn settle(d: &IntentDraft, r: &IntentRequest) -> Intent {
    let kind = IntentKind::parse(&d.kind).unwrap_or(IntentKind::Unclear);
    let base = Intent::bare(kind, title_of(&d.title, &r.text));
    match kind {
        IntentKind::Search => Intent {
            query: d
                .query
                .as_deref()
                .and_then(|q| one_line(q, MAX_TEXT_CHARS))
                .or_else(|| Some(r.text.clone())),
            ..base
        },
        IntentKind::Upload => base,
        IntentKind::MakeShort => make_short(base, d, r),
        IntentKind::MakeGuide => make_guide(base, r),
        IntentKind::AddToProject => add_to_project(base, d, r),
        IntentKind::ReadDocument => read_document(base, d, r),
        IntentKind::MemoryLane => memory_lane(base, d, r),
        IntentKind::Unclear => unclear(base, d, r),
    }
}

/// A short needs a source it can use: added clips, one of the caller's projects, or a query.
fn make_short(base: Intent, d: &IntentDraft, r: &IntentRequest) -> Intent {
    let target = target_of(d.target_s);
    let mut out = Intent {
        source: d.source.as_deref().and_then(ShortSource::parse),
        target_s: Some(target),
        aspect: Some(
            d.aspect
                .as_deref()
                .and_then(|a| Aspect::parse(a).ok())
                .unwrap_or(Aspect::Portrait),
        ),
        ..base
    };
    let usable = match out.source {
        Some(ShortSource::Attached) => {
            out.clip_ids = kept_clips(&d.clip_ids, r);
            !out.clip_ids.is_empty()
        }
        Some(ShortSource::Project) => {
            // A topic inside the project ("the sunsets from Thai trip") is optional.
            out.query = d.query.as_deref().and_then(|q| one_line(q, MAX_TEXT_CHARS));
            out.project_id = owned_project(d, r);
            out.project_id.is_some()
        }
        Some(ShortSource::Search) => {
            out.query = d.query.as_deref().and_then(|q| one_line(q, MAX_TEXT_CHARS));
            out.query.is_some()
        }
        None => false,
    };
    if usable {
        out
    } else {
        out.unclear(short_choices(target, r))
    }
}

/// Ways to make the short: from the added clips (or add some first), or from the first project.
fn short_choices(target: f64, r: &IntentRequest) -> Vec<Choice> {
    let mut out = vec![if r.clips.is_empty() {
        choice(ADD_CLIPS, r.text.clone())
    } else {
        choice(
            "Make a short from the added clips",
            format!("make a {target} second short from the added clips"),
        )
    }];
    if let Some(p) = r.projects.first() {
        out.push(choice(
            format!("Make a short from {}", p.name),
            format!("make a {target} second short from the {} project", p.name),
        ));
    }
    clean_choices(&out)
}

/// A guide is made from exactly one clip: the first one added.
fn make_guide(base: Intent, r: &IntentRequest) -> Intent {
    match r.clips.first() {
        Some(c) => Intent {
            clip_ids: vec![c.id.clone()],
            ..base
        },
        None => base.unclear(vec![choice(ADD_TASK_VIDEO, r.text.clone())]),
    }
}

/// The one document `pool` holds that the draft names; `None` for none or several.
fn named_document(d: &IntentDraft, pool: &[&AskDocument]) -> Option<DocumentId> {
    let named: Vec<&AskDocument> = pool
        .iter()
        .copied()
        .filter(|doc| d.document_ids.iter().any(|id| id == doc.id.as_str()))
        .collect();
    match named.as_slice() {
        [one] => Some(one.id.clone()),
        _ => None,
    }
}

/// A question needs exactly one of the caller's documents: the one added, or the one Spark named
/// among those added (or among all of them when none was added). Else the person adds it.
fn read_document(base: Intent, d: &IntentDraft, r: &IntentRequest) -> Intent {
    let added: Vec<&AskDocument> = r.documents.iter().filter(|doc| doc.added).collect();
    let pick = match added.as_slice() {
        [one] => Some(one.id.clone()),
        [] => named_document(d, &r.documents.iter().collect::<Vec<_>>()),
        _ => named_document(d, &added),
    };
    let Some(id) = pick else {
        return base.unclear(vec![choice(ADD_LETTER, r.text.clone())]);
    };
    let question = d
        .question
        .as_deref()
        .and_then(|q| one_line(q, MAX_TEXT_CHARS))
        .unwrap_or_else(|| DEFAULT_QUESTION.to_owned());
    Intent {
        document_ids: vec![id],
        question: Some(question),
        ..base
    }
}

/// Clips plus one of the caller's projects or a new project's name.
fn add_to_project(base: Intent, d: &IntentDraft, r: &IntentRequest) -> Intent {
    let clips = kept_clips(&d.clip_ids, r);
    if clips.is_empty() {
        return base.unclear(vec![choice(ADD_CLIPS, r.text.clone())]);
    }
    let project_id = owned_project(d, r);
    let new_project_name = project_id
        .is_none()
        .then(|| {
            d.new_project_name
                .as_deref()
                .and_then(|n| one_line(n, PROJECT_NAME_MAX_CHARS))
        })
        .flatten();
    if project_id.is_none() && new_project_name.is_none() {
        let choices = project_choices(&base.title, r);
        return base.unclear(choices);
    }
    Intent {
        clip_ids: clips,
        project_id,
        new_project_name,
        ..base
    }
}

/// Up to three of the caller's projects, or a new project named after the request.
fn project_choices(title: &str, r: &IntentRequest) -> Vec<Choice> {
    let mut out: Vec<Choice> = r
        .projects
        .iter()
        .map(|p| {
            choice(
                format!("Add to {}", p.name),
                format!("add these to {}", p.name),
            )
        })
        .collect();
    if out.is_empty() {
        out.push(choice(
            "Add to a new project",
            format!("add these to a new project called {title}"),
        ));
    }
    clean_choices(&out)
}

/// The caller's person called `name` (ignoring case and spaces at the ends).
fn person_named<'a>(name: &str, r: &'a IntentRequest) -> Option<&'a AskPerson> {
    let name = name.trim().to_lowercase();
    r.people
        .iter()
        .find(|p| p.name.trim().to_lowercase() == name)
}

/// Edits (insert, delete, replace) between two names, ignoring case.
fn edits(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.to_lowercase().chars().collect();
    let b: Vec<char> = b.to_lowercase().chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let here = row[j + 1];
            row[j + 1] = (here + 1).min(row[j] + 1).min(prev + usize::from(ca != cb));
            prev = here;
        }
    }
    row[b.len()]
}

/// Up to [`MAX_CHOICES`] of the caller's people, closest to `name` first.
fn closest<'a>(name: &str, r: &'a IntentRequest) -> Vec<&'a AskPerson> {
    let mut all: Vec<&AskPerson> = r.people.iter().collect();
    all.sort_by(|a, b| {
        edits(name, &a.name)
            .cmp(&edits(name, &b.name))
            .then_with(|| a.name.cmp(&b.name))
    });
    all.truncate(MAX_CHOICES);
    all
}

/// The request that starts a session about `subject`, for `viewer` when one is named.
fn remember_text(subject: &str, viewer: Option<&AskPerson>) -> String {
    match viewer {
        Some(v) => format!("show {} memories of {subject}", v.name),
        None => format!("remember {subject}"),
    }
}

/// The added clip the draft names (or the first added), else the library clip whose title holds
/// every word of the draft's query; `None` when no clip or several equally fit.
fn day_clip(d: &IntentDraft, r: &IntentRequest) -> Option<ClipId> {
    if let Some(first) = kept_clips(&d.clip_ids, r).into_iter().next() {
        return Some(first);
    }
    let words: Vec<String> = d
        .query
        .as_deref()?
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    if words.is_empty() {
        return None;
    }
    let fits: Vec<&AskClip> = r
        .library
        .iter()
        .filter(|c| {
            let title = c.title.to_lowercase();
            words.iter().all(|w| title.contains(w.as_str()))
        })
        .collect();
    match fits.as_slice() {
        [one] => Some(one.id.clone()),
        _ => None,
    }
}

/// "Remember ‹name›" for each of `people`, for `viewer` when one is named.
fn remember_choices(people: &[&AskPerson], viewer: Option<&AskPerson>) -> Vec<Choice> {
    people
        .iter()
        .map(|p| {
            choice(
                format!("Remember {}", p.name),
                remember_text(&p.name, viewer),
            )
        })
        .collect()
}

/// The named viewer as one of the caller's people (`Ok(None)` when none is named), or the
/// closest people offered as viewer of `subject` instead.
fn viewer_of<'a>(
    named: Option<&str>,
    subject: &str,
    r: &'a IntentRequest,
) -> Result<Option<&'a AskPerson>, Vec<Choice>> {
    let Some(v) = named else {
        return Ok(None);
    };
    person_named(v, r).map(Some).ok_or_else(|| {
        closest(v, r)
            .into_iter()
            .map(|p| choice(format!("For {}", p.name), remember_text(subject, Some(p))))
            .collect()
    })
}

/// A session needs one of the caller's people or one clip; the viewer, when named, must be one
/// of the caller's people too. An unknown name offers the closest people instead.
fn memory_lane(base: Intent, d: &IntentDraft, r: &IntentRequest) -> Intent {
    let named = |n: Option<&str>| n.and_then(|n| one_line(n, TITLE_MAX_CHARS));
    let person = named(d.person_name.as_deref());
    let subject = person
        .clone()
        .or_else(|| named(d.query.as_deref()))
        .unwrap_or_else(|| "this day".to_owned());
    let viewer = match viewer_of(named(d.viewer_name.as_deref()).as_deref(), &subject, r) {
        Ok(v) => v,
        Err(choices) => return settled_unclear(base, d, r, choices),
    };
    let viewer_id = viewer.map(|v| v.id.clone());
    if let Some(name) = person {
        return match person_named(&name, r) {
            Some(p) => Intent {
                person_id: Some(p.id.clone()),
                viewer_id,
                ..base
            },
            None => settled_unclear(base, d, r, remember_choices(&closest(&name, r), viewer)),
        };
    }
    match day_clip(d, r) {
        Some(clip) => Intent {
            clip_id: Some(clip),
            viewer_id,
            ..base
        },
        None => {
            let first: Vec<&AskPerson> = r.people.iter().take(MAX_CHOICES).collect();
            settled_unclear(base, d, r, remember_choices(&first, viewer))
        }
    }
}

/// `unclear` with `choices`; the model's choices (or a search) when none are usable.
fn settled_unclear(
    base: Intent,
    d: &IntentDraft,
    r: &IntentRequest,
    choices: Vec<Choice>,
) -> Intent {
    let choices = clean_choices(&choices);
    if choices.is_empty() {
        unclear(base, d, r)
    } else {
        base.unclear(choices)
    }
}

/// The model's choices; a search for the request when none are usable.
fn unclear(base: Intent, d: &IntentDraft, r: &IntentRequest) -> Intent {
    let mut choices = clean_choices(&d.choices);
    if choices.is_empty() {
        let search = format!("search for {}", r.text);
        choices = clean_choices(&[choice(format!("Search for “{}”", r.text), search)]);
    }
    if choices.is_empty() {
        choices.push(choice("Search", r.text.clone()));
    }
    base.unclear(choices)
}

#[cfg(test)]
mod tests;
