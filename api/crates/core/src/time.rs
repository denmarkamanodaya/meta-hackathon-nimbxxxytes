//! Wall-clock formatting. Stored wall-clock times are ISO-8601 UTC text with millisecond
//! precision and a fixed width, so text order equals time order.

use crate::ports::EpochMillis;

/// Formats epoch milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC). Instants before 1970 clamp to
/// the epoch.
pub fn format_utc(millis: EpochMillis) -> String {
    let millis = millis.max(0);
    let days = millis.div_euclid(86_400_000);
    let ms_of_day = millis.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let (h, m, s, ms) = (
        ms_of_day / 3_600_000,
        ms_of_day / 60_000 % 60,
        ms_of_day / 1000 % 60,
        ms_of_day % 1000,
    );
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{ms:03}Z")
}

/// Days since 1970-01-01 to a proleptic Gregorian `(year, month, day)` (H. Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_known_instants() {
        assert_eq!(format_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_utc(1_793_062_923_456), "2026-10-27T01:02:03.456Z");
        // Leap day.
        assert_eq!(format_utc(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        assert_eq!(format_utc(-5), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn text_order_follows_time_order() {
        let a = format_utc(1_793_062_923_456);
        let b = format_utc(1_793_062_923_457);
        assert!(a < b);
    }
}
