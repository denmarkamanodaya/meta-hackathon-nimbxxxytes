// Calendar wording for clips: which day a recording belongs to ("Today", "Yesterday", a
// weekday this week, else a date), library groups per day, and the clip's date-time line.
import type { ClipStatus } from '../services/api/types';

/** A clip in a day group. */
export interface Dated {
  recorded_at: string | null;
  duration_s: number | null;
  status: ClipStatus;
}

/** One library section. */
export interface DayGroup<T> {
  /** Calendar date `yyyy-mm-dd` in the zone, or `unknown`. */
  key: string;
  label: string;
  items: T[];
  /** Clips counted in the header: copies of other clips (`duplicate`) are shown but not counted. */
  count: number;
  /** Whole minutes of footage, rounded (at least 1 when there is any); duplicates excluded. */
  minutes: number;
}

const zoneOpt = (timeZone?: string) => (timeZone === undefined ? {} : { timeZone });

/** `yyyy-mm-dd` of an instant in the zone. */
function dayKey(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...zoneOpt(timeZone) }).format(date);
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * The day word for an instant: "Today", "Yesterday", a short weekday within the last 6 days,
 * else "27 Oct" (with the year when it differs).
 * @param iso - ISO-8601 instant.
 * @param now - The current instant.
 * @param timeZone - IANA zone; defaults to the device zone. Tests pin it.
 * @returns The label, or "" for an unparsable value.
 */
export function dayLabel(iso: string, now: Date, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const gap = daysBetween(dayKey(date, timeZone), dayKey(now, timeZone));
  if (gap === 0) return 'Today';
  if (gap === 1) return 'Yesterday';
  if (gap > 1 && gap < 7) return new Intl.DateTimeFormat('en-GB', { weekday: 'short', ...zoneOpt(timeZone) }).format(date);
  const sameYear = dayKey(date, timeZone).slice(0, 4) === dayKey(now, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    ...zoneOpt(timeZone),
  }).format(date);
}

/**
 * The day word plus the clock time, for a clip's meta line: "Today 7:42 am".
 * @param iso - ISO-8601 instant.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The label, or "" for an unparsable value.
 */
export function dayTimeLabel(iso: string, now: Date, timeZone?: string): string {
  const day = dayLabel(iso, now, timeZone);
  if (day === '') return '';
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...zoneOpt(timeZone) })
    .format(new Date(iso))
    .replace(/\s?AM$/i, ' am')
    .replace(/\s?PM$/i, ' pm');
  return `${day} ${time}`;
}

/**
 * Groups items by recording day, newest day first; items keep their order inside a day.
 * Items without a date form a last "Recently added" group.
 * @param items - Clips, any order.
 * @param now - The current instant.
 * @param timeZone - IANA zone; tests pin it.
 * @returns The day groups.
 */
export function groupByDay<T extends Dated>(items: readonly T[], now: Date, timeZone?: string): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const date = item.recorded_at === null ? null : new Date(item.recorded_at);
    const valid = date !== null && !Number.isNaN(date.getTime());
    const key = valid ? dayKey(date, timeZone) : 'unknown';
    const label = valid && item.recorded_at !== null ? dayLabel(item.recorded_at, now, timeZone) : 'Recently added';
    const group = groups.get(key) ?? { key, label, items: [], count: 0, minutes: 0 };
    group.items.push(item);
    groups.set(key, group);
  }
  const sorted = [...groups.values()].sort((a, b) => {
    if (a.key === 'unknown') return 1;
    if (b.key === 'unknown') return -1;
    return b.key.localeCompare(a.key);
  });
  return sorted.map((group) => {
    const counted = group.items.filter((item) => item.status !== 'duplicate');
    const seconds = counted.reduce((sum, item) => sum + (item.duration_s ?? 0), 0);
    return { ...group, count: counted.length, minutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0 };
  });
}
