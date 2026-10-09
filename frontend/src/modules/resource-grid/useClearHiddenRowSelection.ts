import { useEffect } from 'react';
import type { ResourceInventorySourceState } from './useResourceInventoryTable';

/**
 * A split view's row selection narrows the pane below it, so it must stay
 * visible: once the table settles on rows that no longer include the selected
 * one (filtered, paged, or deleted away), the selection clears. Loading and
 * errored states keep it, since their rows are not the settled result.
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
