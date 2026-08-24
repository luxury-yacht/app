/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.helpers.ts
 *
 * React hook for useGridTableColumnWidths.helpers.
 * Encapsulates state and side effects for the shared components.
 */

import type {
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';
import { parseWidthInputToNumber } from '@shared/components/tables/GridTable.utils';
import {
  buildInitialMeasuredColumnWidthPlan,
  isUserOwnedColumnWidth,
} from '@shared/components/tables/hooks/gridTableColumnWidthMath';
import type { ColumnWidthPhase } from '@shared/components/tables/hooks/useGridTableColumnWidths';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const getAutoSizeMaxWidth = <T>(
  column: GridColumnDefinition<T>,
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number
) => {
  const configuredMaxWidth = getColumnMaxWidth(column);
  const autoSizeMaxWidth = parseWidthInputToNumber(column.autoSizeMaxWidth);
  return autoSizeMaxWidth !== null && autoSizeMaxWidth !== undefined
    ? Math.min(configuredMaxWidth, autoSizeMaxWidth)
    : configuredMaxWidth;
};

// Helper hooks extracted from useGridTableColumnWidths to reduce file size and clarify intent.
// They cover local state init, syncing rendered columns, reacting to data changes,
// reconciling external widths, and notifying parents/persistence.

// Manages local column width state.
// Picks a starting width for every column (controlled state, column default, then fallback),
// and whenever a user manually resizes a column we remember that width as the new “natural” size.
export function useColumnWidthState<T>({
  columns,
  controlledColumnWidths,
  naturalWidthsRef,
  manuallyResizedColumnsRef,
}: {
  columns: GridColumnDefinition<T>[];
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  naturalWidthsRef: RefObject<Record<string, number>>;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
}): {
  columnWidths: Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
} {
  const [columnWidths, setColumnWidthsState] = useState<Record<string, number>>(() => {
    manuallyResizedColumnsRef.current = new Set();
    const initialWidths: Record<string, number> = {};

    // Seed widths from controlled state, column defaults, or the shared fallback.
    columns.forEach((col) => {
      const controlledState = controlledColumnWidths?.[col.key];
      const controlled = controlledState?.width;
      if (typeof controlled === 'number' && !Number.isNaN(controlled)) {
        initialWidths[col.key] = controlled;
        naturalWidthsRef.current[col.key] = controlled;
        return;
      }

      const columnParsed = parseWidthInputToNumber(col.width);
      if (columnParsed !== null && columnParsed !== undefined) {
        initialWidths[col.key] = columnParsed;
        naturalWidthsRef.current[col.key] = columnParsed;
        return;
      }

      initialWidths[col.key] = 150;
      naturalWidthsRef.current[col.key] = 150;
    });

    return initialWidths;
  });

  const setColumnWidths = useCallback((updater: React.SetStateAction<Record<string, number>>) => {
    setColumnWidthsState((prev) => {
      const next =
        typeof updater === 'function'
          ? (updater as (prev: Record<string, number>) => Record<string, number>)(prev)
          : updater;

      if (next === prev) {
        return prev;
      }

      // Hidden columns can be reset before visibility is restored, so compare
      // the complete width state rather than only the currently rendered keys.
      let changed = false;
      const widthKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const key of widthKeys) {
        if (Math.abs((prev[key] ?? 0) - (next[key] ?? 0)) > 0.1) {
          changed = true;
          break;
        }
      }

      if (!changed) {
        return prev;
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const manualKeys = manuallyResizedColumnsRef.current;
    if (manualKeys.size > 0) {
      const nextNatural = { ...naturalWidthsRef.current };
      manualKeys.forEach((key) => {
        const width = columnWidths[key];
        if (typeof width === 'number' && !Number.isNaN(width)) {
          nextNatural[key] = width;
        }
      });
      naturalWidthsRef.current = nextNatural;
    }
  }, [columnWidths, manuallyResizedColumnsRef, naturalWidthsRef]);

  return { columnWidths, setColumnWidths };
}

// Keeps renderedColumns aligned with our refs, prunes stale manual flags/hashes,
// and marks all rendered columns dirty when the set changes so auto-sizing can catch up.
export function useSyncRenderedColumns<T>({
  renderedColumns,
  columnsRef,
  controlledColumnWidths,
  manuallyResizedColumnsRef,
  columnHashesRef,
  allowShrinkColumnsRef,
  dirtyColumnsRef,
  markColumnsDirty,
}: {
  renderedColumns: GridColumnDefinition<T>[];
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  columnHashesRef: RefObject<Map<string, string>>;
  allowShrinkColumnsRef: RefObject<Set<string>>;
  dirtyColumnsRef: RefObject<Set<string>>;
  markColumnsDirty: (keys: Iterable<string>) => void;
}) {
  useEffect(() => {
    columnsRef.current = renderedColumns;

    // Track controlled/manual widths so we don't override user intent when columns change.
    const controlledManualKeys = new Set<string>();
    renderedColumns.forEach((column) => {
      const state = controlledColumnWidths?.[column.key];
      if (!state) {
        return;
      }
      const manual = isUserOwnedColumnWidth(state, column);
      if (manual) {
        controlledManualKeys.add(column.key);
      }
    });

    const currentManual = manuallyResizedColumnsRef.current;
    const renderedKeys = new Set(renderedColumns.map((column) => column.key));

    Array.from(currentManual).forEach((key) => {
      if (!renderedKeys.has(key) && !controlledManualKeys.has(key)) {
        currentManual.delete(key);
      }
    });
    controlledManualKeys.forEach((key) => {
      currentManual.add(key);
    });

    const currentHashes = columnHashesRef.current;
    Array.from(currentHashes.keys()).forEach((key) => {
      if (!renderedKeys.has(key)) {
        currentHashes.delete(key);
        allowShrinkColumnsRef.current.delete(key);
        dirtyColumnsRef.current.delete(key);
      }
    });

    // When columns change, trigger remeasurement for all visible columns.
    markColumnsDirty(renderedColumns.map((column) => column.key));
  }, [
    allowShrinkColumnsRef,
    columnHashesRef,
    columnsRef,
    controlledColumnWidths,
    dirtyColumnsRef,
    manuallyResizedColumnsRef,
    markColumnsDirty,
    renderedColumns,
  ]);
}

// Applies external width payloads while respecting manual/controlled intent, and de-dupes via a simple signature.
export function useExternalWidthsSync<T>({
  columnsRef,
  controlledColumnWidths,
  externalColumnWidths,
  setColumnWidths,
  manuallyResizedColumnsRef,
  lastAppliedExternalWidthsRef,
  isApplyingExternalUpdateRef,
  lastNotifiedWidthsRef,
}: {
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  externalColumnWidths: Record<string, number> | null;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  lastAppliedExternalWidthsRef: RefObject<string>;
  isApplyingExternalUpdateRef: RefObject<boolean>;
  lastNotifiedWidthsRef: RefObject<string>;
}) {
  // Tracks whether the external width sync actually changed any widths.
  // Using a ref instead of a local variable avoids a potential stale-closure
  // issue if React defers the state updater execution.
  const didChangeRef = useRef(false);

  useEffect(() => {
    if (!externalColumnWidths) {
      return;
    }

    // Only apply widths for rendered columns and avoid churn by comparing signatures.
    const payloadForColumns: Record<string, number> = {};
    columnsRef.current.forEach((col) => {
      const width = externalColumnWidths[col.key];
      if (typeof width === 'number' && !Number.isNaN(width)) {
        payloadForColumns[col.key] = width;
      }
    });

    const serializedPayload = JSON.stringify(payloadForColumns);
    if (serializedPayload === lastAppliedExternalWidthsRef.current) {
      return;
    }

    lastAppliedExternalWidthsRef.current = serializedPayload;

    didChangeRef.current = false;
    isApplyingExternalUpdateRef.current = true;

    setColumnWidths((prev) => {
      const next = { ...prev };

      columnsRef.current.forEach((col) => {
        const externalWidth = payloadForColumns[col.key];
        if (typeof externalWidth !== 'number') {
          return;
        }

        // Respect controlled/manual columns by carrying their manual flag forward.
        const controlledState = controlledColumnWidths?.[col.key];
        const manual = controlledState ? isUserOwnedColumnWidth(controlledState, col) : false;

        if (manual) {
          manuallyResizedColumnsRef.current.add(col.key);
        } else {
          manuallyResizedColumnsRef.current.delete(col.key);
        }

        if (Math.abs((prev[col.key] ?? 0) - externalWidth) > 0.5) {
          next[col.key] = externalWidth;
          didChangeRef.current = true;
        }
      });

      return didChangeRef.current ? next : prev;
    });

    const resetFlag = () => {
      isApplyingExternalUpdateRef.current = false;
      if (didChangeRef.current) {
        lastNotifiedWidthsRef.current = serializedPayload;
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(resetFlag);
    } else {
      setTimeout(resetFlag, 0);
    }
  }, [
    columnsRef,
    controlledColumnWidths,
    externalColumnWidths,
    isApplyingExternalUpdateRef,
    lastAppliedExternalWidthsRef,
    lastNotifiedWidthsRef,
    manuallyResizedColumnsRef,
    setColumnWidths,
  ]);
}

// Emits width change notifications only when the signature changes and no external update is in progress.
export function useWidthsChangeNotifier<T>({
  enableColumnResizing,
  onColumnWidthsChange,
  suspendNotifications,
  isApplyingExternalUpdateRef,
  columnsRef,
  columnWidths,
  buildColumnWidthState,
  lastNotifiedWidthsRef,
}: {
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (payload: Record<string, ColumnWidthState>) => void;
  suspendNotifications: boolean;
  isApplyingExternalUpdateRef: RefObject<boolean>;
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  columnWidths: Record<string, number>;
  buildColumnWidthState: (key: string, width: number) => ColumnWidthState;
  lastNotifiedWidthsRef: RefObject<string>;
}) {
  useEffect(() => {
    if (
      !enableColumnResizing ||
      !onColumnWidthsChange ||
      suspendNotifications ||
      isApplyingExternalUpdateRef.current
    ) {
      return;
    }

    // Emit only when the width signature changes to avoid noisy callers.
    const payload: Record<string, ColumnWidthState> = {};
    const widthSignaturePayload: Record<string, number> = {};

    columnsRef.current.forEach((col) => {
      const width = columnWidths[col.key];
      if (typeof width === 'number' && !Number.isNaN(width)) {
        widthSignaturePayload[col.key] = width;
        payload[col.key] = buildColumnWidthState(col.key, width);
      }
    });

    const serialized = JSON.stringify(widthSignaturePayload);
    if (serialized === lastNotifiedWidthsRef.current) {
      return;
    }

    lastNotifiedWidthsRef.current = serialized;
    onColumnWidthsChange(payload);
  }, [
    buildColumnWidthState,
    columnWidths,
    columnsRef,
    enableColumnResizing,
    isApplyingExternalUpdateRef,
    lastNotifiedWidthsRef,
    onColumnWidthsChange,
    suspendNotifications,
  ]);
}

// Measures automatic columns after render on initialization, column changes, label-mode changes,
// and every replacement data page. Page measurement reads the full data page directly, so it does
// not depend on whether virtualization or a loading transition has committed visible cells yet.
export function useGridTableAutoWidthMeasurement<T>({
  tableRef,
  renderedColumns,
  measureColumnWidth,
  manuallyResizedColumnsRef,
  columnWidths,
  naturalWidthsRef,
  externalColumnWidths,
  setColumnWidths,
  useShortNames,
  getColumnMinWidth,
  getColumnMaxWidth,
  phaseRef,
  transitionPhase,
  prevColumnsSignatureRef,
  prevShortNamesRef,
  tableData,
}: {
  tableRef: RefObject<HTMLElement | null>;
  renderedColumns: GridColumnDefinition<T>[];
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  columnWidths: Record<string, number>;
  naturalWidthsRef: RefObject<Record<string, number>>;
  externalColumnWidths: Record<string, number> | null;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  useShortNames: boolean;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
  phaseRef: RefObject<ColumnWidthPhase>;
  transitionPhase: (to: ColumnWidthPhase) => void;
  prevColumnsSignatureRef: RefObject<string | null>;
  prevShortNamesRef: RefObject<boolean>;
  tableData: T[];
}) {
  const lastMeasuredTableDataRef = useRef<T[] | null>(null);
  useEffect(() => {
    if (!tableRef.current || renderedColumns.length === 0) {
      return;
    }

    const columnsSignature = renderedColumns
      .map(
        (col) =>
          `${col.key}:${col.width ?? ''}:${col.minWidth ?? ''}:${col.maxWidth ?? ''}:${col.autoSizeMaxWidth ?? ''}`
      )
      .join('|');

    const needsInitialization = phaseRef.current === 'initializing';
    const columnsChanged = prevColumnsSignatureRef.current !== columnsSignature;
    const shortNamesChanged = prevShortNamesRef.current !== useShortNames;
    const replacementDataNeedsMeasurement =
      lastMeasuredTableDataRef.current !== tableData && tableData.length > 0;

    if (
      !needsInitialization &&
      !columnsChanged &&
      !shortNamesChanged &&
      !replacementDataNeedsMeasurement
    ) {
      return;
    }

    const rafHandle = requestAnimationFrame(() => {
      const measuredAutoWidths: Record<string, number> = {};
      renderedColumns
        .filter((col) => col.autoWidth)
        .forEach((col) => {
          if (manuallyResizedColumnsRef.current.has(col.key)) {
            return;
          }
          const measured = measureColumnWidth(col);
          const min = getColumnMinWidth(col);
          const max = getAutoSizeMaxWidth(col, getColumnMaxWidth);
          measuredAutoWidths[col.key] = Math.max(min, Math.min(max, measured));
        });

      const plan = buildInitialMeasuredColumnWidthPlan({
        renderedColumns,
        columnWidths,
        measuredAutoWidths,
        externalColumnWidths,
        manuallyResizedColumnKeys: manuallyResizedColumnsRef.current,
        measureColumnWidth,
        getColumnMinWidth,
        getColumnMaxWidth,
      });
      naturalWidthsRef.current = plan.naturalWidths;
      setColumnWidths(plan.widths);

      prevColumnsSignatureRef.current = columnsSignature;
      prevShortNamesRef.current = useShortNames;
      lastMeasuredTableDataRef.current = tableData;
      if (phaseRef.current === 'initializing') {
        transitionPhase('idle');
      }
    });

    return () => cancelAnimationFrame(rafHandle);
  }, [
    columnWidths,
    externalColumnWidths,
    getColumnMaxWidth,
    getColumnMinWidth,
    manuallyResizedColumnsRef,
    measureColumnWidth,
    naturalWidthsRef,
    phaseRef,
    prevColumnsSignatureRef,
    prevShortNamesRef,
    renderedColumns,
    setColumnWidths,
    tableData,
    tableRef,
    transitionPhase,
    useShortNames,
  ]);
}
