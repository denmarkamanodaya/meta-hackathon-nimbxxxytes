//! The one ONNX Runtime environment of the process. ONNX Runtime allows a single environment per
//! process, so the image/text embedder and the narrator both take theirs from here.

use std::sync::Mutex;

use nimbytes_core::error::{AppError, ErrorCode};
use ort::environment::Environment;

static ENV: Mutex<Option<Environment>> = Mutex::new(None);

fn err(msg: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("onnx runtime: {msg}"))
}

/// The process's ONNX Runtime environment, built on first use and shared after that.
///
/// # Errors
/// `INTERNAL` when ONNX Runtime cannot start.
pub fn environment() -> Result<Environment, AppError> {
    let mut slot = ENV.lock().map_err(|_| err("environment lock poisoned"))?;
    if let Some(env) = slot.as_ref() {
        return Ok(env.clone());
    }
    let env = ort::init().with_name("nimbytes").build().map_err(err)?;
    *slot = Some(env.clone());
    Ok(env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_model_gets_the_same_environment_instead_of_an_error() {
        environment().unwrap();
        environment().unwrap();
    }
}
