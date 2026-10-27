//! In-memory [`ProjectStore`].

use std::sync::Mutex;

use nimbytes_core::domain::ids::{ClipId, ProjectId, UserId};
use nimbytes_core::domain::project::{Project, ProjectColor, ProjectSummary};
use nimbytes_core::ports::{PortResult, ProjectStore};

/// Projects and clip links in memory. Totals count links only: duration and size stay 0, because
/// this fake knows no clips.
#[derive(Debug, Default)]
pub struct InMemoryProjects {
    /// Projects in creation order.
    pub projects: Mutex<Vec<Project>>,
    /// (project, clip) links.
    pub links: Mutex<Vec<(ProjectId, ClipId)>>,
}

impl InMemoryProjects {
    fn summary_of(&self, p: Project) -> ProjectSummary {
        let n = crate::lock(&self.links)
            .iter()
            .filter(|(id, _)| id == &p.id)
            .count();
        ProjectSummary {
            project: p,
            clip_count: u32::try_from(n).unwrap_or(u32::MAX),
            duration_s: 0.0,
            size_bytes: 0,
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
}
