//! Image preprocessing and vector normalisation (pure, model-free).

use image::RgbImage;
use image::imageops::FilterType;
use serde_json::Value;

/// Image preprocessing read from the export's `meta.json`.
#[derive(Debug, Clone, PartialEq)]
pub struct Preprocess {
    /// Square input size, pixels.
    pub size: u32,
    /// Per-channel mean after `/255`.
    pub mean: [f32; 3],
    /// Per-channel std.
    pub std: [f32; 3],
}

/// Three numbers from a JSON array; f64 → f32 is exact enough for 0.5-style constants.
fn triple(v: &Value) -> Option<[f32; 3]> {
    let a = v.as_array()?;
    Some([
        a.first()?.as_f64()? as f32,
        a.get(1)?.as_f64()? as f32,
        a.get(2)?.as_f64()? as f32,
    ])
}

impl Preprocess {
    /// Reads `image.input_shape[3]`, `image.mean` and `image.std`.
    pub fn from_meta(meta: &Value) -> Option<Self> {
        let size = meta["image"]["input_shape"]
            .get(3)?
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())?;
        Some(Self {
            size,
            mean: triple(&meta["image"]["mean"])?,
            std: triple(&meta["image"]["std"])?,
        })
    }

    /// NCHW float tensor `[1, 3, size, size]`: squash-resize (bilinear with antialiasing on
    /// downscale), `/255`, `(x - mean) / std`.
    pub fn pixels(&self, rgb: &RgbImage) -> ([usize; 4], Vec<f32>) {
        let resized = image::imageops::resize(rgb, self.size, self.size, FilterType::Triangle);
        let side = self.size as usize;
        let plane = side * side;
        let mut chw = vec![0.0f32; 3 * plane];
        for (i, px) in resized.pixels().enumerate() {
            for c in 0..3 {
                chw[c * plane + i] = (f32::from(px[c]) / 255.0 - self.mean[c]) / self.std[c];
            }
        }
        ([1, 3, side, side], chw)
    }
}

/// Scales `v` to unit length (a zero vector stays zero).
pub fn l2_normalise(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        v.iter_mut().for_each(|x| *x /= norm);
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> Value {
        serde_json::json!({ "image": { "input_shape": ["batch", 3, 224, 224], "mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5] } })
    }

    #[test]
    fn reads_size_mean_and_std_from_the_export_metadata() {
        assert_eq!(
            Preprocess::from_meta(&meta()),
            Some(Preprocess {
                size: 224,
                mean: [0.5; 3],
                std: [0.5; 3]
            })
        );
        assert_eq!(Preprocess::from_meta(&serde_json::json!({})), None);
    }

    #[test]
    fn pixels_are_nchw_scaled_to_minus_one_one() {
        let pre = Preprocess::from_meta(&meta()).unwrap();
        let red = RgbImage::from_pixel(300, 100, image::Rgb([255, 0, 128]));
        let (shape, px) = pre.pixels(&red);
        assert_eq!(shape, [1, 3, 224, 224]);
        let plane = 224 * 224;
        assert_eq!(
            (px[0], px[plane], px[2 * plane]),
            (1.0, -1.0, (128.0 / 255.0 - 0.5) / 0.5)
        );
        assert_eq!(px.len(), 3 * plane);
    }

    #[test]
    fn l2_normalise_gives_unit_length() {
        let v = l2_normalise(vec![3.0, 4.0]);
        assert_eq!(v, [0.6, 0.8]);
        assert_eq!(l2_normalise(vec![0.0, 0.0]), [0.0, 0.0]);
    }
}
