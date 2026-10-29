//! Links between clips: near-copies, same-moment footage and pairs the owner kept.

use crate::domain::ids::{ClipId, UserId};
use crate::domain::similar::ClipLink;
use crate::ports::PortResult;

/// Stored clip links. A link goes when either of its clips is deleted.
pub trait ClipLinkStore: Send + Sync {
    /// Inserts the links, replacing an existing link of the same pair (`clip`, `other`).
    fn save<'a>(
        &'a self,
        user: &'a UserId,
        links: &'a [ClipLink],
        now: &'a str,
    ) -> PortResult<'a, ()>;

    /// Every link from or to `clip`.
    fn of_clip<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, Vec<ClipLink>>;

    /// Every link of `user`'s clips.
    fn of_user<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ClipLink>>;

    /// Turns `clip`'s near-copy links into kept pairs, which never link as copies again.
    fn keep<'a>(&'a self, clip: &'a ClipId) -> PortResult<'a, ()>;
}
