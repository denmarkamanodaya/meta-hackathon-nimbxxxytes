// Storage card wording: sizes in GB (decimal, as phones report them).

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
