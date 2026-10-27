//! Shared handler state: the bound ports and the session cookie key. Built only by the
//! composition root (or by tests with fakes).

use std::sync::Arc;
use std::time::Duration;

use axum::extract::FromRef;
use axum_extra::extract::cookie::Key;
use nimbytes_core::ports::{
    BlobStore, Catalogue, Clock, Embedder, FaceMatchStore, IdGenerator, JobQueue, ModelLedger,
    PeopleStore, Reasoner, ShortStore, TextIndex, VectorIndex,
};
use nimbytes_core::usecases::clips::RemoveDeps;
use nimbytes_core::usecases::face_matching::SettingsDeps;
use nimbytes_core::usecases::library::LibraryDeps;
use nimbytes_core::usecases::people::PeopleDeps;
use nimbytes_core::usecases::search::SearchDeps;
use nimbytes_core::usecases::session::SessionDeps;
use nimbytes_core::usecases::shorts::ShortDeps;
use nimbytes_core::usecases::uploads::UploadDeps;

use crate::progress::BroadcastProgress;

/// Ports every request handler may use, bound once at start-up.
pub struct Ports {
    /// Object storage.
    pub blobs: Arc<dyn BlobStore>,
    /// Shorts, versions and step logs.
    pub shorts: Arc<dyn ShortStore>,
    /// Users, clips, uploads.
    pub catalogue: Arc<dyn Catalogue>,
    /// Background jobs.
    pub jobs: Arc<dyn JobQueue>,
    /// Time.
    pub clock: Arc<dyn Clock>,
    /// New ids.
    pub ids: Arc<dyn IdGenerator>,
    /// People, track and speaker names.
    pub people: Arc<dyn PeopleStore>,
    /// Query rewrite and rerank.
    pub reasoner: Arc<dyn Reasoner>,
    /// Keyword index.
    pub text: Arc<dyn TextIndex>,
    /// Query embeddings.
    pub embedder: Arc<dyn Embedder>,
    /// Segment vectors.
    pub vectors: Arc<dyn VectorIndex>,
    /// Model call log (costs screen).
    pub ledger: Arc<dyn ModelLedger>,
    /// Face matching switch, vectors and verdicts.
    pub faces: Arc<dyn FaceMatchStore>,
    /// Demo passcode (non-empty).
    pub passcode: String,
    /// Lifetime of presigned URLs handed to the client.
    pub url_ttl: Duration,
}

impl Ports {
    /// Deps for the upload use cases.
    pub fn upload_deps(&self) -> UploadDeps<'_> {
        UploadDeps {
            blobs: self.blobs.as_ref(),
            catalogue: self.catalogue.as_ref(),
            jobs: self.jobs.as_ref(),
            clock: self.clock.as_ref(),
            ids: self.ids.as_ref(),
        }
    }

    /// Deps for the library and clip screens.
    pub fn library_deps(&self) -> LibraryDeps<'_> {
        LibraryDeps {
            catalogue: self.catalogue.as_ref(),
            blobs: self.blobs.as_ref(),
            url_ttl: self.url_ttl,
            clock: self.clock.as_ref(),
        }
    }

    /// Deps for search.
    pub fn search_deps(&self) -> SearchDeps<'_> {
        SearchDeps {
            catalogue: self.catalogue.as_ref(),
            people: self.people.as_ref(),
            reasoner: self.reasoner.as_ref(),
            text: self.text.as_ref(),
            embedder: self.embedder.as_ref(),
            vectors: self.vectors.as_ref(),
            blobs: self.blobs.as_ref(),
            clock: self.clock.as_ref(),
            url_ttl: self.url_ttl,
            ledger: self.ledger.as_ref(),
        }
    }

    /// Deps for naming people and speakers.
    pub fn people_deps(&self) -> PeopleDeps<'_> {
        PeopleDeps {
            people: self.people.as_ref(),
            catalogue: self.catalogue.as_ref(),
            text: self.text.as_ref(),
            ids: self.ids.as_ref(),
            blobs: self.blobs.as_ref(),
            url_ttl: self.url_ttl,
        }
    }

    /// Deps for the shorts endpoints.
    pub fn short_deps(&self) -> ShortDeps<'_> {
        ShortDeps {
            shorts: self.shorts.as_ref(),
            blobs: self.blobs.as_ref(),
            jobs: self.jobs.as_ref(),
            ids: self.ids.as_ref(),
            clock: self.clock.as_ref(),
            url_ttl: self.url_ttl,
        }
    }

    /// Deps for the face matching switch.
    pub fn settings_deps(&self) -> SettingsDeps<'_> {
        SettingsDeps {
            faces: self.faces.as_ref(),
            jobs: self.jobs.as_ref(),
            ids: self.ids.as_ref(),
            clock: self.clock.as_ref(),
        }
    }

    /// Deps for removing a clip.
    pub fn remove_deps(&self) -> RemoveDeps<'_> {
        RemoveDeps {
            catalogue: self.catalogue.as_ref(),
            blobs: self.blobs.as_ref(),
            text: self.text.as_ref(),
            vectors: self.vectors.as_ref(),
        }
    }

    /// Deps for sign-in.
    pub fn session_deps(&self) -> SessionDeps<'_> {
        SessionDeps {
            catalogue: self.catalogue.as_ref(),
            ids: self.ids.as_ref(),
            clock: self.clock.as_ref(),
            passcode: &self.passcode,
        }
    }
}

/// Axum state: cheap to clone.
#[derive(Clone)]
pub struct AppState {
    /// Bound ports.
    pub ports: Arc<Ports>,
    /// Signs and verifies the session cookie.
    pub cookie_key: Key,
    /// Live step events for SSE watchers.
    pub progress: Arc<BroadcastProgress>,
}

impl FromRef<AppState> for Key {
    fn from_ref(state: &AppState) -> Key {
        state.cookie_key.clone()
    }
}
