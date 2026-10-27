//! [`SessionStore`] on the macOS Keychain (generic password item, service = the bundle id). The
//! value is read from the Keychain once and then served from memory: every API call needs it,
//! and a Keychain read can block on the macOS access prompt.

use std::sync::Mutex;

use crate::core::error::{DesktopError, DesktopResult, ErrorCode};
use crate::ports::SessionStore;

/// Keychain item holding the `nb_session` cookie value.
pub struct KeychainSessionStore {
    service: String,
    account: String,
    /// `None` until the first read; then the Keychain's answer.
    cached: Mutex<Option<Option<String>>>,
}

impl KeychainSessionStore {
    /// One item; the API client clears it whenever the server changes.
    pub fn new(service: &str) -> Self {
        Self {
            service: service.to_owned(),
            account: "nb_session".to_owned(),
            cached: Mutex::new(None),
        }
    }

    fn entry(&self) -> DesktopResult<keyring::Entry> {
        keyring::Entry::new(&self.service, &self.account).map_err(keychain)
    }

    fn remember(&self, value: Option<String>) {
        if let Ok(mut slot) = self.cached.lock() {
            *slot = Some(value);
        }
    }
}

fn keychain(err: keyring::Error) -> DesktopError {
    DesktopError::new(ErrorCode::Keychain, err.to_string())
}

impl SessionStore for KeychainSessionStore {
    fn get(&self) -> DesktopResult<Option<String>> {
        if let Some(value) = self.cached.lock().ok().and_then(|c| c.clone()) {
            return Ok(value);
        }
        let value = match self.entry()?.get_password() {
            Ok(value) => Some(value),
            Err(keyring::Error::NoEntry) => None,
            Err(err) => return Err(keychain(err)),
        };
        self.remember(value.clone());
        Ok(value)
    }

    fn set(&self, value: &str) -> DesktopResult<()> {
        if self.get()?.as_deref() == Some(value) {
            return Ok(());
        }
        self.entry()?.set_password(value).map_err(keychain)?;
        self.remember(Some(value.to_owned()));
        Ok(())
    }

    fn clear(&self) -> DesktopResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {
                self.remember(None);
                Ok(())
            }
            Err(err) => Err(keychain(err)),
        }
    }
}
