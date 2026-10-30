//! ffmpeg / ffprobe argument lists, built as pure functions so tests can assert the exact argv.
//! Source rotation: ffmpeg auto-rotates on decode, so every output from an original is upright and
//! carries no display matrix; later steps read the upright proxy.

use std::path::Path;

use nimbytes_core::domain::document::{PAGE_LONG_EDGE_PX, PDF_DPI};
use nimbytes_core::domain::faces::{CROP_PX, FrameCrop, PROXY_LONG_EDGE_PX};
use nimbytes_core::domain::segmenting::Span;

/// Scale so the long edge is at most [`PROXY_LONG_EDGE_PX`], keeping aspect and even dimensions.
fn proxy_scale() -> String {
    let n = PROXY_LONG_EDGE_PX;
    format!("scale='if(gt(iw,ih),min({n},iw),-2)':'if(gt(iw,ih),-2,min({n},ih))'")
}
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
    a.push(format!("{},fps=30", proxy_scale()));
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
    a.push(format!("fps=1,{}", proxy_scale()));
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

/// The first frame of a still image with its tags (EXIF) and side data (orientation), and the
/// stream's coded size.
pub fn probe_image(src: &Path) -> Vec<String> {
    let mut a = argv(&[
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-read_intervals",
        "%+#1",
        "-show_frames",
        "-show_entries",
        "stream=width,height:frame=side_data_list:frame_tags",
        "-of",
        "json",
    ]);
    a.push(s(src));
    a
}

/// Pause detection (below -35 dB for at least 0.35 s); the pause lines go to stdout.
pub fn silences(src: &Path) -> Vec<String> {
    let mut a = argv(&[
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-nostats",
        "-i",
    ]);
    a.push(s(src));
    a.extend(argv(&[
        "-af",
        "silencedetect=noise=-35dB:d=0.35,ametadata=mode=print:file=-",
        "-vn",
        "-f",
        "null",
        "-",
    ]));
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

/// `span` of the proxy at `fps`, H.264 without audio, for SAM. The seek sits before the input, so
/// the output's frame `f` shows clip second `span.start_s + f / fps`.
pub fn range_proxy(src: &Path, span: Span, fps: u32, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend([
        "-ss".into(),
        secs(span.start_s),
        "-i".into(),
        s(src),
        "-t".into(),
        secs((span.end_s - span.start_s).max(0.0)),
        "-an".into(),
        "-vf".into(),
        format!("fps={fps}"),
    ]);
    a.extend(argv(&[
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    ]));
    a.push(s(dst));
    a
}

/// One JPEG frame at `at_s` at the source's own size.
pub fn frame_at(src: &Path, at_s: f64, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend(["-ss".into(), secs(at_s), "-i".into(), s(src)]);
    a.extend(argv(&["-frames:v", "1", "-q:v", "2"]));
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

/// Prefix of the files [`pdf_pages`] writes: `page-1.jpg`, or `page-01.jpg` for a PDF of 10 or
/// more pages (pdftoppm pads the number to the page count's width).
pub const PDF_PAGE_PREFIX: &str = "page";

/// `pdftoppm` drawing pages 1 to `max` of a PDF as JPEGs at [`PDF_DPI`] into `dst_dir`.
pub fn pdf_pages(src: &Path, dst_dir: &Path, max: usize) -> Vec<String> {
    let mut a = argv(&["-r"]);
    a.push(PDF_DPI.to_string());
    a.extend(argv(&["-jpeg", "-f", "1", "-l"]));
    a.push(max.to_string());
    a.push(s(src));
    a.push(s(&dst_dir.join(PDF_PAGE_PREFIX)));
    a
}

/// One JPEG of an image, its long edge at most [`PAGE_LONG_EDGE_PX`] and never enlarged.
pub fn page_jpeg(src: &Path, dst: &Path) -> Vec<String> {
    fit_jpeg(src, PAGE_LONG_EDGE_PX, dst)
}

/// A still image as a JPEG whose long edge is at most `n` px (never enlarged). No seek: on a still
/// image `-ss` drops the only frame and ffmpeg writes nothing yet exits 0.
pub fn fit_jpeg(src: &Path, n: u32, dst: &Path) -> Vec<String> {
    let mut a = ffmpeg();
    a.extend([
        "-i".into(),
        s(src),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
    ]);
    a.push(format!(
        "scale='min({n},iw)':'min({n},ih)':force_original_aspect_ratio=decrease"
    ));
    a.extend(argv(&["-q:v", "3"]));
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
    fn silences_print_the_pauses_of_the_sound_to_stdout() {
        assert_eq!(
            joined(&silences(Path::new("a.wav"))),
            "-hide_banner -loglevel error -nostdin -nostats -i a.wav -af \
             silencedetect=noise=-35dB:d=0.35,ametadata=mode=print:file=- -vn -f null -"
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
    fn a_range_proxy_seeks_before_the_input_and_keeps_the_proxy_size() {
        let span = Span {
            start_s: 12.0,
            end_s: 18.5,
        };
        assert_eq!(
            joined(&range_proxy(
                Path::new("p.mp4"),
                span,
                12,
                Path::new("r.mp4")
            )),
            "-hide_banner -loglevel error -nostdin -y -ss 12.000 -i p.mp4 -t 6.500 -an -vf fps=12 \
             -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p r.mp4"
        );
    }

    #[test]
    fn frame_at_grabs_one_full_size_jpeg() {
        assert_eq!(
            joined(&frame_at(Path::new("p.mp4"), 4.0, Path::new("f.jpg"))),
            "-hide_banner -loglevel error -nostdin -y -ss 4.000 -i p.mp4 -frames:v 1 -q:v 2 f.jpg"
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

    #[test]
    fn pdf_pages_draws_the_first_max_pages_at_150_dpi_as_jpeg() {
        assert_eq!(
            joined(&pdf_pages(
                Path::new("/w/source.pdf"),
                Path::new("/w/d1"),
                10
            )),
            "-r 150 -jpeg -f 1 -l 10 /w/source.pdf /w/d1/page"
        );
    }

    #[test]
    fn probe_image_reads_the_first_frames_tags_and_orientation() {
        assert_eq!(
            joined(&probe_image(Path::new("p.jpg"))),
            "-v error -select_streams v:0 -read_intervals %+#1 -show_frames -show_entries \
             stream=width,height:frame=side_data_list:frame_tags -of json p.jpg"
        );
    }

    #[test]
    fn fit_jpeg_never_seeks_and_fits_the_long_edge() {
        let a = joined(&fit_jpeg(
            Path::new("cover_drawn.jpg"),
            720,
            Path::new("cover.jpg"),
        ));
        assert!(!a.contains("-ss"), "{a}");
        assert!(
            a.contains("scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease")
        );
    }

    #[test]
    fn page_jpeg_fits_the_image_in_2000_px_without_enlarging() {
        assert_eq!(
            joined(&page_jpeg(Path::new("s.png"), Path::new("page_1.jpg"))),
            "-hide_banner -loglevel error -nostdin -y -i s.png -frames:v 1 -vf \
             scale='min(2000,iw)':'min(2000,ih)':force_original_aspect_ratio=decrease \
             -q:v 3 page_1.jpg"
        );
    }
}
