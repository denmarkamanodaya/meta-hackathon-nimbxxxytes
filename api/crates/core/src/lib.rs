//! Pure core of nimbytes: domain types, ports and use cases. Never does IO; time and ids arrive
//! through the [`ports::Clock`] and [`ports::IdGenerator`] ports, so every rule here is testable
//! without IO.

#![deny(clippy::print_stdout, clippy::print_stderr)]

pub mod domain;
pub mod error;
pub mod keys;
pub mod ports;
pub mod time;
pub mod usecases;

pub use error::{AppError, ErrorCode};
