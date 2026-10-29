//! [`Narrator`] on Meta's MMS-TTS English voice (VITS) exported to ONNX, run with ONNX Runtime on
//! the CPU blocking pool. Text is tokenised the way the model's `VitsTokenizer` does it: lower
//! case, characters outside the vocabulary dropped, then the pad id put between every character
//! and at both ends (`add_blank`). The waveform becomes a 16-bit mono WAV at the export's rate.

mod tokens;

use std::path::Path;
use std::sync::{Arc, Mutex};

use nimbytes_core::ports::{Narrator, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use ort::session::Session;
use ort::value::Tensor;
use serde_json::Value;

pub use tokens::VitsTokens;

fn err(msg: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("narrator: {msg}"))
}

struct Inner {
    session: Mutex<Session>,
    tokens: VitsTokens,
    rate: u32,
}

/// The voice, loaded once at start-up.
#[derive(Clone)]
pub struct OnnxNarrator {
    inner: Arc<Inner>,
}

fn json_file(dir: &Path, name: &str) -> Result<Value, AppError> {
    let bytes = std::fs::read(dir.join(name)).map_err(|e| err(format!("{name}: {e}")))?;
    serde_json::from_slice(&bytes).map_err(|e| err(format!("{name}: {e}")))
}

impl OnnxNarrator {
    /// Loads `model.onnx`, `vocab.json`, `tokenizer_config.json` and `meta.json` from `dir`.
    ///
    /// # Errors
    /// `INTERNAL` when a file is missing or invalid.
    pub fn load(dir: &Path) -> Result<Self, AppError> {
        let tokens = VitsTokens::from_files(
            &json_file(dir, "vocab.json")?,
            &json_file(dir, "tokenizer_config.json")?,
        )?;
        let rate = json_file(dir, "meta.json")?["sampling_rate"]
            .as_u64()
            .and_then(|r| u32::try_from(r).ok())
            .ok_or_else(|| err("meta.json lacks sampling_rate"))?;
        let env = crate::onnx::environment()?;
        let session = Session::builder(&env)
            .map_err(err)?
            .commit_from_file(dir.join("model.onnx"))
            .map_err(err)?;
        Ok(Self {
            inner: Arc::new(Inner {
                session: Mutex::new(session),
                tokens,
                rate,
            }),
        })
    }
}

impl Inner {
    fn speak(&self, text: &str) -> Result<Vec<u8>, AppError> {
        let ids = self.tokens.ids(text)?;
        let input = Tensor::from_array(([1usize, ids.len()], ids)).map_err(err)?;
        let mut s = self
            .session
            .lock()
            .map_err(|_| err("session lock poisoned"))?;
        let outputs = s
            .run(ort::inputs!["input_ids" => input.into_dyn()])
            .map_err(err)?;
        let (_, samples) = outputs["waveform"]
            .try_extract_tensor::<f32>()
            .map_err(err)?;
        Ok(wav(samples, self.rate))
    }
}

/// A mono 16-bit PCM WAV of `samples` (-1.0 to 1.0, clipped) at `rate` Hz.
pub fn wav(samples: &[f32], rate: u32) -> Vec<u8> {
    let data_len = u32::try_from(samples.len() * 2).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        // Clipped to [-1, 1] first, so the product always fits an i16.
        let pcm = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        out.extend_from_slice(&pcm.to_le_bytes());
    }
    out
}

impl Narrator for OnnxNarrator {
    fn speak<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<u8>> {
        let (inner, text): (Arc<Inner>, String) = (self.inner.clone(), text.to_owned());
        Box::pin(async move {
            tokio::task::spawn_blocking(move || inner.speak(&text))
                .await
                .map_err(err)?
        })
    }
}

#[cfg(all(test, feature = "tts-model"))]
mod model_tests;
#[cfg(test)]
mod tests;
