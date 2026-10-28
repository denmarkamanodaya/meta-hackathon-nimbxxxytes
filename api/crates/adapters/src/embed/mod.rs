//! [`Embedder`] on the Perception Encoder ONNX towers (image + text) with ONNX Runtime on CPU.
//! Preprocessing follows the export's `meta.json`: RGB, squash-resize to the input size with
//! bilinear filtering, `/255`, mean/std normalise, NCHW; text as CLIP BPE ids padded with 0.

mod preprocess;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use nimbytes_core::ports::{Embedder, PortResult};
use nimbytes_core::{AppError, ErrorCode};
use ort::session::Session;
use ort::value::{DynValue, Tensor};
use serde_json::Value;
use tokenizers::Tokenizer;

pub use preprocess::{Preprocess, l2_normalise};

fn err(msg: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::Internal, format!("embedder: {msg}"))
}

struct Inner {
    image: Mutex<Session>,
    text: Mutex<Session>,
    tokenizer: Tokenizer,
    pre: Preprocess,
    context: usize,
}

/// Both towers, loaded once at start-up; inference runs on the blocking thread pool.
#[derive(Clone)]
pub struct OrtEmbedder {
    inner: Arc<Inner>,
}

impl OrtEmbedder {
    /// Loads `image.onnx`, `text.onnx`, `tokenizer.json` and `meta.json` from `dir`. Sessions are
    /// built from the files (no second in-memory copy of the weights).
    ///
    /// # Errors
    /// `INTERNAL` when a file is missing or invalid.
    pub fn load(dir: &Path) -> Result<Self, AppError> {
        let meta: Value =
            serde_json::from_slice(&std::fs::read(dir.join("meta.json")).map_err(err)?)
                .map_err(err)?;
        let pre = Preprocess::from_meta(&meta)
            .ok_or_else(|| err("meta.json lacks image preprocessing"))?;
        let context = meta["text"]["context_length"]
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or_else(|| err("meta.json lacks text.context_length"))?;
        let env = crate::onnx::environment()?;
        let session = |file: &str| -> Result<Session, AppError> {
            Session::builder(&env)
                .map_err(err)?
                .commit_from_file(dir.join(file))
                .map_err(err)
        };
        let tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(err)?;
        let inner = Inner {
            image: Mutex::new(session("image.onnx")?),
            text: Mutex::new(session("text.onnx")?),
            tokenizer,
            pre,
            context,
        };
        Ok(Self {
            inner: Arc::new(inner),
        })
    }
}

fn run(session: &Mutex<Session>, name: &str, input: DynValue) -> Result<Vec<f32>, AppError> {
    let mut s = session.lock().map_err(|_| err("session lock poisoned"))?;
    let outputs = s.run(ort::inputs![name => input]).map_err(err)?;
    let (_, data) = outputs["embeddings"]
        .try_extract_tensor::<f32>()
        .map_err(err)?;
    Ok(l2_normalise(data.to_vec()))
}

impl Inner {
    fn image(&self, path: &Path) -> Result<Vec<f32>, AppError> {
        let rgb = image::open(path).map_err(err)?.to_rgb8();
        let (shape, pixels) = self.pre.pixels(&rgb);
        run(
            &self.image,
            "pixel_values",
            Tensor::from_array((shape, pixels)).map_err(err)?.into_dyn(),
        )
    }

    fn text(&self, text: &str) -> Result<Vec<f32>, AppError> {
        let enc = self.tokenizer.encode(text, true).map_err(err)?;
        let mut ids: Vec<i64> = enc.get_ids().iter().map(|&i| i64::from(i)).collect();
        // The tokenizer file pads and truncates already; this keeps the tower's fixed length if not.
        ids.resize(self.context, 0);
        run(
            &self.text,
            "input_ids",
            Tensor::from_array(([1usize, self.context], ids))
                .map_err(err)?
                .into_dyn(),
        )
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f).await.map_err(err)?
}

impl Embedder for OrtEmbedder {
    fn embed_image<'a>(&'a self, image: &'a Path) -> PortResult<'a, Vec<f32>> {
        let (inner, path): (Arc<Inner>, PathBuf) = (self.inner.clone(), image.to_owned());
        Box::pin(blocking(move || inner.image(&path)))
    }

    fn embed_text<'a>(&'a self, text: &'a str) -> PortResult<'a, Vec<f32>> {
        let (inner, text) = (self.inner.clone(), text.to_owned());
        Box::pin(blocking(move || inner.text(&text)))
    }
}

#[cfg(all(test, feature = "pe-model"))]
mod model_tests;
