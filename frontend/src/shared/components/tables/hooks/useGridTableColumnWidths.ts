/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.ts
 *
 * React hook for useGridTableColumnWidths.
 * Encapsulates state and side effects for the shared components.
 */

import { useCallback, useRef, useState } from 'react';
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
import { reconcileColumnWidthsToContainer } from '@shared/components/tables/hooks/gridTableColumnWidthMath';

// Column width lifecycle phase. Replaces the three coupled boolean refs
// (initializedColumnsRef, isAutoSizingEnabledRef, isManualResizeActiveRef)
// with a single state machine.
//
// Valid transitions:
//   initializing → idle   (first measurement complete)
//   idle → dragging       (drag start)
//   dragging → idle       (drag end)
export type ColumnWidthPhase = 'initializing' | 'idle' | 'dragging';

const VALID_TRANSITIONS: Record<ColumnWidthPhase, ColumnWidthPhase[]> = {
  initializing: ['idle'],
  idle: ['dragging'],
  dragging: ['idle'],
};

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

  // Single phase ref + state replaces the three coupled boolean refs
  // (isManualResizeActiveRef, isAutoSizingEnabledRef, initializedColumnsRef).
  const phaseRef = useRef<ColumnWidthPhase>('initializing');
  const [phaseState, setPhaseState] = useState<ColumnWidthPhase>('initializing');

  const transitionPhase = useCallback((to: ColumnWidthPhase) => {
    if (import.meta.env.DEV) {
      const from = phaseRef.current;
      const allowed = VALID_TRANSITIONS[from];
      if (!allowed.includes(to)) {
        console.warn(
          `[ColumnWidthPhase] invalid transition: ${from} → ${to}. ` +
            `Allowed from "${from}": [${allowed.join(', ')}]`
        );
      }
    }
    phaseRef.current = to;
    setPhaseState(to);
  }, []);

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
    phaseRef,
    transitionPhase,
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
    suspendNotifications: phaseState === 'dragging',
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
      // - Skip auto-fitting while a drag is in progress.
      // - If overflow is allowed, we mostly leave widths alone unless forceFit asks us to fill space.
      // - Manually resized columns are protected below (locked as fixed) while flex columns adjust.
      if (phaseRef.current === 'dragging') {
        return base;
      }
      if (!containerWidth || containerWidth <= 0 || renderedColumns.length === 0) {
        return base;
      }

      return reconcileColumnWidthsToContainer({
        baseWidths: base,
        renderedColumns,
        naturalWidths: naturalWidthsRef.current,
        containerWidth,
        allowHorizontalOverflow,
        forceFit: options?.forceFit,
        enableColumnResizing,
        externalColumnWidths,
        manuallyResizedColumnKeys: manuallyResizedColumnsRef.current,
        isFixedColumnKey,
        getColumnMinWidth,
        getColumnMaxWidth,
      });
    },
    [enableColumnResizing, externalColumnWidths, renderedColumns, allowHorizontalOverflow]
  );

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
    isFixedColumnKey,
    phaseRef,
    transitionPhase,
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
    isInitialized: phaseState !== 'initializing',
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  };
}
