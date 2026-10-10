import { useEffect } from 'react';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';

/**
 * A row's highlight, or the detail open under it, must stay on a visible row:
 * once the table settles on rows that no longer include that row (filtered,
 * paged, or deleted away), it clears. Loading and errored states keep it,
 * since their rows are not the settled result.
 */
export function useClearHiddenRowSelection<T>({
  selectedKey,
  source,
  keyExtractor,
  onClear,
}: {
  selectedKey: string | null;
  source: Pick<ResourceInventorySourceState<T>, 'rows' | 'loaded' | 'loading' | 'error'>;
  keyExtractor: (row: T) => string;
  onClear?: () => void;
}): void {
  const { rows, loaded, loading, error } = source;
  useEffect(() => {
    if (!selectedKey || !onClear || !loaded || loading || error) {
      return;
    }
    if (!rows.some((row) => keyExtractor(row) === selectedKey)) {
      onClear();
    }
  }, [error, keyExtractor, loaded, loading, onClear, rows, selectedKey]);
}
