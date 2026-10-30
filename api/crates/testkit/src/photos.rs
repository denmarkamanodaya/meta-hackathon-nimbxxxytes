//! Fakes for Photos: photo rows in memory and a scripted Spark describer.

use std::path::Path;
use std::sync::Mutex;

use nimbytes_core::domain::ids::{PhotoId, UserId};
use nimbytes_core::domain::photo::{Photo, PhotoFacts, PhotoFit};
use nimbytes_core::ports::{PhotoDescriber, PhotoProgress, PhotoStore, PortResult};
use nimbytes_core::{AppError, ErrorCode};

/// [`PhotoStore`] over a vector; a title the owner typed survives new facts, as in SQLite.
#[derive(Debug, Default)]
pub struct InMemoryPhotos {
    rows: Mutex<Vec<(Photo, bool)>>,
}

impl InMemoryPhotos {
    /// The stored photo.
    pub fn photo(&self, id: &str) -> Option<Photo> {
        crate::lock(&self.rows)
            .iter()
            .find(|(p, _)| p.id.as_str() == id)
            .map(|(p, _)| p.clone())
    }

    /// Puts a photo in place, as an earlier run would have.
    pub fn put(&self, photo: Photo) {
        crate::lock(&self.rows).push((photo, false));
    }

    fn edit(&self, id: &PhotoId, f: impl FnOnce(&mut Photo, &mut bool)) {
        if let Some((p, by_owner)) = crate::lock(&self.rows)
            .iter_mut()
            .find(|(p, _)| &p.id == id)
        {
            f(p, by_owner);
        }
    }
}

fn done() -> PortResult<'static, ()> {
    Box::pin(async { Ok(()) })
}

impl PhotoStore for InMemoryPhotos {
    fn create<'a>(&'a self, photo: &'a Photo) -> PortResult<'a, ()> {
        self.put(photo.clone());
        done()
    }

    fn get<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, Option<Photo>> {
        Box::pin(async move { Ok(self.photo(id.as_str())) })
    }

    fn list<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Vec<Photo>> {
        Box::pin(async move {
            let mut mine: Vec<Photo> = crate::lock(&self.rows)
                .iter()
                .filter(|(p, _)| &p.user_id == user)
                .map(|(p, _)| p.clone())
                .collect();
            let when = |p: &Photo| p.taken_at.clone().unwrap_or_else(|| p.created_at.clone());
            mine.sort_by(|a, b| when(b).cmp(&when(a)).then(b.id.cmp(&a.id)));
            Ok(mine)
        })
    }

    fn many<'a>(&'a self, user: &'a UserId, ids: &'a [PhotoId]) -> PortResult<'a, Vec<Photo>> {
        Box::pin(async move {
            Ok(crate::lock(&self.rows)
                .iter()
                .filter(|(p, _)| &p.user_id == user && ids.contains(&p.id))
                .map(|(p, _)| p.clone())
                .collect())
        })
    }

    fn set_progress<'a>(&'a self, id: &'a PhotoId, pr: PhotoProgress<'a>) -> PortResult<'a, ()> {
        self.edit(id, |p, _| {
            p.status = pr.status;
            p.error = pr.error.map(str::to_owned);
            p.updated_at = pr.at.to_owned();
        });
        done()
    }

    fn set_fit<'a>(&'a self, id: &'a PhotoId, fit: &'a PhotoFit) -> PortResult<'a, ()> {
        self.edit(id, |p, _| {
            p.width = Some(fit.width);
            p.height = Some(fit.height);
            p.taken_at = Some(fit.taken_at.clone());
            p.camera = fit.camera.clone();
        });
        done()
    }

    fn set_facts<'a>(&'a self, id: &'a PhotoId, facts: &'a PhotoFacts) -> PortResult<'a, ()> {
        self.edit(id, |p, by_owner| {
            if !*by_owner {
                p.title = facts.title.clone();
            }
            p.facts = facts.clone();
        });
        done()
    }

    fn set_title<'a>(&'a self, id: &'a PhotoId, title: &'a str, at: &'a str) -> PortResult<'a, ()> {
        self.edit(id, |p, by_owner| {
            p.title = title.to_owned();
            p.updated_at = at.to_owned();
            *by_owner = true;
        });
        done()
    }

    fn delete<'a>(&'a self, id: &'a PhotoId) -> PortResult<'a, ()> {
        crate::lock(&self.rows).retain(|(p, _)| &p.id != id);
        done()
    }
}

/// [`PhotoDescriber`] answering scripted facts (`MODEL_UNAVAILABLE` until set) and recording the
/// files it was shown.
#[derive(Debug, Default)]
pub struct ScriptedPhotoDescriber {
    facts: Mutex<Option<PhotoFacts>>,
    seen: Mutex<Vec<String>>,
}

impl ScriptedPhotoDescriber {
    /// Every call answers `facts`.
    pub fn describes(&self, facts: PhotoFacts) {
        *crate::lock(&self.facts) = Some(facts);
    }

    /// File names shown so far.
    pub fn seen(&self) -> Vec<String> {
        crate::lock(&self.seen).clone()
    }
}

impl PhotoDescriber for ScriptedPhotoDescriber {
    fn describe<'a>(&'a self, image: &'a Path) -> PortResult<'a, PhotoFacts> {
        Box::pin(async move {
            let name = image
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            crate::lock(&self.seen).push(name);
            crate::lock(&self.facts)
                .clone()
                .ok_or_else(|| AppError::new(ErrorCode::ModelUnavailable, "nothing scripted"))
        })
    }
}
