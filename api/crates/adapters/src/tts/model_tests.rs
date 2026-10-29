//! Runs only with `--features tts-model`, against the real files in api/models/mms-tts-eng.

use std::path::Path;

use nimbytes_core::ports::Narrator;

use super::OnnxNarrator;

#[tokio::test]
async fn the_voice_speaks_a_step_as_a_16_khz_wav_of_a_plausible_length() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models/mms-tts-eng");
    let narrator = OnnxNarrator::load(&dir).unwrap();

    let wav = narrator
        .speak("Step 1. Turn the dial to Quick Wash.")
        .await
        .unwrap();

    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
    let seconds = (wav.len() - 44) as f64 / 32_000.0;
    assert!((1.0..6.0).contains(&seconds), "{seconds} s");
}
