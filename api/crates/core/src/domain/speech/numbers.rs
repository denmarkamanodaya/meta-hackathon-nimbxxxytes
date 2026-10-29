//! Numbers as Australian English words: "one hundred and forty-two", years as "twenty twenty-six",
//! ordinals, digits one by one, and the letter names used to spell a code.

const ONES: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];

const TENS: [&str; 10] = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

/// Largest number said as a whole; longer ones are read digit by digit.
pub const MAX_CARDINAL: u64 = 999_999_999_999;

fn idx(n: u64) -> usize {
    usize::try_from(n).unwrap_or(0)
}

fn under_100(n: u64) -> String {
    if n < 20 {
        return ONES[idx(n)].to_owned();
    }
    let tens = TENS[idx(n / 10 % 10)];
    match n % 10 {
        0 => tens.to_owned(),
        one => format!("{tens}-{}", ONES[idx(one)]),
    }
}

fn under_1000(n: u64) -> String {
    let (hundreds, rest) = (n / 100 % 10, n % 100);
    match (hundreds, rest) {
        (0, r) => under_100(r),
        (h, 0) => format!("{} hundred", ONES[idx(h)]),
        (h, r) => format!("{} hundred and {}", ONES[idx(h)], under_100(r)),
    }
}

/// `n` in words with "and" before the last part under a hundred ("one thousand and five").
/// Above [`MAX_CARDINAL`] the digits are read one by one.
pub fn cardinal(n: u64) -> String {
    if n == 0 {
        return "zero".to_owned();
    }
    if n > MAX_CARDINAL {
        return digits(&n.to_string());
    }
    let mut parts = Vec::new();
    for (scale, name) in [
        (1_000_000_000, "billion"),
        (1_000_000, "million"),
        (1_000, "thousand"),
    ] {
        let group = n / scale % 1000;
        if group > 0 {
            parts.push(format!("{} {name}", under_1000(group)));
        }
    }
    match n % 1000 {
        0 => {}
        last if last < 100 && !parts.is_empty() => parts.push(format!("and {}", under_100(last))),
        last => parts.push(under_1000(last)),
    }
    parts.join(" ")
}

/// The ordinal of `n`: "first", "twenty-second", "one hundredth".
pub fn ordinal(n: u64) -> String {
    let words = cardinal(n);
    let split = words.rfind([' ', '-']).map_or(0, |i| i + 1);
    let (head, last) = words.split_at(split);
    let last = match last {
        "one" => "first".to_owned(),
        "two" => "second".to_owned(),
        "three" => "third".to_owned(),
        "five" => "fifth".to_owned(),
        "eight" => "eighth".to_owned(),
        "nine" => "ninth".to_owned(),
        "twelve" => "twelfth".to_owned(),
        w if w.ends_with('y') => format!("{}ieth", &w[..w.len() - 1]),
        w => format!("{w}th"),
    };
    format!("{head}{last}")
}

/// A year: "twenty twenty-six", "nineteen oh five", "two thousand and nine", "nineteen hundred".
pub fn year(n: u64) -> String {
    let (high, low) = (n / 100, n % 100);
    if (2000..2010).contains(&n) || n.is_multiple_of(1000) {
        return cardinal(n);
    }
    match low {
        0 => format!("{} hundred", under_100(high)),
        1..=9 => format!("{} oh {}", under_100(high), ONES[idx(low)]),
        _ => format!("{} {}", under_100(high), under_100(low)),
    }
}

/// Every ASCII digit of `s` as a word, separated by spaces; other characters are skipped.
pub fn digits(s: &str) -> String {
    s.chars()
        .filter_map(|c| c.to_digit(10))
        .map(|d| ONES[idx(u64::from(d))])
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whole digits `s` (no sign, no separators) in words: a leading zero or a run too long for
/// [`cardinal`] is read digit by digit.
pub fn whole(s: &str) -> Option<String> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if s.len() > 1 && s.starts_with('0') {
        return Some(digits(s));
    }
    Some(match s.parse::<u64>() {
        Ok(n) if n <= MAX_CARDINAL => cardinal(n),
        _ => digits(s),
    })
}

/// The integer part of a number written with optional thousands commas ("1,222"): its digits
/// without the commas, or `None` when a comma is out of place.
pub fn strip_commas(s: &str) -> Option<String> {
    let groups: Vec<&str> = s.split(',').collect();
    let first_ok = groups
        .first()
        .is_some_and(|g| (1..=3).contains(&g.len()) || groups.len() == 1);
    let rest_ok = groups.iter().skip(1).all(|g| g.len() == 3);
    let all_digits = groups.iter().all(|g| g.bytes().all(|b| b.is_ascii_digit()));
    (first_ok && rest_ok && all_digits && !s.is_empty()).then(|| groups.concat())
}

/// A number written as `1,222`, `38`, `2.5` or `-4` in words ("minus four", "two point five").
pub fn number(s: &str) -> Option<String> {
    let (sign, s) = match s.strip_prefix(['-', '−']) {
        Some(rest) => ("minus ", rest),
        None => ("", s),
    };
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (s, None),
    };
    let int = strip_commas(int)?;
    let int_words = if int.contains(',') || s.contains(',') {
        cardinal(int.parse().ok()?)
    } else {
        whole(&int)?
    };
    let frac_words = match frac {
        None => String::new(),
        Some(f) if !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()) => {
            format!(" point {}", digits(f))
        }
        Some(_) => return None,
    };
    Some(format!("{sign}{int_words}{frac_words}"))
}

/// The value of a whole number written with optional commas, for singular units and dates.
pub fn value(s: &str) -> Option<u64> {
    strip_commas(s)?.parse().ok()
}

/// The name of a letter as it is spoken when spelling ("ay", "bee", "zed").
pub fn letter(c: char) -> Option<&'static str> {
    const NAMES: [&str; 26] = [
        "ay",
        "bee",
        "see",
        "dee",
        "ee",
        "ef",
        "gee",
        "aitch",
        "eye",
        "jay",
        "kay",
        "el",
        "em",
        "en",
        "oh",
        "pee",
        "cue",
        "ar",
        "ess",
        "tee",
        "you",
        "vee",
        "double-you",
        "ex",
        "why",
        "zed",
    ];
    let c = c.to_ascii_lowercase();
    c.is_ascii_lowercase()
        .then(|| NAMES[usize::from(c as u8 - b'a')])
}

/// `s` spelled: letters by name, digits as words, anything else skipped.
pub fn spell(s: &str) -> String {
    s.chars()
        .filter_map(|c| {
            letter(c)
                .map(str::to_owned)
                .or_else(|| c.to_digit(10).map(|d| ONES[idx(u64::from(d))].to_owned()))
        })
        .collect::<Vec<_>>()
        .join(" ")
}
