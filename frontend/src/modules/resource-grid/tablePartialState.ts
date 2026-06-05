import type { SnapshotStats } from '@/core/refresh/client';
import type { ResourceGridTableMode } from './resourceGridTableTypes';

interface LocalPartialLabelOptions {
  stats?: SnapshotStats | null;
  fallback: string;
  sourceLabel?: string;
  sourceVerb?: 'is' | 'are';
}

const cleanWarnings = (stats?: SnapshotStats | null): string[] =>
  (stats?.warnings ?? []).map((warning) => warning.trim()).filter(Boolean);

const isLocalSnapshotPartial = (stats?: SnapshotStats | null): boolean =>
  Boolean(stats?.truncated || cleanWarnings(stats).length > 0);

export const localTableModeForStats = (
  stats?: SnapshotStats | null
): Extract<ResourceGridTableMode, 'Local Complete' | 'Local Partial'> =>
  isLocalSnapshotPartial(stats) ? 'Local Partial' : 'Local Complete';

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
