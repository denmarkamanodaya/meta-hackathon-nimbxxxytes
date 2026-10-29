//! Written text turned into words the voice can say. The MMS-TTS English voice knows only the
//! letters a to z, space, apostrophe, hyphen and a few digits; any other character is dropped
//! before it speaks, so "$142.60" or "1300 555 019" came out as gibberish. [`speakable`] writes
//! every number, amount, date, time, phone number, unit, abbreviation, address and symbol out in
//! Australian English words, and cuts the text into clauses (at `,` `;` `:` and between the
//! printed groups of a phone number) and sentences, each with the pause that comes before it.

mod lex;
mod numbers;
mod words;

use lex::{Brk, Tok, lex};
use numbers::{cardinal, digits, ordinal, year};
use words::{ordinal_word, say, unit};

/// Pause before a clause inside a sentence, milliseconds.
pub const CLAUSE_PAUSE_MS: u32 = 150;
/// Pause before a new sentence, milliseconds.
pub const SENTENCE_PAUSE_MS: u32 = 250;

/// One stretch the voice says in one breath.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Clause {
    /// Lower-case words: only `a`-`z`, space, apostrophe and hyphen.
    pub text: String,
    /// Silence before it: 0 for the first, [`CLAUSE_PAUSE_MS`] or [`SENTENCE_PAUSE_MS`].
    pub pause_ms: u32,
}

/// What the words of the text become: spoken words or a break.
enum Piece {
    Words(String),
    Brk(Brk),
}

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];

fn month(w: &str) -> Option<&'static str> {
    let lower = w.to_lowercase();
    let lower = if lower == "sept" {
        "sep".to_owned()
    } else {
        lower
    };
    MONTHS
        .iter()
        .copied()
        .find(|m| *m == lower || (lower.len() == 3 && *m != "may" && m.starts_with(lower.as_str())))
}

fn capital(w: &str) -> bool {
    w.chars().next().is_some_and(char::is_uppercase)
}

fn day(w: &str) -> Option<u64> {
    let n = if w.len() <= 2 && w.bytes().all(|b| b.is_ascii_digit()) {
        w.parse().ok()
    } else {
        ordinal_word(w)
    }?;
    (1..=31).contains(&n).then_some(n)
}

fn year_of(w: &str) -> Option<u64> {
    let n: u64 = (w.len() == 4).then(|| w.parse().ok()).flatten()?;
    (1000..=2999).contains(&n).then_some(n)
}

fn word_at(toks: &[Tok], i: usize) -> Option<&str> {
    toks.get(i).map(|t| t.word.as_str())
}

fn runs_on(toks: &[Tok], i: usize) -> bool {
    toks.get(i).is_some_and(|t| t.brk == Brk::None)
}

/// "the fourteenth of november" plus ", two thousand and twenty-six" when a year follows.
fn dated(head: String, year_word: Option<u64>) -> Vec<Piece> {
    let mut out = vec![Piece::Words(head)];
    if let Some(y) = year_word {
        out.extend([Piece::Brk(Brk::Clause), Piece::Words(year(y))]);
    }
    out
}

/// `14 November 2026`, `30 Nov`, `November 14, 2026`, `Nov 2026`, `14/11/2026`.
fn date(toks: &[Tok], i: usize) -> Option<(usize, Vec<Piece>)> {
    let w = word_at(toks, i)?;
    let next = word_at(toks, i + 1);
    if let (Some(d), Some(m), true) = (day(w), next.and_then(month), runs_on(toks, i)) {
        let y = runs_on(toks, i + 1)
            .then(|| word_at(toks, i + 2).and_then(year_of))
            .flatten();
        let head = format!("the {} of {m}", ordinal(d));
        return Some((2 + usize::from(y.is_some()), dated(head, y)));
    }
    let m = month(w).filter(|_| capital(w) && runs_on(toks, i))?;
    if let Some(d) = next.and_then(day) {
        let after_day = toks.get(i + 1).map(|t| t.brk);
        let y = matches!(after_day, Some(Brk::None | Brk::Clause))
            .then(|| word_at(toks, i + 2).and_then(year_of))
            .flatten();
        let head = format!("{m} the {}", ordinal(d));
        return Some((2 + usize::from(y.is_some()), dated(head, y)));
    }
    let y = next.and_then(year_of)?;
    Some((2, vec![Piece::Words(format!("{m} {}", year(y)))]))
}

/// `14/11/2026`, `14.11.26`, `14-11-2026`, day first.
fn numeric_date(w: &str) -> Option<String> {
    let parts: Vec<&str> = w.split(['/', '.', '-']).collect();
    let [d, m, y] = parts.as_slice() else {
        return None;
    };
    let (d, m) = (day(d)?, m.parse::<usize>().ok()?);
    let month = MONTHS.get(m.checked_sub(1)?)?;
    let y = match y.len() {
        2 => 2000 + y.parse::<u64>().ok()?,
        4 => year_of(y)?,
        _ => return None,
    };
    Some(format!("the {} of {month}, {}", ordinal(d), year(y)))
}

fn meridiem(w: &str) -> Option<&'static str> {
    match w.to_lowercase().as_str() {
        "am" | "a.m" => Some("ay em"),
        "pm" | "p.m" => Some("pee em"),
        _ => None,
    }
}

/// `9:30`, `9:30am`, `9am`: hour, minutes and an attached am or pm.
fn clock(w: &str) -> Option<(u64, u64, Option<&'static str>)> {
    let split = w.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(w.len());
    let (time, suffix) = w.split_at(split);
    let suffix = if suffix.is_empty() {
        None
    } else {
        Some(meridiem(suffix)?)
    };
    let (h, m) = match time.split_once(':') {
        Some((h, m)) if m.len() == 2 => (h.parse().ok()?, m.parse().ok()?),
        Some(_) => return None,
        None => (time.parse().ok()?, 0),
    };
    (h <= 23 && m <= 59 && (time.len() <= 2 || time.contains(':'))).then_some((h, m, suffix))
}

fn time_words(h: u64, m: u64, suffix: Option<&'static str>) -> String {
    let (h, suffix) = match (h, suffix) {
        (0, None) => (12, Some("ay em")),
        (13..=23, None) => (h - 12, Some("pee em")),
        (h, s) => (h, s),
    };
    let minutes = match m {
        0 => String::new(),
        1..=9 => format!(" oh {}", cardinal(m)),
        m => format!(" {}", cardinal(m)),
    };
    let suffix = suffix.map(|s| format!(" {s}")).unwrap_or_default();
    format!("{}{minutes}{suffix}", cardinal(h))
}

/// A time, with am or pm attached or as the next word. A bare hour needs am or pm.
fn time(toks: &[Tok], i: usize) -> Option<(usize, Vec<Piece>)> {
    let w = word_at(toks, i)?;
    let (h, m, attached) = clock(w)?;
    let next = runs_on(toks, i)
        .then(|| word_at(toks, i + 1).and_then(meridiem))
        .flatten()
        .filter(|_| attached.is_none());
    if (attached.or(next).is_none() && !w.contains(':')) || (attached.or(next).is_some() && h > 12)
    {
        return None;
    }
    let used = 1 + usize::from(next.is_some());
    Some((
        used,
        vec![Piece::Words(time_words(h, m, attached.or(next)))],
    ))
}

fn phone_groups(w: &str) -> Option<Vec<&str>> {
    let groups: Vec<&str> = w.split('-').collect();
    let ok = groups.iter().enumerate().all(|(n, g)| {
        let g = if n == 0 {
            g.strip_prefix('+').unwrap_or(g)
        } else {
            g
        };
        !g.is_empty() && g.bytes().all(|b| b.is_ascii_digit())
    });
    ok.then_some(groups)
}

/// Phone, account and reference numbers: a run of digit groups with six or more digits, or one
/// starting with `+`, read digit by digit with a short pause between the printed groups.
fn phone(toks: &[Tok], i: usize) -> Option<(usize, Vec<Piece>)> {
    let mut groups = Vec::new();
    let mut used = 0;
    while let Some(g) = word_at(toks, i + used).and_then(phone_groups) {
        groups.extend(g);
        used += 1;
        if !runs_on(toks, i + used - 1) || used == 6 {
            break;
        }
    }
    let total: usize = groups.iter().map(|g| digits(g).split(' ').count()).sum();
    let plus = groups.first().is_some_and(|g| g.starts_with('+'));
    if used == 0 || (total < 6 && !plus) {
        return None;
    }
    let mut out = Vec::new();
    for (n, g) in groups.iter().enumerate() {
        if n > 0 {
            out.push(Piece::Brk(Brk::Clause));
        }
        let lead = if g.starts_with('+') { "plus " } else { "" };
        out.push(Piece::Words(format!("{lead}{}", digits(g))));
    }
    Some((used, out))
}

/// A number and the unit written after it: `50 kL`, `1 kg`.
fn measured(toks: &[Tok], i: usize) -> Option<(usize, Vec<Piece>)> {
    let w = word_at(toks, i)?;
    let n = numbers::number(w)?;
    let unit_word = word_at(toks, i + 1).filter(|_| runs_on(toks, i))?;
    let amount = w.replace(',', "").parse::<f64>().ok();
    let said = unit(unit_word, amount)?;
    Some((2, vec![Piece::Words(format!("{n} {said}"))]))
}

/// Short weekday names; "Sat" and "Sun" are also words, so they count only inside a range.
const WEEKDAYS: [(&str, &str); 10] = [
    ("Mon", "monday"),
    ("Tue", "tuesday"),
    ("Tues", "tuesday"),
    ("Wed", "wednesday"),
    ("Thu", "thursday"),
    ("Thur", "thursday"),
    ("Thurs", "thursday"),
    ("Fri", "friday"),
    ("Sat", "saturday"),
    ("Sun", "sunday"),
];

fn weekday(w: &str) -> Option<&'static str> {
    WEEKDAYS.iter().find(|(k, _)| *k == w).map(|(_, v)| *v)
}

/// One end of a range: a time, or any word with a digit.
fn range_end(w: &str) -> Option<String> {
    if let Some((h, m, s)) = clock(w).filter(|(_, _, s)| s.is_some()) {
        return Some(time_words(h, m, s));
    }
    w.bytes()
        .any(|b| b.is_ascii_digit())
        .then(|| say(w, None, false))
}

/// `5th-6th`, `8am-6pm`, `Mon-Fri`: both ends with "to" between.
fn range(w: &str) -> Option<String> {
    let (a, b) = w.split_once(['-', '–'])?;
    if a.is_empty() || b.is_empty() || b.contains(['-', '–']) {
        return None;
    }
    if let (Some(a), Some(b)) = (weekday(a), weekday(b)) {
        return Some(format!("{a} to {b}"));
    }
    Some(format!("{} to {}", range_end(a)?, range_end(b)?))
}

fn one_word(toks: &[Tok], i: usize) -> Vec<Piece> {
    let Some(t) = toks.get(i) else {
        return Vec::new();
    };
    let next = runs_on(toks, i).then(|| word_at(toks, i + 1)).flatten();
    let lone_weekday = weekday(&t.word).filter(|_| !matches!(t.word.as_str(), "Sat" | "Sun"));
    let said = numeric_date(&t.word)
        .or_else(|| range(&t.word))
        .or_else(|| lone_weekday.map(str::to_owned))
        .unwrap_or_else(|| say(&t.word, next, t.dot));
    let mut out = Vec::new();
    for (n, part) in said.split(',').enumerate() {
        if n > 0 {
            out.push(Piece::Brk(Brk::Clause));
        }
        out.push(Piece::Words(part.to_owned()));
    }
    out
}

/// Only `a`-`z`, apostrophes and hyphens inside words, single spaces.
fn clean(words: &str) -> String {
    words
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c == '\'' || c == '-' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(|w| w.trim_matches(['-', '\'']))
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn clauses(pieces: Vec<Piece>) -> Vec<Clause> {
    let mut out: Vec<Clause> = Vec::new();
    let (mut current, mut pending) = (String::new(), Brk::None);
    let close = |current: &mut String, pending: Brk, out: &mut Vec<Clause>| {
        let text = clean(current);
        current.clear();
        if text.is_empty() {
            return false;
        }
        let pause_ms = match (out.is_empty(), pending) {
            (true, _) => 0,
            (false, Brk::Sentence) => SENTENCE_PAUSE_MS,
            (false, _) => CLAUSE_PAUSE_MS,
        };
        out.push(Clause { text, pause_ms });
        true
    };
    for piece in pieces {
        match piece {
            Piece::Words(w) => {
                current.push(' ');
                current.push_str(&w);
            }
            Piece::Brk(Brk::None) => {}
            Piece::Brk(b) => {
                if close(&mut current, pending, &mut out) {
                    pending = b;
                } else {
                    pending = pending.max(b);
                }
            }
        }
    }
    close(&mut current, pending, &mut out);
    out
}

/// `text` as clauses of plain lower-case words, each with the pause before it. Empty when
/// nothing in it can be said.
pub fn speakable(text: &str) -> Vec<Clause> {
    let toks = lex(text);
    let mut pieces = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let matched = phone(&toks, i)
            .or_else(|| date(&toks, i))
            .or_else(|| time(&toks, i))
            .or_else(|| measured(&toks, i));
        let (used, said) = matched.unwrap_or_else(|| (1, one_word(&toks, i)));
        pieces.extend(said);
        if let Some(last) = toks.get(i + used - 1) {
            pieces.push(Piece::Brk(last.brk));
        }
        i += used;
    }
    clauses(pieces)
}

/// The clauses on one line, `, ` before a clause and `. ` before a sentence: for logs and tests.
pub fn spoken_line(clauses: &[Clause]) -> String {
    let mut line = String::new();
    for c in clauses {
        line.push_str(match c.pause_ms {
            0 => "",
            SENTENCE_PAUSE_MS => ". ",
            _ => ", ",
        });
        line.push_str(&c.text);
    }
    line
}

#[cfg(test)]
mod tests;
