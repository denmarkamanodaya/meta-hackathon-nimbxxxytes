//! Photo ports: the photo rows and Muse Spark describing a photo.

use std::path::Path;

use crate::domain::ids::{PhotoId, UserId};
use crate::domain::photo::{Photo, PhotoFacts, PhotoFit, PhotoStatus};
use crate::ports::PortResult;

/// A photo's status change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PhotoProgress<'a> {
    /// New status.
    pub status: PhotoStatus,
    /// Why it failed (`None` clears it).
    pub error: Option<&'a str>,
    /// ISO-8601 UTC.
    pub at: &'a str,
}

/// Photo rows.
pub trait PhotoStore: Send + Sync {
    /// Inserts a new photo.
    fn create<'a>(&'a self, photo: &'a Photo) -> PortResult<'a, ()>;

    /// The photo, if it exists.
    fn get<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, Option<Photo>>;

    /// The user's photos, newest taken first (photos not read yet by when they were added).
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Photo>>;

    /// These photos of `user` (unknown ids and other users' photos are left out), in no order.
    fn many<'a>(&'a self, user: &'a UserId, ids: &'a [PhotoId]) -> PortResult<'a, Vec<Photo>>;

    /// Sets status and error.
    fn set_progress<'a>(&'a self, id: &'a PhotoId, p: PhotoProgress<'a>) -> PortResult<'a, ()>;

    /// Records the size after orientation, the date taken and the camera.
    fn set_fit<'a>(&'a self, id: &'a PhotoId, fit: &'a PhotoFit) -> PortResult<'a, ()>;

    /// Stores Spark's facts; the title becomes the facts' title unless the owner named it.
    fn set_facts<'a>(&'a self, id: &'a PhotoId, facts: &'a PhotoFacts) -> PortResult<'a, ()>;

    /// Sets the title the owner typed (already checked).
    fn set_title<'a>(&'a self, id: &'a PhotoId, title: &'a str, at: &'a str) -> PortResult<'a, ()>;

    /// Deletes the photo; none is not an error.
    fn delete<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, ()>;
}

/// Muse Spark describing photos.
pub trait PhotoDescriber: Send + Sync {
    /// What is in the JPEG at `image`, untidied. `MODEL_UNAVAILABLE` on failure or an invalid
    /// answer.
    fn describe<'a>(&'a self, image: &'a Path) -> PortResult<'a, PhotoFacts>;
}
