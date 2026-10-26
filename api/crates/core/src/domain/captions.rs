//! Phrase captions from speech turns. Voice Transcribe gives turn timings only (no word
//! timestamps), so each turn is cut into phrases of 3–5 words and its time is spread over the
//! words by their length. Times stay in SOURCE clip seconds, so a shot that is moved or trimmed in
//! the editor keeps its captions without asking the server.

use serde::{Deserialize, Serialize};

use crate::domain::segmenting::Span;

/// Most words in one phrase.
pub const PHRASE_MAX_WORDS: usize = 5;

/// One word of a phrase and when it is estimated to be said, source seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CaptionWord {
    /// The word as written.
    pub text: String,
    /// Estimated start, source seconds.
    pub at_s: f64,
}

/// One phrase on screen from `start_s` to `end_s`, source seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Caption {
    /// Shown from, source seconds.
    pub start_s: f64,
    /// Shown until, source seconds (after `start_s`).
    pub end_s: f64,
    /// The phrase.
    pub text: String,
    /// Its words with estimated times, for active-word emphasis.
    pub words: Vec<CaptionWord>,
}

/// One speech turn: its span and words.
#[derive(Debug, Clone, PartialEq)]
pub struct SpokenTurn {
    /// Span, source seconds.
    pub span: Span,
    /// What was said.
    pub text: String,
}

fn ms(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

/// Sizes of `n` words split into the fewest phrases of at most [`PHRASE_MAX_WORDS`], as even as
/// possible (7 words → 4 + 3), so every phrase has 3–5 words when the turn has 3 or more.
fn group_sizes(n: usize) -> Vec<usize> {
    if n == 0 {
        return Vec::new();
    }
    let groups = n.div_ceil(PHRASE_MAX_WORDS);
    (0..groups)
        .map(|g| n / groups + usize::from(g < n % groups))
        .collect()
}

/// The phrases of one turn. Each word gets a share of the turn proportional to its length plus
/// one (the space after it); a phrase lasts until the next phrase starts, the last until the turn
/// ends. Turns without words or time give nothing.
pub fn phrases(turn: &SpokenTurn) -> Vec<Caption> {
    let words: Vec<&str> = turn.text.split_whitespace().collect();
    let (start, len) = (turn.span.start_s, turn.span.len());
    if words.is_empty() || !len.is_finite() || len <= 0.0 {
        return Vec::new();
    }
    let weight = |w: &str| w.chars().count() as f64 + 1.0;
    let total: f64 = words.iter().map(|w| weight(w)).sum();
    let mut at = Vec::with_capacity(words.len());
    let mut done = 0.0;
    for w in &words {
        at.push(ms(start + len * done / total));
        done += weight(w);
    }
    let mut out: Vec<Caption> = Vec::new();
    let mut first = 0;
    for size in group_sizes(words.len()) {
        let last = first + size;
        let end_s = at.get(last).copied().unwrap_or(ms(turn.span.end_s));
        let caption = Caption {
            start_s: at[first],
            end_s,
            text: words[first..last].join(" "),
            words: (first..last)
                .map(|i| CaptionWord {
                    text: words[i].to_owned(),
                    at_s: at[i],
                })
                .collect(),
        };
        if caption.end_s > caption.start_s {
            out.push(caption);
        }
        first = last;
    }
    out
}

/// Captions for one segment: the phrases of every turn that overlaps `segment`, in time order.
/// Whole turns are kept (not cut at the segment edge) so a trim inside the editor still shows the
/// phrase that was being said.
pub fn segment_captions(segment: Span, turns: &[SpokenTurn]) -> Vec<Caption> {
    let mut hits: Vec<&SpokenTurn> = turns
        .iter()
        .filter(|t| t.span.overlap(segment) > 0.0)
        .collect();
    hits.sort_by(|a, b| a.span.start_s.total_cmp(&b.span.start_s));
    hits.into_iter().flat_map(phrases).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(start_s: f64, end_s: f64, text: &str) -> SpokenTurn {
        SpokenTurn {
            span: Span { start_s, end_s },
            text: text.into(),
        }
    }

    fn texts(c: &[Caption]) -> Vec<&str> {
        c.iter().map(|p| p.text.as_str()).collect()
    }

    #[test]
    fn phrases_hold_three_to_five_words_split_as_evenly_as_possible() {
        assert_eq!(group_sizes(3), [3]);
        assert_eq!(group_sizes(5), [5]);
        assert_eq!(group_sizes(6), [3, 3]);
        assert_eq!(group_sizes(7), [4, 3]);
        assert_eq!(group_sizes(11), [4, 4, 3]);
        let c = phrases(&turn(0.0, 7.0, "one two three four five six seven"));
        assert_eq!(texts(&c), ["one two three four", "five six seven"]);
    }

    #[test]
    fn time_is_spread_over_words_by_length_and_phrases_meet_end_to_start() {
        // weights: "ab"=3, "c"=2, "defg"=5 → total 10 over 10 s
        let c = phrases(&turn(20.0, 30.0, "ab c defg"));
        assert_eq!(c.len(), 1);
        let at: Vec<f64> = c[0].words.iter().map(|w| w.at_s).collect();
        assert_eq!(at, [20.0, 23.0, 25.0]);
        assert_eq!((c[0].start_s, c[0].end_s), (20.0, 30.0));
        let two = phrases(&turn(0.0, 6.0, "aa bb cc dd ee ff"));
        assert_eq!(
            (two[0].end_s, two[1].start_s, two[1].end_s),
            (3.0, 3.0, 6.0)
        );
        assert!(
            two[1].words[0].at_s >= two[0].words[2].at_s,
            "emphasis moves forward"
        );
    }

    #[test]
    fn empty_or_timeless_turns_give_no_captions() {
        assert!(phrases(&turn(1.0, 2.0, "   ")).is_empty());
        assert!(phrases(&turn(2.0, 2.0, "said nothing in time")).is_empty());
        assert!(
            segment_captions(
                Span {
                    start_s: 0.0,
                    end_s: 5.0
                },
                &[]
            )
            .is_empty()
        );
    }

    #[test]
    fn a_segment_keeps_whole_turns_that_overlap_it_in_time_order() {
        let turns = [
            turn(9.0, 12.0, "after the segment ends"),
            turn(3.0, 6.0, "starts before and runs in"),
            turn(0.0, 2.0, "too early to show"),
            turn(5.0, 7.0, "inside it"),
        ];
        let c = segment_captions(
            Span {
                start_s: 4.0,
                end_s: 9.0,
            },
            &turns,
        );
        assert_eq!(texts(&c), ["starts before and runs in", "inside it"]);
        assert_eq!(
            c[0].start_s, 3.0,
            "source seconds, not cut at the segment edge"
        );
    }
}
