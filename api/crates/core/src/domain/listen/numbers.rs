//! The number check under the checker: every number said in a line must survive translation.
//! Numbers are read as Arabic digits (full width too) and as CJK numerals (〇零一二三四五六七八九
//! 十百千万 and 两); a translation may also write them as English number words or ordinals
//! ("ten", "third"). A lone 一 or 〇 in the original is not counted: in 一下, 一起 or 一緒 it is
//! part of a word, not a number, and a translation rightly drops it.

/// Characters of a CJK numeral.
fn cjk_digit(c: char) -> Option<u64> {
    match c {
        '〇' | '零' => Some(0),
        '一' => Some(1),
        '二' | '两' | '兩' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn cjk_unit(c: char) -> Option<u64> {
    match c {
        '十' => Some(10),
        '百' => Some(100),
        '千' => Some(1_000),
        '万' | '萬' => Some(10_000),
        _ => None,
    }
}

fn is_cjk_numeral(c: char) -> bool {
    cjk_digit(c).is_some() || cjk_unit(c).is_some()
}

/// The value of a run of CJK numerals: digit by digit without units (二〇二六 is 2026), else by
/// units (二十三 is 23, 一百零五 is 105, 两万五千 is 25000, 十 is 10).
fn cjk_value(run: &[char]) -> u64 {
    if run.iter().all(|c| cjk_unit(*c).is_none()) {
        return run
            .iter()
            .filter_map(|c| cjk_digit(*c))
            .fold(0, |acc, d| acc.saturating_mul(10).saturating_add(d));
    }
    let (mut total, mut section, mut digit) = (0u64, 0u64, None::<u64>);
    for &c in run {
        if let Some(d) = cjk_digit(c) {
            digit = Some(d);
        } else if let Some(unit) = cjk_unit(c) {
            if unit == 10_000 {
                total =
                    total.saturating_add(section.saturating_add(digit.unwrap_or(0)).max(1) * unit);
                section = 0;
            } else {
                section = section.saturating_add(digit.unwrap_or(1) * unit);
            }
            digit = None;
        }
    }
    total
        .saturating_add(section)
        .saturating_add(digit.unwrap_or(0))
}

/// A full-width digit as its ASCII digit.
fn ascii_digit(c: char) -> Option<u64> {
    match c {
        '0'..='9' => Some(u64::from(c) - u64::from('0')),
        '０'..='９' => Some(u64::from(c) - u64::from('０')),
        _ => None,
    }
}

/// Every Arabic and CJK number in `text`, with whether it was written in CJK numerals. A comma
/// between digits is a thousands separator (`1,000` is 1000).
fn numbers(text: &str) -> Vec<(u64, bool)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if ascii_digit(chars[i]).is_some() {
            let mut value = 0u64;
            while i < chars.len() {
                if let Some(d) = ascii_digit(chars[i]) {
                    value = value.saturating_mul(10).saturating_add(d);
                } else if !(chars[i] == ','
                    && chars.get(i + 1).and_then(|c| ascii_digit(*c)).is_some())
                {
                    break;
                }
                i += 1;
            }
            out.push((value, false));
        } else if is_cjk_numeral(chars[i]) {
            let start = i;
            while i < chars.len() && is_cjk_numeral(chars[i]) {
                i += 1;
            }
            out.push((cjk_value(&chars[start..i]), true));
        } else {
            i += 1;
        }
    }
    out
}

/// The numbers of an original line that its translation must keep (see the module docs).
pub fn original_numbers(text: &str) -> Vec<u64> {
    let mut out: Vec<u64> = numbers(text)
        .into_iter()
        .filter(|&(n, cjk)| !cjk || n >= 2)
        .map(|(n, _)| n)
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// English number words, by value.
const SMALL: [&str; 20] = [
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
/// English ordinals, by value.
const ORDINAL: [&str; 20] = [
    "zeroth",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
];
/// English tens from twenty, by value / 10 - 2.
const TENS: [&str; 8] = [
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
/// English tens ordinals from twentieth.
const TENTHS: [&str; 8] = [
    "twentieth",
    "thirtieth",
    "fortieth",
    "fiftieth",
    "sixtieth",
    "seventieth",
    "eightieth",
    "ninetieth",
];

/// The value of one English number word, and whether it scales what comes before it.
fn word_value(word: &str) -> Option<(u64, bool)> {
    let pos = |list: &[&str]| list.iter().position(|w| *w == word);
    if let Some(n) = pos(&SMALL).or_else(|| pos(&ORDINAL)) {
        return u64::try_from(n).ok().map(|n| (n, false));
    }
    if let Some(n) = pos(&TENS).or_else(|| pos(&TENTHS)) {
        return u64::try_from(n + 2).ok().map(|n| (n * 10, false));
    }
    match word {
        "hundred" | "hundredth" => Some((100, true)),
        "thousand" | "thousandth" => Some((1_000, true)),
        "million" | "millionth" => Some((1_000_000, true)),
        _ => None,
    }
}

/// Every number written in words in an English text: runs like "twenty-three", "two hundred"
/// and "third" each give one value.
fn word_numbers(text: &str) -> Vec<u64> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    let (mut total, mut current, mut in_run) = (0u64, 0u64, false);
    let mut close = |total: &mut u64, current: &mut u64, in_run: &mut bool| {
        if *in_run {
            out.push(total.saturating_add(*current));
        }
        (*total, *current, *in_run) = (0, 0, false);
    };
    for word in lower.split(|c: char| !c.is_ascii_alphabetic()) {
        match word_value(word) {
            Some((scale, true)) => {
                let base = if in_run { current.max(1) } else { 1 };
                if scale >= 1_000 {
                    total = total.saturating_add(base.saturating_mul(scale));
                    current = 0;
                } else {
                    current = base.saturating_mul(scale);
                }
                in_run = true;
            }
            Some((n, false)) => {
                current = current.saturating_add(n);
                in_run = true;
            }
            None if word == "and" && in_run => {}
            None if word.is_empty() => {}
            None => close(&mut total, &mut current, &mut in_run),
        }
    }
    close(&mut total, &mut current, &mut in_run);
    out
}

/// Every number a translation shows: digits, CJK numerals and English number words.
pub fn translation_numbers(text: &str) -> Vec<u64> {
    let mut out: Vec<u64> = numbers(text).into_iter().map(|(n, _)| n).collect();
    out.extend(word_numbers(text));
    out.sort_unstable();
    out.dedup();
    out
}

/// Whether every number of `original` (see [`original_numbers`]) appears in `translation`.
pub fn numbers_kept(original: &str, translation: &str) -> bool {
    let shown = translation_numbers(translation);
    original_numbers(original)
        .iter()
        .all(|n| shown.binary_search(n).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cjk_numerals_read_by_units_or_digit_by_digit() {
        assert_eq!(original_numbers("午前十時"), [10]);
        assert_eq!(original_numbers("二十三人"), [23]);
        assert_eq!(original_numbers("一百零五元"), [105]);
        assert_eq!(original_numbers("两万五千"), [25_000]);
        assert_eq!(original_numbers("二〇二六年"), [2026]);
        assert_eq!(original_numbers("三階の会議室"), [3]);
        assert_eq!(original_numbers("十五号"), [15]);
        assert_eq!(original_numbers("两个"), [2]);
        assert_eq!(original_numbers("三千"), [3_000]);
    }

    #[test]
    fn a_lone_one_is_a_word_but_arabic_digits_always_count() {
        assert!(original_numbers("我想确认一下时间").is_empty());
        assert!(original_numbers("一緒に行きましょう").is_empty());
        assert_eq!(original_numbers("1 個と 0 点"), [0, 1]);
        assert_eq!(
            original_numbers("costs 1,000 yen at 10:30"),
            [10, 30, 1_000]
        );
        assert_eq!(original_numbers("２０２６年"), [2026]);
    }

    #[test]
    fn translations_may_write_numbers_as_words_or_ordinals() {
        assert_eq!(translation_numbers("the third floor at ten"), [3, 10]);
        assert_eq!(translation_numbers("twenty-three people"), [23]);
        assert_eq!(translation_numbers("two hundred and five"), [205]);
        assert_eq!(translation_numbers("three thousand five hundred"), [3_500]);
        assert_eq!(translation_numbers("his sixtieth birthday"), [60]);
        assert_eq!(translation_numbers("会议在十点"), [10]);
        assert!(translation_numbers("someone, anyone, often").is_empty());
    }

    #[test]
    fn a_missing_number_is_caught_and_a_kept_one_passes() {
        let original = "明日の会議は午前十時からです。場所は三階の会議室です。";
        assert!(numbers_kept(
            original,
            "Tomorrow's meeting is from 10 AM. The location is the conference room on the third floor."
        ));
        assert!(!numbers_kept(
            original,
            "Tomorrow's meeting is from 11 AM. The location is the conference room on the second floor."
        ));
        assert!(numbers_kept(
            "我想确认一下时间。",
            "I want to confirm the time."
        ));
        assert!(numbers_kept("no numbers here", "aucun nombre"));
    }
}
