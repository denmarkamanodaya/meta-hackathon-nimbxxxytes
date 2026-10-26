//! Use cases: each takes its input plus the driven ports it needs, and returns a domain value or
//! an [`crate::AppError`]. Handlers call exactly one of these.

pub mod clips;
pub mod ingest;
pub mod jobs;
pub mod library;
pub mod people;
pub mod search;
pub mod session;
pub mod shorts;
pub mod uploads;
