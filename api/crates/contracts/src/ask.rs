//! The ask box: `POST /api/transcribe` (raw audio in, text out) and `POST /api/intents`. Every
//! key is always present; empty values are `null` or `[]`.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// `POST /api/transcribe` (200).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct TranscribeResponse {
    /// What was said, trimmed; `""` when nothing was.
    pub text: String,
}

/// `POST /api/intents` body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct IntentsRequest {
    /// The request, 1–500 characters after trimming.
    pub text: String,
    /// 0–20 of the caller's clips, the ones added to the box.
    #[serde(default)]
    pub clip_ids: Vec<String>,
    /// 0–5 of the caller's iRead documents, the ones added to the box (`[]` when left out).
    #[serde(default)]
    pub document_ids: Vec<String>,
}

/// One "Did you mean…" choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct IntentChoice {
    /// What the button says.
    pub label: String,
    /// The full request the box sends again when it is picked.
    pub text: String,
}

/// `POST /api/intents` (200).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
pub struct IntentResponse {
    /// `search`, `upload`, `make_short`, `make_guide`, `add_to_project`, `read_document`,
    /// `memory_lane` or `unclear`.
    pub kind: String,
    /// Short name of the job, at most 60 characters.
    pub title: String,
    /// Search words: always for `search` and `make_short` from a search; for `make_short` from a
    /// project, the topic within it (`null` = the whole project); else `null`.
    pub query: Option<String>,
    /// `attached`, `project` or `search` for `make_short`; else `null`.
    pub source: Option<String>,
    /// One of the caller's projects (`make_short` from a project, `add_to_project`); else `null`.
    pub project_id: Option<String>,
    /// A project to create (`add_to_project` only); else `null`.
    pub new_project_name: Option<String>,
    /// Added clips the intent uses (`make_short` from attached clips, `make_guide` (exactly one),
    /// `add_to_project`); else `[]`.
    pub clip_ids: Vec<String>,
    /// Short length, seconds, 3–90 (`make_short` only); else `null`.
    pub target_s: Option<f64>,
    /// `4:5` or `1:1` (`make_short` only); else `null`.
    pub aspect: Option<String>,
    /// 1–3 choices for `unclear`; else `[]`.
    pub choices: Vec<IntentChoice>,
    /// Exactly one of the caller's documents for `read_document`; else `[]`.
    pub document_ids: Vec<String>,
    /// What to ask about the document (`read_document` only, "Tell me what this says" when the
    /// request names nothing); else `null`.
    pub question: Option<String>,
    /// The caller's person a `memory_lane` session is about (send as `person_id` to
    /// `POST /api/memories`); else `null`.
    pub person_id: Option<String>,
    /// The caller's person who watches a `memory_lane` session; `null` when none is named.
    pub viewer_id: Option<String>,
    /// The clip (a day) a `memory_lane` session is about, when it is not about a person; else
    /// `null`.
    pub clip_id: Option<String>,
}
