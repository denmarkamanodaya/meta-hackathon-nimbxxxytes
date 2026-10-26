//! Wire contracts between `web/` and `api/`: the one source for HTTP JSON shapes (error codes are
//! re-exported from `nimbytes_core`); the TypeScript mirror is `web/src/services/api/types.ts`.

pub mod error;
pub mod health;

pub use error::{ErrorBody, ErrorCode, ErrorEnvelope};
pub use health::HealthResponse;
