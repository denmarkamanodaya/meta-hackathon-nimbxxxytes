//! Driven adapters that implement the core ports: the only code that does IO.

pub mod clock;
pub mod ids;
pub mod s3;
pub mod sqlite;

pub use clock::SystemClock;
pub use ids::UuidV7Ids;
pub use s3::S3BlobStore;
pub use sqlite::{SqliteCatalogue, SqliteJobQueue};
