//! Tokenising and WAV encoding of the narrator, without the model.

use serde_json::json;

use super::*;

/// The model's own files, trimmed to the characters these tests use (ids as in `vocab.json`).
fn tokens() -> VitsTokens {
    let vocab = json!({" ": 19, "'": 1, "a": 26, "d": 5, "e": 7, "h": 6, "i": 18, "k": 0,
                       "l": 21, "o": 22, "p": 13, "s": 8, "t": 33, "1": 15, "<unk>": 38});
    let config = json!({"add_blank": true, "normalize": true, "pad_token": "k"});
    VitsTokens::from_files(&vocab, &config).unwrap()
}

#[test]
fn text_is_lower_cased_stripped_of_unknown_characters_and_interleaved_with_the_pad_id() {
    let ids = tokens().ids("Step 1. Dial!").unwrap();

    // "step 1 dial" -> s t e p ' ' 1 ' ' d i a l, with 0 (the pad "k") around each.
    assert_eq!(
        ids,
        [
            0, 8, 0, 33, 0, 7, 0, 13, 0, 19, 0, 15, 0, 19, 0, 5, 0, 18, 0, 26, 0, 21, 0
        ]
    );
}

#[test]
fn outer_spaces_are_trimmed_after_unknown_characters_go() {
    assert_eq!(tokens().ids(" .a. ").unwrap(), [0, 26, 0]);
}

#[test]
fn text_with_nothing_speakable_is_refused() {
    let err = tokens().ids("?!. 😀").unwrap_err();
    assert_eq!(err.code, ErrorCode::ValidationFailed);
}

#[test]
fn a_vocabulary_without_the_pad_token_is_an_error() {
    let err = VitsTokens::from_files(&json!({"a": 1}), &json!({"pad_token": "k"})).unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
}

#[test]
fn the_wav_is_16_bit_mono_pcm_at_the_rate_with_clipped_samples() {
    let bytes = wav(&[0.0, 1.0, -1.0, 2.0, 0.5], 16_000);

    assert_eq!(&bytes[0..4], b"RIFF");
    assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 10);
    assert_eq!(&bytes[8..16], b"WAVEfmt ");
    assert_eq!(u16::from_le_bytes([bytes[22], bytes[23]]), 1, "mono");
    assert_eq!(
        u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
        16_000
    );
    assert_eq!(
        u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
        32_000
    );
    assert_eq!(u16::from_le_bytes([bytes[34], bytes[35]]), 16, "16-bit");
    assert_eq!(&bytes[36..40], b"data");
    let pcm: Vec<i16> = bytes[44..]
        .chunks(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    assert_eq!(pcm, [0, 32767, -32767, 32767, 16383]);
}
