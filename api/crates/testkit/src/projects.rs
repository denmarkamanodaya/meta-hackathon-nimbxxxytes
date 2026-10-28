//! In-memory [`ProjectStore`].

use std::sync::Mutex;

use nimbytes_core::domain::ids::{ClipId, ProjectId, UserId};
use nimbytes_core::domain::project::{
    ArtSource, Project, ProjectArt, ProjectColor, ProjectSummary,
};
use nimbytes_core::keys::ObjectKey;
use nimbytes_core::ports::{PortResult, ProjectStore};

/// Projects and clip links in memory. Totals count links only: duration and size stay 0, because
/// this fake knows no clips.
#[derive(Debug, Default)]
pub struct InMemoryProjects {
    /// Projects in creation order.
    pub projects: Mutex<Vec<Project>>,
    /// (project, clip) links.
    pub links: Mutex<Vec<(ProjectId, ClipId)>>,
    /// Key art by project.
    pub art: Mutex<Vec<(ProjectId, ProjectArt)>>,
    /// Projects whose automatic first art was claimed.
    pub auto_art: Mutex<Vec<ProjectId>>,
}

impl InMemoryProjects {
    fn summary_of(&self, p: Project) -> ProjectSummary {
        let n = crate::lock(&self.links)
            .iter()
            .filter(|(id, _)| id == &p.id)
            .count();
        let art = crate::lock(&self.art)
            .iter()
            .find(|(id, _)| id == &p.id)
            .map(|(_, a)| a.clone())
            .unwrap_or_default();
        ProjectSummary {
            project: p,
            clip_count: u32::try_from(n).unwrap_or(u32::MAX),
            duration_s: 0.0,
            size_bytes: 0,
            art,
        }
    }

    fn link(&self, id: &ProjectId, clips: &[ClipId]) {
        let mut links = crate::lock(&self.links);
        for c in clips {
            if !links.iter().any(|(p, l)| p == id && l == c) {
                links.push((id.clone(), c.clone()));
            }
        }
    }
}

impl ProjectStore for InMemoryProjects {
    fn create<'a>(&'a self, project: &'a Project, clips: &'a [ClipId]) -> PortResult<'a, ()> {
        crate::lock(&self.projects).push(project.clone());
        self.link(&project.id, clips);
        Box::pin(async { Ok(()) })
    }

    fn get<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<Project>> {
        let got = crate::lock(&self.projects)
            .iter()
            .find(|p| &p.id == id)
            .cloned();
        Box::pin(async move { Ok(got) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<ProjectSummary>> {
        let mut mine: Vec<Project> = crate::lock(&self.projects)
            .iter()
            .filter(|p| &p.user_id == user)
            .cloned()
            .collect();
        mine.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
        let out = mine.into_iter().map(|p| self.summary_of(p)).collect();
        Box::pin(async move { Ok(out) })
    }

    fn summary<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, Option<ProjectSummary>> {
        let found = crate::lock(&self.projects)
            .iter()
            .find(|p| &p.id == id)
            .cloned();
        let out = found.map(|p| self.summary_of(p));
        Box::pin(async move { Ok(out) })
    }

    fn update<'a>(
        &'a self,
        id: &'a ProjectId,
        (name, color): (&'a str, ProjectColor),
        updated_at: &'a str,
    ) -> PortResult<'a, ()> {
        if let Some(p) = crate::lock(&self.projects).iter_mut().find(|p| &p.id == id) {
            name.clone_into(&mut p.name);
            p.color = color;
            updated_at.clone_into(&mut p.updated_at);
        }
        Box::pin(async { Ok(()) })
    }

    fn delete<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, ()> {
        crate::lock(&self.projects).retain(|p| &p.id != id);
        crate::lock(&self.links).retain(|(p, _)| p != id);
        Box::pin(async { Ok(()) })
    }

    fn add_clips<'a>(
        &'a self,
        id: &'a ProjectId,
        clips: &'a [ClipId],
        _at: &'a str,
    ) -> PortResult<'a, ()> {
        self.link(id, clips);
        Box::pin(async { Ok(()) })
    }

    fn remove_clip<'a>(&'a self, id: &'a ProjectId, clip: &'a ClipId) -> PortResult<'a, ()> {
        crate::lock(&self.links).retain(|(p, c)| !(p == id && c == clip));
        Box::pin(async { Ok(()) })
    }

    fn set_art<'a>(
        &'a self,
        id: &'a ProjectId,
        key: &'a ObjectKey,
        sources: &'a [ArtSource],
    ) -> PortResult<'a, ()> {
        let mut art = crate::lock(&self.art);
        art.retain(|(p, _)| p != id);
        art.push((
            id.clone(),
            ProjectArt {
                key: Some(key.clone()),
                sources: sources.to_vec(),
            },
        ));
        Box::pin(async { Ok(()) })
    }

    fn claim_auto_art<'a>(&'a self, id: &'a ProjectId) -> PortResult<'a, bool> {
        let mut claimed = crate::lock(&self.auto_art);
        let first = !claimed.contains(id);
        if first {
            claimed.push(id.clone());
        }
        Box::pin(async move { Ok(first) })
    }
}
