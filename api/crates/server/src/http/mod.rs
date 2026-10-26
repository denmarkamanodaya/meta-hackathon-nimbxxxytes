//! Axum router and driving adapters (handlers). Handlers parse, call one use case, shape output.

pub mod error;
mod health;

use axum::Router;
use axum::routing::get;

pub use error::ApiError;

/// Builds the `/api` router.
pub fn router() -> Router {
    Router::new()
        .route("/api/health", get(health::health))
        .fallback(error::not_found)
}
