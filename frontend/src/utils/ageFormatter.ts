/** A timestamp accepted by the age formatters; null/undefined format as missing. */
export type AgeTimestampInput = Date | string | number | null | undefined;

const COMPACT_AGE_UNITS_IN_SECONDS: Record<string, number> = {
  y: 365 * 86400,
  mo: 30 * 86400,
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

const isAsciiDigit = (character: string | undefined): boolean =>
  character !== undefined && character >= '0' && character <= '9';

/** Parses compact Kubernetes durations such as `1d2h` without regex backtracking. */
export function parseCompactAgeToSeconds(age: string | null | undefined): number {
  if (!age || age === '-' || age === '—' || age === 'future' || age === 'now') {
    return 0;
  }

  let totalSeconds = 0;
  let cursor = 0;
  while (cursor < age.length) {
    if (!isAsciiDigit(age[cursor])) {
      cursor += 1;
      continue;
    }

    const amountStart = cursor;
    while (isAsciiDigit(age[cursor])) {
      cursor += 1;
    }
    const unit = age.startsWith('mo', cursor) ? 'mo' : age[cursor];
    const multiplier = unit ? COMPACT_AGE_UNITS_IN_SECONDS[unit] : undefined;
    if (multiplier !== undefined) {
      totalSeconds += Number.parseInt(age.slice(amountStart, cursor), 10) * multiplier;
      cursor += unit.length;
    }
  }

  return totalSeconds;
}

/**
 * Formats a timestamp into a human-readable age string
 * @param timestamp - The timestamp to format (Date, string, or number)
 * @returns A formatted age string like "5m", "2h", "3d"
 */
export function formatAge(
  timestamp: AgeTimestampInput,
  nowInput: Date | string | number = Date.now()
): string {
  if (!timestamp) {
    return '-';
  }

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (Number.isNaN(now.getTime())) {
    return '-';
  }
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    return 'future';
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) {
    return `${years}y`;
  }
  if (months > 0) {
    return `${months}mo`;
  }
  if (days > 0) {
    return `${days}d`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  if (seconds > 0) {
    return `${seconds}s`;
  }

  return 'now';
}

/** Formats a timestamp as relative past-tense text like "5m ago" or "just now". */
export function formatAgeAgo(
  timestamp: AgeTimestampInput,
  nowInput: Date | string | number = Date.now()
): string {
  const age = formatAge(timestamp, nowInput);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/**
 * Formats a timestamp into a full date string
 * @param timestamp - The timestamp to format
 * @returns A formatted date string
 */
export function formatFullDate(timestamp: AgeTimestampInput): string {
  if (!timestamp) {
    return '-';
  }

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}
