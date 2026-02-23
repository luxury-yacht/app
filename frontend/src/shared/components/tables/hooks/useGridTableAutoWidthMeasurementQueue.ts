/**
 * frontend/src/shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue.ts
 *
 * React hook for useGridTableAutoWidthMeasurementQueue.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

// Auto-width measurement queue for GridTable.
// - When a column is marked autoWidth, we keep an eye on its rendered text/content.
// - If that content changes, we remeasure the column—but only after a short debounce so the UI
//   does not jitter during fast updates or virtualization.
// - If the user has manually resized a column, we leave it alone until they reset it.
// - We remember a simple “content signature” so we don’t keep remeasuring when nothing changed.

const DIRTY_DEBOUNCE_MS = 280;
const DIRTY_MIN_INTERVAL_MS = 200;
const WIDTH_EPSILON = 0.5;

export type ManualResizeEvent = {
  type: 'dragStart' | 'drag' | 'dragEnd' | 'autoSize' | 'reset';
  columns: string[];
};

type DirtyQueueOptions<T> = {
  tableRef: RefObject<HTMLElement | null>;
  renderedColumnsRef: RefObject<GridColumnDefinition<T>[]>;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  naturalWidthsRef: RefObject<Record<string, number>>;
  dirtyColumnsRef: RefObject<Set<string>>;
  columnHashesRef: RefObject<Map<string, string>>;
  allowShrinkColumnsRef: RefObject<Set<string>>;
  isManualResizeActiveRef: RefObject<boolean>;
  isAutoSizingEnabledRef: RefObject<boolean>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
};

export type DirtyQueueResult = {
  markColumnsDirty: (keys: Iterable<string>) => void;
  markAllAutoColumnsDirty: () => void;
  handleManualResizeEvent: (event: ManualResizeEvent) => void;
};

const createVisibleColumnSignature = (
  tableRef: RefObject<HTMLElement | null>,
  columnKey: string
): string | null => {
  const table = tableRef.current;
  if (!table) {
    return null;
  }
  const escapedKey =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(columnKey)
      : columnKey;
  const selector = `.grid-cell[data-column="${escapedKey}"] .grid-cell-content`;
  const nodes = table.querySelectorAll<HTMLElement>(selector);
  if (nodes.length === 0) {
    return null;
  }
  const parts: string[] = [];
  nodes.forEach((node, index) => {
    const rect = node.getBoundingClientRect();
    const width = Number.isFinite(rect.width) ? Math.round(rect.width) : 0;
    const text = node.textContent ?? '';
    parts.push(`${index}:${width}:${text}`);
  });
  return parts.join('|');
};

export function useDirtyQueue<T>({
  tableRef,
  renderedColumnsRef,
  manuallyResizedColumnsRef,
  naturalWidthsRef,
  dirtyColumnsRef,
  columnHashesRef,
  allowShrinkColumnsRef,
  isManualResizeActiveRef,
  isAutoSizingEnabledRef,
  setColumnWidths,
  measureColumnWidth,
  getColumnMinWidth,
  getColumnMaxWidth,
}: DirtyQueueOptions<T>): DirtyQueueResult {
  // Debounced auto-width measurement queue that only re-measures columns when their visible
  // contents change and skips anything the user has manually resized.
  const dirtyTimerRef = useRef<number | null>(null);
  const lastDirtyFlushRef = useRef<number>(0);
  const pendingRetryRef = useRef(false);
  const isMountedRef = useRef(true);
  const flushDirtyColumnsRef = useRef<(() => void) | null>(null);

  const scheduleDirtyFlush = useCallback((delay: number = DIRTY_DEBOUNCE_MS) => {
    if (typeof window === 'undefined') {
      return;
    }
    if (dirtyTimerRef.current != null) {
      window.clearTimeout(dirtyTimerRef.current);
    }
    dirtyTimerRef.current = window.setTimeout(() => {
      dirtyTimerRef.current = null;
      flushDirtyColumnsRef.current?.();
    }, delay);
  }, []);

  const markColumnsDirty = useCallback(
    (keys: Iterable<string>) => {
      // Queue autoWidth columns for measurement unless a manual drag is in progress.
      if (!isAutoSizingEnabledRef.current || isManualResizeActiveRef.current) {
        return;
      }
      let added = false;
      const dirty = dirtyColumnsRef.current;
      const columns = renderedColumnsRef.current;
      for (const key of keys) {
        if (!key) continue;
        const column = columns.find((col) => col.key === key);
        if (!column || !column.autoWidth) {
          continue;
        }
        if (manuallyResizedColumnsRef.current.has(key)) {
          continue;
        }
        if (!dirty.has(key)) {
          dirty.add(key);
          added = true;
        }
      }
      if (added) {
        scheduleDirtyFlush();
      }
    },
    [
      renderedColumnsRef,
      manuallyResizedColumnsRef,
      scheduleDirtyFlush,
      dirtyColumnsRef,
      isAutoSizingEnabledRef,
      isManualResizeActiveRef,
    ]
  );

  const markAllAutoColumnsDirty = useCallback(() => {
    if (!isAutoSizingEnabledRef.current) {
      return;
    }
    markColumnsDirty(renderedColumnsRef.current.map((col) => col.key));
  }, [markColumnsDirty, renderedColumnsRef, isAutoSizingEnabledRef]);

  const handleManualResizeEvent = useCallback(
    (event: ManualResizeEvent) => {
      const { type, columns: keys } = event;
      if (!Array.isArray(keys) || keys.length === 0) {
        return;
      }

      if (type === 'dragStart' || type === 'autoSize') {
        if (isAutoSizingEnabledRef.current) {
          isAutoSizingEnabledRef.current = false;
          dirtyColumnsRef.current.clear();
          columnHashesRef.current.clear();
          allowShrinkColumnsRef.current.clear();
          if (dirtyTimerRef.current != null && typeof window !== 'undefined') {
            window.clearTimeout(dirtyTimerRef.current);
          }
          dirtyTimerRef.current = null;
        }
      }

      if (type === 'dragStart') {
        isManualResizeActiveRef.current = true;
        return;
      }

      const dirty = dirtyColumnsRef.current;
      keys.forEach((key) => {
        if (!key) {
          return;
        }
        dirty.delete(key);
        if (type === 'drag' || type === 'dragEnd') {
          columnHashesRef.current.delete(key);
          allowShrinkColumnsRef.current.delete(key);
        } else {
          allowShrinkColumnsRef.current.add(key);
        }
      });

      if (type === 'dragEnd') {
        isManualResizeActiveRef.current = false;
        if (isAutoSizingEnabledRef.current) {
          scheduleDirtyFlush(DIRTY_DEBOUNCE_MS);
        }
        return;
      }

      if (type === 'autoSize' || type === 'reset') {
        // Re-enable auto-sizing so markColumnsDirty proceeds. The disabling
        // block above cleared stale queue state; now we re-enable before
        // queueing the measurement.
        isAutoSizingEnabledRef.current = true;
        if (type === 'reset') {
          dirtyColumnsRef.current.clear();
          columnHashesRef.current.clear();
          allowShrinkColumnsRef.current.clear();
        }
        markColumnsDirty(keys);
        if (type === 'reset') {
          markColumnsDirty(renderedColumnsRef.current.map((col) => col.key));
        }
      }
    },
    [
      markColumnsDirty,
      renderedColumnsRef,
      scheduleDirtyFlush,
      allowShrinkColumnsRef,
      columnHashesRef,
      dirtyColumnsRef,
      isAutoSizingEnabledRef,
      isManualResizeActiveRef,
    ]
  );

  const flushDirtyColumns = useCallback(() => {
    // Take care of any columns flagged as "dirty" by measuring them again.
    // We skip work if their on-screen content hasn’t changed, and we reschedule if cells
    // are not rendered yet (common with virtualization).
    if (!isMountedRef.current) {
      return;
    }
    if (dirtyColumnsRef.current.size === 0) {
      pendingRetryRef.current = false;
      return;
    }

    const now = Date.now();
    const sinceLast = now - lastDirtyFlushRef.current;
    if (sinceLast < DIRTY_MIN_INTERVAL_MS) {
      scheduleDirtyFlush(DIRTY_MIN_INTERVAL_MS - sinceLast);
      return;
    }

    lastDirtyFlushRef.current = now;
    const dirtyKeys = Array.from(dirtyColumnsRef.current);
    dirtyColumnsRef.current.clear();

    if (dirtyKeys.length === 0) {
      return;
    }

    const retryKeys: string[] = [];
    const updates: Record<string, number> = {};

    dirtyKeys.forEach((key) => {
      const column = renderedColumnsRef.current.find((col) => col.key === key);
      if (!column || !column.autoWidth) {
        columnHashesRef.current.delete(key);
        allowShrinkColumnsRef.current.delete(key);
        return;
      }
      if (manuallyResizedColumnsRef.current.has(key)) {
        columnHashesRef.current.delete(key);
        allowShrinkColumnsRef.current.delete(key);
        return;
      }

      const signature = createVisibleColumnSignature(tableRef, key);
      if (signature == null) {
        retryKeys.push(key);
        return;
      }

      const prevSignature = columnHashesRef.current.get(key);
      const allowShrink = allowShrinkColumnsRef.current.has(key);
      if (prevSignature === signature && !allowShrink) {
        return;
      }

      columnHashesRef.current.set(key, signature);

      const measured = measureColumnWidth(column);
      const min = getColumnMinWidth(column);
      const max = getColumnMaxWidth(column);
      const clamped = Math.max(min, Math.min(max, measured));
      const current = naturalWidthsRef.current[column.key] ?? min;

      if (clamped > current + WIDTH_EPSILON || (allowShrink && clamped < current - WIDTH_EPSILON)) {
        updates[key] = clamped;
      } else if (allowShrink) {
        allowShrinkColumnsRef.current.delete(key);
      }
    });

    // If cells are not yet rendered, retry a moment later.
    if (retryKeys.length > 0) {
      retryKeys.forEach((key) => dirtyColumnsRef.current.add(key));
      pendingRetryRef.current = true;
      scheduleDirtyFlush(50);
    } else {
      pendingRetryRef.current = false;
    }

    if (Object.keys(updates).length === 0) {
      return;
    }

    setColumnWidths((prev) => {
      let mutated = false;
      const next = { ...prev };
      Object.entries(updates).forEach(([key, value]) => {
        if (Math.abs((prev[key] ?? 0) - value) > WIDTH_EPSILON) {
          next[key] = value;
          mutated = true;
        }
      });
      if (!mutated) {
        return prev;
      }
      return next;
    });

    Object.entries(updates).forEach(([key, value]) => {
      naturalWidthsRef.current[key] = value;
      allowShrinkColumnsRef.current.delete(key);
    });
  }, [
    allowShrinkColumnsRef,
    columnHashesRef,
    dirtyColumnsRef,
    getColumnMaxWidth,
    getColumnMinWidth,
    manuallyResizedColumnsRef,
    measureColumnWidth,
    naturalWidthsRef,
    renderedColumnsRef,
    scheduleDirtyFlush,
    setColumnWidths,
    tableRef,
  ]);

  flushDirtyColumnsRef.current = flushDirtyColumns;

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (dirtyTimerRef.current != null && typeof window !== 'undefined') {
        window.clearTimeout(dirtyTimerRef.current);
      }
    };
  }, []);

  return {
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  };
}
