// Storage card wording: sizes in GB (decimal, as phones report them) and the tier bar split.

const GB = 1_000_000_000;

/**
 * A size in GB for the big numbers: one decimal, "0 GB" for nothing.
 * @param bytes - Size in bytes, >= 0.
 * @returns For example `"41.2 GB"`, `"0 GB"`.
 */
export function formatGb(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  return `${(bytes / GB).toFixed(1)} GB`.replace(/\.0 GB$/, ' GB');
}

/**
 * A size in whole GB for the legend; under 1 GB shows MB.
 * @param bytes - Size in bytes, >= 0.
 * @returns For example `"6 GB"`, `"35 GB"`, `"420 MB"`.
 */
export function formatGbRounded(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  if (bytes < GB) return `${String(Math.round(bytes / 1_000_000))} MB`;
  return `${String(Math.round(bytes / GB))} GB`;
}

/**
 * Bar segment weights for the two tiers; a non-empty tier keeps a sliver so it stays visible.
 * @param frequent - Watched-lately bytes.
 * @param resting - Resting bytes.
 * @returns Flex weights `{ frequent, resting }`, both 0 when empty.
 */
export function tierSplit(frequent: number, resting: number): { frequent: number; resting: number } {
  const total = Math.max(0, frequent) + Math.max(0, resting);
  if (total === 0) return { frequent: 0, resting: 0 };
  const share = (bytes: number) => (bytes <= 0 ? 0 : Math.max(2, Math.round((bytes / total) * 100)));
  return { frequent: share(frequent), resting: share(resting) };
}
