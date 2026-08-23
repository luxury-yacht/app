/**
 * frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.ts
 *
 * React hook for useGridTableColumnWidths.
 * Encapsulates state and side effects for the shared components.
 */

import {
  DEFAULT_COLUMN_MIN_WIDTH,
  detectWidthUnit,
  parseWidthInputToNumber,
} from '@shared/components/tables/GridTable.utils';
import {
  type ManualResizeEvent,
  useDirtyQueue,
} from '@shared/components/tables/hooks/useGridTableAutoWidthMeasurementQueue';
import {
  useColumnWidthState,
  useExternalWidthsSync,
  useInitialColumnMeasurement,
  useSyncRenderedColumns,
  useWatchTableData,
  useWidthsChangeNotifier,
} from '@shared/components/tables/hooks/useGridTableColumnWidths.helpers';
import type { RefObject } from 'react';
import { useCallback, useRef, useState } from 'react';

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
  controlledColumnWidths?: Record<string, ColumnWidthState> | null;
  externalColumnWidths: Record<string, number> | null;
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (payload: Record<string, ColumnWidthState>) => void;
  useShortNames: boolean;
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
}

interface ColumnWidthsResult<T> {
  columnWidths: Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  buildColumnWidthState: (key: string, width: number) => ColumnWidthState;
  updateNaturalWidth: (key: string, width: number) => void;
  markColumnsDirty: (keys: Iterable<string>) => void;
  markAllAutoColumnsDirty: () => void;
  handleManualResizeEvent: (event: ManualResizeEvent) => void;
}

const hasWidthInput = (value: ColumnWidthInput | null | undefined): boolean =>
  value !== null && value !== undefined;

const resolveControlledWidthSource = <T>(
  controlledState: ColumnWidthState,
  column: GridColumnDefinition<T> | undefined,
  manual: boolean,
  autoWidth: boolean
): ColumnWidthState['source'] => {
  if (controlledState.source) {
    return controlledState.source;
  }
  if (manual) {
    return 'user';
  }
  if (autoWidth) {
    return 'auto';
  }
  return hasWidthInput(column?.width) ? 'column' : 'table';
};

const buildControlledWidthState = <T>(
  width: number,
  controlledState: ColumnWidthState,
  column: GridColumnDefinition<T> | undefined,
  manual: boolean
): ColumnWidthState => {
  const autoWidth = controlledState.autoWidth ?? Boolean(column?.autoWidth && !manual);
  const raw = controlledState.raw ?? null;
  return {
    width,
    unit: controlledState.unit ?? 'px',
    raw,
    rawValue:
      controlledState.rawValue ??
      (typeof controlledState.raw === 'number' ? controlledState.raw : null),
    autoWidth,
    source: resolveControlledWidthSource(controlledState, column, manual, autoWidth),
    updatedAt: Date.now(),
  };
};

const parseRawWidthValue = (raw: ColumnWidthInput | null): number | null => {
  if (typeof raw === 'number') {
    return raw;
  }
  return raw ? parseWidthInputToNumber(raw) : null;
};

const resolveWidthSource = (
  manual: boolean,
  autoWidth: boolean,
  hasDeclaredWidth: boolean
): ColumnWidthState['source'] => {
  if (manual) {
    return 'user';
  }
  if (autoWidth) {
    return 'auto';
  }
  return hasDeclaredWidth ? 'column' : 'table';
};

const buildUncontrolledWidthState = <T>(
  width: number,
  column: GridColumnDefinition<T> | undefined,
  manual: boolean
): ColumnWidthState => {
  const raw = column?.width ?? null;
  const autoWidth = Boolean(column?.autoWidth) && !manual;
  return {
    width,
    unit: detectWidthUnit(raw) as ColumnWidthState['unit'],
    raw,
    rawValue: parseRawWidthValue(raw),
    autoWidth,
    source: resolveWidthSource(manual, autoWidth, hasWidthInput(column?.width)),
    updatedAt: Date.now(),
  };
};

// Main hook that keeps GridTable column widths in sync with user actions, data changes,
// and layout constraints. In plain terms, it:
// - picks starting widths (controlled state, column defaults, shared fallback)
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
    controlledColumnWidths,
    externalColumnWidths,
    enableColumnResizing,
    onColumnWidthsChange,
    useShortNames,
    measureColumnWidth,
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
        return buildControlledWidthState(width, controlledState, column, manual);
      }
      return buildUncontrolledWidthState(width, column, manual);
    },
    [controlledColumnWidths]
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

  const prevColumnsSignatureRef = useRef<string | null>(null);
  const prevShortNamesRef = useRef(useShortNames);

  useInitialColumnMeasurement({
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
  });

  return {
    columnWidths,
    setColumnWidths,
    columnsRef,
    manuallyResizedColumnsRef,
    buildColumnWidthState,
    updateNaturalWidth,
    markColumnsDirty,
    markAllAutoColumnsDirty,
    handleManualResizeEvent,
  };
}
