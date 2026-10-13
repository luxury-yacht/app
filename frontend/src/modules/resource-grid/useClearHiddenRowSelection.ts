import { useEffect } from 'react';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';

/**
 * A row's highlight, or a detail open under it, must stay on a visible row:
 * once the table settles on rows that no longer include some of the selected
 * rows (filtered, paged, or deleted away), onClear gets those rows' keys.
 * Loading and errored states keep them, since their rows are not the settled
 * result.
 */
export function useClearHiddenRowSelection<T>({
  selectedKeys,
  source,
  keyExtractor,
  onClear,
}: {
  selectedKeys: readonly string[];
  source: Pick<ResourceInventorySourceState<T>, 'rows' | 'loaded' | 'loading' | 'error'>;
  keyExtractor: (row: T) => string;
  onClear?: (hiddenKeys: string[]) => void;
}): void {
  const { rows, loaded, loading, error } = source;
  useEffect(() => {
    if (selectedKeys.length === 0 || !onClear || !loaded || loading || error) {
      return;
    }
    const shown = new Set(rows.map((row) => keyExtractor(row)));
    const hiddenKeys = selectedKeys.filter((key) => !shown.has(key));
    if (hiddenKeys.length > 0) {
      onClear(hiddenKeys);
    }
  }, [error, keyExtractor, loaded, loading, onClear, rows, selectedKeys]);
}
