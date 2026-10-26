//! Pure core of nimbytes: domain types, ports and use cases. Never does IO; time and ids arrive
//! through the [`ports::Clock`] and [`ports::IdGenerator`] ports, so every rule here is testable without IO.

#![deny(clippy::print_stdout, clippy::print_stderr)]

pub mod error;
pub mod ports;

pub use error::{AppError, ErrorCode};
