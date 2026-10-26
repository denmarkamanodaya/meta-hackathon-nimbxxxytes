//! Driven adapters that implement the core ports: the only code that does IO.

pub mod clock;
pub mod ids;
pub mod media;
pub mod meta;
pub mod s3;
pub mod scratch;
pub mod sqlite;

pub use clock::SystemClock;
pub use ids::UuidV7Ids;
pub use media::{FfmpegMediaTool, MediaTimeouts};
pub use s3::S3BlobStore;
pub use scratch::FsScratch;
pub use sqlite::{SqliteCatalogue, SqliteJobQueue, SqliteModelLedger};
