//! One smoke test per media operation on tiny media generated with `ffmpeg -f lavfi` (≤ 2 s),
//! checking the output with ffprobe. Needs `ffmpeg` and `ffprobe` on `PATH`.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use nimbytes_core::domain::segmenting::Span;
use nimbytes_core::ports::MediaTool;
use serde_json::Value;

use super::{FfmpegMediaTool, MediaTimeouts};

fn tool() -> FfmpegMediaTool {
    FfmpegMediaTool::new(MediaTimeouts {
        probe: Duration::from_secs(20),
        encode: Duration::from_secs(60),
    })
}

/// Runs ffmpeg with `args` (generation only, never the code under test).
fn generate(args: &[&str]) {
    let status = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args)
        .status()
        .unwrap();
    assert!(status.success(), "ffmpeg {args:?}");
}

/// 2 s 320x240 H.264 with a 440 Hz tone, optionally tagged as rotated -90°.
fn clip(dir: &Path, rotated: bool) -> PathBuf {
    let plain = dir.join("plain.mp4");
    generate(&[
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x240:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        plain.to_str().unwrap(),
    ]);
    if !rotated {
        return plain;
    }
    let out = dir.join("rotated.mp4");
    generate(&[
        "-display_rotation:v:0",
        "-90",
        "-i",
        plain.to_str().unwrap(),
        "-c",
        "copy",
        out.to_str().unwrap(),
    ]);
    out
}

fn streams(path: &Path) -> Vec<Value> {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-print_format", "json", "-show_streams"])
        .arg(path)
        .output()
        .unwrap();
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    v["streams"].as_array().unwrap().clone()
}

fn video(path: &Path) -> Value {
    streams(path)
        .into_iter()
        .find(|s| s["codec_type"] == "video")
        .unwrap()
}

#[tokio::test]
async fn probe_and_proxy_of_a_rotated_clip_give_an_upright_h264_30_fps_proxy() {
    let dir = tempfile::tempdir().unwrap();
    let src = clip(dir.path(), true);
    let probe = tool().probe(&src).await.unwrap();
    assert_eq!(
        (probe.width, probe.height, probe.rotation, probe.has_audio),
        (240, 320, -90, true)
    );

    let dst = dir.path().join("proxy.mp4");
    tool()
        .make_proxy(&src, &dst, std::time::Duration::from_secs(60))
        .await
        .unwrap();

    let v = video(&dst);
    assert_eq!(
        (
            v["codec_name"].as_str(),
            v["width"].as_u64(),
            v["height"].as_u64()
        ),
        (Some("h264"), Some(240), Some(320))
    );
    assert_eq!(v["r_frame_rate"], "30/1");
    assert!(
        v["side_data_list"]
            .as_array()
            .is_none_or(|l| l.iter().all(|s| s["rotation"].as_i64().unwrap_or(0) == 0))
    );
    assert!(streams(&dst).iter().any(|s| s["codec_name"] == "aac"));
}

#[tokio::test]
async fn fps1_copy_is_one_frame_per_second_without_audio() {
    let dir = tempfile::tempdir().unwrap();
    let src = clip(dir.path(), false);
    let dst = dir.path().join("fps1.mp4");
    tool().make_sam_fps1(&src, &dst).await.unwrap();
    let s = streams(&dst);
    assert_eq!(s.len(), 1);
    assert_eq!(
        (s[0]["codec_name"].as_str(), s[0]["r_frame_rate"].as_str()),
        (Some("h264"), Some("1/1"))
    );
}

#[tokio::test]
async fn wav_is_16k_mono_s16_pcm() {
    let dir = tempfile::tempdir().unwrap();
    let src = clip(dir.path(), false);
    let dst = dir.path().join("a.wav");
    tool()
        .extract_wav(
            &src,
            Span {
                start_s: 0.5,
                end_s: 1.5,
            },
            &dst,
        )
        .await
        .unwrap();
    let a = &streams(&dst)[0];
    assert_eq!(
        (
            a["codec_name"].as_str(),
            a["sample_rate"].as_str(),
            a["channels"].as_u64()
        ),
        (Some("pcm_s16le"), Some("16000"), Some(1))
    );
    let secs: f64 = a["duration"].as_str().unwrap().parse().unwrap();
    assert!((secs - 1.0).abs() < 0.05, "{secs}");
}

#[tokio::test]
async fn scene_cuts_find_a_hard_cut() {
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("cut.mp4");
    generate(&[
        "-f",
        "lavfi",
        "-i",
        "color=c=red:size=160x120:rate=10:duration=1",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x120:rate=10:duration=1",
        "-filter_complex",
        "[0][1]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        src.to_str().unwrap(),
    ]);
    let cuts = tool().scene_cuts(&src).await.unwrap();
    assert_eq!(cuts, [1.0]);
}

#[tokio::test]
async fn thumbnail_is_a_640_wide_jpeg_and_snippet_is_360p() {
    let dir = tempfile::tempdir().unwrap();
    let src = clip(dir.path(), false);
    let thumb = dir.path().join("t.jpg");
    let snip = dir.path().join("s.mp4");
    tool().thumbnail(&src, 1.0, &thumb).await.unwrap();
    tool()
        .snippet(
            &src,
            Span {
                start_s: 0.5,
                end_s: 1.5,
            },
            &snip,
        )
        .await
        .unwrap();

    let t = video(&thumb);
    assert_eq!(
        (t["codec_name"].as_str(), t["width"].as_u64()),
        (Some("mjpeg"), Some(640))
    );
    let s = video(&snip);
    assert_eq!(
        (s["codec_name"].as_str(), s["height"].as_u64()),
        (Some("h264"), Some(360))
    );
}

#[tokio::test]
async fn a_bad_input_is_media_failed() {
    let dir = tempfile::tempdir().unwrap();
    let junk = dir.path().join("junk.mp4");
    std::fs::write(&junk, b"not a video").unwrap();
    let err = tool().probe(&junk).await.unwrap_err();
    assert_eq!(err.code, nimbytes_core::ErrorCode::MediaFailed);
}

#[tokio::test]
async fn crop_is_a_256_px_square_jpeg() {
    use nimbytes_core::domain::faces::{CropRect, FrameCrop};
    let dir = tempfile::tempdir().unwrap();
    let src = clip(dir.path(), false);
    let dst = dir.path().join("face.jpg");
    let c = FrameCrop {
        at_s: 1.0,
        rect: CropRect {
            x: 100,
            y: 60,
            side: 80,
        },
    };
    tool().crop(&src, c, &dst).await.unwrap();
    let v = video(&dst);
    assert_eq!(
        (v["width"].as_u64(), v["height"].as_u64()),
        (Some(256), Some(256))
    );
}
