//! MMS-TTS text to token ids, as Hugging Face's `VitsTokenizer` makes them for `mms-tts-eng`
//! (`normalize`, no uroman, no phonemes, `add_blank`).

use std::collections::HashMap;

use nimbytes_core::{AppError, ErrorCode};
use serde_json::Value;

/// The character vocabulary and the blank rule.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VitsTokens {
    vocab: HashMap<char, i64>,
    pad: i64,
    add_blank: bool,
    lower: bool,
}

fn bad(msg: &str) -> AppError {
    AppError::new(ErrorCode::Internal, format!("narrator tokenizer: {msg}"))
}

impl VitsTokens {
    /// Reads `vocab.json` (one character per id) and `tokenizer_config.json` (`pad_token`,
    /// `add_blank`, `normalize`).
    ///
    /// # Errors
    /// `INTERNAL` when the vocabulary or the pad token is missing.
    pub fn from_files(vocab: &Value, config: &Value) -> Result<Self, AppError> {
        let entries = vocab
            .as_object()
            .ok_or_else(|| bad("vocab.json is not an object"))?;
        let mut map = HashMap::new();
        for (token, id) in entries {
            let mut chars = token.chars();
            if let (Some(c), None, Some(id)) = (chars.next(), chars.next(), id.as_i64()) {
                map.insert(c, id);
            }
        }
        let pad_char = config["pad_token"]
            .as_str()
            .and_then(|p| p.chars().next())
            .ok_or_else(|| bad("tokenizer_config.json lacks pad_token"))?;
        let pad = *map
            .get(&pad_char)
            .ok_or_else(|| bad("pad_token is not in the vocabulary"))?;
        Ok(Self {
            vocab: map,
            pad,
            add_blank: config["add_blank"].as_bool().unwrap_or(true),
            lower: config["normalize"].as_bool().unwrap_or(true),
        })
    }

    /// The ids of `text`: lower-cased, unknown characters dropped, outer spaces trimmed, then the
    /// pad id between and around every character.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` when nothing in `text` is in the vocabulary.
    pub fn ids(&self, text: &str) -> Result<Vec<i64>, AppError> {
        let text = if self.lower {
            text.to_lowercase()
        } else {
            text.to_owned()
        };
        let kept: String = text
            .chars()
            .filter(|c| self.vocab.contains_key(c))
            .collect();
        let ids: Vec<i64> = kept
            .trim()
            .chars()
            .filter_map(|c| self.vocab.get(&c).copied())
            .collect();
        if ids.is_empty() {
            return Err(AppError::new(
                ErrorCode::ValidationFailed,
                "nothing to speak",
            ));
        }
        if !self.add_blank {
            return Ok(ids);
        }
        let mut out = Vec::with_capacity(ids.len() * 2 + 1);
        out.push(self.pad);
        for id in ids {
            out.extend([id, self.pad]);
        }
        Ok(out)
    }
}
