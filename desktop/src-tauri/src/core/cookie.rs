//! Reads the session cookie out of `Set-Cookie` headers. The server signs the value; the app
//! stores it as is and sends it back as `Cookie: nb_session=<value>`.

use nimbytes_contracts::session::SESSION_COOKIE;

/// What a response asks the app to do with the stored session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionChange {
    /// Keep the new value.
    Set(String),
    /// The server removed the cookie (empty value or `Max-Age=0`).
    Clear,
}

/// Finds the `nb_session` cookie among `Set-Cookie` header values; the last one wins.
pub fn session_change<'a>(set_cookies: impl IntoIterator<Item = &'a str>) -> Option<SessionChange> {
    let prefix = format!("{SESSION_COOKIE}=");
    set_cookies
        .into_iter()
        .filter_map(|raw| {
            let rest = raw.trim().strip_prefix(&prefix)?;
            let mut parts = rest.split(';');
            let value = parts.next().unwrap_or_default().trim();
            let expired = parts.any(|attr| attr.trim().eq_ignore_ascii_case("max-age=0"));
            Some(if value.is_empty() || expired {
                SessionChange::Clear
            } else {
                SessionChange::Set(value.to_owned())
            })
        })
        .last()
}

/// Stores a session together with the server origin that issued it (`<origin>\n<value>`; a
/// cookie value never holds a newline).
pub fn bind_session(origin: &str, value: &str) -> String {
    format!("{origin}\n{value}")
}

/// The cookie value to send to `origin`, only if the stored session was issued by that exact
/// origin. Anything else (another server, an unbound legacy value) counts as signed out.
pub fn session_for_origin<'a>(stored: &'a str, origin: &str) -> Option<&'a str> {
    let (issuer, value) = stored.split_once('\n')?;
    (issuer == origin && !value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_only_sent_to_the_origin_that_issued_it() {
        let stored = bind_session("https://localhost", "abc=1");
        assert_eq!(
            session_for_origin(&stored, "https://localhost"),
            Some("abc=1")
        );
        assert_eq!(
            session_for_origin(&stored, "https://3-104-132-162.sslip.io"),
            None
        );
        assert_eq!(session_for_origin(&stored, "https://localhost:8443"), None);
        assert_eq!(session_for_origin("abc=1", "https://localhost"), None);
        assert_eq!(
            session_for_origin("https://localhost\n", "https://localhost"),
            None
        );
    }

    #[test]
    fn the_session_cookie_is_read_and_a_removal_clears_it() {
        let set =
            "nb_session=abc%2Fdef=018f; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=630720000";
        assert_eq!(
            session_change(["other=1; Path=/", set]),
            Some(SessionChange::Set("abc%2Fdef=018f".into()))
        );
        let removed = "nb_session=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
        assert_eq!(session_change([removed]), Some(SessionChange::Clear));
        assert_eq!(session_change(["other=1"]), None);
    }
}
