use super::*;

const GB: u64 = BYTES_PER_GB;

fn cap() -> StorageCap {
    StorageCap::from_gb(250).unwrap()
}

const NOW: EpochMillis = 1_793_059_200_000;
const HOUR: i64 = 3_600_000;

#[test]
fn the_cap_is_read_in_decimal_gigabytes_and_never_zero() {
    assert_eq!(cap().bytes, 250_000_000_000);
    assert_eq!(
        StorageCap::from_gb(0).unwrap_err().code,
        ErrorCode::ValidationFailed
    );
    assert!(
        StorageCap::from_gb(u64::MAX).is_err(),
        "overflow is refused"
    );
}

#[test]
fn a_write_that_ends_exactly_at_the_cap_fits_and_one_byte_more_does_not() {
    let c = cap();
    assert!(has_room(200 * GB, 40 * GB, 10 * GB, c));
    assert!(!has_room(200 * GB, 40 * GB, 10 * GB + 1, c));
    assert!(has_room(c.bytes, 0, 0, c), "a full account may still read");
    assert!(!has_room(c.bytes, 0, 1, c));
}

#[test]
fn reservations_count_against_the_room() {
    let c = cap();
    assert!(has_room(249 * GB, 0, GB, c));
    assert!(!has_room(249 * GB, 1, GB, c));
}

#[test]
fn huge_numbers_never_wrap_into_room() {
    assert!(!has_room(u64::MAX, u64::MAX, 1, cap()));
}

#[test]
fn levels_turn_at_80_95_and_100_percent() {
    let c = cap();
    let cases = [
        (0, StorageLevel::Ok),
        (200 * GB - 1, StorageLevel::Ok),
        (200 * GB, StorageLevel::Warn),
        (237_500_000_000 - 1, StorageLevel::Warn),
        (237_500_000_000, StorageLevel::High),
        (250 * GB - 1, StorageLevel::High),
        (250 * GB, StorageLevel::Full),
        (300 * GB, StorageLevel::Full),
    ];
    for (used, want) in cases {
        assert_eq!(storage_level(used, c), want, "{used}");
    }
}

#[test]
fn estimates_add_a_render_and_a_batch_of_covers_per_platform() {
    assert_eq!(images_estimate(3), 3 * IMAGE_ESTIMATE_BYTES);
    assert_eq!(
        export_estimate(2),
        RENDER_ESTIMATE_BYTES + 2 * 3 * IMAGE_ESTIMATE_BYTES
    );
}

#[test]
fn an_upload_reserves_its_size_plus_the_derived_allowance() {
    assert_eq!(upload_reservation(1_000), 1_250);
    assert_eq!(upload_reservation(0), 0);
}

fn upload(size: u64, started_hours_ago: i64, open: bool) -> PendingUpload {
    PendingUpload {
        size_bytes: size,
        created_at: NOW - started_hours_ago * HOUR,
        open,
    }
}

#[test]
fn an_open_upload_is_reserved_until_it_is_a_day_old() {
    let measured_at = NOW;
    assert_eq!(
        reserved_bytes(&[upload(100, 1, true)], measured_at, NOW),
        125
    );
    assert_eq!(
        reserved_bytes(&[upload(100, 23, true)], measured_at, NOW),
        125
    );
    assert_eq!(
        reserved_bytes(&[upload(100, 24, true)], measured_at, NOW),
        0,
        "abandoned for a day: released"
    );
}

#[test]
fn completing_an_upload_releases_it_once_a_measurement_can_hold_it() {
    let started = NOW - HOUR;
    let done = PendingUpload {
        size_bytes: 100,
        created_at: started,
        open: false,
    };
    assert_eq!(
        reserved_bytes(&[done], started - 1, NOW),
        125,
        "measured before it started: still held"
    );
    assert_eq!(
        reserved_bytes(&[done], started, NOW),
        125,
        "measured as it started: still held"
    );
    assert_eq!(
        reserved_bytes(&[done], started + 1, NOW),
        0,
        "measured after: released"
    );
}

#[test]
fn reservations_add_up() {
    let uploads = [
        upload(100, 1, true),
        upload(200, 2, true),
        upload(1_000, 30, true),
    ];
    assert_eq!(reserved_bytes(&uploads, NOW, NOW), 375);
}
