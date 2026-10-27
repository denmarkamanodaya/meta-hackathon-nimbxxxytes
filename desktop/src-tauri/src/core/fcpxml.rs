//! FCPXML 1.10 writer: turns a short's cut into an editable timeline for Final Cut Pro 10.6+ and
//! DaVinci Resolve. Every time is a rational number of seconds snapped to a whole frame; media is
//! linked by absolute, percent-encoded `file://` URLs. Captions, punch-in and transitions are not
//! exported (the editor finishes those in the NLE).

use std::fmt::Write as _;

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};

/// Characters left as-is in a `file://` path: RFC 3986 unreserved plus the separator.
const PATH_KEEP: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~')
    .remove(b'/');

/// A frame duration as the rational `num/den` seconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FrameRate {
    /// Numerator of one frame's duration, seconds.
    pub num: u64,
    /// Denominator.
    pub den: u64,
}

impl FrameRate {
    /// The frame duration for a measured fps: NTSC rates (23.976, 29.97, 59.94) become
    /// `1001/24000`, `1001/30000`, `1001/60000`; others round to whole fps; unknown = 30.
    pub fn from_fps(fps: Option<f64>) -> Self {
        let fps = fps.filter(|f| f.is_finite() && *f >= 1.0).unwrap_or(30.0);
        for base in [24_u64, 30, 48, 60, 120] {
            let ntsc = base as f64 * 1000.0 / 1001.0;
            if (fps - ntsc).abs() < 0.01 {
                return Self {
                    num: 1001,
                    den: base * 1000,
                };
            }
        }
        Self {
            num: 1,
            den: fps.round().max(1.0) as u64,
        }
    }

    /// Frames per second as a float.
    pub fn fps(self) -> f64 {
        self.den as f64 / self.num as f64
    }

    /// Whole frames nearest to `seconds` (never negative).
    pub fn frames(self, seconds: f64) -> u64 {
        if seconds.is_finite() && seconds > 0.0 {
            (seconds * self.fps()).round() as u64
        } else {
            0
        }
    }

    /// `frames` as an FCPXML time: `0s`, `5s` or `150150/30000s`.
    pub fn time(self, frames: u64) -> String {
        let num = frames * self.num;
        if num == 0 {
            "0s".to_owned()
        } else if num.is_multiple_of(self.den) {
            format!("{}s", num / self.den)
        } else {
            format!("{num}/{}s", self.den)
        }
    }

    /// One frame as an FCPXML time.
    pub fn frame_duration(self) -> String {
        format!("{}/{}s", self.num, self.den)
    }
}

/// A source file the cut uses.
#[derive(Debug, Clone, PartialEq)]
pub struct Media {
    /// Name shown in the NLE's browser.
    pub name: String,
    /// Absolute local path (original if offline, else the proxy).
    pub path: String,
    /// Pixel width.
    pub width: u32,
    /// Pixel height.
    pub height: u32,
    /// Frame rate.
    pub rate: FrameRate,
    /// Length, seconds.
    pub duration_s: f64,
}

/// One shot: a part of `media[media]`.
#[derive(Debug, Clone, PartialEq)]
pub struct Shot {
    /// Index into [`Project::media`].
    pub media: usize,
    /// Start on the source, seconds.
    pub in_s: f64,
    /// End on the source, seconds.
    pub out_s: f64,
    /// The AI's reason for the shot (becomes a marker).
    pub reason: String,
}

/// A critique note at a time on the cut.
#[derive(Debug, Clone, PartialEq)]
pub struct Note {
    /// Seconds from the start of the cut.
    pub at_s: f64,
    /// The text.
    pub text: String,
}

/// Everything the writer needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    /// Project name (the prompt, else the short id).
    pub name: String,
    /// Output width.
    pub width: u32,
    /// Output height.
    pub height: u32,
    /// Sources, each once.
    pub media: Vec<Media>,
    /// Shots in play order.
    pub shots: Vec<Shot>,
    /// Critique notes, as to-do markers.
    pub notes: Vec<Note>,
}

/// XML-escapes text for an attribute value and drops characters XML 1.0 forbids.
pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\n' => out.push_str("&#10;"),
            '\t' | '\r' => out.push(' '),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// `file:///Users/a/My%20clip.mp4` for an absolute path.
pub fn file_url(path: &str) -> String {
    format!("file://{}", utf8_percent_encode(path, PATH_KEEP))
}

/// A shot placed on the sequence, in frames.
struct Placed {
    shot: usize,
    start: u64,
    duration: u64,
    offset: u64,
}

fn place(project: &Project, seq: FrameRate) -> Vec<Placed> {
    let mut offset = 0;
    let mut out = Vec::new();
    for (i, shot) in project.shots.iter().enumerate() {
        let Some(media) = project.media.get(shot.media) else {
            continue;
        };
        let out_s = shot.out_s.min(media.duration_s);
        let start = media.rate.frames(shot.in_s);
        let duration = seq.frames(out_s - shot.in_s);
        if duration == 0 {
            continue;
        }
        out.push(Placed {
            shot: i,
            start,
            duration,
            offset,
        });
        offset += duration;
    }
    out
}

/// Format ids: `r1` is the sequence; each distinct source format follows.
fn formats(project: &Project, seq: FrameRate) -> (String, Vec<String>) {
    let mut xml = String::new();
    let _ = writeln!(
        xml,
        r#"    <format id="r1" frameDuration="{}" width="{}" height="{}"/>"#,
        seq.frame_duration(),
        project.width,
        project.height
    );
    let mut keys: Vec<(u32, u32, FrameRate)> = Vec::new();
    let mut ids = Vec::new();
    for media in &project.media {
        let key = (media.width, media.height, media.rate);
        let index = keys.iter().position(|k| *k == key).unwrap_or_else(|| {
            keys.push(key);
            let _ = writeln!(
                xml,
                r#"    <format id="f{}" frameDuration="{}" width="{}" height="{}"/>"#,
                keys.len(),
                media.rate.frame_duration(),
                media.width,
                media.height
            );
            keys.len() - 1
        });
        ids.push(format!("f{}", index + 1));
    }
    (xml, ids)
}

fn assets(project: &Project, format_ids: &[String]) -> String {
    let mut xml = String::new();
    for (i, media) in project.media.iter().enumerate() {
        let duration = media.rate.time(media.rate.frames(media.duration_s));
        let _ = writeln!(
            xml,
            r#"    <asset id="a{}" name="{}" start="0s" duration="{duration}" hasVideo="1" hasAudio="1" format="{}" audioSources="1" audioChannels="2" audioRate="48000">"#,
            i + 1,
            escape(&media.name),
            format_ids.get(i).map_or("r1", String::as_str),
        );
        let _ = writeln!(
            xml,
            r#"      <media-rep kind="original-media" src="{}"/>"#,
            escape(&file_url(&media.path))
        );
        xml.push_str("    </asset>\n");
    }
    xml
}

fn markers(project: &Project, placed: &Placed, seq: FrameRate) -> String {
    let shot = &project.shots[placed.shot];
    let rate = project.media[shot.media].rate;
    let mut xml = String::new();
    if !shot.reason.trim().is_empty() {
        let _ = writeln!(
            xml,
            r#"              <marker start="{}" duration="{}" value="{}"/>"#,
            rate.time(placed.start),
            rate.frame_duration(),
            escape(shot.reason.trim())
        );
    }
    for note in &project.notes {
        let at = seq.frames(note.at_s);
        let inside = at >= placed.offset && at < placed.offset + placed.duration;
        if inside {
            let local = placed.start + rate.frames((at - placed.offset) as f64 / seq.fps());
            let _ = writeln!(
                xml,
                r#"              <marker start="{}" duration="{}" value="{}" completed="0"/>"#,
                rate.time(local),
                rate.frame_duration(),
                escape(&note.text)
            );
        }
    }
    xml
}

/// Writes the FCPXML document. The sequence takes the first shot's frame rate.
pub fn write(project: &Project) -> String {
    let seq = project
        .shots
        .first()
        .and_then(|s| project.media.get(s.media))
        .map_or(FrameRate::from_fps(None), |m| m.rate);
    let placed = place(project, seq);
    let total: u64 = placed.iter().map(|p| p.duration).sum();
    let (format_xml, format_ids) = formats(project, seq);
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.10\">\n  <resources>\n",
    );
    xml.push_str(&format_xml);
    xml.push_str(&assets(project, &format_ids));
    xml.push_str("  </resources>\n  <library>\n    <event name=\"nimbytes\">\n");
    let _ = writeln!(xml, r#"      <project name="{}">"#, escape(&project.name));
    let _ = writeln!(
        xml,
        r#"        <sequence format="r1" duration="{}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">"#,
        seq.time(total)
    );
    xml.push_str("          <spine>\n");
    for p in &placed {
        let shot = &project.shots[p.shot];
        let media = &project.media[shot.media];
        let _ = writeln!(
            xml,
            r#"            <asset-clip ref="a{}" name="{}" offset="{}" start="{}" duration="{}" format="{}" tcFormat="NDF">"#,
            shot.media + 1,
            escape(&media.name),
            seq.time(p.offset),
            media.rate.time(p.start),
            seq.time(p.duration),
            format_ids.get(shot.media).map_or("r1", String::as_str),
        );
        xml.push_str(&markers(project, p, seq));
        xml.push_str("            </asset-clip>\n");
    }
    xml.push_str("          </spine>\n        </sequence>\n      </project>\n    </event>\n  </library>\n</fcpxml>\n");
    xml
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ntsc_and_whole_rates_get_exact_frame_durations() {
        assert_eq!(
            FrameRate::from_fps(Some(29.97)),
            FrameRate {
                num: 1001,
                den: 30000
            }
        );
        assert_eq!(
            FrameRate::from_fps(Some(29.970_03)),
            FrameRate {
                num: 1001,
                den: 30000
            }
        );
        assert_eq!(
            FrameRate::from_fps(Some(30.0)),
            FrameRate { num: 1, den: 30 }
        );
        assert_eq!(
            FrameRate::from_fps(Some(59.94)),
            FrameRate {
                num: 1001,
                den: 60000
            }
        );
        assert_eq!(
            FrameRate::from_fps(Some(60.0)),
            FrameRate { num: 1, den: 60 }
        );
        assert_eq!(FrameRate::from_fps(None), FrameRate { num: 1, den: 30 });
        assert_eq!(
            FrameRate::from_fps(Some(f64::NAN)),
            FrameRate { num: 1, den: 30 }
        );
    }

    #[test]
    fn times_snap_to_whole_frames() {
        let ntsc = FrameRate::from_fps(Some(29.97));
        // 5 s at 29.97 is 149.85 frames: 150 frames = 150150/30000 s.
        assert_eq!(ntsc.time(ntsc.frames(5.0)), "150150/30000s");
        assert_eq!(ntsc.time(0), "0s");
        let thirty = FrameRate::from_fps(Some(30.0));
        assert_eq!(thirty.time(thirty.frames(2.0)), "2s");
        // 1.01 s at 30 fps is 30.3 frames: snapped to 30.
        assert_eq!(thirty.time(thirty.frames(1.01)), "1s");
        assert_eq!(thirty.time(thirty.frames(1.02)), "31/30s");
        let sixty = FrameRate::from_fps(Some(60.0));
        assert_eq!(sixty.time(sixty.frames(0.5)), "30/60s");
        assert_eq!(sixty.frames(-1.0), 0);
    }

    #[test]
    fn text_and_paths_are_escaped() {
        assert_eq!(
            escape(r#"Mia & "Leo" <3 it's"#),
            "Mia &amp; &quot;Leo&quot; &lt;3 it&apos;s"
        );
        assert_eq!(escape("a\u{0}b\nc"), "ab&#10;c");
        assert_eq!(
            file_url("/Users/me/nimbytes/Library/2026-10-27 Café [ab].mp4"),
            "file:///Users/me/nimbytes/Library/2026-10-27%20Caf%C3%A9%20%5Bab%5D.mp4"
        );
    }

    fn media(
        name: &str,
        path: &str,
        (width, height): (u32, u32),
        (fps, duration_s): (f64, f64),
    ) -> Media {
        Media {
            name: name.into(),
            path: path.into(),
            width,
            height,
            rate: FrameRate::from_fps(Some(fps)),
            duration_s,
        }
    }

    fn shot(media: usize, in_s: f64, out_s: f64, reason: &str) -> Shot {
        Shot {
            media,
            in_s,
            out_s,
            reason: reason.into(),
        }
    }

    #[test]
    fn the_document_matches_the_golden_file() {
        let walk = media(
            "Walk & talk",
            "/Users/me/nimbytes/Originals/2026-10-27 Walk [0000aaaa].mov",
            (1440, 1920),
            (29.97, 12.0),
        );
        let dog = media(
            "Dog",
            "/Users/me/nimbytes/Library/Dog [0000bbbb].mp4",
            (720, 960),
            (30.0, 4.0),
        );
        let project = Project {
            name: "Beach <day>".into(),
            width: 1080,
            height: 1350,
            media: vec![walk, dog],
            shots: vec![
                shot(0, 1.0, 3.5, "Opens on the \"wave\""),
                shot(1, 0.5, 9.0, "Payoff"),
                shot(0, 6.0, 6.01, "sliver, dropped"),
            ],
            notes: vec![Note {
                at_s: 3.0,
                text: "Hold the dog shot longer → trim less".into(),
            }],
        };
        let golden = include_str!("../../tests/fixtures/short.fcpxml");
        assert_eq!(write(&project), golden);
    }
}
