//! Standard base64 (RFC 4648, `=` padding) decoding for a binary request body (a voice note) that
//! crosses the Tauri bridge as text, since invoke arguments are JSON. Pure; no dependency needed
//! for this one direction.

/// The value of one alphabet character, or `None` outside the alphabet.
fn value(c: u8) -> Option<u32> {
    match c {
        b'A'..=b'Z' => Some(u32::from(c - b'A')),
        b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
        b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decodes padded standard base64; `None` for a bad length, a bad character or misplaced `=`.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let bytes = text.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let (quads, _) = bytes.as_chunks::<4>();
    for (i, quad) in quads.iter().enumerate() {
        let pad = quad.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && i + 1 != quads.len()) {
            return None;
        }
        let mut n = 0u32;
        for &c in &quad[..4 - pad] {
            n = (n << 6) | value(c)?;
        }
        n <<= 6 * pad as u32;
        let [_, a, b, c] = n.to_be_bytes();
        out.push(a);
        if pad < 2 {
            out.push(b);
        }
        if pad < 1 {
            out.push(c);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_every_padding_length() {
        for (text, plain) in [
            ("", ""),
            ("Zg==", "f"),
            ("Zm8=", "fo"),
            ("Zm9v", "foo"),
            ("Zm9vYmFy", "foobar"),
        ] {
            assert_eq!(decode(text).as_deref(), Some(plain.as_bytes()), "{text}");
        }
        assert_eq!(decode("//+/").as_deref(), Some(&[0xff, 0xff, 0xbf][..]));
    }

    #[test]
    fn refuses_a_bad_length_character_or_padding() {
        assert_eq!(decode("Zm9"), None);
        assert_eq!(decode("Zm9-"), None);
        assert_eq!(decode("Z==="), None);
        assert_eq!(decode("Zg==Zm9v"), None);
    }
}
