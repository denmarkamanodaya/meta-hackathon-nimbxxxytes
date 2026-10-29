//! Written text cut into words with the break that follows each: none, a clause (`,` `;` `:`, a
//! lone dash, an ellipsis) or a sentence (`.` `!` `?`, a line end). A full stop after a title
//! ("Mr.", "No.") never ends a sentence; after a short form ("St.", "a.m.") it does only when the
//! next word starts with a capital.

/// What follows a word, weakest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Brk {
    /// Nothing: the words run on.
    None,
    /// A short pause inside a sentence.
    Clause,
    /// The end of a sentence.
    Sentence,
}

/// One written word, outer quotes and brackets stripped, with its break.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tok {
    /// The word as written (curly quotes made straight); empty for a lone dash.
    pub word: String,
    /// The break after it.
    pub brk: Brk,
    /// It was written with a full stop after it.
    pub dot: bool,
}

const OPENERS: &[char] = &['(', '[', '{', '"', '\'', '«', '<'];
const TRAILERS: &[char] = &[
    '.', ',', ';', ':', '!', '?', ')', ']', '}', '"', '\'', '»', '>', '…',
];
/// Never end a sentence with their full stop.
const TITLES: &[&str] = &["mr", "mrs", "ms", "dr", "no", "prof"];
/// End a sentence with their full stop only before a capital.
const SHORT_FORMS: &[&str] = &[
    "a.m", "p.m", "e.g", "i.e", "etc", "st", "rd", "ave", "approx", "incl", "excl", "vs", "ref",
    "acct", "pty", "ltd", "tel", "ph", "qty", "jan", "feb", "mar", "apr", "jun", "jul", "aug",
    "sep", "sept", "oct", "nov", "dec",
];

fn straight(c: char) -> char {
    match c {
        '‘' | '’' | 'ʼ' => '\'',
        '“' | '”' => '"',
        c => c,
    }
}

fn trailing_break(trail: &str) -> Brk {
    if trail.contains(['!', '?']) {
        Brk::Sentence
    } else if trail.contains("..") || trail.contains('…') {
        Brk::Clause
    } else if trail.contains('.') {
        Brk::Sentence
    } else if trail.contains([',', ';', ':']) {
        Brk::Clause
    } else {
        Brk::None
    }
}

fn is_dash(word: &str) -> bool {
    !word.is_empty() && word.chars().all(|c| matches!(c, '-' | '–' | '—'))
}

fn tok(chunk: &str, next: Option<&str>) -> Tok {
    let chunk: String = chunk.chars().map(straight).collect();
    if is_dash(&chunk) {
        return Tok {
            word: String::new(),
            brk: Brk::Clause,
            dot: false,
        };
    }
    let start = chunk.trim_start_matches(OPENERS);
    let word = start.trim_end_matches(TRAILERS);
    let trail = &start[word.len()..];
    let mut brk = trailing_break(trail);
    let dot = trail.starts_with('.');
    if brk == Brk::Sentence && !trail.contains(['!', '?']) {
        let lower = word.to_lowercase();
        let capital_next = next
            .and_then(|n| n.trim_start_matches(OPENERS).chars().next())
            .is_none_or(char::is_uppercase);
        let single_letter = word.chars().count() == 1 && word.chars().all(char::is_alphabetic);
        if TITLES.contains(&lower.as_str())
            || ((single_letter || SHORT_FORMS.contains(&lower.as_str())) && !capital_next)
        {
            brk = Brk::None;
        }
    }
    Tok {
        word: word.to_owned(),
        brk,
        dot,
    }
}

/// The words of `text`; the last word of every line ends a sentence.
pub fn lex(text: &str) -> Vec<Tok> {
    let mut toks = Vec::new();
    for line in text.lines() {
        let chunks: Vec<&str> = line.split_whitespace().collect();
        for (i, chunk) in chunks.iter().enumerate() {
            toks.push(tok(chunk, chunks.get(i + 1).copied()));
        }
        if let Some(last) = toks.last_mut() {
            last.brk = Brk::Sentence;
        }
    }
    toks
}
