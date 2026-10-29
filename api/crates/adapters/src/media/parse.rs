//! Parsers for ffprobe JSON, scene-cut output and pdftoppm's page file names.

use nimbytes_core::domain::probe::ProbeInfo;
use nimbytes_core::{AppError, ErrorCode};
use serde_json::Value;

fn media_failed(msg: &str) -> AppError {
    AppError::new(ErrorCode::MediaFailed, msg.to_owned())
}

/// Reads ffprobe `-show_format -show_streams` JSON. Width and height are display size: swapped
/// when the display matrix rotates by ±90°. Rotation comes from the stream's display-matrix side
/// data, else the legacy `rotate` tag.
///
/// # Errors
/// `MEDIA_FAILED` when the JSON is invalid or has no video stream or duration.
pub fn probe_info(json: &str) -> Result<ProbeInfo, AppError> {
    let v: Value =
        serde_json::from_str(json).map_err(|_| media_failed("ffprobe output is not JSON"))?;
    let streams = v["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let video = streams
        .iter()
        .find(|s| s["codec_type"] == "video")
        .ok_or_else(|| media_failed("no video stream"))?;
    let duration_s = number(&v["format"]["duration"])
        .or_else(|| number(&video["duration"]))
        .ok_or_else(|| media_failed("no duration"))?;
    let rotation = rotation(video);
    let (w, h) = (dim(&video["width"])?, dim(&video["height"])?);
    let (width, height) = if rotation.rem_euclid(180) == 90 {
        (h, w)
    } else {
        (w, h)
    };
    Ok(ProbeInfo {
        duration_s,
        width,
        height,
        fps: rate(&video["avg_frame_rate"])
            .or_else(|| rate(&video["r_frame_rate"]))
            .unwrap_or(0.0),
        rotation,
        codec: video["codec_name"].as_str().unwrap_or("unknown").to_owned(),
        recorded_at: v["format"]["tags"]["creation_time"]
            .as_str()
            .or_else(|| video["tags"]["creation_time"].as_str())
            .and_then(normalise_utc),
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}

fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn dim(v: &Value) -> Result<u32, AppError> {
    v.as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| media_failed("no frame size"))
}

/// `"30000/1001"` → 29.97; `"0/0"` → None.
fn rate(v: &Value) -> Option<f64> {
    let (n, d) = v.as_str()?.split_once('/')?;
    let (n, d): (f64, f64) = (n.parse().ok()?, d.parse().ok()?);
    (d > 0.0 && n > 0.0).then(|| n / d)
}

fn rotation(video: &Value) -> i32 {
    let side = video["side_data_list"]
        .as_array()
        .and_then(|l| l.iter().find_map(|sd| sd["rotation"].as_i64()));
    let tag = || {
        video["tags"]["rotate"]
            .as_str()
            .and_then(|r| r.parse::<i64>().ok())
    };
    side.or_else(tag)
        .and_then(|r| i32::try_from(r).ok())
        .unwrap_or(0)
}

/// `2026-01-28T05:59:00.000000Z` → `2026-01-28T05:59:00.000Z` (our fixed-width UTC form); any
/// other shape → None.
pub fn normalise_utc(raw: &str) -> Option<String> {
    let raw = raw.strip_suffix('Z')?;
    let (base, frac) = raw.split_once('.').unwrap_or((raw, ""));
    let b = base.as_bytes();
    let shape_ok = b.len() == 19
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 | 16 => *c == b':',
            _ => c.is_ascii_digit(),
        });
    if !shape_ok || !frac.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let ms: String = frac.chars().chain("000".chars()).take(3).collect();
    Some(format!("{base}.{ms}Z"))
}

/// Cut times from `metadata=mode=print` output: the `pts_time` of every `frame:` line.
pub fn cut_times(output: &str) -> Vec<f64> {
    output
        .lines()
        .filter(|l| l.starts_with("frame:"))
        .filter_map(|l| l.split("pts_time:").nth(1))
        .filter_map(|t| t.trim().parse().ok())
        .collect()
}

/// The page number of a file pdftoppm wrote: `page-3.jpg` or `page-03.jpg` gives 3; anything
/// else `None`.
pub fn pdf_page_number(name: &str, prefix: &str) -> Option<u32> {
    let digits = name
        .strip_prefix(prefix)?
        .strip_prefix('-')?
        .strip_suffix(".jpg")?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdftoppm_page_names_give_their_number_and_other_files_none() {
        assert_eq!(pdf_page_number("page-3.jpg", "page"), Some(3));
        assert_eq!(pdf_page_number("page-03.jpg", "page"), Some(3));
        assert_eq!(pdf_page_number("page-10.jpg", "page"), Some(10));
        for other in [
            "page-.jpg",
            "page-1.png",
            "page-1a.jpg",
            "source.pdf",
            "pages-1.jpg",
        ] {
            assert_eq!(pdf_page_number(other, "page"), None, "{other}");
        }
    }

    const HEVC: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/ffprobe/hevc_rotated.json"
    ));
    const PROXY: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/ffprobe/proxy_720p.json"
    ));
    const SELECT: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/scdet/select_scene.txt"
    ));
    const SCDET: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/scdet/scdet_sc_pass.txt"
    ));

    #[test]
    fn hevc_portrait_reports_display_size_rotation_and_creation_time() {
        let p = probe_info(HEVC).unwrap();
        assert_eq!((p.width, p.height, p.rotation), (1080, 1920, -90));
        assert_eq!((p.duration_s, p.fps, p.codec.as_str()), (3.0, 30.0, "hevc"));
        assert_eq!(p.recorded_at.as_deref(), Some("2026-10-27T01:02:03.000Z"));
        assert!(p.has_audio);
    }

    #[test]
    fn upright_proxy_without_creation_time() {
        let p = probe_info(PROXY).unwrap();
        assert_eq!((p.width, p.height, p.rotation), (720, 1280, 0));
        assert_eq!(p.recorded_at, None);
    }

    #[test]
    fn h264_landscape_with_legacy_rotate_tag_and_no_audio() {
        let json = r#"{"streams":[{"codec_type":"video","codec_name":"h264","width":1920,
            "height":1080,"avg_frame_rate":"30000/1001","tags":{"rotate":"0"}}],
            "format":{"duration":"12.5","tags":{"creation_time":"2026-01-28T05:59:00Z"}}}"#;
        let p = probe_info(json).unwrap();
        assert_eq!(
            (p.width, p.height, p.rotation, p.has_audio),
            (1920, 1080, 0, false)
        );
        assert!((p.fps - 29.97).abs() < 0.01);
        assert_eq!(p.recorded_at.as_deref(), Some("2026-01-28T05:59:00.000Z"));
    }

    #[test]
    fn audio_only_or_garbage_is_media_failed() {
        let audio = r#"{"streams":[{"codec_type":"audio"}],"format":{"duration":"3"}}"#;
        assert_eq!(probe_info(audio).unwrap_err().code, ErrorCode::MediaFailed);
        assert_eq!(probe_info("nope").unwrap_err().code, ErrorCode::MediaFailed);
    }

    #[test]
    fn creation_time_normalises_or_is_dropped() {
        assert_eq!(
            normalise_utc("2026-10-27T01:02:03.1Z").as_deref(),
            Some("2026-10-27T01:02:03.100Z")
        );
        assert_eq!(normalise_utc("2026-10-27 01:02:03"), None);
        assert_eq!(normalise_utc("1970-01-01T00:00:00.000000+08:00"), None);
    }

    #[test]
    fn both_scene_filters_parse_to_the_same_cuts() {
        assert_eq!(cut_times(SELECT), [2.0, 4.0, 6.0]);
        assert_eq!(cut_times(SCDET), [2.0, 4.0, 6.0]);
        assert!(cut_times("").is_empty());
    }
}
