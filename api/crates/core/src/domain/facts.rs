//! Segment facts from the vision model, and the fallback rule when the model fails twice.

/// Whether the facts came from a valid model answer or the fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FactsStatus {
    /// Valid against the schema.
    Ok,
    /// Two invalid answers; only a description survives.
    Fallback,
}

impl FactsStatus {
    /// Stored text: `ok` or `fallback`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Fallback => "fallback",
        }
    }
}

/// What the model says about one segment (ids and times are ours, never the model's).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentFacts {
    /// One or two sentences.
    pub description: String,
    /// Up to 5 short verb phrases.
    pub actions: Vec<String>,
    /// Up to 8 visible things.
    pub objects: Vec<String>,
    /// Setting label.
    pub place: Option<String>,
    /// One or two words.
    pub mood: Option<String>,
    /// 0–10 visual usability.
    pub quality: Option<u8>,
    /// 0–10 opening-shot strength.
    pub hook_score: Option<u8>,
    /// Ok or fallback.
    pub status: FactsStatus,
}

/// Description used when the model gave nothing usable.
pub const UNTITLED: &str = "Untitled moment";
/// Longest fallback description, characters.
pub const FALLBACK_CHARS: usize = 120;
/// Longest transcript excerpt sent with a segment, characters.
pub const TRANSCRIPT_CONTEXT_CHARS: usize = 600;

/// Fallback facts: the first 120 characters of the model's last text (trimmed), else
/// "Untitled moment"; every other field empty.
pub fn fallback(model_text: &str) -> SegmentFacts {
    let text: String = model_text.trim().chars().take(FALLBACK_CHARS).collect();
    let description = if text.trim().is_empty() {
        UNTITLED.to_owned()
    } else {
        text.trim().to_owned()
    };
    SegmentFacts {
        description,
        actions: Vec::new(),
        objects: Vec::new(),
        place: None,
        mood: None,
        quality: None,
        hook_score: None,
        status: FactsStatus::Fallback,
    }
}

/// Speech context for a segment: its turn texts joined, cut to 600 characters on a char boundary;
/// `(none)` when nobody speaks.
pub fn transcript_context<'a>(texts: impl IntoIterator<Item = &'a str>) -> String {
    let joined = texts
        .into_iter()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if joined.is_empty() {
        return "(none)".to_owned();
    }
    joined.chars().take(TRANSCRIPT_CONTEXT_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_keeps_the_first_120_chars_or_says_untitled() {
        let long = "x".repeat(300);
        assert_eq!(fallback(&long).description.len(), 120);
        assert_eq!(fallback("  A dog sleeps.  ").description, "A dog sleeps.");
        assert_eq!(fallback("   ").description, UNTITLED);
        assert_eq!(fallback("").status, FactsStatus::Fallback);
    }

    #[test]
    fn transcript_context_joins_and_cuts_on_char_boundaries() {
        assert_eq!(transcript_context([]), "(none)");
        assert_eq!(transcript_context([" hi ", "", "there"]), "hi there");
        let ugly = "é".repeat(700);
        assert_eq!(transcript_context([ugly.as_str()]).chars().count(), 600);
    }
}
