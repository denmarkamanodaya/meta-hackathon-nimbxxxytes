//! Model prices and the cost of one call. Prices come from the price file loaded at start-up.

use serde::Deserialize;

/// USD prices per model (the price file's schema).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Prices {
    /// Muse Spark token prices.
    pub spark: TokenPrices,
    /// SAM video frame prices.
    pub sam: FramePrices,
    /// Voice Transcribe audio prices.
    pub transcribe: AudioPrices,
}

/// Per-1M-token prices.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct TokenPrices {
    /// USD per 1M uncached input tokens.
    pub input_per_m: f64,
    /// USD per 1M output tokens (reasoning included).
    pub output_per_m: f64,
    /// USD per 1M cached input tokens.
    pub cached_input_per_m: f64,
}

/// Per-1000-frame video prices with a minimum billed frame count.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FramePrices {
    /// USD per 1000 frames.
    pub per_1000_frames: f64,
    /// Frames billed at least, per request.
    pub min_frames: u64,
}

/// Per-hour audio prices, metered per second.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AudioPrices {
    /// USD per hour of audio.
    pub per_hour: f64,
}

/// What one model call consumed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Usage {
    /// Spark tokens: `input` includes `cached`.
    Tokens {
        /// All input tokens.
        input: u64,
        /// Input tokens served from the prompt cache.
        cached: u64,
        /// Output tokens, reasoning included.
        output: u64,
    },
    /// SAM frames processed.
    Frames(u64),
    /// Seconds of audio transcribed.
    AudioSeconds(f64),
}

/// One row of the model call log.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelCall {
    /// Row id.
    pub id: String,
    /// When the call finished (ISO-8601 UTC).
    pub at: String,
    /// Model id.
    pub model: String,
    /// What the call was for (`transcribe`, `segment_facts`, …).
    pub purpose: String,
    /// Hash of model + request + media.
    pub input_hash: String,
    /// What was consumed; `None` when the call failed or was a cache hit.
    pub usage: Option<Usage>,
    /// USD; 0 for cache hits and failures.
    pub cost_usd: f64,
    /// Wall time including retries, ms.
    pub latency_ms: u64,
    /// Served from the cache without an API call.
    pub cache_hit: bool,
    /// Error code and message when the call failed after retries.
    pub error: Option<String>,
}

/// Spend per model, for the costs screen.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelSpend {
    /// Model id.
    pub model: String,
    /// Calls logged (cache hits included).
    pub calls: u64,
    /// USD.
    pub cost_usd: f64,
}

/// USD cost of `usage` at `prices`.
pub fn cost_usd(prices: &Prices, usage: Usage) -> f64 {
    match usage {
        Usage::Tokens {
            input,
            cached,
            output,
        } => {
            let cached = cached.min(input);
            let p = &prices.spark;
            ((input - cached) as f64 * p.input_per_m
                + cached as f64 * p.cached_input_per_m
                + output as f64 * p.output_per_m)
                / 1_000_000.0
        }
        Usage::Frames(frames) => {
            frames.max(prices.sam.min_frames) as f64 * prices.sam.per_1000_frames / 1000.0
        }
        Usage::AudioSeconds(s) => s.max(0.0) * prices.transcribe.per_hour / 3600.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prices() -> Prices {
        Prices {
            spark: TokenPrices {
                input_per_m: 1.25,
                output_per_m: 4.25,
                cached_input_per_m: 0.15,
            },
            sam: FramePrices {
                per_1000_frames: 0.20,
                min_frames: 50,
            },
            transcribe: AudioPrices { per_hour: 0.18 },
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-12
    }

    #[test]
    fn spark_bills_cached_input_cheaper_and_output_with_reasoning() {
        // The spike call: 744 in, 958 out.
        let c = cost_usd(
            &prices(),
            Usage::Tokens {
                input: 744,
                cached: 0,
                output: 958,
            },
        );
        assert!(close(c, 0.000_93 + 0.004_071_5), "{c}");
        let cached = cost_usd(
            &prices(),
            Usage::Tokens {
                input: 1000,
                cached: 1000,
                output: 0,
            },
        );
        assert!(close(cached, 0.000_15), "{cached}");
    }

    #[test]
    fn sam_bills_at_least_50_frames() {
        assert!(close(cost_usd(&prices(), Usage::Frames(16)), 0.01));
        assert!(close(cost_usd(&prices(), Usage::Frames(120)), 0.024));
    }

    #[test]
    fn transcribe_bills_per_second() {
        assert!(close(
            cost_usd(&prices(), Usage::AudioSeconds(3600.0)),
            0.18
        ));
        assert!(close(
            cost_usd(&prices(), Usage::AudioSeconds(21.52)),
            0.18 * 21.52 / 3600.0
        ));
    }
}
