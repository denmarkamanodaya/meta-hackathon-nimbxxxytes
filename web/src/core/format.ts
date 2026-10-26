// Display formatters for sizes, speeds and durations. Decimal units (1 MB = 1,000,000 bytes),
// matching how iOS reports file sizes.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Formats a byte count, one decimal below 100 of a unit.
 * @param bytes - Byte count, >= 0.
 * @returns For example `"0 B"`, `"950 KB"`, `"12.4 MB"`, `"1.2 GB"`.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit] ?? 'B'}`;
}

/**
 * Formats a transfer speed.
 * @param bytesPerSecond - Speed in bytes per second.
 * @returns For example `"2.1 MB/s"`.
 */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Formats a duration as `m:ss`, or `h:mm:ss` from one hour.
 * @param seconds - Duration in seconds, >= 0; fractions are floored.
 * @returns For example `"0:07"`, `"12:30"`, `"1:02:03"`.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
}

/**
 * Whole-number percentage of `part` in `whole`, clamped to 0–100; an empty whole counts as done.
 * @param part - Bytes done.
 * @param whole - Total bytes.
 * @returns 0–100.
 */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((part / whole) * 100)));
}
