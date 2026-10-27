//! Local file names: readable, safe on macOS (no `/` or `:`), and unique through an id suffix.
//! The suffix is the LAST 8 characters of the id: ids are UUID v7, whose first 8 characters are
//! a timestamp shared by everything created in the same minute, while the tail is random.

/// Longest title or slug kept in a file name, characters.
const MAX_TITLE_CHARS: usize = 80;
/// Longest prompt slug, characters.
const MAX_SLUG_CHARS: usize = 40;

/// Makes text safe as part of a macOS file name.
pub fn sanitise(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c == '/' || c == ':' || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let joined = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = joined.trim_start_matches('.').trim();
    let cut: String = trimmed.chars().take(MAX_TITLE_CHARS).collect();
    let cut = cut.trim_end().to_owned();
    if cut.is_empty() {
        "untitled".to_owned()
    } else {
        cut
    }
}

/// Lower-case words of `text` joined by `-` (`"Beach day!"` → `beach-day`), or `short`.
pub fn slug(text: &str) -> String {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let mut out = String::new();
    for word in words {
        let extra = usize::from(!out.is_empty()) + word.chars().count();
        if out.chars().count() + extra > MAX_SLUG_CHARS {
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(&word);
    }
    if out.is_empty() {
        "short".to_owned()
    } else {
        out
    }
}

fn id_tail(id: &str) -> String {
    let chars: Vec<char> = id.chars().filter(char::is_ascii_alphanumeric).collect();
    chars[chars.len().saturating_sub(8)..].iter().collect()
}

fn date_prefix(iso: Option<&str>) -> String {
    match iso {
        Some(t) if t.len() >= 10 && t.as_bytes().get(4) == Some(&b'-') => format!("{} ", &t[..10]),
        _ => String::new(),
    }
}

/// `2026-10-27 Morning walk [1a2b3c4d]`: the base of a clip's proxy and original names.
pub fn clip_base(recorded_at: Option<&str>, title: &str, clip_id: &str) -> String {
    format!(
        "{}{} [{}]",
        date_prefix(recorded_at),
        sanitise(title),
        id_tail(clip_id)
    )
}

/// Proxy file in `Library/`.
pub fn proxy_file(recorded_at: Option<&str>, title: &str, clip_id: &str) -> String {
    format!("{}.mp4", clip_base(recorded_at, title, clip_id))
}

/// Original file in `Originals/`, with the upload's extension.
pub fn original_file(recorded_at: Option<&str>, title: &str, clip_id: &str, ext: &str) -> String {
    let ext = sanitise(ext).to_lowercase();
    format!("{}.{ext}", clip_base(recorded_at, title, clip_id))
}

/// Render file in `Shorts/`: `2026-10-27 beach-day [1a2b3c4d].mp4`.
pub fn render_file(created_at: &str, prompt: &str, short_id: &str) -> String {
    format!(
        "{}{} [{}].mp4",
        date_prefix(Some(created_at)),
        slug(prompt),
        id_tail(short_id)
    )
}

/// FCPXML file in `Projects/`: `beach-day [1a2b3c4d].fcpxml`.
pub fn project_file(prompt: &str, short_id: &str) -> String {
    format!("{} [{}].fcpxml", slug(prompt), id_tail(short_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "019a2b3c-4d5e-7f00-8a1b-2c3d4e5f6a7b";

    #[test]
    fn titles_lose_slashes_colons_and_leading_dots() {
        assert_eq!(sanitise("  ../a/b:c\td  "), "a b c d");
        assert_eq!(sanitise("..."), "untitled");
        assert_eq!(sanitise(&"x".repeat(200)).chars().count(), 80);
    }

    #[test]
    fn clip_names_carry_the_date_the_title_and_the_random_id_tail() {
        assert_eq!(
            proxy_file(Some("2026-10-27T01:02:03Z"), "Walk: day 1", ID),
            "2026-10-27 Walk day 1 [4e5f6a7b].mp4"
        );
        assert_eq!(proxy_file(None, "Walk", ID), "Walk [4e5f6a7b].mp4");
        assert_eq!(
            original_file(Some("2026-10-27T01:02:03Z"), "Walk", ID, "MOV"),
            "2026-10-27 Walk [4e5f6a7b].mov"
        );
    }

    #[test]
    fn ids_minted_in_the_same_minute_still_get_different_names() {
        let a = proxy_file(None, "Clip", "019a2b3c-0000-7000-8000-00000000aaaa");
        let b = proxy_file(None, "Clip", "019a2b3c-0000-7000-8000-00000000bbbb");
        assert_ne!(a, b);
    }

    #[test]
    fn shorts_use_a_prompt_slug() {
        assert_eq!(
            slug("Beach day! With   Mia & the dog"),
            "beach-day-with-mia-the-dog"
        );
        assert_eq!(slug("!!!"), "short");
        assert!(slug(&"word ".repeat(30)).chars().count() <= 40);
        assert_eq!(
            render_file("2026-10-27T09:00:00Z", "Beach day", ID),
            "2026-10-27 beach-day [4e5f6a7b].mp4"
        );
        assert_eq!(project_file("Beach day", ID), "beach-day [4e5f6a7b].fcpxml");
    }
}
