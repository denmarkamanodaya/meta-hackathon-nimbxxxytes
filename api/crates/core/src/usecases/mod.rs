//! Use cases: each takes its input plus the driven ports it needs, and returns a domain value or
//! an [`crate::AppError`]. Handlers call exactly one of these.

pub mod ask;
pub mod brand;
pub mod clips;
pub mod documents;
pub mod exports;
pub mod face_matching;
pub mod guides;
pub mod ingest;
pub mod jobs;
pub mod library;
pub mod listens;
pub mod memories;
pub mod narrate;
pub mod people;
pub mod people_overview;
pub mod photos;
pub mod project_art;
pub mod projects;
pub mod search;
pub mod session;
pub mod shorts;
pub mod similar;
pub mod storage;
pub mod streamed;
pub mod subjects;
pub mod sync;
pub mod transcribe;
pub mod uploads;
