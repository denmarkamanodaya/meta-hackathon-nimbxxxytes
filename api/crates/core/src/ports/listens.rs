//! iListen ports: the listen rows (turns and versions) and Muse Spark understanding, checking and
//! fixing a transcript's translation.

use crate::domain::ids::{ListenId, UserId};
use crate::domain::listen::{
    CheckAnswer, Draft, FixAnswer, HeardBy, HeardShare, Listen, ListenStatus, ListenTurn,
    ListenVersion, OutputLanguage, Overview,
};
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// A listen's status change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListenProgress<'a> {
    /// New status.
    pub status: ListenStatus,
    /// Why it failed (`None` clears it).
    pub error: Option<&'a str>,
    /// ISO-8601 UTC.
    pub at: &'a str,
}

/// What a listen shows: written after understanding (version 1, unchecked) and again by the check
/// loop with the kept version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListenResult {
    /// The version shown.
    pub version: u32,
    /// Title, summary and key points of that version.
    pub overview: Overview,
    /// Languages heard.
    pub languages: Vec<HeardShare>,
    /// Lowest score; `None` before the check.
    pub confidence: Option<u32>,
    /// Whether that version passed.
    pub passed: bool,
    /// Every turn with its language, translation, score, issue and `fixed_in`.
    pub turns: Vec<ListenTurn>,
}

/// Listen rows, their turns, versions and voice files.
pub trait ListenStore: Send + Sync {
    /// Inserts a new listen.
    fn create<'a>(&'a self, listen: &'a Listen) -> PortResult<'a, ()>;

    /// The listen, if it exists.
    fn get<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Option<Listen>>;

    /// The user's listens, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Listen>>;

    /// Sets status and error.
    fn set_progress<'a>(&'a self, id: &'a ListenId, p: ListenProgress<'a>) -> PortResult<'a, ()>;

    /// Sets the step running and the version in hand.
    fn set_step<'a>(
        &'a self,
        id: &'a ListenId,
        step: Option<&'a str>,
        version: u32,
    ) -> PortResult<'a, ()>;

    /// Records the audio length.
    fn set_duration<'a>(&'a self, id: &'a ListenId, duration_ms: u64) -> PortResult<'a, ()>;

    /// Replaces every turn with `turns` (as transcribed), sets the speaker count and records
    /// where the transcript came from.
    fn set_turns<'a>(
        &'a self,
        id: &'a ListenId,
        turns: &'a [ListenTurn],
        heard_by: HeardBy,
    ) -> PortResult<'a, ()>;

    /// The turns by index.
    fn turns<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenTurn>>;

    /// Stores what the listen shows (see [`ListenResult`]).
    fn set_result<'a>(&'a self, id: &'a ListenId, r: &'a ListenResult) -> PortResult<'a, ()>;

    /// Inserts or replaces one version.
    fn put_version<'a>(&'a self, id: &'a ListenId, v: &'a ListenVersion) -> PortResult<'a, ()>;

    /// Every version, oldest first.
    fn versions<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ListenVersion>>;

    /// Forgets the translation: every version, the turns' languages, translations and scores,
    /// title, summary, key points, languages, confidence and spoken summary. Turns stay.
    fn clear_understanding<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()>;

    /// Sets the output language.
    fn set_target<'a>(
        &'a self,
        id: &'a ListenId,
        target: &'a str,
        at: &'a str,
    ) -> PortResult<'a, ()>;

    /// Sets the title (already checked).
    fn set_title<'a>(&'a self, id: &'a ListenId, title: &'a str, at: &'a str)
    -> PortResult<'a, ()>;

    /// Points the listen at its spoken summary (`None` clears it).
    fn set_summary_audio<'a>(
        &'a self,
        id: &'a ListenId,
        key: Option<&'a ObjectKey>,
    ) -> PortResult<'a, ()>;

    /// Records a voice file of the listen (a second record of the same key is ignored).
    fn add_voice<'a>(&'a self, id: &'a ListenId, key: &'a ObjectKey) -> PortResult<'a, ()>;

    /// Every voice file recorded for the listen.
    fn voices<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, Vec<ObjectKey>>;

    /// Deletes the listen, its turns, versions and voice rows; none is not an error.
    fn delete<'a>(&'a self, id: &'a ListenId) -> PortResult<'a, ()>;
}

/// The turns (one part of a transcript) to name, translate and summarise.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UnderstandRequest<'a> {
    /// The output language.
    pub target: OutputLanguage,
    /// The turns, in order.
    pub turns: &'a [ListenTurn],
}

/// The parts' overviews of a long transcript, to merge into one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MergeRequest<'a> {
    /// The output language.
    pub target: OutputLanguage,
    /// Each part's title, summary and key points, in order.
    pub parts: &'a [Overview],
}

/// A draft (of one part) to check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CheckRequest<'a> {
    /// What the turns are: the whole recording or part n of m.
    pub part: &'a str,
    /// The original turns.
    pub turns: &'a [ListenTurn],
    /// Their draft translations, with the whole summary and key points.
    pub draft: &'a Draft,
}

/// A draft (of one part) to fix from the checker's notes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FixRequest<'a> {
    /// The output language.
    pub target: OutputLanguage,
    /// The original turns.
    pub turns: &'a [ListenTurn],
    /// Their draft translations, with the whole summary and key points.
    pub draft: &'a Draft,
    /// The checker's notes.
    pub notes: &'a [String],
}

/// Muse Spark understanding and checking transcripts. Every call answers `MODEL_UNAVAILABLE` on
/// failure, a timeout or an invalid answer.
pub trait ListenInterpreter: Send + Sync {
    /// Each turn's language and translation, a title, summary and key points.
    fn understand<'a>(&'a self, request: UnderstandRequest<'a>) -> PortResult<'a, Draft>;

    /// One title, summary and key points from the parts' ones.
    fn merge<'a>(&'a self, request: MergeRequest<'a>) -> PortResult<'a, Overview>;

    /// Each turn back-translated and scored, and the summary scored.
    fn check<'a>(&'a self, request: CheckRequest<'a>) -> PortResult<'a, CheckAnswer>;

    /// The flagged turns translated again, the summary rewritten where the notes say.
    fn fix<'a>(&'a self, request: FixRequest<'a>) -> PortResult<'a, FixAnswer>;
}
