//! Spike 0.4, Rust side (throwaway): load the Perception Encoder ONNX towers with `ort` and the
//! CLIP tokenizer with `tokenizers`, embed the three test images and four captions, and print the
//! cosine table plus load time, resident memory and per-call latency.
//!
//! Run from `api/`: `cargo run --release -p nimbytes-server --bin spike_pe -- [models/pe] [images]`
//! Defaults: `models/pe` and `../ml/vendor/testimages`.

use std::path::{Path, PathBuf};
use std::time::Instant;

use image::imageops::FilterType;
use ort::session::Session;
use ort::session::builder::GraphOptimizationLevel;
use ort::value::Tensor;
use tokenizers::Tokenizer;

type Res<T> = Result<T, Box<dyn std::error::Error>>;

const IMAGES: [&str; 3] = ["coffee", "bicycles", "lake"];
const TEXTS: [&str; 4] = [
    "a cup of coffee",
    "bicycles parked on a street",
    "a lake in the mountains",
    "a dog",
];
/// Preprocessing from the export's metadata file: squash to 224, /255, mean 0.5, std 0.5, NCHW.
const SIZE: u32 = 224;
const MEAN: f32 = 0.5;
const STD: f32 = 0.5;
const CONTEXT: usize = 32;

fn main() -> Res<()> {
    let mut args = std::env::args().skip(1);
    let models = PathBuf::from(args.next().unwrap_or_else(|| "models/pe".into()));
    let images = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "../ml/vendor/testimages".into()),
    );
    println!("rss at start: {} MB", rss_mb()?);

    let env = ort::init().with_name("spike_pe").build()?;
    let mut image_session = load(&env, &models.join("image.onnx"))?;
    let mut text_session = load(&env, &models.join("text.onnx"))?;
    let tokenizer =
        Tokenizer::from_file(models.join("tokenizer.json")).map_err(|e| e.to_string())?;

    let image_vecs = IMAGES
        .iter()
        .map(|name| embed_image(&mut image_session, &images.join(format!("{name}.jpg"))))
        .collect::<Res<Vec<_>>>()?;
    let text_vecs = TEXTS
        .iter()
        .map(|text| embed_text(&mut text_session, &tokenizer, text))
        .collect::<Res<Vec<_>>>()?;
    println!(
        "embedding dim: {}, |image0| = {:.4}",
        image_vecs[0].len(),
        norm(&image_vecs[0])
    );
    print_table(&image_vecs, &text_vecs);

    let pixels = preprocess(&images.join("coffee.jpg"))?;
    let ids = token_ids(&tokenizer, TEXTS[0])?;
    let image_ms = mean_ms(|| run_image(&mut image_session, pixels.clone()).map(drop))?;
    let text_ms = mean_ms(|| run_text(&mut text_session, ids.clone()).map(drop))?;
    println!("latency (batch 1, mean of 20): image {image_ms:.1} ms, text {text_ms:.1} ms");
    println!("rss with both sessions loaded: {} MB", rss_mb()?);
    Ok(())
}

fn load(env: &ort::environment::Environment, path: &Path) -> Res<Session> {
    let started = Instant::now();
    let mut builder = Session::builder(env)?;
    // `SPIKE_PE_LOW_MEM=1`: skip graph optimisation and the memory-pattern planner to see how
    // much of the resident memory they cost.
    if std::env::var("SPIKE_PE_LOW_MEM").is_ok() {
        builder = builder
            .with_optimization_level(GraphOptimizationLevel::Disable)
            .map_err(|e| e.to_string())?
            .with_memory_pattern(false)
            .map_err(|e| e.to_string())?;
    }
    let session = builder.commit_from_file(path)?;
    println!(
        "loaded {} in {} ms, rss now {} MB",
        path.display(),
        started.elapsed().as_millis(),
        rss_mb()?
    );
    Ok(session)
}

/// Decodes to RGB, squash-resizes to 224x224 (Triangle = bilinear with antialiasing on
/// downscale), scales to [0, 1], normalises with mean/std 0.5, and lays out as CHW.
fn preprocess(path: &Path) -> Res<Vec<f32>> {
    let rgb = image::open(path)?.to_rgb8();
    let resized = image::imageops::resize(&rgb, SIZE, SIZE, FilterType::Triangle);
    let plane = (SIZE * SIZE) as usize;
    let mut chw = vec![0.0f32; 3 * plane];
    for (i, pixel) in resized.pixels().enumerate() {
        for c in 0..3 {
            chw[c * plane + i] = (f32::from(pixel[c]) / 255.0 - MEAN) / STD;
        }
    }
    Ok(chw)
}

fn token_ids(tokenizer: &Tokenizer, text: &str) -> Res<Vec<i64>> {
    let encoding = tokenizer.encode(text, true).map_err(|e| e.to_string())?;
    let ids: Vec<i64> = encoding.get_ids().iter().map(|&id| i64::from(id)).collect();
    if ids.len() != CONTEXT {
        return Err(format!("expected {CONTEXT} ids, got {}", ids.len()).into());
    }
    Ok(ids)
}

fn run_image(session: &mut Session, pixels: Vec<f32>) -> Res<Vec<f32>> {
    let input = Tensor::from_array(([1usize, 3, SIZE as usize, SIZE as usize], pixels))?;
    let outputs = session.run(ort::inputs!["pixel_values" => input])?;
    let (_, data) = outputs["embeddings"].try_extract_tensor::<f32>()?;
    Ok(data.to_vec())
}

fn run_text(session: &mut Session, ids: Vec<i64>) -> Res<Vec<f32>> {
    let input = Tensor::from_array(([1usize, CONTEXT], ids))?;
    let outputs = session.run(ort::inputs!["input_ids" => input])?;
    let (_, data) = outputs["embeddings"].try_extract_tensor::<f32>()?;
    Ok(data.to_vec())
}

fn embed_image(session: &mut Session, path: &Path) -> Res<Vec<f32>> {
    run_image(session, preprocess(path)?)
}

fn embed_text(session: &mut Session, tokenizer: &Tokenizer, text: &str) -> Res<Vec<f32>> {
    run_text(session, token_ids(tokenizer, text)?)
}

fn print_table(images: &[Vec<f32>], texts: &[Vec<f32>]) {
    println!("cosine text x image (Rust):");
    println!(
        "  {:<30}{}",
        "",
        IMAGES
            .iter()
            .map(|n| format!("{n:>10}"))
            .collect::<String>()
    );
    for (text, t) in TEXTS.iter().zip(texts) {
        let row: String = images
            .iter()
            .map(|i| format!("{:>10.4}", cosine(t, i)))
            .collect();
        println!("  {text:<30}{row}");
    }
}

fn mean_ms(mut f: impl FnMut() -> Res<()>) -> Res<f64> {
    for _ in 0..3 {
        f()?;
    }
    let started = Instant::now();
    for _ in 0..20 {
        f()?;
    }
    Ok(started.elapsed().as_secs_f64() * 1e3 / 20.0)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    dot(a, b) / (norm(a) * norm(b))
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn norm(a: &[f32]) -> f32 {
    dot(a, a).sqrt()
}

/// Resident set size of this process in MB, read with `ps` (spike only).
fn rss_mb() -> Res<u64> {
    let out = std::process::Command::new("ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()?;
    let kb: u64 = String::from_utf8(out.stdout)?.trim().parse()?;
    Ok(kb / 1024)
}
