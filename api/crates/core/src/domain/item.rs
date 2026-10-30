//! Library items other than clips: iListen recordings, iRead documents and photos. They sit in
//! projects next to clips and the Mac mirrors their originals; this is the one home of their
//! kind words (`listen`, `document`, `photo`).

use crate::domain::ids::{DocumentId, ListenId, PhotoId, ProjectId};
use crate::domain::text_enum::text_enum;
use crate::error::AppError;

text_enum!(
    /// What a non-clip item is.
    ItemKind {
        /// An iListen recording.
        Listen => "listen",
        /// An iRead document.
        Document => "document",
        /// A photo.
        Photo => "photo",
    }
);

/// One non-clip item, by kind and id.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ItemRef {
    /// An iListen recording.
    Listen(ListenId),
    /// An iRead document.
    Document(DocumentId),
    /// A photo.
    Photo(PhotoId),
}

impl ItemRef {
    /// The item named by wire `kind` and `id`.
    ///
    /// # Errors
    /// `VALIDATION_FAILED` for an unknown kind or a bad id.
    pub fn parse(kind: &str, id: impl Into<String>) -> Result<Self, AppError> {
        Ok(match ItemKind::parse(kind)? {
            ItemKind::Listen => Self::Listen(ListenId::parse(id)?),
            ItemKind::Document => Self::Document(DocumentId::parse(id)?),
            ItemKind::Photo => Self::Photo(PhotoId::parse(id)?),
        })
    }

    /// Its kind.
    pub fn kind(&self) -> ItemKind {
        match self {
            Self::Listen(_) => ItemKind::Listen,
            Self::Document(_) => ItemKind::Document,
            Self::Photo(_) => ItemKind::Photo,
        }
    }

    /// Its id within its kind.
    pub fn id_str(&self) -> &str {
        match self {
            Self::Listen(id) => id.as_str(),
            Self::Document(id) => id.as_str(),
            Self::Photo(id) => id.as_str(),
        }
    }
}

/// The projects `item` is in, sorted, from the owner's `(item, project)` links.
pub fn projects_of(links: &[(ItemRef, ProjectId)], item: &ItemRef) -> Vec<ProjectId> {
    let mut out: Vec<ProjectId> = links
        .iter()
        .filter(|(i, _)| i == item)
        .map(|(_, p)| p.clone())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// The name an item shows: its title, or the file name without its extension while it has none.
pub fn shown_title(title: &str, filename: &str) -> String {
    let title = title.trim();
    if !title.is_empty() {
        return title.to_owned();
    }
    match filename.rsplit_once('.') {
        Some((stem, _)) if !stem.trim().is_empty() => stem.trim().to_owned(),
        _ => filename.trim().to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn kinds_are_the_three_wire_words() {
        let wire: Vec<&str> = ItemKind::ALL.iter().map(|k| k.as_str()).collect();
        assert_eq!(wire, ["listen", "document", "photo"]);
    }

    #[test]
    fn an_item_parses_from_kind_and_id_and_refuses_other_kinds() {
        let item = ItemRef::parse("photo", "p1").unwrap();
        assert_eq!(item, ItemRef::Photo(PhotoId::parse("p1").unwrap()));
        assert_eq!((item.kind(), item.id_str()), (ItemKind::Photo, "p1"));
        for bad in ["clip", "Photo", ""] {
            assert_eq!(
                ItemRef::parse(bad, "p1").unwrap_err().code,
                ErrorCode::ValidationFailed,
                "{bad:?}"
            );
        }
    }

    #[test]
    fn projects_of_picks_one_items_links_sorted_without_repeats() {
        let (l1, d1) = (
            ItemRef::Listen(ListenId::parse("x").unwrap()),
            ItemRef::Document(DocumentId::parse("x").unwrap()),
        );
        let p = |s: &str| ProjectId::parse(s).unwrap();
        let links = [
            (l1.clone(), p("b")),
            (d1.clone(), p("c")),
            (l1.clone(), p("a")),
            (l1.clone(), p("a")),
        ];
        assert_eq!(projects_of(&links, &l1), [p("a"), p("b")]);
        assert_eq!(projects_of(&links, &d1), [p("c")]);
    }

    #[test]
    fn the_shown_title_falls_back_to_the_file_stem() {
        assert_eq!(shown_title(" Lunch ", "a.mp3"), "Lunch");
        assert_eq!(shown_title("", "Voice 12.m4a"), "Voice 12");
        assert_eq!(shown_title("  ", "noext"), "noext");
        assert_eq!(shown_title("", ".mp3"), ".mp3");
    }
}
