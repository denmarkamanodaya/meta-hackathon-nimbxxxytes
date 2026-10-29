//! The only code that talks HTTP: nimbytes API calls carry the Keychain session cookie; presigned
//! S3 URLs never do. reqwest + rustls, timeouts set by the composition root.

use std::sync::{Arc, RwLock};
use std::time::Duration;

use nimbytes_contracts::session::SESSION_COOKIE;
use reqwest::header::{ACCEPT, CONTENT_TYPE, COOKIE, SET_COOKIE};
use reqwest::{Method, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::core::cookie::{SessionChange, bind_session, session_change, session_for_origin};
use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::core::server_url::check_api_path;
use crate::ports::SessionStore;

/// A raw API answer, as `api_request` returns it to the web layer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RawResponse {
    /// HTTP status.
    pub status: u16,
    /// Body text (empty for 204).
    pub body: String,
    /// `Content-Type` header.
    pub content_type: Option<String>,
}

/// One API call as the web layer describes it.
#[derive(Debug, Clone)]
pub struct ApiCall {
    /// HTTP method.
    pub method: String,
    /// Path starting with `/api/`.
    pub path: String,
    /// Request body bytes (JSON text, or a binary body such as a voice note).
    pub body: Option<Vec<u8>>,
    /// Its type; JSON when absent.
    pub content_type: Option<String>,
}

/// nimbytes API client bound to one server and the stored session.
pub struct ApiClient {
    http: reqwest::Client,
    server: RwLock<Option<String>>,
    session: Arc<dyn SessionStore>,
    call_timeout: Duration,
}

/// A transport failure as `NETWORK` with a readable message: `Can't reach <origin>`.
pub(crate) fn network(err: &reqwest::Error) -> DesktopError {
    let origin = err.url().map(|u| u.origin().ascii_serialization());
    let message = match origin {
        Some(origin) if err.is_timeout() => format!("Can't reach {origin} (timed out)"),
        Some(origin) => format!("Can't reach {origin}"),
        None => "Can't reach the server".to_owned(),
    };
    DesktopError::new(ErrorCode::Network, message)
}

impl ApiClient {
    /// Wraps a built client; `call_timeout` bounds every non-streaming API call.
    pub fn new(
        http: reqwest::Client,
        server: Option<String>,
        session: Arc<dyn SessionStore>,
        call_timeout: Duration,
    ) -> Self {
        Self {
            http,
            server: RwLock::new(server),
            session,
            call_timeout,
        }
    }

    /// The underlying client, for presigned S3 transfers (no cookie is ever attached there).
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// The current server, `scheme://host[:port]`.
    ///
    /// # Errors
    /// `SERVER_NOT_SET` on first run.
    pub fn server(&self) -> DesktopResult<String> {
        self.server
            .read()
            .ok()
            .and_then(|s| s.clone())
            .ok_or_else(|| DesktopError::new(ErrorCode::ServerNotSet, "choose a server first"))
    }

    /// Whether a session for the current server is stored.
    ///
    /// # Errors
    /// `KEYCHAIN` when the store cannot be read.
    pub fn has_session(&self) -> DesktopResult<bool> {
        Ok(self.cookie()?.is_some())
    }

    /// The stored cookie value, only when it was issued by the current server.
    fn cookie(&self) -> DesktopResult<Option<String>> {
        let Ok(server) = self.server() else {
            return Ok(None);
        };
        let stored = self.session.get()?;
        Ok(stored
            .as_deref()
            .and_then(|s| session_for_origin(s, &server))
            .map(str::to_owned))
    }

    /// Forgets the session.
    ///
    /// # Errors
    /// `KEYCHAIN` when the store refuses.
    pub fn sign_out(&self) -> DesktopResult<()> {
        self.session.clear()
    }

    fn build(&self, method: Method, path: &str) -> DesktopResult<reqwest::RequestBuilder> {
        let url = format!("{}{}", self.server()?, check_api_path(path)?);
        let mut req = self.http.request(method, url);
        if let Some(value) = self.cookie()? {
            req = req.header(COOKIE, format!("{SESSION_COOKIE}={value}"));
        }
        Ok(req)
    }

    /// The web layer's call as a request: method, cookie, and the body with its type (JSON
    /// when absent).
    fn prepare(&self, call: &ApiCall) -> DesktopResult<reqwest::RequestBuilder> {
        let method =
            Method::from_bytes(call.method.to_ascii_uppercase().as_bytes()).map_err(|_| {
                DesktopError::new(ErrorCode::BadPath, format!("bad method {}", call.method))
            })?;
        let mut req = self.build(method, &call.path)?;
        if let Some(body) = &call.body {
            let kind = call.content_type.as_deref().unwrap_or("application/json");
            req = req.header(CONTENT_TYPE, kind).body(body.clone());
        }
        Ok(req)
    }

    fn stream_request(&self, call: &ApiCall) -> DesktopResult<reqwest::RequestBuilder> {
        Ok(self.prepare(call)?.header(ACCEPT, "text/event-stream"))
    }

    fn remember_session(&self, path: &str, res: &reqwest::Response) -> DesktopResult<()> {
        let headers = res.headers().get_all(SET_COOKIE);
        let change = session_change(headers.iter().filter_map(|v| v.to_str().ok()));
        let logged_out = path == "/api/session/logout" && res.status() == StatusCode::NO_CONTENT;
        match (change, logged_out) {
            (_, true) | (Some(SessionChange::Clear), _) => self.session.clear(),
            (Some(SessionChange::Set(value)), false) => {
                self.session.set(&bind_session(&self.server()?, &value))
            }
            (None, false) => Ok(()),
        }
    }

    /// One API call with the session cookie; any status comes back as data.
    ///
    /// # Errors
    /// `BAD_PATH`, `SERVER_NOT_SET`, `KEYCHAIN` or `NETWORK`.
    pub async fn request(&self, call: ApiCall) -> DesktopResult<RawResponse> {
        let req = self.prepare(&call)?.timeout(self.call_timeout);
        let res = req.send().await.map_err(|e| network(&e))?;
        self.remember_session(&call.path, &res)?;
        let status = res.status().as_u16();
        let content_type = res
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let body = res.text().await.map_err(|e| network(&e))?;
        Ok(RawResponse {
            status,
            body,
            content_type,
        })
    }

    /// Opens a Server-Sent Events stream with the call's method and body (no total timeout; the
    /// read timeout still applies).
    ///
    /// # Errors
    /// `NOT_SIGNED_IN` on 401, `BAD_STATUS` on another non-2xx, or a transport error.
    pub async fn open_stream(&self, call: &ApiCall) -> DesktopResult<reqwest::Response> {
        let res = self
            .stream_request(call)?
            .send()
            .await
            .map_err(|e| network(&e))?;
        ok_status(res).await
    }

    /// GETs JSON from the API, with `If-None-Match` when an etag is given; `None` on 304.
    ///
    /// # Errors
    /// `NOT_SIGNED_IN` on 401, `NOT_FOUND` on 404, `BAD_STATUS`, `BAD_RESPONSE` or a transport error.
    pub async fn get_json<T: DeserializeOwned>(
        &self,
        path: &str,
        etag: Option<&str>,
    ) -> DesktopResult<Option<T>> {
        let mut req = self.build(Method::GET, path)?.timeout(self.call_timeout);
        if let Some(etag) = etag {
            req = req.header("If-None-Match", etag);
        }
        let res = req.send().await.map_err(|e| network(&e))?;
        if res.status() == StatusCode::NOT_MODIFIED {
            return Ok(None);
        }
        let res = ok_status(res).await?;
        res.json().await.map(Some).map_err(|e| bad_response(&e))
    }

    /// POSTs JSON to the API and parses the JSON answer.
    ///
    /// # Errors
    /// Same as [`Self::get_json`].
    pub async fn post_json<B: Serialize + Sync, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> DesktopResult<T> {
        let res = self
            .build(Method::POST, path)?
            .timeout(self.call_timeout)
            .json(body)
            .send()
            .await
            .map_err(|e| network(&e))?;
        ok_status(res)
            .await?
            .json()
            .await
            .map_err(|e| bad_response(&e))
    }
}

fn bad_response(err: &reqwest::Error) -> DesktopError {
    DesktopError::new(ErrorCode::BadResponse, err.to_string())
}

/// Maps a non-2xx answer to a typed error, keeping the server's message when it sent the
/// `{ error: { code, message } }` envelope.
pub(crate) async fn ok_status(res: reqwest::Response) -> DesktopResult<reqwest::Response> {
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    let body = res.text().await.unwrap_or_default();
    let message = serde_json::from_str::<nimbytes_contracts::ErrorEnvelope>(&body)
        .map(|e| e.error.message)
        .unwrap_or_else(|_| format!("server answered {status}"));
    let code = match status {
        StatusCode::UNAUTHORIZED => ErrorCode::NotSignedIn,
        StatusCode::NOT_FOUND => ErrorCode::NotFound,
        _ => ErrorCode::BadStatus,
    };
    Err(DesktopError::new(code, message))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    struct Stored(Mutex<Option<String>>);

    impl SessionStore for Stored {
        fn get(&self) -> DesktopResult<Option<String>> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> DesktopResult<()> {
            *self.0.lock().unwrap() = Some(value.to_owned());
            Ok(())
        }
        fn clear(&self) -> DesktopResult<()> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    fn cookie_sent(server: &str) -> Option<String> {
        let stored = bind_session("https://localhost", "signed-value");
        let store = Arc::new(Stored(Mutex::new(Some(stored))));
        let client = ApiClient::new(
            reqwest::Client::new(),
            Some(server.to_owned()),
            store,
            Duration::from_secs(1),
        );
        let req = client
            .build(Method::GET, "/api/session")
            .unwrap()
            .build()
            .unwrap();
        req.headers()
            .get(COOKIE)
            .map(|v| v.to_str().unwrap().to_owned())
    }

    #[tokio::test]
    async fn a_transport_failure_names_the_origin_without_raw_error_text() {
        // Port 1 on loopback refuses at once; nothing leaves the machine.
        let err = reqwest::Client::new()
            .get("http://127.0.0.1:1/api/sync/manifest")
            .send()
            .await
            .unwrap_err();
        let mapped = network(&err);
        assert_eq!(mapped.code, ErrorCode::Network);
        assert_eq!(mapped.message, "Can't reach http://127.0.0.1:1");
    }

    #[test]
    fn a_post_stream_carries_its_body_type_cookie_and_accept() {
        let stored = bind_session("https://localhost", "signed-value");
        let client = ApiClient::new(
            reqwest::Client::new(),
            Some("https://localhost".to_owned()),
            Arc::new(Stored(Mutex::new(Some(stored)))),
            Duration::from_secs(1),
        );
        let call = ApiCall {
            method: "post".to_owned(),
            path: "/api/search/stream".to_owned(),
            body: Some(br#"{"query":"dog"}"#.to_vec()),
            content_type: None,
        };
        let req = client.stream_request(&call).unwrap().build().unwrap();
        assert_eq!(req.method(), Method::POST);
        assert_eq!(req.url().as_str(), "https://localhost/api/search/stream");
        assert_eq!(req.headers()[CONTENT_TYPE], "application/json");
        assert_eq!(req.headers()[ACCEPT], "text/event-stream");
        assert_eq!(req.headers()[COOKIE], "nb_session=signed-value");
        let body = req.body().and_then(reqwest::Body::as_bytes).unwrap();
        assert_eq!(body, br#"{"query":"dog"}"#);
    }

    #[test]
    fn the_cookie_goes_only_to_the_server_that_issued_it() {
        assert_eq!(
            cookie_sent("https://localhost").as_deref(),
            Some("nb_session=signed-value")
        );
        assert_eq!(cookie_sent("https://3-104-132-162.sslip.io"), None);
    }
}
