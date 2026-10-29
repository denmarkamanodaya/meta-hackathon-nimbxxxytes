//! The title rule for things the owner names (an iGuide, an iRead document): spaces collapsed and
//! trimmed, 1 to `max` characters.

use crate::error::{AppError, ErrorCode};

/// `raw` tidied: runs of whitespace become one space and the ends are trimmed. `noun` names the
/// thing in the error, for example `an iGuide`.
///
/// # Errors
/// `VALIDATION_FAILED` when nothing is left or it is longer than `max` characters.
pub fn owner_title(raw: &str, max: usize, noun: &str) -> Result<String, AppError> {
    let title = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!("{noun} needs a title"),
        ));
    }
    if title.chars().count() > max {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            format!("{noun} title is at most {max} characters"),
        ));
    }
    Ok(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spaces_collapse_and_the_length_counts_characters() {
        assert_eq!(
            owner_title("  My \n letter ", 60, "a letter").unwrap(),
            "My letter"
        );
        let full = owner_title(&"é".repeat(60), 60, "a letter").unwrap();
        assert_eq!(full.chars().count(), 60);
        let long = owner_title(&"é".repeat(61), 60, "a letter").unwrap_err();
        assert_eq!(long.message, "a letter title is at most 60 characters");
        let empty = owner_title(" \t ", 60, "a letter").unwrap_err();
        assert_eq!(
            (empty.code, empty.message.as_str()),
            (ErrorCode::ValidationFailed, "a letter needs a title")
        );
    }
}
