/**
 * Formats a timestamp into a human-readable age string
 * @param timestamp - The timestamp to format (Date, string, or number)
 * @returns A formatted age string like "5m", "2h", "3d"
 */
export function formatAge(timestamp: Date | string | number | null | undefined): string {
  if (!timestamp) return '-';

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) return 'future';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  if (seconds > 0) return `${seconds}s`;

  return 'now';
}

/**
 * Formats a timestamp into a full date string
 * @param timestamp - The timestamp to format
 * @returns A formatted date string
 */
export function formatFullDate(timestamp: Date | string | number | null | undefined): string {
  if (!timestamp) return '-';

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (isNaN(date.getTime())) return '-';

  return date.toLocaleString();
}
