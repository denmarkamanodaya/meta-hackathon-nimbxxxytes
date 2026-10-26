//! ffmpeg / ffprobe argument lists, built as pure functions so tests can assert the exact argv.
//! Source rotation: ffmpeg auto-rotates on decode, so every output from an original is upright and
//! carries no display matrix; later steps read the upright proxy.

use std::path::Path;

use nimbytes_core::domain::faces::{CROP_PX, FrameCrop};
use nimbytes_core::domain::segmenting::Span;

/// Scale so the long edge is at most 1280 px, keeping aspect and even dimensions.
const LONG_EDGE_1280: &str =
    "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))'";
/// Scale so the short edge is 360 px.
const SHORT_EDGE_360: &str = "scale='if(gt(iw,ih),-2,360)':'if(gt(iw,ih),360,-2)'";
/// Scene cuts: only frames whose scene score exceeds 0.3, printed as `frame:… pts_time:…` lines.
pub const SCENE_FILTER: &str = "select='gt(scene,0.3)',metadata=mode=print:file=-";

fn s(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn secs(v: f64) -> String {
    format!("{v:.3}")
}

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|p| (*p).to_owned()).collect()
}

/// Shared ffmpeg prefix: quiet, overwrite.
fn ffmpeg() -> Vec<String> {
    argv(&["-hide_banner", "-loglevel", "error", "-nostdin", "-y"])
}

/// `ffprobe` JSON of format and streams.
pub fn probe(src: &Path) -> Vec<String> {
    let mut a = argv(&[
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
    ]);
    a.push(s(src));
    a
}

/// 720p-class proxy: long edge 1280, constant 30 fps, H.264 veryfast CRF 23, AAC, fast start.
pub fn proxy(src: &Path, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend(["-i".into(), s(src)]);
    a.extend(argv(&["-map", "0:v:0", "-map", "0:a:0?", "-vf"]));
    a.push(format!("{LONG_EDGE_1280},fps=30"));
    a.extend(argv(&[
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
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
    ]));
    a.push(s(dst));
    a
}

/// 1 fps, long edge 1280, H.264, no audio (face tracking reads every frame and bills it).
pub fn sam_fps1(src: &Path, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend(["-i".into(), s(src), "-an".into(), "-vf".into()]);
    a.push(format!("fps=1,{LONG_EDGE_1280}"));
    a.extend(argv(&[
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
    ]));
    a.push(s(dst));
    a
}

/// RIFF/WAVE mono 16-bit PCM at 16 kHz of `span`.
pub fn wav(src: &Path, span: Span, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend([
        "-ss".into(),
        secs(span.start_s),
        "-t".into(),
        secs(span.len()),
        "-i".into(),
        s(src),
    ]);
    a.extend(argv(&[
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-f",
        "wav",
    ]));
    a.push(s(dst));
    a
}

/// Scene-cut detection; cut lines go to stdout.
pub fn scene_cuts(src: &Path) -> Vec<String> {
    let mut a = argv(&[
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-nostats",
        "-i",
    ]);
    a.push(s(src));
    a.extend(argv(&["-vf", SCENE_FILTER, "-an", "-f", "null", "-"]));
    a
}

/// One JPEG frame at `at_s`, 640 px wide.
pub fn thumbnail(src: &Path, at_s: f64, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend(["-ss".into(), secs(at_s), "-i".into(), s(src)]);
    a.extend(argv(&[
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-2",
        "-q:v",
        "3",
    ]));
    a.push(s(dst));
    a
}

/// Square face crop from one frame, scaled to 256 px.
pub fn crop(src: &Path, c: FrameCrop, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend([
        "-ss".into(),
        secs(c.at_s),
        "-i".into(),
        s(src),
        "-frames:v".into(),
        "1".into(),
    ]);
    let r = c.rect;
    a.push("-vf".into());
    a.push(format!(
        "crop={}:{}:{}:{},scale={CROP_PX}:{CROP_PX}",
        r.side, r.side, r.x, r.y
    ));
    a.extend(argv(&["-q:v", "3"]));
    a.push(s(dst));
    a
}

/// 360p H.264 + AAC clip of `span`, fast start.
pub fn snippet(src: &Path, span: Span, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend([
        "-ss".into(),
        secs(span.start_s),
        "-t".into(),
        secs(span.len()),
        "-i".into(),
        s(src),
    ]);
    a.extend(argv(&[
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        SHORT_EDGE_360,
    ]));
    a.extend(argv(&[
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        "-movflags",
        "+faststart",
    ]));
    a.push(s(dst));
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(a: &[String]) -> String {
        a.join(" ")
    }

    #[test]
    fn proxy_scales_long_edge_to_1280_at_constant_30_fps() {
        let a = proxy(Path::new("/w/original.mov"), Path::new("/w/proxy_720p.mp4"));
        assert_eq!(
            joined(&a),
            "-hide_banner -loglevel error -nostdin -y -i /w/original.mov -map 0:v:0 -map 0:a:0? \
             -vf scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',fps=30 \
             -fps_mode cfr -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -c:a aac \
             -b:a 128k -movflags +faststart /w/proxy_720p.mp4"
        );
    }

    #[test]
    fn fps1_drops_audio_and_keeps_long_edge_1280() {
        let a = joined(&sam_fps1(Path::new("p.mp4"), Path::new("f.mp4")));
        assert!(
            a.contains("-i p.mp4 -an -vf fps=1,scale='if(gt(iw,ih),min(1280,iw)"),
            "{a}"
        );
        assert!(a.ends_with("-movflags +faststart f.mp4"), "{a}");
    }

    #[test]
    fn wav_is_mono_16k_s16_for_the_span() {
        let span = Span {
            start_s: 570.0,
            end_s: 1140.0,
        };
        assert_eq!(
            joined(&wav(Path::new("a.wav"), span, Path::new("audio_1.wav"))),
            "-hide_banner -loglevel error -nostdin -y -ss 570.000 -t 570.000 -i a.wav -vn -ac 1 \
             -ar 16000 -c:a pcm_s16le -f wav audio_1.wav"
        );
    }

    #[test]
    fn scene_cuts_prints_selected_frames_to_stdout() {
        assert_eq!(
            joined(&scene_cuts(Path::new("p.mp4"))),
            "-hide_banner -loglevel error -nostdin -nostats -i p.mp4 -vf \
             select='gt(scene,0.3)',metadata=mode=print:file=- -an -f null -"
        );
    }

    #[test]
    fn thumbnail_seeks_then_grabs_one_640_wide_frame() {
        assert_eq!(
            joined(&thumbnail(Path::new("p.mp4"), 11.375, Path::new("t.jpg"))),
            "-hide_banner -loglevel error -nostdin -y -ss 11.375 -i p.mp4 -frames:v 1 -vf \
             scale=640:-2 -q:v 3 t.jpg"
        );
    }

    #[test]
    fn snippet_cuts_the_span_at_360p() {
        let span = Span {
            start_s: 8.0,
            end_s: 14.75,
        };
        let a = joined(&snippet(Path::new("p.mp4"), span, Path::new("s.mp4")));
        assert!(a.contains("-ss 8.000 -t 6.750 -i p.mp4"), "{a}");
        assert!(
            a.contains("-vf scale='if(gt(iw,ih),-2,360)':'if(gt(iw,ih),360,-2)'"),
            "{a}"
        );
    }

    #[test]
    fn crop_cuts_the_square_then_scales_to_256() {
        use nimbytes_core::domain::faces::CropRect;
        let c = FrameCrop {
            at_s: 9.0,
            rect: CropRect {
                x: 325,
                y: 290,
                side: 70,
            },
        };
        assert_eq!(
            joined(&crop(Path::new("p.mp4"), c, Path::new("f.jpg"))),
            "-hide_banner -loglevel error -nostdin -y -ss 9.000 -i p.mp4 -frames:v 1 -vf \
             crop=70:70:325:290,scale=256:256 -q:v 3 f.jpg"
        );
    }

    #[test]
    fn probe_asks_for_json_format_and_streams() {
        assert_eq!(
            joined(&probe(Path::new("o.mov"))),
            "-v error -print_format json -show_format -show_streams o.mov"
        );
    }
}
