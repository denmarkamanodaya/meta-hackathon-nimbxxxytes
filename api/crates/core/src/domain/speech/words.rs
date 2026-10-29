//! One written word (with a peek at the next) turned into spoken words: money, percentages,
//! ordinals, numbers and years, units, abbreviations, web and email addresses, codes, symbols.

use super::numbers::{cardinal, number, ordinal, spell, value, whole, year};

/// Units said after a number: written form (case matters), singular, plural.
const UNITS: &[(&str, &str, &str)] = &[
    ("kL", "kilolitre", "kilolitres"),
    ("L", "litre", "litres"),
    ("l", "litre", "litres"),
    ("mL", "millilitre", "millilitres"),
    ("ml", "millilitre", "millilitres"),
    ("kWh", "kilowatt hour", "kilowatt hours"),
    ("kW", "kilowatt", "kilowatts"),
    ("W", "watt", "watts"),
    ("MJ", "megajoule", "megajoules"),
    ("km/h", "kilometre per hour", "kilometres per hour"),
    ("km", "kilometre", "kilometres"),
    ("m", "metre", "metres"),
    ("cm", "centimetre", "centimetres"),
    ("mm", "millimetre", "millimetres"),
    ("kg", "kilogram", "kilograms"),
    ("g", "gram", "grams"),
    ("mg", "milligram", "milligrams"),
    ("hr", "hour", "hours"),
    ("hrs", "hour", "hours"),
    ("min", "minute", "minutes"),
    ("mins", "minute", "minutes"),
    ("c", "cent", "cents"),
];

/// Short forms said in full (matched without case).
const ABBREVIATIONS: &[(&str, &str)] = &[
    ("rd", "road"),
    ("ave", "avenue"),
    ("mr", "mister"),
    ("mrs", "missus"),
    ("ms", "miz"),
    ("dr", "doctor"),
    ("ref", "reference"),
    ("acct", "account"),
    ("gst", "gee ess tee"),
    ("bpay", "bee pay"),
    ("abn", "ay bee en"),
    ("acn", "ay see en"),
    ("atm", "ay tee em"),
    ("ato", "ay tee oh"),
    ("eft", "ee ef tee"),
    ("id", "eye dee"),
    ("url", "you ar el"),
    ("pty", "proprietary"),
    ("ltd", "limited"),
    ("approx", "approximately"),
    ("incl", "including"),
    ("excl", "excluding"),
    ("qty", "quantity"),
    ("tel", "phone"),
    ("ph", "phone"),
    ("vs", "versus"),
    ("etc", "et cetera"),
    ("e.g", "for example"),
    ("i.e", "that is"),
    ("and/or", "and or"),
    ("a.m", "ay em"),
    ("p.m", "pee em"),
];

/// Top-level domains that mark a word as a web address.
const TLDS: &[&str] = &[
    "com", "au", "org", "net", "gov", "edu", "io", "app", "dev", "co", "info", "nz", "uk",
    "example",
];

/// Words split off the end of a run-together domain name ("sunvalewater" is "sunvale water").
const DOMAIN_WORDS: &[&str] = &[
    "water",
    "energy",
    "power",
    "gas",
    "council",
    "bank",
    "health",
    "care",
    "group",
    "online",
    "services",
    "insurance",
    "mobile",
    "help",
    "support",
    "pay",
    "mail",
];

/// The spoken form of a unit after a number of `value` (`None` when `w` is not a unit).
pub fn unit(w: &str, value: Option<f64>) -> Option<&'static str> {
    let (_, one, many) = UNITS.iter().find(|(written, _, _)| *written == w)?;
    Some(if value == Some(1.0) { one } else { many })
}

fn numeric_value(s: &str) -> Option<f64> {
    s.replace(',', "").parse().ok()
}

/// A number followed by a unit, written together ("450kWh", "2.5L", "50c").
fn number_with_unit(w: &str) -> Option<String> {
    let split = w.find(|c: char| c.is_ascii_alphabetic())?;
    let (num, rest) = w.split_at(split);
    let said = unit(rest, numeric_value(num))?;
    Some(format!("{} {said}", number(num)?))
}

/// `$142.60`, `$1,860.00`, `-$5`: dollars and cents.
pub fn money(w: &str) -> Option<String> {
    let (sign, w) = match w.strip_prefix(['-', '−']) {
        Some(rest) => ("minus ", rest),
        None => ("", w),
    };
    let amount = w.strip_prefix('$').filter(|a| !a.is_empty())?;
    let (dollars, cents) = match amount.split_once('.') {
        Some((d, c)) if c.len() == 2 && c.bytes().all(|b| b.is_ascii_digit()) => (d, Some(c)),
        Some(_) => return number(amount).map(|n| format!("{sign}{n} dollars")),
        None => (amount, None),
    };
    let d = if dollars.is_empty() {
        0
    } else {
        value(dollars)?
    };
    let c = cents.and_then(|c| c.parse::<u64>().ok()).unwrap_or(0);
    let dollar_words = match d {
        1 => "one dollar".to_owned(),
        d => format!("{} dollars", cardinal(d)),
    };
    let cent_words = match c {
        1 => "one cent".to_owned(),
        c => format!("{} cents", cardinal(c)),
    };
    Some(match (d, c) {
        (_, 0) => format!("{sign}{dollar_words}"),
        (0, _) => format!("{sign}{cent_words}"),
        _ => format!("{sign}{dollar_words} and {cent_words}"),
    })
}

/// `1st`, `22nd`, `14th`: the ordinal; the day of a date uses it too.
pub fn ordinal_word(w: &str) -> Option<u64> {
    let lower = w.to_ascii_lowercase();
    let digits = ["st", "nd", "rd", "th"]
        .iter()
        .find_map(|s| lower.strip_suffix(s))?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
        .then(|| digits.parse().ok())
        .flatten()
}

/// A plain number, read as a year when it is four digits from 1900 to 2099.
pub fn plain_number(w: &str) -> Option<String> {
    if w.len() == 4 && w.bytes().all(|b| b.is_ascii_digit()) {
        let n: u64 = w.parse().ok()?;
        if (1900..=2099).contains(&n) {
            return Some(year(n));
        }
    }
    number(w)
}

fn domain_label(label: &str) -> String {
    if label.bytes().any(|b| b.is_ascii_digit()) {
        return spell(label);
    }
    let lower = label.to_ascii_lowercase();
    if lower == "www" {
        return spell(&lower);
    }
    for suffix in DOMAIN_WORDS {
        if let Some(head) = lower.strip_suffix(suffix).filter(|h| h.len() >= 3) {
            return format!("{head} {suffix}");
        }
    }
    lower.replace('-', " dash ")
}

fn host_words(host: &str) -> String {
    host.split('.')
        .filter(|l| !l.is_empty())
        .map(domain_label)
        .collect::<Vec<_>>()
        .join(" dot ")
}

/// `help@x.com`: "help at x dot com".
fn email(w: &str) -> Option<String> {
    let (local, host) = w.split_once('@')?;
    if local.is_empty() || !host.contains('.') {
        return None;
    }
    let local = local
        .replace('.', " dot ")
        .replace('_', " underscore ")
        .replace('-', " dash ");
    Some(format!("{} at {}", generic(&local), host_words(host)))
}

/// `https://www.x.com/pay`, `sunvalewater.example`: the address without its scheme.
fn web_address(w: &str) -> Option<String> {
    let lower = w.to_ascii_lowercase();
    let bare = ["https://", "http://"]
        .iter()
        .find_map(|s| lower.strip_prefix(s));
    let rest = bare.unwrap_or(&lower);
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let tld = host.rsplit('.').next().unwrap_or_default();
    let looks_like = bare.is_some() || host.starts_with("www.") || TLDS.contains(&tld);
    if !looks_like || !host.contains('.') || host.starts_with('.') {
        return None;
    }
    let mut out = host_words(host);
    for part in path.split('/').filter(|p| !p.is_empty()) {
        out.push_str(" slash ");
        out.push_str(&generic(part));
    }
    Some(out)
}

/// Letters and digits mixed (`ABC123`), or capitals without a vowel (`NSW`): spelled.
fn code(w: &str) -> Option<String> {
    let alnum = !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric());
    let letters = w.chars().any(|c| c.is_ascii_alphabetic());
    let digits = w.chars().any(|c| c.is_ascii_digit());
    let no_vowel_caps = (2..=5).contains(&w.len())
        && w.chars().all(|c| c.is_ascii_uppercase())
        && !w.chars().any(|c| "AEIOUY".contains(c));
    (alnum && ((letters && digits) || no_vowel_caps)).then(|| spell(w))
}

fn abbreviation(t: &str, next: Option<&str>, dot: bool) -> Option<String> {
    let lower = t.to_lowercase();
    let next_starts = |f: fn(char) -> bool| next.and_then(|n| n.chars().next()).is_some_and(f);
    match lower.as_str() {
        "st" => Some(if next_starts(char::is_uppercase) && t == "St" && !dot {
            "saint".to_owned()
        } else {
            "street".to_owned()
        }),
        "no" if t == "No" && (dot || next_starts(|c| c.is_ascii_digit())) => {
            Some("number".to_owned())
        }
        _ => ABBREVIATIONS
            .iter()
            .find(|(k, _)| *k == lower)
            .map(|(_, v)| (*v).to_owned()),
    }
}

/// The spoken form of the written word `t`; `next` is the word after it.
pub fn say(t: &str, next: Option<&str>, dot: bool) -> String {
    if let Some(s) = abbreviation(t, next, dot) {
        return s;
    }
    let parsers: [fn(&str) -> Option<String>; 9] = [
        money,
        |w| number(w.strip_suffix('%')?).map(|n| format!("{n} percent")),
        |w| ordinal_word(w).map(ordinal),
        |w| plain_number(w.strip_prefix('#')?).map(|n| format!("number {n}")),
        plain_number,
        number_with_unit,
        email,
        web_address,
        code,
    ];
    parsers
        .iter()
        .find_map(|p| p(t))
        .unwrap_or_else(|| generic(t))
}

fn fold(c: char) -> Option<char> {
    let folded = match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c',
        'ñ' => 'n',
        c => c,
    };
    folded.is_ascii_alphabetic().then_some(folded)
}

fn symbol(c: char, before: Option<char>, after: Option<char>) -> &'static str {
    let digit = |c: Option<char>| c.is_some_and(|c| c.is_ascii_digit());
    let alpha = |c: Option<char>| c.is_some_and(char::is_alphabetic);
    match c {
        '&' => " and ",
        '+' => " plus ",
        '@' => " at ",
        '#' => " number ",
        '%' => " percent ",
        '=' => " equals ",
        '$' => " dollars ",
        '°' => " degrees ",
        '/' if alpha(before) && alpha(after) => " or ",
        '/' => " slash ",
        '-' | '–' | '—' if digit(before) && digit(after) => " to ",
        '-' | '\'' if alpha(before) && alpha(after) => {
            if c == '-' {
                "-"
            } else {
                "'"
            }
        }
        _ => " ",
    }
}

/// Any other word: letters kept (accents folded), digit runs said as numbers, symbols named.
pub fn generic(t: &str) -> String {
    let chars: Vec<char> = t.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while let Some(&c) = chars.get(i) {
        if c.is_ascii_digit() {
            let end = (i..chars.len())
                .find(|&j| !chars[j].is_ascii_digit())
                .unwrap_or(chars.len());
            let run: String = chars[i..end].iter().collect();
            out.push(' ');
            out.push_str(&whole(&run).unwrap_or_default());
            out.push(' ');
            i = end;
            continue;
        }
        if let Some(f) = fold(c) {
            out.push(f.to_ascii_lowercase());
        } else {
            let before = i.checked_sub(1).and_then(|b| chars.get(b)).copied();
            out.push_str(symbol(c, before, chars.get(i + 1).copied()));
        }
        i += 1;
    }
    out
}
