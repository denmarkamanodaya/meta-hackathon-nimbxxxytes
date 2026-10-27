//! Router over in-memory fakes, plus request helpers, for handler tests.

use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::response::IntoResponse;
use axum_extra::extract::cookie::{Cookie, Key, SignedCookieJar};
use nimbytes_contracts::session::SESSION_COOKIE;
use nimbytes_testkit::{
    FakeBlobStore, FakeEmbedder, FakeScratch, FixedClock, InMemoryCatalogue, InMemoryFaceStore,
    InMemoryJobQueue, InMemoryLedger, InMemoryPeople, InMemoryShorts, InMemoryTextIndex,
    InMemoryVectorIndex, ScriptedReasoner, SequentialIds, UnwiredStudio,
};
use tower::ServiceExt;

use crate::progress::BroadcastProgress;
use crate::state::{AppState, Ports};
use crate::studio::Studio;

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
    pub key: Key,
}

pub const PASSCODE: &str = "letmein";

/// The real router over `ports`, signing sessions with `key`.
fn router_over(ports: Ports, key: &Key) -> Router {
    let ports = Arc::new(ports);
    let progress = Arc::new(BroadcastProgress::new(16));
    let unwired = Arc::new(UnwiredStudio);
    let studio = Studio::new(
        ports.clone(),
        progress.clone(),
        String::new(),
        (unwired.clone(), unwired.clone(), unwired),
    );
    crate::http::router(AppState {
        ports,
        cookie_key: key.clone(),
        progress,
        studio,
    })
}

impl TestApp {
    pub fn new() -> Self {
        let mut app = Self {
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
            key: Key::from(&[7u8; 64]),
        };
        app.router = router_over(app.ports(), &app.key);
        app
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

/// `DELETE` with a `Cookie` header.
pub fn delete(uri: &str, cookie: &str) -> Request<Body> {
    Request::delete(uri)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap()
}
