/**
 * frontend/src/shared/components/tables/hooks/useGridTableExternalWidths.ts
 *
 * React hook for useGridTableExternalWidths.
 * Encapsulates state and side effects for the shared components.
 */

import { useMemo } from 'react';
import type { ColumnWidthState } from '@shared/components/tables/GridTable.types';

export function useGridTableExternalWidths(
  controlledColumnWidths: Record<string, ColumnWidthState> | null
): Record<string, number> | null {
  return useMemo(() => {
    if (!controlledColumnWidths) {
      return null;
    }
    const map: Record<string, number> = {};
    Object.entries(controlledColumnWidths).forEach(([key, state]) => {
      if (state && typeof state.width === 'number' && !Number.isNaN(state.width)) {
        map[key] = state.width;
      }
    });
    return Object.keys(map).length > 0 ? map : null;
  }, [controlledColumnWidths]);
}
