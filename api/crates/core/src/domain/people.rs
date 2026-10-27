//! The people screen: named people with how many clips they appear in, faces still waiting for a
//! name, and how many were hidden.

use crate::domain::clip::Clip;
use crate::domain::ids::{PersonId, TrackId};

/// A named person.
#[derive(Debug, Clone, PartialEq)]
pub struct PersonRow {
    /// Person id.
    pub id: PersonId,
    /// Name.
    pub name: String,
    /// Clips with at least one visible track of this person.
    pub clip_count: u32,
    /// Stored key of the person's biggest face crop.
    pub crop_key: Option<String>,
}

/// A face track with its clip: an unnamed visible one, or one the user hid.
#[derive(Debug, Clone, PartialEq)]
pub struct FaceRow {
    /// Track id.
    pub track_id: TrackId,
    /// Its clip.
    pub clip: Clip,
    /// First second seen (1 fps frames).
    pub first_s: f64,
    /// Last second seen.
    pub last_s: f64,
    /// Stored key of its face crop.
    pub crop_key: Option<String>,
}

/// Everything the people screen lists for one user.
#[derive(Debug, Clone, PartialEq)]
pub struct PeopleOverviewRows {
    /// Named people.
    pub people: Vec<PersonRow>,
    /// Unnamed visible tracks.
    pub unnamed: Vec<FaceRow>,
    /// Tracks the user hid (named or not).
    pub hidden: Vec<FaceRow>,
}

/// Seconds a track is on screen. Tracks come from 1 fps frames and each frame stands for a whole
/// second, so first and last count inclusively.
pub fn on_screen_s(first_s: f64, last_s: f64) -> f64 {
    (last_s - first_s + 1.0).max(0.0)
}

/// The screen order: people by clip count (most first) then name; unnamed and hidden faces from
/// the newest clip first, then by when they appear.
pub fn screen_order(mut rows: PeopleOverviewRows) -> PeopleOverviewRows {
    rows.people.sort_by(|a, b| {
        b.clip_count
            .cmp(&a.clip_count)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    rows.unnamed.sort_by(newest_clip_first);
    rows.hidden.sort_by(newest_clip_first);
    rows
}

fn newest_clip_first(a: &FaceRow, b: &FaceRow) -> std::cmp::Ordering {
    b.clip
        .created_at
        .cmp(&a.clip.created_at)
        .then_with(|| a.first_s.total_cmp(&b.first_s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::clip::ClipStatus;
    use crate::domain::ids::{ClipId, UserId};
    use crate::domain::media::MediaExt;

    fn person(name: &str, clip_count: u32) -> PersonRow {
        PersonRow {
            id: PersonId::parse(format!("p-{name}")).unwrap(),
            name: name.into(),
            clip_count,
            crop_key: None,
        }
    }

    fn unnamed(track: &str, created_at: &str, first_s: f64) -> FaceRow {
        FaceRow {
            track_id: TrackId::parse(track).unwrap(),
            clip: Clip {
                id: ClipId::parse("c1").unwrap(),
                user_id: UserId::parse("u1").unwrap(),
                filename: "a.mp4".into(),
                ext: MediaExt::Mp4,
                size_bytes: 1,
                status: ClipStatus::Ready,
                probe: None,
                created_at: created_at.into(),
                title: None,
                last_viewed_at: None,
                content_sha256: None,
                duplicate_of: None,
            },
            first_s,
            last_s: first_s + 2.0,
            crop_key: None,
        }
    }

    #[test]
    fn a_track_seen_from_second_3_to_5_is_on_screen_3_seconds() {
        assert_eq!(on_screen_s(3.0, 5.0), 3.0);
        assert_eq!(on_screen_s(4.0, 4.0), 1.0);
    }

    #[test]
    fn people_sort_by_clip_count_then_name_and_unnamed_by_newest_clip() {
        let rows = PeopleOverviewRows {
            people: vec![person("ben", 1), person("Ana", 1), person("Zoe", 4)],
            unnamed: vec![
                unnamed("t-old", "2026-10-01T00:00:00.000Z", 1.0),
                unnamed("t-new-late", "2026-10-26T00:00:00.000Z", 9.0),
                unnamed("t-new-early", "2026-10-26T00:00:00.000Z", 2.0),
            ],
            hidden: vec![
                unnamed("h-old", "2026-10-01T00:00:00.000Z", 1.0),
                unnamed("h-new", "2026-10-26T00:00:00.000Z", 5.0),
            ],
        };
        let out = screen_order(rows);
        let names: Vec<&str> = out.people.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Zoe", "Ana", "ben"]);
        let tracks: Vec<&str> = out.unnamed.iter().map(|u| u.track_id.as_str()).collect();
        assert_eq!(tracks, ["t-new-early", "t-new-late", "t-old"]);
        let hidden: Vec<&str> = out.hidden.iter().map(|h| h.track_id.as_str()).collect();
        assert_eq!(hidden, ["h-new", "h-old"]);
    }
}
