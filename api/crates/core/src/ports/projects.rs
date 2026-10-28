//! Projects and the clips in them.

use crate::domain::ids::{ClipId, ProjectId, UserId};
use crate::domain::project::{ArtSource, Project, ProjectColor, ProjectSummary};
use crate::keys::ObjectKey;
use crate::ports::PortResult;

/// Where projects and their clip links live.
pub trait ProjectStore: Send + Sync {
    /// Stores a new project with `clips` in it (added at its creation time), in one transaction.
    fn create<'a>(&'a self, project: &'a Project, clips: &'a [ClipId]) -> PortResult<'a, ()>;

    /// One project.
    fn get<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<Project>>;

    /// The user's projects with their totals, newest first.
    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ProjectSummary>>;

    /// One project with its totals.
    fn summary<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<ProjectSummary>>;

    /// Sets the project's name and colour (`fields`) and its `updated_at`.
    fn update<'a>(
        &'a self,
        id: &'a ProjectId,
        fields: (&'a str, ProjectColor),
        updated_at: &'a str,
    ) -> PortResult<'a, ()>;

    /// Deletes the project and its clip links; the clips stay.
    fn delete<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, ()>;

    /// Adds `clips` to the project at `at`; clips already in it are left as they are.
    fn add_clips<'a>(
        &'a self,
        id: &'a ProjectId,
        clips: &'a [ClipId],
        at: &'a str,
    ) -> PortResult<'a, ()>;

    /// Takes the clip out of the project; nothing happens when it is not in it.
    fn remove_clip<'a>(&'a self, id: &'a ProjectId, clip: &'a ClipId) -> PortResult<'a, ()>;

    /// Records the project's key art and the moments it was drawn from.
    fn set_art<'a>(
        &'a self,
        id: &'a ProjectId,
        key: &'a ObjectKey,
        sources: &'a [ArtSource],
    ) -> PortResult<'a, ()>;

    /// Marks the automatic first key art as started; `true` only the first time.
    fn claim_auto_art<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, bool>;
}
