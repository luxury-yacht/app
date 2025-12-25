/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.ts
 *
 * React hook for useGridTableColumnWidths.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import {
  DEFAULT_COLUMN_MIN_WIDTH,
  detectWidthUnit,
  isFixedColumnKey,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import {
  useColumnWidthState,
  useExternalWidthsSync,
  useInitialMeasurementAndReconcile,
  useSyncRenderedColumns,
  useWatchTableData,
  useWidthsChangeNotifier,
} from '@shared/components/tables/hooks/useGridTableColumnWidths.helpers';
import {
  useDirtyQueue,
  type ManualResizeEvent,
} from '@shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue';

// Orchestrates all column-width concerns for GridTable: starting widths, auto
// measurement, manual resize tracking, reconciling to container space, and
// notifying persistence/controlled consumers.
const getColumnMinWidth = <T>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.minWidth);
  return parsed ?? DEFAULT_COLUMN_MIN_WIDTH;
};

const getColumnMaxWidth = <T>(column: GridColumnDefinition<T>) => {
  const parsed = parseWidthInputToNumber(column.maxWidth);
  return parsed ?? Number.POSITIVE_INFINITY;
};

import type {
  ColumnWidthInput,
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';

interface ColumnWidthsOptions<T> {
  columns: GridColumnDefinition<T>[];
  renderedColumns: GridColumnDefinition<T>[];
  tableRef: RefObject<HTMLElement | null>;
  tableData: T[];
  initialColumnWidths?: Record<string, ColumnWidthInput | undefined> | null;
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  externalColumnWidths: Record<string, number> | null;
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (payload: Record<string, ColumnWidthState>) => void;
  useShortNames: boolean;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  allowHorizontalOverflow: boolean;
}

interface ColumnWidthsResult<T> {
  columnWidths: Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  reconcileWidthsToContainer: (
    base: Record<string, number>,
    containerWidth: number,
    options?: { forceFit?: boolean }
  ) => Record<string, number>;
  buildColumnWidthState: (key: string, width: number) => ColumnWidthState;
  updateNaturalWidth: (key: string, width: number) => void;
  isInitialized: boolean;
  markColumnsDirty: (keys: Iterable<string>) => void;
  markAllAutoColumnsDirty: () => void;
  handleManualResizeEvent: (event: ManualResizeEvent) => void;
}

// Main hook that keeps GridTable column widths in sync with user actions, data changes,
// and layout constraints. In plain terms, it:
// - picks starting widths (controlled, initial overrides, column defaults)
// - lets auto-width columns grow/shrink when their visible text changes
// - leaves manually resized columns alone while fitting the rest to the container
// - listens to external width updates and notifies persistence/parents when widths change
export function useGridTableColumnWidths<T>(
  options: ColumnWidthsOptions<T>
): ColumnWidthsResult<T> {
  const {
    columns,
    renderedColumns,
    tableRef,
    tableData,
    initialColumnWidths,
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    measureColumnWidth,
    allowHorizontalOverflow,
  } = options;

  const columnsRef = useRef(renderedColumns);
  const manuallyResizedColumnsRef = useRef<Set<string>>(new Set());
  const lastAppliedExternalWidthsRef = useRef<string>('');
  const isApplyingExternalUpdateRef = useRef(false);
  const lastNotifiedWidthsRef = useRef<string>('');
  const naturalWidthsRef = useRef<Record<string, number>>({});
  const dirtyColumnsRef = useRef<Set<string>>(new Set());
  const columnHashesRef = useRef<Map<string, string>>(new Map());
  const allowShrinkColumnsRef = useRef<Set<string>>(new Set());
  const isManualResizeActiveRef = useRef(false);
  const isAutoSizingEnabledRef = useRef(true);

  const { columnWidths, setColumnWidths } = useColumnWidthState({
    columns,
    columnsRef,
    initialColumnWidths,
    controlledColumnWidths,
    naturalWidthsRef,
    manuallyResizedColumnsRef,
  });

  const updateNaturalWidth = useCallback((key: string, width: number) => {
    if (!Number.isFinite(width)) {
      return;
    }
    naturalWidthsRef.current = {
      ...naturalWidthsRef.current,
      [key]: width,
    };
  }, []);

  const { markColumnsDirty, markAllAutoColumnsDirty, handleManualResizeEvent } = useDirtyQueue({
    tableRef,
    renderedColumnsRef: columnsRef,
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
  });

  useWatchTableData({ tableData, renderedColumns, markColumnsDirty });

  useSyncRenderedColumns({
    renderedColumns,
    columnsRef,
    controlledColumnWidths,
    manuallyResizedColumnsRef,
    columnHashesRef,
    allowShrinkColumnsRef,
    dirtyColumnsRef,
    markColumnsDirty,
  });

  const buildColumnWidthState = useCallback(
    (key: string, width: number): ColumnWidthState => {
      const column = columnsRef.current.find((col) => col.key === key);
      const controlledState = controlledColumnWidths?.[key];
      const manual = manuallyResizedColumnsRef.current.has(key);

      if (controlledState) {
        const resolvedAuto = controlledState.autoWidth ?? Boolean(column?.autoWidth && !manual);
        let source = controlledState.source;
        if (!source) {
          if (manual) {
            source = 'user';
          } else if (resolvedAuto) {
            source = 'auto';
          } else if (initialColumnWidths?.[key] != null) {
            source = 'table';
          } else if (column?.width != null) {
            source = 'column';
          } else {
            source = 'table';
          }
        }

        return {
          width,
          unit: controlledState.unit ?? 'px',
          raw: controlledState.raw ?? null,
          rawValue:
            controlledState.rawValue ??
            (typeof controlledState.raw === 'number' ? controlledState.raw : null),
          autoWidth: resolvedAuto,
          source,
          updatedAt: Date.now(),
        };
      }

      const initialInput = initialColumnWidths?.[key] ?? null;
      const columnRaw = column?.width ?? null;
      const raw = columnRaw ?? initialInput;
      const parsedRawValue =
        typeof raw === 'number'
          ? raw
          : raw
            ? parseWidthInputToNumber(raw as ColumnWidthInput)
            : null;
      const autoActive = Boolean(column?.autoWidth) && !manual;

      let source: ColumnWidthState['source'] = 'column';
      if (manual) {
        source = 'user';
      } else if (initialInput != null) {
        source = 'table';
      } else if (autoActive) {
        source = 'auto';
      } else if (column?.width != null) {
        source = 'column';
      }

      return {
        width,
        unit: detectWidthUnit(raw) as ColumnWidthState['unit'],
        raw: raw ?? null,
        rawValue: parsedRawValue ?? null,
        autoWidth: autoActive,
        source,
        updatedAt: Date.now(),
      };
    },
    [controlledColumnWidths, initialColumnWidths]
  );

  useExternalWidthsSync({
    columnsRef,
    controlledColumnWidths,
    externalColumnWidths,
    setColumnWidths,
    manuallyResizedColumnsRef,
    lastAppliedExternalWidthsRef,
    isApplyingExternalUpdateRef,
    lastNotifiedWidthsRef,
  });

  useWidthsChangeNotifier({
    enableColumnResizing,
    onColumnWidthsChange,
    isApplyingExternalUpdateRef,
    columnsRef,
    columnWidths,
    buildColumnWidthState,
    lastNotifiedWidthsRef,
  });

  const reconcileWidthsToContainer = useCallback(
    (
      base: Record<string, number>,
      containerWidth: number,
      options?: { forceFit?: boolean }
    ): Record<string, number> => {
      // Adjust widths so the table fits its container without fighting the user.
      // - Skip auto-fitting while a drag is in progress or auto sizing is turned off.
      // - If overflow is allowed, we mostly leave widths alone unless forceFit asks us to fill space.
      // - Manually resized columns are protected below (locked as fixed) while flex columns adjust.
      if (!isAutoSizingEnabledRef.current || isManualResizeActiveRef.current) {
        return base;
      }
      if (!containerWidth || containerWidth <= 0 || renderedColumns.length === 0) {
        return base;
      }

      const forceFit = options?.forceFit ?? false;
      const hasMissingColumns = renderedColumns.some(
        (col) => typeof base[col.key] !== 'number' || Number.isNaN(base[col.key]!)
      );

      const resolvedWidths: Record<string, number> = {};
      renderedColumns.forEach((col) => {
        const min = getColumnMinWidth(col);
        const max = getColumnMaxWidth(col);
        let width = base[col.key];
        if (typeof width !== 'number' || Number.isNaN(width)) {
          width = naturalWidthsRef.current[col.key];
        }
        if (typeof width !== 'number' || Number.isNaN(width)) {
          width = parseWidthInputToNumber(col.width) ?? min;
        }
        width = Math.max(min, Math.min(max, width));
        resolvedWidths[col.key] = width;
      });

      // With horizontal overflow, honor the provided widths unless we explicitly need to fill.
      if (allowHorizontalOverflow) {
        if (!forceFit) {
          return resolvedWidths;
        }

        const flexColumns = renderedColumns.filter(
          (col) => !isFixedColumnKey(col.key) && !manuallyResizedColumnsRef.current.has(col.key)
        );

        if (flexColumns.length === 0) {
          return resolvedWidths;
        }

        const next = { ...resolvedWidths };
        const naturalTotal = flexColumns.reduce((sum, col) => sum + (next[col.key] ?? 0), 0);
        const targetTotal = Math.max(containerWidth, naturalTotal);
        let remaining = Math.max(0, targetTotal - naturalTotal);

        let adjustable = flexColumns.filter((col) => next[col.key] < getColumnMaxWidth(col) - 0.5);

        while (remaining > 0 && adjustable.length > 0) {
          const share = Math.max(1, Math.floor(remaining / adjustable.length));
          const nextAdjustable: GridColumnDefinition<T>[] = [];

          adjustable.forEach((col) => {
            if (remaining <= 0) {
              return;
            }
            const key = col.key;
            const max = getColumnMaxWidth(col);
            const current = next[key];
            const capacity = Math.max(0, max - current);
            if (capacity <= 0.5) {
              return;
            }
            const delta = Math.min(share, capacity, remaining);
            next[key] = current + delta;
            remaining -= delta;
            if (capacity - delta > 0.5) {
              nextAdjustable.push(col);
            }
          });

          adjustable = nextAdjustable;
          if (nextAdjustable.length === 0) {
            break;
          }
        }

        return next;
      }

      // Without overflow, spread the remaining container space across flex columns while
      // leaving fixed/locked widths alone.
      const lockedKeys = new Set<string>();
      if (!enableColumnResizing && externalColumnWidths) {
        Object.keys(externalColumnWidths).forEach((key) => lockedKeys.add(key));
      }
      manuallyResizedColumnsRef.current.forEach((key) => lockedKeys.add(key));
      const lockedKeysSet = lockedKeys.size > 0 ? lockedKeys : null;

      const fixedColumns = renderedColumns.filter((col) => {
        if (isFixedColumnKey(col.key)) {
          return true;
        }
        return lockedKeysSet?.has(col.key) ?? false;
      });

      const fixedColumnKeys = new Set(fixedColumns.map((col) => col.key));
      const flexColumns = renderedColumns.filter((col) => !fixedColumnKeys.has(col.key));

      if (flexColumns.length === 0) {
        return resolvedWidths;
      }

      const updated: Record<string, number> = { ...resolvedWidths };
      let mutated = false;

      const fixedWidth = fixedColumns.reduce((sum, col) => sum + (updated[col.key] ?? 0), 0);
      const targetFlexWidth = containerWidth - fixedWidth;

      if (targetFlexWidth <= 0) {
        return updated;
      }

      const allColumnsProvided = !hasMissingColumns;
      if (allColumnsProvided) {
        return updated;
      }

      const currentFlexTotal = flexColumns.reduce((sum, col) => sum + (updated[col.key] ?? 0), 0);

      if (currentFlexTotal <= 0) {
        const widthPer = Math.floor(targetFlexWidth / flexColumns.length);
        let remainder = targetFlexWidth - widthPer * flexColumns.length;

        flexColumns.forEach((col, index) => {
          let width = widthPer;
          if (index === 0) {
            width += remainder;
          }
          width = Math.max(getColumnMinWidth(col), Math.min(getColumnMaxWidth(col), width));
          if (updated[col.key] !== width) {
            updated[col.key] = width;
            mutated = true;
          }
        });

        return mutated || hasMissingColumns ? updated : base;
      }

      const scale = targetFlexWidth / currentFlexTotal;

      flexColumns.forEach((col) => {
        const prevWidth = updated[col.key] ?? 0;
        let width = Math.round(prevWidth * scale);
        const min = getColumnMinWidth(col);
        const max = getColumnMaxWidth(col);
        if (width < min) width = min;
        if (width > max) width = max;
        if (width !== prevWidth) {
          updated[col.key] = width;
          mutated = true;
        }
      });

      const adjustedFlexTotal = flexColumns.reduce((sum, col) => sum + (updated[col.key] ?? 0), 0);
      let delta = Math.round(targetFlexWidth - adjustedFlexTotal);

      if (delta !== 0) {
        const adjustables = [...flexColumns].reverse();
        for (const col of adjustables) {
          const key = col.key;
          const min = getColumnMinWidth(col);
          const max = getColumnMaxWidth(col);
          const current = updated[key] ?? 0;

          if (delta > 0 && current < max) {
            const increase = Math.min(delta, max - current);
            if (increase > 0) {
              updated[key] = current + increase;
              delta -= increase;
              mutated = true;
            }
          } else if (delta < 0 && current > min) {
            const decrease = Math.min(Math.abs(delta), current - min);
            if (decrease > 0) {
              updated[key] = current - decrease;
              delta += decrease;
              mutated = true;
            }
          }

          if (delta === 0) {
            break;
          }
        }
      }

      const shouldReturnUpdated = mutated || hasMissingColumns;
      return shouldReturnUpdated ? updated : base;
    },
    [enableColumnResizing, externalColumnWidths, renderedColumns, allowHorizontalOverflow]
  );

  const initializedColumnsRef = useRef(false);
  const prevColumnsSignatureRef = useRef<string | null>(null);
  const prevShortNamesRef = useRef(useShortNames);

  useInitialMeasurementAndReconcile({
    tableRef,
    renderedColumns,
    measureColumnWidth,
    manuallyResizedColumnsRef,
    columnWidths,
    naturalWidthsRef,
    externalColumnWidths,
    reconcileWidthsToContainer,
    setColumnWidths,
    useShortNames,
    allowHorizontalOverflow,
    getColumnMinWidth,
    getColumnMaxWidth,
    parseWidthInputToNumber,
    isFixedColumnKey,
    initializedColumnsRef,
    prevColumnsSignatureRef,
    prevShortNamesRef,
    tableData,
  });

  return {
    columnWidths,
    setColumnWidths,
    columnsRef,
    manuallyResizedColumnsRef,
    reconcileWidthsToContainer,
    buildColumnWidthState,
    updateNaturalWidth,
    isInitialized: initializedColumnsRef.current,
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  };
}
