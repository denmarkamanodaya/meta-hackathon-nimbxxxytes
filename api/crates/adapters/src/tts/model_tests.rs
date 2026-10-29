//! Runs only with `--features tts-model`, against the real files in api/models/mms-tts-eng (or
//! the folder `TTS_MODEL_DIR` names). With `SPEECH_OUT_DIR` set, the spike sentences are also
//! written there as `before.wav` (the raw text) and `after.wav` (through the shared voice path).

use std::path::{Path, PathBuf};

use nimbytes_core::ports::Narrator;
use nimbytes_core::usecases::narrate::narrate;

use super::OnnxNarrator;

const SPIKE: &str = "You owe $142.60. Please pay by 14 November 2026. Call 1300 555 019. \
                     Pensioners may get a 50% concession: call 08 9555 0100. \
                     BPAY biller code 4455, reference 881204.";

fn model_dir() -> PathBuf {
    std::env::var_os("TTS_MODEL_DIR").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("../../models/mms-tts-eng"),
        PathBuf::from,
    )
}

fn seconds(wav: &[u8]) -> f64 {
    (wav.len() - 44) as f64 / 32_000.0
}

#[tokio::test]
async fn the_voice_speaks_a_step_as_a_16_khz_wav_of_a_plausible_length() {
    let narrator = OnnxNarrator::load(&model_dir()).unwrap();

    let wav = narrator
        .speak("Step 1. Turn the dial to Quick Wash.")
        .await
        .unwrap();

    assert_eq!(&wav[0..4], b"RIFF");
    assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
    let seconds = seconds(&wav);
    assert!((1.0..6.0).contains(&seconds), "{seconds} s");
}

#[tokio::test]
async fn the_spike_sentences_spoken_in_words_last_longer_than_the_raw_text() {
    let narrator = OnnxNarrator::load(&model_dir()).unwrap();

    let before = narrator.speak(SPIKE).await.unwrap();
    let after = narrate(&narrator, SPIKE).await.unwrap();

    if let Some(out) = std::env::var_os("SPEECH_OUT_DIR") {
        let out = PathBuf::from(out);
        std::fs::write(out.join("before.wav"), &before).unwrap();
        std::fs::write(out.join("after.wav"), &after).unwrap();
    }
    println!(
        "before {:.2} s, after {:.2} s",
        seconds(&before),
        seconds(&after)
    );
    assert!(seconds(&after) > seconds(&before) * 1.5);
}
