//! The 720p-class proxy every later step reads: whether a proxy the Mac app made with its
//! hardware encoder can stand in for the server's own, and how long the server's encode may take.

use std::time::Duration;

use crate::domain::probe::ProbeInfo;

/// Long edge of a proxy, pixels.
pub const PROXY_LONG_EDGE: u32 = 1280;
/// Shortest long edge accepted from a client (smaller proxies hurt face tracking).
const MIN_CLIENT_LONG_EDGE: u32 = 640;
/// The server's encode limit never drops below this.
const MIN_ENCODE: Duration = Duration::from_secs(15 * 60);
/// Nor rises above this.
const MAX_ENCODE: Duration = Duration::from_secs(4 * 60 * 60);
/// Seconds of encode allowed per second of footage (a 2-core box decodes heavy HEVC at about
/// 0.6× real time; 8× leaves room for slower sources).
const ENCODE_PER_SECOND: f64 = 8.0;

/// Whether a client-made proxy can replace the server's: H.264, same orientation, long edge
/// between 640 and 1280, the same length within 2% (at least 1 s), and audio when the original
/// has it.
pub fn client_proxy_ok(original: &ProbeInfo, proxy: &ProbeInfo) -> bool {
    let long_edge = proxy.width.max(proxy.height);
    let same_orientation = (original.width >= original.height) == (proxy.width >= proxy.height);
    let tolerance = (original.duration_s * 0.02).max(1.0);
    proxy.codec == "h264"
        && same_orientation
        && (MIN_CLIENT_LONG_EDGE..=PROXY_LONG_EDGE).contains(&long_edge)
        && (proxy.duration_s - original.duration_s).abs() <= tolerance
        && (proxy.has_audio || !original.has_audio)
}

/// How long the server's proxy encode may run for footage of `duration_s` seconds.
pub fn encode_timeout(duration_s: f64) -> Duration {
    let scaled = if duration_s.is_finite() && duration_s > 0.0 {
        Duration::from_secs_f64(duration_s * ENCODE_PER_SECOND)
    } else {
        MIN_ENCODE
    };
    scaled.clamp(MIN_ENCODE, MAX_ENCODE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(
        (width, height): (u32, u32),
        duration_s: f64,
        codec: &str,
        has_audio: bool,
    ) -> ProbeInfo {
        ProbeInfo {
            duration_s,
            width,
            height,
            fps: 30.0,
            rotation: 0,
            codec: codec.into(),
            recorded_at: None,
            has_audio,
        }
    }

    #[test]
    fn a_hardware_proxy_of_the_same_clip_is_accepted() {
        let original = info((1920, 1080), 327.38, "hevc", true);
        assert!(client_proxy_ok(
            &original,
            &info((1280, 720), 327.38, "h264", true)
        ));
        // Portrait glasses footage: 1312x1744 becomes 964x1280.
        let glasses = info((1312, 1744), 17.8, "h264", true);
        assert!(client_proxy_ok(
            &glasses,
            &info((964, 1280), 17.8, "h264", true)
        ));
    }

    #[test]
    fn a_proxy_that_does_not_match_is_refused() {
        let original = info((1920, 1080), 327.38, "hevc", true);
        let refused = [
            info((1280, 720), 327.38, "hevc", true),  // not H.264
            info((1920, 1080), 327.38, "h264", true), // too big
            info((480, 270), 327.38, "h264", true),   // too small
            info((720, 1280), 327.38, "h264", true),  // turned
            info((1280, 720), 300.0, "h264", true),   // cut short
            info((1280, 720), 327.38, "h264", false), // lost its audio
        ];
        for proxy in refused {
            assert!(!client_proxy_ok(&original, &proxy), "{proxy:?}");
        }
    }

    #[test]
    fn the_encode_limit_grows_with_the_footage_within_bounds() {
        assert_eq!(encode_timeout(30.0), MIN_ENCODE);
        assert_eq!(encode_timeout(327.0), Duration::from_secs(2616));
        assert_eq!(encode_timeout(4.0 * 3600.0), MAX_ENCODE);
        assert_eq!(encode_timeout(f64::NAN), MIN_ENCODE);
    }
}
