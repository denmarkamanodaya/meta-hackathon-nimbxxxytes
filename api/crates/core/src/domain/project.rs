//! Projects: named, coloured groups of the owner's clips. A clip may sit in any number of
//! projects; removing a project never touches its clips.

use crate::domain::ids::{ProjectId, UserId};
use crate::error::{AppError, ErrorCode};

/// Longest project name, in characters, after trimming.
pub const MAX_NAME_CHARS: usize = 60;

/// A project's colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectColor {
    /// Orange.
    Orange,
    /// Green.
    Green,
    /// Blue.
    Blue,
    /// Purple.
    Purple,
    /// Pink.
    Pink,
    /// Grey.
    Grey,
}

impl ProjectColor {
    /// Every colour, in the order the picker shows them.
    pub const ALL: [Self; 6] = [
        Self::Orange,
        Self::Green,
        Self::Blue,
        Self::Purple,
        Self::Pink,
        Self::Grey,
    ];

    /// Stored and wire text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Orange => "orange",
            Self::Green => "green",
            Self::Blue => "blue",
            Self::Purple => "purple",
            Self::Pink => "pink",
            Self::Grey => "grey",
        }
    }

    /// Parses stored or wire text.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for anything but one of [`Self::ALL`].
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        Self::ALL
            .into_iter()
            .find(|c| c.as_str() == raw)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::ValidationFailed,
                    "color must be orange, green, blue, purple, pink or grey",
                )
            })
    }
}

/// One project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    /// Id.
    pub id: ProjectId,
    /// Owner.
    pub user_id: UserId,
    /// Name, trimmed, 1–60 characters, unique per owner ignoring case.
    pub name: String,
    /// Colour.
    pub color: ProjectColor,
    /// Created, ISO-8601 UTC.
    pub created_at: String,
    /// Last renamed or recoloured, ISO-8601 UTC.
    pub updated_at: String,
}

/// A project with totals over its clips.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectSummary {
    /// The project.
    pub project: Project,
    /// Clips in it.
    pub clip_count: u32,
    /// Sum of the clips' known durations, seconds.
    pub duration_s: f64,
    /// Sum of the clips' original sizes.
    pub size_bytes: u64,
}

/// The name as stored: trimmed, 1–60 characters, and not the name of another of the owner's
/// projects (`others`: the owner's other project names), ignoring case.
///
/// # Errors
/// `VALIDATION_FAILED` for an empty or too long name, or one the owner already uses.
pub fn checked_name<'a>(
    raw: &str,
    others: impl IntoIterator<Item = &'a str>,
) -> Result<String, AppError> {
    let name = raw.trim();
    let len = name.chars().count();
    if !(1..=MAX_NAME_CHARS).contains(&len) {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "name must be 1 to 60 characters",
        ));
    }
    let key = name.to_lowercase();
    if others.into_iter().any(|o| o.trim().to_lowercase() == key) {
        return Err(AppError::new(
            ErrorCode::ValidationFailed,
            "you already have a project with that name",
        ));
    }
    Ok(name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_trimmed_and_kept_between_1_and_60_characters() {
        assert_eq!(checked_name("  Tokyo trip ", []).unwrap(), "Tokyo trip");
        assert_eq!(
            checked_name(&"é".repeat(60), []).unwrap().chars().count(),
            60
        );
        for bad in ["", "   ", &"a".repeat(61)] {
            assert_eq!(
                checked_name(bad, []).unwrap_err().code,
                ErrorCode::ValidationFailed,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn a_name_is_unique_per_owner_ignoring_case() {
        let others = ["Tokyo Trip", "Beach"];
        for taken in ["tokyo trip", "TOKYO TRIP", "  beach "] {
            assert_eq!(
                checked_name(taken, others).unwrap_err().code,
                ErrorCode::ValidationFailed,
                "{taken:?}"
            );
        }
        assert_eq!(
            checked_name("Tokyo trip 2", others).unwrap(),
            "Tokyo trip 2"
        );
        assert_eq!(
            checked_name("ÉTÉ", ["été"]).unwrap_err().code,
            ErrorCode::ValidationFailed
        );
    }

    #[test]
    fn colours_are_the_six_of_the_picker() {
        let wire: Vec<&str> = ProjectColor::ALL.iter().map(|c| c.as_str()).collect();
        assert_eq!(wire, ["orange", "green", "blue", "purple", "pink", "grey"]);
        for c in ProjectColor::ALL {
            assert_eq!(ProjectColor::parse(c.as_str()).unwrap(), c);
        }
        for bad in ["Orange", "gray", "red", ""] {
            assert_eq!(
                ProjectColor::parse(bad).unwrap_err().code,
                ErrorCode::ValidationFailed,
                "{bad:?}"
            );
        }
    }
}
