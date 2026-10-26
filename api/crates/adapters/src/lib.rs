//! Driven adapters that implement the core ports: the only code that does IO.

pub mod clock;
pub mod embed;
pub mod ids;
pub mod media;
pub mod meta;
pub mod render;
pub mod s3;
pub mod scratch;
pub mod search;
pub mod sqlite;

pub use clock::SystemClock;
pub use embed::OrtEmbedder;
pub use ids::UuidV7Ids;
pub use media::{FfmpegMediaTool, MediaTimeouts};
pub use render::{RemotionRenderer, RenderTimeouts};
pub use s3::S3BlobStore;
pub use scratch::FsScratch;
pub use search::TantivySearchIndex;
pub use sqlite::{
    SqliteCatalogue, SqliteJobQueue, SqliteModelLedger, SqliteShortStore, SqliteVectorIndex,
};
