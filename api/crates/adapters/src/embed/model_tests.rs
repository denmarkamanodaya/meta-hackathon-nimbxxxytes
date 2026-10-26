//! Runs only with `--features pe-model`, against the real files in api/models/pe.

use std::path::Path;

use nimbytes_core::ports::Embedder;

use super::OrtEmbedder;

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[tokio::test]
async fn each_caption_ranks_its_own_test_image_first() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let e = OrtEmbedder::load(&root.join("models/pe")).unwrap();
    let images = root.join("../ml/vendor/testimages");
    let names = ["coffee", "bicycles", "lake"];
    let captions = [
        "a cup of coffee",
        "bicycles parked on a street",
        "a lake in the mountains",
    ];
    let mut img = Vec::new();
    for n in names {
        img.push(
            e.embed_image(&images.join(format!("{n}.jpg")))
                .await
                .unwrap(),
        );
    }
    for (i, caption) in captions.iter().enumerate() {
        let t = e.embed_text(caption).await.unwrap();
        let scores: Vec<f32> = img.iter().map(|v| dot(&t, v)).collect();
        let best = scores
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        assert_eq!(best, i, "{caption}: {scores:?}");
        assert!((dot(&t, &t) - 1.0).abs() < 1e-3);
    }
}
