import type { SnapshotStats } from '@/core/refresh/client';

interface LocalPartialLabelOptions {
  stats?: SnapshotStats | null;
  fallback: string;
  sourceLabel?: string;
  sourceVerb?: 'is' | 'are';
}

const cleanWarnings = (stats?: SnapshotStats | null): string[] =>
  (stats?.warnings ?? []).map((warning) => warning.trim()).filter(Boolean);

export const buildLocalPartialDataLabel = ({
  stats,
  fallback,
  sourceLabel = 'This table',
  sourceVerb = 'is',
}: LocalPartialLabelOptions): string => {
  const warnings = cleanWarnings(stats);
  const windowLabel =
    warnings.length > 0
      ? warnings.join(' ')
      : stats?.truncated && stats.totalItems && stats.totalItems > stats.itemCount
        ? `Showing ${stats.itemCount} of ${stats.totalItems} rows.`
        : fallback;

  return `${windowLabel} ${sourceLabel} ${sourceVerb} a bounded local window. Search, filters, sort, copy, and actions apply only to the visible rows.`;
};
