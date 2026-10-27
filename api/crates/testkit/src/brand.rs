//! In-memory [`BrandStore`].

use std::collections::HashMap;
use std::sync::Mutex;

use nimbytes_core::AppError;
use nimbytes_core::domain::brand::BrandKit;
use nimbytes_core::domain::ids::UserId;
use nimbytes_core::ports::{BrandStore, PortResult};

/// Brand kits in memory.
#[derive(Debug, Default)]
pub struct InMemoryBrand {
    /// Saved kits.
    pub kits: Mutex<HashMap<UserId, BrandKit>>,
}

impl BrandStore for InMemoryBrand {
    fn brand_kit<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<BrandKit>> {
        let kit = self.kits.lock().ok().and_then(|k| k.get(user).cloned());
        Box::pin(async move { Ok::<_, AppError>(kit) })
    }

    fn put_brand_kit<'a>(&'a self, user: &'a UserId, kit: &'a BrandKit) -> PortResult<'a, ()> {
        if let Ok(mut k) = self.kits.lock() {
            k.insert(user.clone(), kit.clone());
        }
        Box::pin(async { Ok(()) })
    }
}
