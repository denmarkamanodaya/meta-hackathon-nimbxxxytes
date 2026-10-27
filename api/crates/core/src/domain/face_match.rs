//! Opt-in face match suggestions. Perception Encoder vectors only propose pairs of face tracks;
//! Muse Spark looks at both crops and confirms. Nothing is named until the owner says yes.

use std::collections::{BTreeMap, BTreeSet};

use crate::domain::ids::{PersonId, TrackId};
use crate::error::{AppError, ErrorCode};

/// Cosine similarity of two face vectors at which the pair is sent to Spark. Uncalibrated: a
/// first guess, to be calibrated on the owner's demo clips (pairs of same and different faces).
pub const PROPOSE_MIN: f64 = 0.70;
/// Spark confidence at which a "same" answer links two tracks. Uncalibrated, as above.
pub const CONFIRM_MIN: f64 = 0.7;
/// Nearest faces looked at per face when proposing pairs.
pub const PROPOSE_K: u32 = 8;
/// Pairs sent to Spark in one run (about $0.0012 each); the rest wait for the next run.
pub const MAX_PAIRS_PER_RUN: usize = 100;

/// What a face belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaceKind {
    /// A human.
    Person,
    /// An animal.
    Pet,
}

impl FaceKind {
    /// Stored and model text: `person` or `pet`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Person => "person",
            Self::Pet => "pet",
        }
    }

    /// Parses stored or model text.
    ///
    /// # Errors
    /// `MODEL_UNAVAILABLE` for anything else (only the model's answer can be wrong here).
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        [Self::Person, Self::Pet]
            .into_iter()
            .find(|k| k.as_str() == raw)
            .ok_or_else(|| {
                AppError::new(ErrorCode::ModelUnavailable, format!("bad face kind {raw}"))
            })
    }
}

/// Spark's answer for one pair of crops.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FaceVerdict {
    /// Same individual.
    pub same: bool,
    /// 0 to 1.
    pub confidence: f64,
    /// Human or animal.
    pub kind: FaceKind,
}

impl FaceVerdict {
    /// Whether the pair counts as one individual.
    pub fn confirmed(&self) -> bool {
        self.same && self.confidence >= CONFIRM_MIN
    }
}

/// A pair of the user's tracks Spark confirmed as the same individual.
#[derive(Debug, Clone, PartialEq)]
pub struct FaceLink {
    /// One track.
    pub a: TrackId,
    /// The other.
    pub b: TrackId,
    /// Spark's confidence.
    pub confidence: f64,
}

/// A visible track the user named.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NamedTrack {
    /// Track.
    pub track: TrackId,
    /// Its person.
    pub person_id: PersonId,
    /// The person's name.
    pub name: String,
}

/// "Is this ‹name›?" for an unnamed face.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    /// The person.
    pub person_id: PersonId,
    /// Their name.
    pub name: String,
    /// Spark's confidence for the best link to one of their tracks.
    pub similarity: f64,
}

/// What the people screen shows next to an unnamed face.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Matching {
    /// Shared by unnamed faces linked to each other (the smallest track id of the group);
    /// `None` for a face linked to no other unnamed face.
    pub group_id: Option<String>,
    /// The named person the face (or its group) is linked to most confidently.
    pub suggested: Option<Suggestion>,
}

/// Groups and suggestions for `unnamed` tracks. Groups are single-link: unnamed faces joined by
/// confirmed links, directly or through each other. Every face of a group gets the group's best
/// suggestion (the highest-confidence link from any member to a named track; ties go to the name
/// first in order). Links to tracks in neither list are ignored.
pub fn match_faces(
    unnamed: &[TrackId],
    named: &[NamedTrack],
    links: &[FaceLink],
) -> BTreeMap<TrackId, Matching> {
    let open: BTreeSet<&TrackId> = unnamed.iter().collect();
    let groups = groups(&open, links);
    let best = best_suggestions(&groups, named, links);
    let sizes = groups.values().fold(BTreeMap::new(), |mut m, r| {
        *m.entry(*r).or_insert(0usize) += 1;
        m
    });
    unnamed
        .iter()
        .map(|t| {
            let root = groups[t];
            let group_id = (sizes[root] > 1).then(|| root.to_string());
            let suggested = best.get(root).cloned();
            (
                t.clone(),
                Matching {
                    group_id,
                    suggested,
                },
            )
        })
        .collect()
}

/// Per group root, the highest-confidence link from any member to a named track (ties: the name
/// first in order).
fn best_suggestions<'a>(
    groups: &BTreeMap<&'a TrackId, &'a TrackId>,
    named: &[NamedTrack],
    links: &[FaceLink],
) -> BTreeMap<&'a TrackId, Suggestion> {
    let by_track: BTreeMap<&TrackId, &NamedTrack> = named.iter().map(|n| (&n.track, n)).collect();
    let mut best: BTreeMap<&TrackId, Suggestion> = BTreeMap::new();
    for l in links {
        for (u, other) in [(&l.a, &l.b), (&l.b, &l.a)] {
            let (Some(root), Some(n)) = (groups.get(u), by_track.get(other)) else {
                continue;
            };
            let better = best.get(root).is_none_or(|s| {
                l.confidence > s.similarity || (l.confidence == s.similarity && n.name < s.name)
            });
            if better {
                let s = Suggestion {
                    person_id: n.person_id.clone(),
                    name: n.name.clone(),
                    similarity: l.confidence,
                };
                best.insert(root, s);
            }
        }
    }
    best
}

/// Each unnamed track's group root (the smallest track id reachable over links between unnamed
/// tracks).
fn groups<'a>(
    open: &BTreeSet<&'a TrackId>,
    links: &'a [FaceLink],
) -> BTreeMap<&'a TrackId, &'a TrackId> {
    let mut root: BTreeMap<&TrackId, &TrackId> = open.iter().map(|t| (*t, *t)).collect();
    fn find<'a>(root: &BTreeMap<&'a TrackId, &'a TrackId>, mut t: &'a TrackId) -> &'a TrackId {
        while root[t] != t {
            t = root[t];
        }
        t
    }
    for l in links
        .iter()
        .filter(|l| open.contains(&l.a) && open.contains(&l.b))
    {
        let (ra, rb) = (find(&root, &l.a), find(&root, &l.b));
        let (keep, join) = if ra <= rb { (ra, rb) } else { (rb, ra) };
        root.insert(join, keep);
    }
    open.iter().map(|t| (*t, find(&root, t))).collect()
}

#[cfg(test)]
mod tests;
