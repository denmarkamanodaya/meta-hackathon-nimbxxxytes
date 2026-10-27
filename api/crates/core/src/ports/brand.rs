//! The owner's brand kit.

use crate::domain::brand::BrandKit;
use crate::domain::ids::UserId;
use crate::ports::PortResult;

/// One brand kit per user.
pub trait BrandStore: Send + Sync {
    /// The user's kit, if one was saved.
    fn brand_kit<'a>(&'a self, user: &'a UserId) -> PortResult<'a, Option<BrandKit>>;

    /// Saves (replaces) the user's kit.
    fn put_brand_kit<'a>(&'a self, user: &'a UserId, kit: &'a BrandKit) -> PortResult<'a, ()>;
}
