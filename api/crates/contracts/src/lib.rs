//! Wire contracts between `web/` and `api/`: the one source for HTTP JSON shapes (error codes and
//! clip statuses are re-exported from `nimbytes_core`); the TypeScript mirror is
//! `web/src/services/api/types.ts`. Ids travel as plain strings and are validated by handlers.

pub mod clips;
pub mod error;
pub mod health;
pub mod session;
pub mod uploads;

pub use error::{ErrorBody, ErrorCode, ErrorEnvelope};
pub use health::HealthResponse;
