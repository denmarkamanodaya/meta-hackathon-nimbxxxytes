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

/// `YYYY-MM-DD (Weekday)` of a UTC instant, the form the query rewrite gets as "today" so it can
/// resolve "last weekend" and similar.
pub fn day_with_weekday(millis: EpochMillis) -> String {
    const NAMES: [&str; 7] = [
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
    ];
    let days = millis.max(0).div_euclid(86_400_000);
    let name = NAMES[usize::try_from(days.rem_euclid(7)).unwrap_or(0)];
    format!("{} ({name})", &format_utc(millis)[..10])
}

/// Parses `YYYY-MM-DDTHH:MM:SS[.fff]Z` (what [`format_utc`] writes) back to epoch milliseconds.
/// `None` for any other shape or an impossible date.
pub fn parse_utc(text: &str) -> Option<EpochMillis> {
    let t = text.strip_suffix('Z')?;
    let (date, time) = t.split_once('T')?;
    let mut d = date.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (year, month, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut h = hms.splitn(3, ':').map(|p| p.parse::<i64>().ok());
    let (hh, mm, ss) = (h.next()??, h.next()??, h.next()??);
    let ms: i64 = frac
        .chars()
        .chain("000".chars())
        .take(3)
        .collect::<String>()
        .parse()
        .ok()?;
    let valid =
        (1..=12).contains(&month) && (1..=31).contains(&day) && hh < 24 && mm < 60 && ss < 61;
    if !valid {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hh) * 60 + mm) * 60_000 + ss * 1000 + ms)
}

/// Proleptic Gregorian `(year, month, day)` to days since 1970-01-01 (H. Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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
    fn today_carries_the_weekday() {
        assert_eq!(day_with_weekday(0), "1970-01-01 (Thursday)");
        assert_eq!(day_with_weekday(1_793_062_923_456), "2026-10-27 (Tuesday)");
    }

    #[test]
    fn parse_is_the_inverse_of_format() {
        for ms in [0, 1_709_164_800_000, 1_793_062_923_456] {
            assert_eq!(parse_utc(&format_utc(ms)), Some(ms));
        }
        assert_eq!(parse_utc("2026-10-27T01:02:03Z"), Some(1_793_062_923_000));
        assert_eq!(parse_utc("2026-13-01T00:00:00Z"), None);
        assert_eq!(parse_utc("yesterday"), None);
    }

    #[test]
    fn text_order_follows_time_order() {
        let a = format_utc(1_793_062_923_456);
        let b = format_utc(1_793_062_923_457);
        assert!(a < b);
    }
}
