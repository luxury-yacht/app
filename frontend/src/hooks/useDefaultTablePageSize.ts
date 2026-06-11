/**
 * frontend/src/hooks/useDefaultTablePageSize.ts
 *
 * Hook for the app-wide Default Page Size preference (Settings ▸ Display ▸
 * Tables). Re-renders when the setting changes so open tables WITHOUT a
 * persisted per-view page size pick up the new default immediately.
 */
import { useState, useEffect } from 'react';
import { eventBus } from '@/core/events';
import { getDefaultTablePageSize } from '@/core/settings/appPreferences';
import {
  normalizeTablePageSize,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';

export function useDefaultTablePageSize(): TablePageSize {
  const [defaultPageSize, setDefaultPageSize] = useState<TablePageSize>(() =>
    getDefaultTablePageSize()
  );

  useEffect(() => {
    const unsubscribe = eventBus.on('settings:default-table-page-size', (value) => {
      setDefaultPageSize(normalizeTablePageSize(value));
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return defaultPageSize;
}
