//! Parsers for ffprobe JSON, scene-cut output and pdftoppm's page file names.

use nimbytes_core::domain::photo::{camera_name, exif_utc};
use nimbytes_core::domain::probe::{AudioProbe, ImageProbe, ProbeInfo};
use nimbytes_core::domain::segmenting::Span;
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

/// Reads ffprobe `-show_format -show_streams` JSON of any sound file or video: the container
/// duration (else the longest stream's) and whether there is an audio stream. No video needed.
///
/// # Errors
/// `MEDIA_FAILED` when the JSON is invalid or has no duration.
pub fn audio_probe(json: &str) -> Result<AudioProbe, AppError> {
    let v: Value =
        serde_json::from_str(json).map_err(|_| media_failed("ffprobe output is not JSON"))?;
    let streams = v["streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let duration_s = number(&v["format"]["duration"])
        .or_else(|| {
            streams
                .iter()
                .filter_map(|s| number(&s["duration"]))
                .reduce(f64::max)
        })
        .ok_or_else(|| media_failed("no duration"))?;
    Ok(AudioProbe {
        duration_s,
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
    })
}

/// A frame tag by its EXIF name; ffmpeg 7 writes `DateTimeOriginal`, ffmpeg 9
/// `ExifIFD/DateTimeOriginal`.
fn exif_tag<'a>(tags: &'a Value, name: &str) -> Option<&'a str> {
    tags[name]
        .as_str()
        .or_else(|| tags[format!("ExifIFD/{name}")].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Reads [`args::probe_image`](super::args::probe_image) JSON: the size swapped when the
/// orientation turns the image by ±90°, the date taken (`DateTimeOriginal` with its offset
/// `0x9011`, else `DateTime`, as UTC) and the camera (`Make`, `Model`).
///
/// # Errors
/// `MEDIA_FAILED` when the JSON is invalid or has no image size.
pub fn image_probe(json: &str) -> Result<ImageProbe, AppError> {
    let v: Value =
        serde_json::from_str(json).map_err(|_| media_failed("ffprobe output is not JSON"))?;
    let stream = &v["streams"][0];
    let (w, h) = (dim(&stream["width"])?, dim(&stream["height"])?);
    let frame = &v["frames"][0];
    let turned = frame["side_data_list"]
        .as_array()
        .and_then(|l| l.iter().find_map(|sd| sd["rotation"].as_i64()))
        .is_some_and(|r| r.rem_euclid(180) == 90);
    let (width, height) = if turned { (h, w) } else { (w, h) };
    let tags = &frame["tags"];
    let original = exif_tag(tags, "DateTimeOriginal")
        .and_then(|d| exif_utc(d, exif_tag(tags, "0x9011").or(exif_tag(tags, "0x9010"))));
    let taken_at = original
        .or_else(|| exif_tag(tags, "DateTime").and_then(|d| exif_utc(d, exif_tag(tags, "0x9010"))));
    Ok(ImageProbe {
        width,
        height,
        taken_at,
        camera: camera_name(exif_tag(tags, "Make"), exif_tag(tags, "Model")),
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

/// Pauses from `silencedetect` + `ametadata` print output: each `lavfi.silence_start` paired with
/// the next `lavfi.silence_end`; a pause still open at the end of the file has an infinite end.
pub fn silences(output: &str) -> Vec<Span> {
    let value = |line: &str, key: &str| {
        line.strip_prefix(key)
            .and_then(|v| v.trim().parse::<f64>().ok())
    };
    let mut out = Vec::new();
    let mut open: Option<f64> = None;
    for line in output.lines().map(str::trim) {
        if let Some(start) = value(line, "lavfi.silence_start=") {
            open = Some(start);
        } else if let Some(end) = value(line, "lavfi.silence_end=")
            && let Some(start) = open.take()
        {
            out.push(Span {
                start_s: start,
                end_s: end,
            });
        }
    }
    if let Some(start) = open {
        out.push(Span {
            start_s: start,
            end_s: f64::INFINITY,
        });
    }
    out
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
    fn audio_only_files_probe_for_length_and_sound() {
        let mp3 = r#"{"streams":[{"codec_type":"audio","codec_name":"mp3","duration":"26.16"}],
            "format":{"format_name":"mp3","duration":"26.160000"}}"#;
        let p = audio_probe(mp3).unwrap();
        assert_eq!((p.duration_s, p.has_audio), (26.16, true));
        let p = audio_probe(HEVC).unwrap();
        assert_eq!(
            (p.duration_s, p.has_audio),
            (3.0, true),
            "a video works too"
        );
        let silent = r#"{"streams":[{"codec_type":"video","duration":"4.5"}],"format":{}}"#;
        let p = audio_probe(silent).unwrap();
        assert_eq!(
            (p.duration_s, p.has_audio),
            (4.5, false),
            "stream duration when the format has none"
        );
        assert_eq!(
            audio_probe(r#"{"streams":[],"format":{}}"#)
                .unwrap_err()
                .code,
            ErrorCode::MediaFailed
        );
        assert_eq!(
            audio_probe("nope").unwrap_err().code,
            ErrorCode::MediaFailed
        );
    }

    const SILENCES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/listen/silencedetect.txt"
    ));

    #[test]
    fn the_real_spike_pauses_parse_in_order_with_an_open_last_one() {
        let s = silences(SILENCES);
        assert_eq!(s.len(), 34);
        assert_eq!((s[0].start_s, s[0].end_s), (0.0, 0.686937));
        assert_eq!((s[4].start_s, s[4].end_s), (12.050187, 12.717688));
        assert_eq!(s[33].start_s, 89.583125);
        assert!(s[33].end_s.is_infinite(), "silent to the end");
        assert!(silences("frame:1 pts:2\n").is_empty());
    }

    #[test]
    fn the_real_spike_cuts_into_the_seven_windows_it_was_heard_in() {
        use nimbytes_core::domain::listen::coverage::plan_windows;
        let w = plan_windows(90.0, &silences(SILENCES));
        let ends: Vec<f64> = w
            .iter()
            .map(|s| (s.end_s * 100.0).round() / 100.0)
            .collect();
        assert_eq!(ends, [12.38, 24.87, 37.6, 50.17, 64.47, 79.89, 90.0]);
    }

    const WINDOWS: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/listen/mix-real.windows.json"
    ));
    const FULL: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/listen/mix-real.full.json"
    ));

    fn units_of(response: &Value) -> f64 {
        use nimbytes_core::domain::listen::coverage::text_units;
        response["turns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| text_units(t["transcript"].as_str().unwrap()))
            .sum()
    }

    #[test]
    fn on_the_real_spike_only_the_dropped_window_is_sparse_and_the_windows_win() {
        use nimbytes_core::domain::listen::coverage::{
            density, median, plan_windows, sparse, speech_seconds, windows_heard_more,
        };
        let pauses = silences(SILENCES);
        let windows = plan_windows(90.0, &pauses);
        let heard: Value = serde_json::from_str(WINDOWS).unwrap();
        let names = ["w0", "w1", "w2", "w3", "w4", "w5", "w6"];
        let densities: Vec<f64> = names
            .iter()
            .zip(&windows)
            .map(|(n, w)| density(units_of(&heard[*n]), speech_seconds(*w, &pauses)))
            .collect();
        let m = median(&densities);
        let flagged: Vec<&str> = names
            .iter()
            .zip(&windows)
            .zip(&densities)
            .filter(|((_, w), d)| sparse(**w, **d, m))
            .map(|((n, _), _)| *n)
            .collect();
        assert_eq!(flagged, ["w1"], "densities {densities:?}, median {m}");
        let halves = units_of(&heard["w1a"]) + units_of(&heard["w1b"]);
        assert!(
            halves > units_of(&heard["w1"]),
            "splitting w1 recovered the Japanese"
        );
        let window_units: f64 = names.iter().map(|n| units_of(&heard[*n])).sum();
        let full = units_of(&serde_json::from_str(FULL).unwrap());
        assert!(
            windows_heard_more(full, window_units),
            "{full} vs {window_units}"
        );
    }

    const EXIF_7: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/photo/ffprobe_exif_rotated_7.1.json"
    ));
    const EXIF_9: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/photo/ffprobe_exif_9.0.json"
    ));

    #[test]
    fn a_rotated_camera_photo_reads_upright_with_its_date_in_utc_and_camera() {
        let p = image_probe(EXIF_7).unwrap();
        assert_eq!((p.width, p.height), (320, 480), "orientation 6 turns it");
        assert_eq!(
            p.taken_at.as_deref(),
            Some("2026-08-08T06:09:37.000Z"),
            "+08:00"
        );
        assert_eq!(p.camera.as_deref(), Some("Canon EOS 200D"));
    }

    #[test]
    fn ffmpeg_9_tag_names_read_the_same_and_a_bare_image_has_no_date() {
        let p = image_probe(EXIF_9).unwrap();
        assert_eq!((p.width, p.height), (480, 320));
        assert_eq!(p.taken_at.as_deref(), Some("2026-08-08T06:09:37.000Z"));
        let bare = r#"{"frames":[{}],"streams":[{"width":10,"height":20}]}"#;
        let p = image_probe(bare).unwrap();
        assert_eq!(
            (p.width, p.height, p.taken_at, p.camera),
            (10, 20, None, None)
        );
        assert!(image_probe(r#"{"frames":[],"streams":[]}"#).is_err());
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
