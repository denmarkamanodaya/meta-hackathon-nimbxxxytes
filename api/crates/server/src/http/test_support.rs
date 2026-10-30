//! Router over in-memory fakes, plus request helpers, for handler tests.

use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::response::IntoResponse;
use axum_extra::extract::cookie::{Cookie, Key, SignedCookieJar};
use nimbytes_contracts::session::SESSION_COOKIE;
use nimbytes_core::ports::{ExportStore, ImageMaker};
use nimbytes_core::usecases::ask::AskPorts;
use nimbytes_core::usecases::documents::DocumentPorts;
use nimbytes_core::usecases::guides::GuidePorts;
use nimbytes_core::usecases::listens::ListenPorts;
use nimbytes_core::usecases::photos::PhotoPorts;
use nimbytes_core::usecases::subjects::SubjectPorts;
use nimbytes_testkit::world::probe;
use nimbytes_testkit::{
    FakeBlobStore, FakeEmbedder, FakeMasks, FakeMediaTool, FakeNamer, FakeNarrator, FakeRenderer,
    FakeScratch, FakeTranscriber, FixedClock, InMemoryBrand, InMemoryCatalogue, InMemoryClipLinks,
    InMemoryDocuments, InMemoryExports, InMemoryFaceStore, InMemoryGuides, InMemoryJobQueue,
    InMemoryLedger, InMemoryListens, InMemoryPeople, InMemoryPhotos, InMemoryPrivacy,
    InMemoryProjects, InMemoryShorts, InMemorySubjects, InMemoryTextIndex, InMemoryUsage,
    InMemoryVectorIndex, ROOMY_CAP, RecordingImages, ScriptedDocumentReader, ScriptedGuideWriter,
    ScriptedIntentReader, ScriptedInterpreter, ScriptedPhotoDescriber, ScriptedReasoner,
    ScriptedTracker, SequentialIds, Unwired,
};
use tower::ServiceExt;

use crate::art::ProjectArt;
use crate::progress::BroadcastProgress;
use crate::publisher::Publisher;
use crate::state::{AppState, Ports};

/// Fakes behind a router; keep the `Arc`s to assert on them.
pub struct TestApp {
    pub router: Router,
    pub blobs: Arc<FakeBlobStore>,
    pub catalogue: Arc<InMemoryCatalogue>,
    pub people: Arc<InMemoryPeople>,
    pub ledger: Arc<InMemoryLedger>,
    pub jobs: Arc<InMemoryJobQueue>,
    pub shorts: Arc<InMemoryShorts>,
    pub faces: Arc<InMemoryFaceStore>,
    pub scratch: Arc<FakeScratch>,
    pub reasoner: Arc<ScriptedReasoner>,
    pub text: Arc<InMemoryTextIndex>,
    pub privacy: Arc<InMemoryPrivacy>,
    pub brand: Arc<InMemoryBrand>,
    pub projects: Arc<InMemoryProjects>,
    /// Wired only by [`TestApp::with_publishing`].
    pub exports: Arc<InMemoryExports>,
    /// Wired only by [`TestApp::with_publishing`].
    pub images: Arc<RecordingImages>,
    /// SAM answers by prompt.
    pub tracker: Arc<ScriptedTracker>,
    /// Blur switch, reframe rows, tapped objects.
    pub subjects: Arc<InMemorySubjects>,
    /// Renderer mask work.
    pub masks: Arc<FakeMasks>,
    /// Range copies, frames and crops.
    pub media: Arc<FakeMediaTool>,
    /// MyWay guide rows.
    pub guides: Arc<InMemoryGuides>,
    /// Spark's guide steps.
    pub guide_writer: Arc<ScriptedGuideWriter>,
    /// MMS-TTS.
    pub narrator: Arc<FakeNarrator>,
    /// Voice Transcribe.
    pub transcriber: Arc<FakeTranscriber>,
    /// Spark reading ask-box requests.
    pub intents: Arc<ScriptedIntentReader>,
    /// iRead document rows.
    pub documents: Arc<InMemoryDocuments>,
    /// Spark reading and answering documents.
    pub doc_reader: Arc<ScriptedDocumentReader>,
    /// Near-copy and same-moment links.
    pub links: Arc<InMemoryClipLinks>,
    /// iListen rows.
    pub listens: Arc<InMemoryListens>,
    /// Photo rows.
    pub photos: Arc<InMemoryPhotos>,
    /// Photo vectors.
    pub photo_vectors: Arc<InMemoryVectorIndex>,
    /// Spark describing photos.
    pub photo_describer: Arc<ScriptedPhotoDescriber>,
    /// Spark understanding and checking transcripts.
    pub interpreter: Arc<ScriptedInterpreter>,
    pub key: Key,
}

/// The publish ports a router runs on (the platform pack is never wired).
type PublishPorts = (Arc<dyn ImageMaker>, Arc<dyn ExportStore>);

pub const PASSCODE: &str = "letmein";

/// The real router over `ports`, the guide ports and the publish ports, signing sessions with
/// `key`.
fn router_over(
    (ports, guides, ask, documents, listens, photos): AllPorts,
    (images, exports): PublishPorts,
    key: &Key,
) -> Router {
    let ports = Arc::new(ports);
    let progress = Arc::new(BroadcastProgress::new(16));
    let publisher = Publisher::new(
        (ports.clone(), progress.clone()),
        (Arc::new(Unwired), images.clone()),
        (exports, Arc::new(FakeRenderer::default())),
        std::time::Duration::from_secs(60),
    );
    crate::http::router(AppState {
        art: ProjectArt::new(ports.clone(), images),
        ports,
        cookie_key: key.clone(),
        progress,
        publisher,
        guides: Arc::new(guides),
        documents: Arc::new(documents),
        listens: Arc::new(listens),
        photos: Arc::new(photos),
        ask: Arc::new(ask),
    })
}

/// Every port group a router runs on.
type AllPorts = (
    Ports,
    GuidePorts,
    AskPorts,
    DocumentPorts,
    ListenPorts,
    PhotoPorts,
);

impl TestApp {
    /// Fakes everywhere; the publish ports are not wired (any use fails with `INTERNAL`).
    pub fn new() -> Self {
        let mut app = Self::fakes();
        let unwired = Arc::new(Unwired);
        let publish: PublishPorts = (unwired.clone(), unwired);
        app.router = router_over(app.all_ports(), publish, &app.key);
        app
    }

    /// Fakes everywhere, with in-memory exports and a recording image maker.
    pub fn with_publishing() -> Self {
        let mut app = Self::fakes();
        let publish: PublishPorts = (app.images.clone(), app.exports.clone());
        app.router = router_over(app.all_ports(), publish, &app.key);
        app
    }

    fn all_ports(&self) -> AllPorts {
        (
            self.ports(),
            self.guide_ports(),
            self.ask_ports(),
            self.document_ports(),
            self.listen_ports(),
            self.photo_ports(),
        )
    }

    fn fakes() -> Self {
        Self {
            router: Router::new(),
            blobs: Arc::default(),
            catalogue: Arc::default(),
            people: Arc::default(),
            ledger: Arc::default(),
            jobs: Arc::default(),
            shorts: Arc::default(),
            faces: Arc::default(),
            scratch: Arc::default(),
            reasoner: Arc::default(),
            text: Arc::default(),
            privacy: Arc::default(),
            brand: Arc::default(),
            projects: Arc::default(),
            exports: Arc::default(),
            images: Arc::default(),
            tracker: Arc::default(),
            subjects: Arc::default(),
            masks: Arc::default(),
            media: Arc::new(FakeMediaTool::new(probe(10.0, false), Vec::new())),
            guides: Arc::default(),
            guide_writer: Arc::default(),
            narrator: Arc::default(),
            transcriber: Arc::default(),
            intents: Arc::default(),
            documents: Arc::default(),
            doc_reader: Arc::default(),
            links: Arc::default(),
            listens: Arc::default(),
            photos: Arc::default(),
            photo_vectors: Arc::default(),
            photo_describer: Arc::default(),
            interpreter: Arc::default(),
            key: Key::from(&[7u8; 64]),
        }
    }

    /// The ports the router runs on: the kept fakes plus a fixed clock, sequential ids and empty
    /// vectors.
    fn ports(&self) -> Ports {
        Ports {
            blobs: self.blobs.clone(),
            shorts: self.shorts.clone(),
            catalogue: self.catalogue.clone(),
            jobs: self.jobs.clone(),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("id")),
            people: self.people.clone(),
            reasoner: self.reasoner.clone(),
            text: self.text.clone(),
            embedder: Arc::new(FakeEmbedder),
            vectors: Arc::new(InMemoryVectorIndex::default()),
            ledger: self.ledger.clone(),
            faces: self.faces.clone(),
            scratch: self.scratch.clone(),
            passcode: PASSCODE.into(),
            url_ttl: std::time::Duration::from_secs(3600),
            privacy: self.privacy.clone(),
            brand: self.brand.clone(),
            usage: Arc::new(InMemoryUsage::default()),
            storage_cap: ROOMY_CAP,
            usage_refresh: Arc::default(),
            projects: self.projects.clone(),
            subjects: SubjectPorts {
                tracker: self.tracker.clone(),
                media: self.media.clone(),
                store: self.subjects.clone(),
                catalogue: self.catalogue.clone(),
                namer: Arc::new(FakeNamer::answering("red mug")),
                masks: self.masks.clone(),
            },
            tap_timeout: std::time::Duration::from_millis(300),
            links: self.links.clone(),
            photo_store: self.photos.clone(),
            photo_vectors: self.photo_vectors.clone(),
        }
    }

    /// The MyWay ports over the kept fakes, with the narrator on.
    fn guide_ports(&self) -> GuidePorts {
        GuidePorts {
            store: self.guides.clone(),
            catalogue: self.catalogue.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            jobs: self.jobs.clone(),
            writer: self.guide_writer.clone(),
            tracker: self.tracker.clone(),
            masks: self.masks.clone(),
            narrator: Some(self.narrator.clone()),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("g")),
            url_ttl: std::time::Duration::from_secs(3600),
        }
    }

    /// The iRead ports over the kept fakes, with the narrator on.
    fn document_ports(&self) -> DocumentPorts {
        DocumentPorts {
            store: self.documents.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            jobs: self.jobs.clone(),
            reader: self.doc_reader.clone(),
            narrator: Some(self.narrator.clone()),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("d")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
            upload_ttl: std::time::Duration::from_secs(900),
        }
    }

    /// The iListen ports over the kept fakes, with the narrator on.
    fn listen_ports(&self) -> ListenPorts {
        ListenPorts {
            store: self.listens.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            transcriber: self.transcriber.clone(),
            interpreter: self.interpreter.clone(),
            cover_artist: Arc::new(nimbytes_testkit::FakeCoverArtist::default()),
            catalogue: self.catalogue.clone(),
            jobs: self.jobs.clone(),
            narrator: Some(self.narrator.clone()),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("l")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
        }
    }

    /// The Photos ports over the kept fakes.
    fn photo_ports(&self) -> PhotoPorts {
        PhotoPorts {
            store: self.photos.clone(),
            blobs: self.blobs.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            describer: self.photo_describer.clone(),
            embedder: Arc::new(FakeEmbedder),
            text: self.text.clone(),
            vectors: self.photo_vectors.clone(),
            jobs: self.jobs.clone(),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("p")),
            usage: Arc::new(InMemoryUsage::default()),
            cap: ROOMY_CAP,
            url_ttl: std::time::Duration::from_secs(3600),
        }
    }

    /// The ask-box ports over the kept fakes.
    fn ask_ports(&self) -> AskPorts {
        AskPorts {
            catalogue: self.catalogue.clone(),
            projects: self.projects.clone(),
            documents: self.documents.clone(),
            scratch: self.scratch.clone(),
            media: self.media.clone(),
            transcriber: self.transcriber.clone(),
            intents: self.intents.clone(),
            ids: Arc::new(SequentialIds::new("v")),
        }
    }

    /// Sends one request; returns status, headers and the body as text.
    pub async fn send(&self, req: Request<Body>) -> (StatusCode, header::HeaderMap, String) {
        let response = self.router.clone().oneshot(req).await.unwrap();
        let (status, headers) = (response.status(), response.headers().clone());
        let body = to_bytes(response.into_body(), 1 << 20).await.unwrap();
        (status, headers, String::from_utf8(body.to_vec()).unwrap())
    }

    /// A `Cookie` header value signed for `user`, as the browser would send it back.
    pub fn cookie_for(&self, user: &str) -> String {
        let jar = SignedCookieJar::new(self.key.clone())
            .add(Cookie::new(SESSION_COOKIE, user.to_owned()));
        let response = jar.into_response();
        let set = response.headers()[header::SET_COOKIE].to_str().unwrap();
        set.split(';').next().unwrap().to_owned()
    }
}

/// `POST` with a JSON body and an optional `Cookie` header.
pub fn post_json(uri: &str, cookie: Option<&str>, json: &str) -> Request<Body> {
    let mut req = Request::post(uri).header(header::CONTENT_TYPE, "application/json");
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    req.body(Body::from(json.to_owned())).unwrap()
}

/// `PUT` with a JSON body and a `Cookie` header.
pub fn put_json(uri: &str, cookie: &str, json: &str) -> Request<Body> {
    Request::put(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, cookie)
        .body(Body::from(json.to_owned()))
        .unwrap()
}

/// `GET` with an optional `Cookie` header.
pub fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut req = Request::get(uri);
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    req.body(Body::empty()).unwrap()
}

/// `PATCH` with a JSON body and a `Cookie` header.
pub fn patch_json(uri: &str, cookie: &str, json: &str) -> Request<Body> {
    Request::patch(uri)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::COOKIE, cookie)
        .body(Body::from(json.to_owned()))
        .unwrap()
}

/// `DELETE` with a `Cookie` header.
pub fn delete(uri: &str, cookie: &str) -> Request<Body> {
    Request::delete(uri)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}
