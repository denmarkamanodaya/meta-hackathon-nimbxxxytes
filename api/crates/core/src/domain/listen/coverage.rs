//! The coverage rules of the transcribe step. One Voice Transcribe call on a mixed-language file
//! can keep one language and silently drop the other (real-audio spike, 2026-10-30: a Mandarin
//! and Japanese reading kept only the Mandarin). So the step also hears the file in short windows
//! cut at pauses, splits a window that came back far too sparse, and keeps the window lines when
//! they hold clearly more speech than the full pass.

use crate::domain::segmenting::Span;

/// A window is cut at the first pause once it is at least this long, seconds.
pub const WINDOW_MIN_S: f64 = 12.0;
/// A window with no pause is cut here, seconds.
pub const WINDOW_MAX_S: f64 = 20.0;
/// A window is sparse below this share of the median window density.
pub const SPARSE_RATIO: f64 = 0.5;
/// A sparse window shorter than this is not split, seconds.
pub const SPLIT_MIN_S: f64 = 3.0;
/// How many times a window may be split.
pub const MAX_SPLIT_DEPTH: u32 = 2;
/// The window pass wins when it holds more than this many times the full pass's text.
pub const WINDOW_GAIN: f64 = 1.15;

/// Whether `c` is written one syllable or word per character (CJK, Kana, Hangul).
fn dense_script(c: char) -> bool {
    matches!(u32::from(c),
        0x3040..=0x30FF       // Hiragana, Katakana
        | 0x3400..=0x4DBF     // CJK extension A
        | 0x4E00..=0x9FFF     // CJK unified
        | 0xF900..=0xFAFF     // CJK compatibility
        | 0x1100..=0x11FF     // Hangul jamo
        | 0xAC00..=0xD7AF) // Hangul syllables
}

/// How much was said in `text`: each CJK, Kana or Hangul character counts 1, every other letter
/// a third (about one syllable).
pub fn text_units(text: &str) -> f64 {
    let (mut dense, mut letters) = (0u32, 0u32);
    for c in text.chars() {
        if dense_script(c) {
            dense += 1;
        } else if c.is_alphabetic() {
            letters += 1;
        }
    }
    f64::from(dense) + f64::from(letters) / 3.0
}

/// Pause midpoints strictly inside `(from, to)`, ascending.
fn pause_mids(silences: &[Span], from: f64, to: f64) -> Vec<f64> {
    let mut mids: Vec<f64> = silences
        .iter()
        .filter(|s| s.end_s.is_finite())
        .map(|s| s.mid())
        .filter(|m| *m > from && *m < to)
        .collect();
    mids.sort_by(f64::total_cmp);
    mids
}

/// Windows covering `[0, duration_s)`: each is cut at the first pause midpoint once it is at
/// least [`WINDOW_MIN_S`] long, or at [`WINDOW_MAX_S`] when no pause comes in time.
pub fn plan_windows(duration_s: f64, silences: &[Span]) -> Vec<Span> {
    let mids = pause_mids(silences, 0.0, duration_s);
    let mut out = Vec::new();
    let mut start = 0.0;
    while start < duration_s {
        let pause = mids
            .iter()
            .copied()
            .find(|m| *m - start >= WINDOW_MIN_S && *m - start <= WINDOW_MAX_S);
        let end = match pause {
            Some(m) => m,
            None if duration_s - start > WINDOW_MAX_S => start + WINDOW_MAX_S,
            None => duration_s,
        };
        out.push(Span {
            start_s: start,
            end_s: end,
        });
        start = end;
    }
    out
}

/// Seconds of `window` that are not silence.
pub fn speech_seconds(window: Span, silences: &[Span]) -> f64 {
    let quiet: f64 = silences.iter().map(|s| window.overlap(*s)).sum();
    (window.len() - quiet).max(0.0)
}

/// Text units per speech second; 0 without speech.
pub fn density(units: f64, speech_s: f64) -> f64 {
    if speech_s > 0.0 {
        units / speech_s
    } else {
        0.0
    }
}

/// The median (0 for none).
pub fn median(values: &[f64]) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    match v.len() {
        0 => 0.0,
        n if n % 2 == 1 => v[n / 2],
        n => (v[n / 2 - 1] + v[n / 2]) / 2.0,
    }
}

/// Whether a window of `density` came back far too sparse to trust: below [`SPARSE_RATIO`] of
/// the median and at least [`SPLIT_MIN_S`] long.
pub fn sparse(window: Span, density: f64, median: f64) -> bool {
    window.len() >= SPLIT_MIN_S && density < SPARSE_RATIO * median
}

/// Where a sparse window is split: the pause midpoint nearest its middle, at least 1 s from
/// either edge; `None` without such a pause.
pub fn split_at(window: Span, silences: &[Span]) -> Option<f64> {
    let middle = window.mid();
    pause_mids(silences, window.start_s + 1.0, window.end_s - 1.0)
        .into_iter()
        .min_by(|a, b| (a - middle).abs().total_cmp(&(b - middle).abs()))
}

/// Whether the window pass heard clearly more than the full pass (see [`WINDOW_GAIN`]).
pub fn windows_heard_more(full_units: f64, window_units: f64) -> bool {
    window_units > WINDOW_GAIN * full_units
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(start_s: f64, end_s: f64) -> Span {
        Span { start_s, end_s }
    }

    /// The real-audio spike's pauses up to 26 s (ffmpeg silencedetect, -35 dB, 0.35 s).
    fn spike_pauses() -> Vec<Span> {
        vec![
            span(0.0, 0.687),
            span(2.488, 2.850),
            span(4.177, 5.155),
            span(7.787, 8.634),
            span(12.050, 12.718),
            span(16.559, 17.230),
            span(18.499, 19.698),
            span(20.926, 21.365),
            span(22.166, 22.611),
            span(24.196, 25.539),
        ]
    }

    #[test]
    fn units_count_cjk_kana_and_hangul_once_and_other_letters_by_three() {
        assert_eq!(text_units("而终于归结到传 RQ"), 7.0 + 2.0 / 3.0);
        assert_eq!(text_units("はい、パソコン"), 6.0);
        assert_eq!(text_units("안녕하세요"), 5.0);
        assert_eq!(text_units("Hello there"), 10.0 / 3.0);
        assert_eq!(text_units(" 12, ... "), 0.0);
    }

    #[test]
    fn windows_are_cut_at_the_first_pause_after_12_s() {
        let w = plan_windows(26.0, &spike_pauses());
        let cuts: Vec<(f64, f64)> = w
            .iter()
            .map(|s| {
                (
                    (s.start_s * 100.0).round() / 100.0,
                    (s.end_s * 100.0).round() / 100.0,
                )
            })
            .collect();
        assert_eq!(cuts, [(0.0, 12.38), (12.38, 24.87), (24.87, 26.0)]);
    }

    #[test]
    fn a_window_without_a_pause_is_cut_at_20_s() {
        assert_eq!(
            plan_windows(45.0, &[]),
            [span(0.0, 20.0), span(20.0, 40.0), span(40.0, 45.0)]
        );
        assert_eq!(plan_windows(8.0, &[span(3.0, 4.0)]), [span(0.0, 8.0)]);
        assert!(plan_windows(0.0, &[]).is_empty());
    }

    #[test]
    fn speech_seconds_leave_out_the_pauses_and_density_follows() {
        let pauses = spike_pauses();
        let w1 = span(12.38, 24.87);
        let speech = speech_seconds(w1, &pauses);
        assert!((speech - 8.72).abs() < 0.01, "{speech}");
        let d = density(text_units("而终于归结到传 RQ"), speech);
        assert!((d - 0.88).abs() < 0.01, "the dropped window: {d}");
        assert_eq!(density(5.0, 0.0), 0.0);
        let trailing = [span(9.0, f64::INFINITY)];
        assert_eq!(speech_seconds(span(0.0, 10.0), &trailing), 9.0);
    }

    #[test]
    fn the_dropped_window_is_sparse_against_the_spike_median() {
        // Densities of the spike's seven windows (units per speech second).
        let densities = [4.4, 0.88, 5.87, 3.16, 5.08, 4.21, 7.97];
        let m = median(&densities);
        assert_eq!(m, 4.4);
        assert!(sparse(span(12.38, 24.87), 0.88, m));
        assert!(
            !sparse(span(37.6, 50.17), 3.16, m),
            "the lowest good window stays"
        );
        assert!(!sparse(span(0.0, 2.5), 0.1, m), "too short to split");
        assert_eq!(median(&[1.0, 3.0]), 2.0);
        assert_eq!(median(&[]), 0.0);
    }

    #[test]
    fn a_sparse_window_splits_at_the_pause_nearest_its_middle() {
        let pauses = spike_pauses();
        let at = split_at(span(12.38, 24.87), &pauses).unwrap();
        assert!((at - 19.10).abs() < 0.01, "{at}");
        let half = split_at(span(12.38, 19.10), &pauses).unwrap();
        assert!((half - 16.89).abs() < 0.01, "{half}");
        assert_eq!(
            split_at(span(0.0, 3.0), &[span(0.2, 0.4)]),
            None,
            "no pause inside"
        );
    }

    #[test]
    fn the_window_pass_wins_only_with_15_percent_more_text() {
        assert!(
            windows_heard_more(134.7, 278.3),
            "the spike: Japanese recovered"
        );
        assert!(!windows_heard_more(100.0, 114.0));
        assert!(windows_heard_more(100.0, 116.0));
        assert!(windows_heard_more(0.0, 1.0));
    }
}
