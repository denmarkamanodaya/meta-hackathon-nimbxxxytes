//! Router over in-memory fakes, plus request helpers, for handler tests.

use std::sync::Arc;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode, header};
use axum::response::IntoResponse;
use axum_extra::extract::cookie::{Cookie, Key, SignedCookieJar};
use nimbytes_contracts::session::SESSION_COOKIE;
use nimbytes_testkit::{
    FakeBlobStore, FixedClock, InMemoryCatalogue, InMemoryJobQueue, SequentialIds,
};
use tower::ServiceExt;

use crate::progress::BroadcastProgress;
use crate::state::{AppState, Ports};

/// Fakes behind a router; keep the `Arc`s to assert on them.
pub struct TestApp {
    pub router: Router,
    pub blobs: Arc<FakeBlobStore>,
    pub jobs: Arc<InMemoryJobQueue>,
    pub key: Key,
}

pub const PASSCODE: &str = "letmein";

impl TestApp {
    pub fn new() -> Self {
        let blobs = Arc::new(FakeBlobStore::default());
        let jobs = Arc::new(InMemoryJobQueue::default());
        let key = Key::from(&[7u8; 64]);
        let ports = Ports {
            blobs: blobs.clone(),
            catalogue: Arc::new(InMemoryCatalogue::default()),
            jobs: jobs.clone(),
            clock: Arc::new(FixedClock::at(1_793_062_923_456)),
            ids: Arc::new(SequentialIds::new("id")),
            passcode: PASSCODE.into(),
        };
        let progress = Arc::new(BroadcastProgress::new(16));
        let state = AppState {
            ports: Arc::new(ports),
            cookie_key: key.clone(),
            progress,
        };
        Self {
            router: crate::http::router(state),
            blobs,
            jobs,
            key,
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

/// `GET` with an optional `Cookie` header.
pub fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut req = Request::get(uri);
    if let Some(cookie) = cookie {
        req = req.header(header::COOKIE, cookie);
    }
    req.body(Body::empty()).unwrap()
}
