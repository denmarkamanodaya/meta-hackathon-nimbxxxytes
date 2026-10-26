//! Cutting a clip into 5–10 s windows, preferring real scene cuts as window edges.

/// Shortest window, seconds (except a whole clip shorter than this).
pub const MIN_WINDOW_S: f64 = 5.0;
/// Target window, seconds.
pub const TARGET_WINDOW_S: f64 = 7.0;
/// Longest window, seconds.
pub const MAX_WINDOW_S: f64 = 10.0;

/// A half-open span `[start_s, end_s)` in clip seconds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    /// Start, seconds from clip start.
    pub start_s: f64,
    /// End, seconds from clip start.
    pub end_s: f64,
}

impl Span {
    /// Length in seconds.
    pub fn len(self) -> f64 {
        self.end_s - self.start_s
    }

    /// Middle instant.
    pub fn mid(self) -> f64 {
        (self.start_s + self.end_s) / 2.0
    }

    /// Seconds two half-open spans share (0 when they only touch).
    pub fn overlap(self, other: Span) -> f64 {
        (self.end_s.min(other.end_s) - self.start_s.max(other.start_s)).max(0.0)
    }
}

/// Splits `[0, duration)` into windows. Every window is 5–10 s; a clip of 10 s or less is one
/// window. Each edge is the scene cut nearest the target inside the allowed range, else the target
/// itself, so short shots (slivers) end up inside a neighbouring window instead of on their own.
pub fn windows(duration_s: f64, cuts: &[f64]) -> Vec<Span> {
    if !duration_s.is_finite() || duration_s <= 0.0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0.0;
    while duration_s - start > MAX_WINDOW_S {
        let remaining = duration_s - start;
        let (lo, hi, target) = if remaining < MAX_WINDOW_S + MIN_WINDOW_S {
            // Two windows left: split near the middle so both stay >= 5 s.
            (
                start + MIN_WINDOW_S,
                duration_s - MIN_WINDOW_S,
                start + remaining / 2.0,
            )
        } else {
            (
                start + MIN_WINDOW_S,
                start + MAX_WINDOW_S,
                start + TARGET_WINDOW_S,
            )
        };
        let end = nearest_cut(cuts, lo, hi, target).unwrap_or(target);
        out.push(Span {
            start_s: start,
            end_s: end,
        });
        start = end;
    }
    out.push(Span {
        start_s: start,
        end_s: duration_s,
    });
    out
}

fn nearest_cut(cuts: &[f64], lo: f64, hi: f64, target: f64) -> Option<f64> {
    cuts.iter()
        .copied()
        .filter(|c| (lo..=hi).contains(c))
        .min_by(|a, b| (a - target).abs().total_cmp(&(b - target).abs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges(spans: &[Span]) -> Vec<(f64, f64)> {
        spans.iter().map(|s| (s.start_s, s.end_s)).collect()
    }

    #[test]
    fn no_cuts_gives_7_s_windows_and_a_5_to_10_s_tail() {
        assert_eq!(
            edges(&windows(30.0, &[])),
            [(0.0, 7.0), (7.0, 14.0), (14.0, 21.0), (21.0, 30.0)]
        );
    }

    #[test]
    fn short_clips_are_one_window() {
        assert_eq!(edges(&windows(3.2, &[1.0])), [(0.0, 3.2)]);
        assert_eq!(edges(&windows(10.0, &[])), [(0.0, 10.0)]);
        assert!(windows(0.0, &[]).is_empty());
    }

    #[test]
    fn a_tail_between_10_and_15_s_splits_in_two_windows_of_at_least_5_s() {
        assert_eq!(edges(&windows(12.0, &[])), [(0.0, 6.0), (6.0, 12.0)]);
    }

    #[test]
    fn edges_snap_to_the_cut_nearest_the_target() {
        let spans = windows(30.0, &[1.0, 6.0, 8.5, 9.9, 16.0, 29.5]);
        assert_eq!(
            spans[0].end_s, 6.0,
            "6.0 is 1 s from the 7 s target, 8.5 is 1.5 s"
        );
        assert_eq!(
            spans[1].end_s, 16.0,
            "any cut inside 11..=16 beats a cut-free target edge"
        );
        assert_eq!(
            spans[2].end_s, 23.0,
            "no cut in 21..=25: split the 14 s tail in half"
        );
    }

    #[test]
    fn slivers_never_become_windows_and_every_window_is_5_to_10_s() {
        let cuts = [0.4, 1.1, 2.0, 2.3, 7.1, 7.9, 8.2, 15.0, 15.5, 31.0, 31.2];
        let spans = windows(41.7, &cuts);
        for s in &spans {
            assert!((MIN_WINDOW_S..=MAX_WINDOW_S).contains(&s.len()), "{s:?}");
        }
        assert_eq!(spans.first().unwrap().start_s, 0.0);
        assert_eq!(spans.last().unwrap().end_s, 41.7);
        assert!(
            spans.windows(2).all(|w| w[0].end_s == w[1].start_s),
            "contiguous"
        );
    }

    #[test]
    fn overlap_of_half_open_spans() {
        let a = Span {
            start_s: 0.0,
            end_s: 7.0,
        };
        assert_eq!(
            a.overlap(Span {
                start_s: 6.0,
                end_s: 9.0
            }),
            1.0
        );
        assert_eq!(
            a.overlap(Span {
                start_s: 7.0,
                end_s: 9.0
            }),
            0.0
        );
    }
}
