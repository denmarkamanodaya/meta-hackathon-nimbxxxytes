//! Spike 0.6 (throwaway): HEVC with a rotation display matrix → upright 720p CFR30 H.264 proxy,
//! and scene-cut detection output (`scdet` vs `select=gt(scene,0.3)`).
//!
//! Run from `api/`: `cargo run -p nimbytes-server --bin spike_media -- [clip.mp4] [--write-fixtures]`
//! Without a clip it generates synthetic media with `ffmpeg -f lavfi` in `../data/spikes/media/`.
//! `--write-fixtures` saves the probe JSON and cut outputs to `tests/fixtures/{ffprobe,scdet}/`.

use std::error::Error;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::process::Command;

type Res<T> = Result<T, Box<dyn Error>>;

const TIMEOUT: Duration = Duration::from_secs(120);
const OUT_DIR: &str = "../data/spikes/media";
const PROXY_FILTER: &str = "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)',fps=30";
const SELECT_FILTER: &str = "select='gt(scene,0.3)',metadata=mode=print:file=-";
const SCDET_FILTER: &str = "scdet=threshold=10:sc_pass=1,metadata=mode=print:file=-";

#[tokio::main]
async fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let write_fixtures = args.iter().any(|a| a == "--write-fixtures");
    let input = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .map(PathBuf::from);
    let out = PathBuf::from(OUT_DIR);
    std::fs::create_dir_all(&out)?;

    let rotated = match input {
        Some(path) => path,
        None => generate_rotated_hevc(&out).await?,
    };
    let probe = ffprobe(&rotated).await?;
    report_probe("input", &probe);

    let proxy = out.join("proxy_720p.mp4");
    make_proxy(&rotated, &proxy).await?;
    let proxy_probe = ffprobe(&proxy).await?;
    report_probe("proxy", &proxy_probe);

    let cuts = generate_cuts(&out).await?;
    let select_out = detect(&cuts, SELECT_FILTER).await?;
    let scdet_out = detect(&cuts, SCDET_FILTER).await?;
    println!("select cuts (s): {:?}", parse_pts_times(&select_out));
    println!("scdet  cuts (s): {:?}", parse_pts_times(&scdet_out));

    if write_fixtures {
        save_fixtures(&probe, &proxy_probe, &select_out, &scdet_out)?;
    }
    Ok(())
}

/// 3 s 1920x1080 HEVC + AAC, then remuxed with a -90° display matrix (how a portrait phone clip
/// stores rotation) and a fixed `creation_time`.
async fn generate_rotated_hevc(out: &Path) -> Res<PathBuf> {
    let landscape = out.join("landscape_hevc.mp4");
    let rotated = out.join("rotated_hevc.mp4");
    run_ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=1920x1080:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-c:v",
        "libx265",
        "-preset",
        "ultrafast",
        "-tag:v",
        "hvc1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        path_str(&landscape)?,
    ])
    .await?;
    run_ffmpeg(&[
        "-display_rotation:v:0",
        "-90",
        "-i",
        path_str(&landscape)?,
        "-metadata",
        "creation_time=2026-10-27T01:02:03.000000Z",
        "-c",
        "copy",
        path_str(&rotated)?,
    ])
    .await?;
    Ok(rotated)
}

/// Four 2 s shots with hard cuts at 2, 4 and 6 s.
async fn generate_cuts(out: &Path) -> Res<PathBuf> {
    let cuts = out.join("cuts.mp4");
    run_ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "smptebars=size=640x360:rate=30:duration=2",
        "-f",
        "lavfi",
        "-i",
        "mandelbrot=size=640x360:rate=30",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:size=640x360:rate=30:duration=2",
        "-filter_complex",
        "[2]trim=duration=2,setpts=PTS-STARTPTS[m];[0][1][m][3]concat=n=4:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        path_str(&cuts)?,
    ])
    .await?;
    Ok(cuts)
}

/// 720p (short side) constant 30 fps H.264 proxy. ffmpeg autorotates on decode by default, so
/// the display matrix is applied to the pixels and not copied to the output.
async fn make_proxy(input: &Path, proxy: &Path) -> Res<()> {
    let started = Instant::now();
    run_ffmpeg(&[
        "-i",
        path_str(input)?,
        "-vf",
        PROXY_FILTER,
        "-fps_mode",
        "cfr",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        path_str(proxy)?,
    ])
    .await?;
    println!("proxy encode: {} ms", started.elapsed().as_millis());
    Ok(())
}

async fn detect(input: &Path, filter: &str) -> Res<String> {
    let args = [
        "-nostats",
        "-i",
        path_str(input)?,
        "-vf",
        filter,
        "-an",
        "-f",
        "null",
        "-",
    ];
    run(Command::new("ffmpeg")
        .arg("-hide_banner")
        .args(["-loglevel", "error"])
        .args(args))
    .await
}

async fn ffprobe(input: &Path) -> Res<Value> {
    let stdout = run(Command::new("ffprobe").args([
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path_str(input)?,
    ]))
    .await?;
    Ok(serde_json::from_str(&stdout)?)
}

/// Prints what the probe parser will need: dims, codec, fps, rotation, duration, creation time.
fn report_probe(label: &str, probe: &Value) {
    let video = probe["streams"]
        .as_array()
        .and_then(|s| s.iter().find(|st| st["codec_type"] == "video"));
    let Some(v) = video else {
        println!("{label}: no video stream");
        return;
    };
    println!(
        "{label}: codec={} coded={}x{} fps={} rotation={:?} duration={} creation_time={}",
        v["codec_name"],
        v["width"],
        v["height"],
        v["avg_frame_rate"],
        rotation(v),
        probe["format"]["duration"],
        probe["format"]["tags"]["creation_time"],
    );
}

/// Rotation in degrees: the display-matrix side data, else the legacy `tags.rotate`.
fn rotation(stream: &Value) -> Option<i64> {
    let side = stream["side_data_list"]
        .as_array()
        .and_then(|list| list.iter().find_map(|sd| sd["rotation"].as_i64()));
    side.or_else(|| {
        stream["tags"]["rotate"]
            .as_str()
            .and_then(|r| r.parse().ok())
    })
}

/// Cut times from `metadata=mode=print` output: every `pts_time:<seconds>` on a `frame:` line.
fn parse_pts_times(output: &str) -> Vec<f64> {
    output
        .lines()
        .filter(|l| l.starts_with("frame:"))
        .filter_map(|l| l.split("pts_time:").nth(1))
        .filter_map(|t| t.trim().parse().ok())
        .collect()
}

fn save_fixtures(probe: &Value, proxy: &Value, select: &str, scdet: &str) -> Res<()> {
    let ffprobe_dir = Path::new("tests/fixtures/ffprobe");
    let scdet_dir = Path::new("tests/fixtures/scdet");
    std::fs::create_dir_all(ffprobe_dir)?;
    std::fs::create_dir_all(scdet_dir)?;
    std::fs::write(ffprobe_dir.join("hevc_rotated.json"), scrub(probe)?)?;
    std::fs::write(ffprobe_dir.join("proxy_720p.json"), scrub(proxy)?)?;
    std::fs::write(scdet_dir.join("select_scene.txt"), select)?;
    std::fs::write(scdet_dir.join("scdet_sc_pass.txt"), scdet)?;
    println!("fixtures written to tests/fixtures/{{ffprobe,scdet}}/");
    Ok(())
}

/// Drops the local file path so fixtures carry no machine details.
fn scrub(probe: &Value) -> Res<String> {
    let mut probe = probe.clone();
    if let Some(format) = probe["format"].as_object_mut() {
        format.insert("filename".into(), Value::String("input.mp4".into()));
    }
    Ok(serde_json::to_string_pretty(&probe)? + "\n")
}

async fn run_ffmpeg(args: &[&str]) -> Res<()> {
    run(Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y"])
        .args(args))
    .await
    .map(drop)
}

/// Runs a child process with [`TIMEOUT`]; returns stdout, or stderr as the error.
async fn run(cmd: &mut Command) -> Res<String> {
    let output = tokio::time::timeout(TIMEOUT, cmd.kill_on_drop(true).output()).await??;
    if output.status.success() {
        Ok(String::from_utf8(output.stdout)?)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned().into())
    }
}

fn path_str(path: &Path) -> Res<&str> {
    path.to_str()
        .ok_or_else(|| format!("non-UTF-8 path {}", path.display()).into())
}
