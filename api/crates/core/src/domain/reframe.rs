//! Keep subject in frame: a 9:16 export follows a shot's subject instead of cropping the centre.
//! SAM tracks the subject over the shot at [`REFRAME_FPS`]; [`crop_path`] turns the track into a
//! smooth camera path (crop centres over time) that never leaves the source frame.

use serde::{Deserialize, Serialize};

use crate::domain::ids::{SegmentId, ShortId};
use crate::domain::sam::{SamRecord, frame_time};
use crate::domain::timeline::TimelineClip;

/// Frame rate of the range proxy SAM tracks the subject on.
pub const REFRAME_FPS: u32 = 12;
/// Most shots one reframe run tracks.
pub const MAX_REFRAME_SHOTS: usize = 20;
/// Output frame of a vertical export, width / height.
pub const VERTICAL_ASPECT: f64 = 9.0 / 16.0;
/// Weight of each new sample in the moving average.
pub const EMA_ALPHA: f64 = 0.35;
/// The crop ignores the subject moving less than this far from its centre (share of the frame).
pub const DEAD_ZONE: f64 = 0.04;
/// Fastest pan, shares of the frame per second.
pub const MAX_PAN_PER_S: f64 = 0.5;

/// One keyframe: the crop centre at clip second `t_s`, as shares (0–1) of the upright source.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CropKey {
    /// Clip (source) seconds, the time base of captions and blur boxes.
    pub t_s: f64,
    /// Crop centre, share of the source width.
    pub cx: f64,
    /// Crop centre, share of the source height.
    pub cy: f64,
}

/// The subject at one frame: its box centre as shares of the frame, or `None` when lost.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackSample {
    /// Clip seconds.
    pub t_s: f64,
    /// Subject centre (x, y), shares of the frame.
    pub centre: Option<(f64, f64)>,
}

/// Half the crop's width and height, as shares of a frame of `frame_aspect` (width / height),
/// for an output of `out_aspect`: the crop is as large as the frame allows.
pub fn crop_half(frame_aspect: f64, out_aspect: f64) -> (f64, f64) {
    if !(frame_aspect > 0.0 && out_aspect > 0.0) {
        return (0.5, 0.5);
    }
    if out_aspect <= frame_aspect {
        ((out_aspect / frame_aspect).min(1.0) / 2.0, 0.5)
    } else {
        (0.5, (frame_aspect / out_aspect).min(1.0) / 2.0)
    }
}

fn clamp_centre(v: f64, half: f64) -> f64 {
    v.clamp(half, 1.0 - half)
}

/// One axis of the camera: an EMA towards `target` past the dead zone, no faster than `max_step`.
fn step_axis(current: f64, target: f64, max_step: f64) -> f64 {
    let err = target - current;
    if err.abs() <= DEAD_ZONE {
        return current;
    }
    let wanted = EMA_ALPHA * (err - DEAD_ZONE * err.signum());
    current + wanted.clamp(-max_step, max_step)
}

/// The camera path over `samples` (in time order) for a `frame` (w, h) source cut to
/// `out_aspect`: one keyframe per sample. The crop starts on the first sighting (the centre when
/// the subject is never seen), follows with an EMA, ignores moves inside the dead zone, pans at
/// most [`MAX_PAN_PER_S`], holds still while the subject is lost, and stays inside the frame.
pub fn crop_path(samples: &[TrackSample], frame: (u32, u32), out_aspect: f64) -> Vec<CropKey> {
    let frame_aspect = f64::from(frame.0) / f64::from(frame.1.max(1));
    let (hw, hh) = crop_half(frame_aspect, out_aspect);
    let first = samples.iter().find_map(|s| s.centre).unwrap_or((0.5, 0.5));
    let mut cur = (clamp_centre(first.0, hw), clamp_centre(first.1, hh));
    let mut target = first;
    let mut prev_t: Option<f64> = None;
    let mut out = Vec::with_capacity(samples.len());
    for s in samples {
        if let Some(c) = s.centre {
            target = c;
        }
        let dt = prev_t.map_or(0.0, |p| (s.t_s - p).max(0.0));
        let max_step = MAX_PAN_PER_S * dt;
        if s.centre.is_some() {
            cur = (
                clamp_centre(step_axis(cur.0, target.0, max_step), hw),
                clamp_centre(step_axis(cur.1, target.1, max_step), hh),
            );
        }
        prev_t = Some(s.t_s);
        out.push(CropKey {
            t_s: s.t_s,
            cx: cur.0,
            cy: cur.1,
        });
    }
    out
}

/// Frames a range proxy of `in_s..out_s` at `fps` has.
pub fn frames_in(in_s: f64, out_s: f64, fps: u32) -> u32 {
    let n = ((out_s - in_s).max(0.0) * f64::from(fps)).round();
    if n >= f64::from(u32::MAX) {
        u32::MAX
    } else {
        n as u32
    }
}

/// One sample per frame of the shot's range proxy from the picked track's records (the largest
/// when a frame has two), the frame's time in clip seconds.
pub fn samples(track: &[SamRecord], in_s: f64, frames: u32, fps: u32) -> Vec<TrackSample> {
    (0..frames)
        .map(|f| {
            let centre = track
                .iter()
                .filter(|r| r.frame == f && r.frame_w > 0 && r.frame_h > 0)
                .max_by(|a, b| a.area().total_cmp(&b.area()))
                .map(|r| {
                    (
                        (r.bbox.x1 + r.bbox.x2) / 2.0 / f64::from(r.frame_w),
                        (r.bbox.y1 + r.bbox.y2) / 2.0 / f64::from(r.frame_h),
                    )
                });
            TrackSample {
                t_s: frame_time(in_s, f, fps),
                centre,
            }
        })
        .collect()
}

/// How one shot was tracked, stored per short, version and moment.
#[derive(Debug, Clone, PartialEq)]
pub struct ShotReframe {
    /// The short.
    pub short_id: ShortId,
    /// The version tracked.
    pub version_n: u32,
    /// The shot's moment.
    pub segment_id: SegmentId,
    /// What was followed.
    pub subject: String,
    /// The camera path; empty when the subject was never found (the centre crop stays).
    pub crop_path: Vec<CropKey>,
    /// Frames the subject was seen in.
    pub frames_tracked: u32,
    /// Frames of the shot.
    pub frames_total: u32,
    /// Seconds the subject was out of view.
    pub lost_s: f64,
    /// Last change, ISO-8601 UTC.
    pub updated_at: String,
}

/// The reframe for `shot` of version `n`: the row of that version, else the newest row of any
/// version for the same moment and subject (a later save that kept the subject reuses it; a
/// changed subject matches nothing).
pub fn reframe_for<'a>(
    rows: &'a [ShotReframe],
    n: u32,
    shot: &TimelineClip,
) -> Option<&'a ShotReframe> {
    let subject = shot.subject.as_deref()?.trim();
    let same = |r: &&ShotReframe| r.segment_id == shot.segment_id && r.subject == subject;
    rows.iter()
        .filter(same)
        .find(|r| r.version_n == n)
        .or_else(|| rows.iter().filter(same).max_by_key(|r| r.version_n))
}

/// The shots of a timeline a reframe follows: those with a subject, at most
/// [`MAX_REFRAME_SHOTS`], each moment and subject once.
pub fn reframe_shots(clips: &[TimelineClip]) -> Vec<&TimelineClip> {
    let mut out: Vec<&TimelineClip> = Vec::new();
    for c in clips {
        let Some(subject) = c.subject.as_deref().map(str::trim) else {
            continue;
        };
        if subject.is_empty()
            || out.iter().any(|o| {
                o.segment_id == c.segment_id && o.subject.as_deref().map(str::trim) == Some(subject)
            })
        {
            continue;
        }
        out.push(c);
        if out.len() == MAX_REFRAME_SHOTS {
            break;
        }
    }
    out
}

/// Where a short's reframe stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReframeStatus {
    /// Not run for the current cut.
    Idle,
    /// Running now.
    Running,
    /// Every followed shot has a row.
    Ready,
    /// The last run failed.
    Failed,
}

/// The status from what is known: a run in flight wins, then every followed shot having a row,
/// then a failed last run.
pub fn reframe_status(
    running: bool,
    failed: bool,
    shots: usize,
    with_rows: usize,
) -> ReframeStatus {
    if running {
        ReframeStatus::Running
    } else if with_rows >= shots {
        ReframeStatus::Ready
    } else if failed {
        ReframeStatus::Failed
    } else {
        ReframeStatus::Idle
    }
}

/// Progress step of a reframe run: `reframe {done}/{total}`.
pub fn reframe_step(done: usize, total: usize) -> String {
    format!("reframe {done}/{total}")
}

#[cfg(test)]
mod tests;
