//! Driven adapters that implement the core ports: the only code that does IO.

pub mod clock;
pub mod ids;

pub use clock::SystemClock;
pub use ids::UuidV7Ids;
