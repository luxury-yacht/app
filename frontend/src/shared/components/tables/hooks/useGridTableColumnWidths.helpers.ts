import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { parseWidthInputToNumber } from '@shared/components/tables/GridTable.utils';
import type {
  ColumnWidthInput,
  ColumnWidthState,
  GridColumnDefinition,
} from '@shared/components/tables/GridTable.types';

// Helper hooks extracted from useGridTableColumnWidths to reduce file size and clarify intent.
// They cover local state init, syncing rendered columns, reacting to data changes,
// reconciling external widths, and notifying parents/persistence.

// Manages local column width state.
// Picks a starting width for every column (Controlled beats Initial beats Column Default beats Fallback),
// and whenever a user manually resizes a column we remember that width as the new “natural” size.
export function useColumnWidthState<T>({
  columns,
  columnsRef,
  initialColumnWidths,
  controlledColumnWidths,
  naturalWidthsRef,
  manuallyResizedColumnsRef,
}: {
  columns: GridColumnDefinition<T>[];
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  initialColumnWidths?: Record<string, ColumnWidthInput | undefined> | null;
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

    // Seed widths from (1) controlled, (2) initial overrides, (3) column defaults, (4) fallbacks.
    columns.forEach((col) => {
      const controlledState = controlledColumnWidths?.[col.key];
      const controlled = controlledState?.width;
      if (typeof controlled === 'number' && !Number.isNaN(controlled)) {
        initialWidths[col.key] = controlled;
        naturalWidthsRef.current[col.key] = controlled;
        return;
      }

      const initialInput = initialColumnWidths?.[col.key];
      const initialParsed = parseWidthInputToNumber(initialInput);
      if (initialParsed != null) {
        initialWidths[col.key] = initialParsed;
        naturalWidthsRef.current[col.key] = initialParsed;
        return;
      }

      const columnParsed = parseWidthInputToNumber(col.width);
      if (columnParsed != null) {
        initialWidths[col.key] = columnParsed;
        naturalWidthsRef.current[col.key] = columnParsed;
        return;
      }

      if (col.key === 'kind' || col.key === 'type') {
        initialWidths[col.key] = 100;
        naturalWidthsRef.current[col.key] = 100;
      } else if (col.key === 'name') {
        initialWidths[col.key] = 250;
        naturalWidthsRef.current[col.key] = 250;
      } else {
        initialWidths[col.key] = 150;
        naturalWidthsRef.current[col.key] = 150;
      }
    });

    return initialWidths;
  });

  const setColumnWidths = useCallback(
    (updater: React.SetStateAction<Record<string, number>>) => {
      setColumnWidthsState((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: Record<string, number>) => Record<string, number>)(prev)
            : updater;

        if (next === prev) {
          return prev;
        }

        // Only treat as a change when a visible column moves by a perceptible delta.
        let changed = false;
        for (const col of columnsRef.current) {
          const key = col.key;
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
    },
    [columnsRef]
  );

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

export function useWatchTableData<T>({
  tableData,
  renderedColumns,
  markColumnsDirty,
}: {
  tableData: T[];
  renderedColumns: GridColumnDefinition<T>[];
  markColumnsDirty: (keys: Iterable<string>) => void;
}) {
  const lastTableDataRef = useRef<T[] | null>(tableData);
  const lastTableLengthRef = useRef<number>(Array.isArray(tableData) ? tableData.length : 0);

  useEffect(() => {
    const currentLength = Array.isArray(tableData) ? tableData.length : 0;
    if (lastTableDataRef.current !== tableData || lastTableLengthRef.current !== currentLength) {
      lastTableDataRef.current = tableData;
      lastTableLengthRef.current = currentLength;
      // When the dataset changes, re-measure auto columns.
      markColumnsDirty(renderedColumns.map((column) => column.key));
    }
  }, [markColumnsDirty, renderedColumns, tableData]);
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
      const columnAuto = Boolean(column.autoWidth);
      const manual = state.source === 'user' || (columnAuto && state.autoWidth === false);
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
    controlledManualKeys.forEach((key) => currentManual.add(key));

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

    let didChange = false;
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
        const columnAuto = Boolean(col.autoWidth);
        const manual =
          controlledState?.source === 'user' ||
          (columnAuto && controlledState?.autoWidth === false);

        if (manual) {
          manuallyResizedColumnsRef.current.add(col.key);
        } else {
          manuallyResizedColumnsRef.current.delete(col.key);
        }

        if (Math.abs((prev[col.key] ?? 0) - externalWidth) > 0.5) {
          next[col.key] = externalWidth;
          didChange = true;
        }
      });

      return didChange ? next : prev;
    });

    const resetFlag = () => {
      isApplyingExternalUpdateRef.current = false;
      if (didChange) {
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
  isApplyingExternalUpdateRef,
  columnsRef,
  columnWidths,
  buildColumnWidthState,
  lastNotifiedWidthsRef,
}: {
  enableColumnResizing: boolean;
  onColumnWidthsChange?: (payload: Record<string, ColumnWidthState>) => void;
  isApplyingExternalUpdateRef: RefObject<boolean>;
  columnsRef: RefObject<GridColumnDefinition<T>[]>;
  columnWidths: Record<string, number>;
  buildColumnWidthState: (key: string, width: number) => ColumnWidthState;
  lastNotifiedWidthsRef: RefObject<string>;
}) {
  useEffect(() => {
    if (!enableColumnResizing || !onColumnWidthsChange || isApplyingExternalUpdateRef.current) {
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
  ]);
}

// Performs the first full measurement pass (and later re-runs) when columns change or labels shorten.
// This keeps natural widths in sync with the container before virtualization or persistence apply.
export function useInitialMeasurementAndReconcile<T>({
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
}: {
  tableRef: RefObject<HTMLElement | null>;
  renderedColumns: GridColumnDefinition<T>[];
  measureColumnWidth: (column: GridColumnDefinition<T>) => number;
  manuallyResizedColumnsRef: RefObject<Set<string>>;
  columnWidths: Record<string, number>;
  naturalWidthsRef: RefObject<Record<string, number>>;
  externalColumnWidths: Record<string, number> | null;
  reconcileWidthsToContainer: (
    base: Record<string, number>,
    containerWidth: number,
    options?: { forceFit?: boolean }
  ) => Record<string, number>;
  setColumnWidths: (updater: React.SetStateAction<Record<string, number>>) => void;
  useShortNames: boolean;
  allowHorizontalOverflow: boolean;
  getColumnMinWidth: (column: GridColumnDefinition<T>) => number;
  getColumnMaxWidth: (column: GridColumnDefinition<T>) => number;
  parseWidthInputToNumber: (input: ColumnWidthInput | undefined) => number | null;
  isFixedColumnKey: (key: string) => boolean;
  initializedColumnsRef: RefObject<boolean>;
  prevColumnsSignatureRef: RefObject<string | null>;
  prevShortNamesRef: RefObject<boolean>;
  tableData: T[];
}) {
  const initializedColumns = initializedColumnsRef;
  const initializedWithDataRef = useRef(false);
  useEffect(() => {
    if (!tableRef.current || renderedColumns.length === 0) {
      return;
    }

    const columnsSignature = renderedColumns
      .map((col) => `${col.key}:${col.width ?? ''}:${col.minWidth ?? ''}:${col.maxWidth ?? ''}`)
      .join('|');

    const needsInitialization = !initializedColumns.current;
    const columnsChanged = prevColumnsSignatureRef.current !== columnsSignature;
    const shortNamesChanged = prevShortNamesRef.current !== useShortNames;
    // Re-initialize if we previously initialized with empty data and now have data
    const dataArrivedAfterEmptyInit =
      initializedColumns.current && !initializedWithDataRef.current && tableData.length > 0;

    if (
      !needsInitialization &&
      !columnsChanged &&
      !shortNamesChanged &&
      !dataArrivedAfterEmptyInit
    ) {
      return;
    }

    const rafHandle = requestAnimationFrame(() => {
      const container = tableRef.current?.closest('.gridtable-wrapper') as HTMLElement | null;
      if (!container) return;

      const containerWidth = container.clientWidth;
      const measuredFixedWidths: Record<string, number> = {};
      renderedColumns
        .filter((col) => isFixedColumnKey(col.key))
        .forEach((col) => {
          measuredFixedWidths[col.key] = measureColumnWidth(col);
        });

      const measuredAutoWidths: Record<string, number> = {};
      renderedColumns
        .filter((col) => col.autoWidth && !isFixedColumnKey(col.key))
        .forEach((col) => {
          if (manuallyResizedColumnsRef.current.has(col.key)) {
            return;
          }
          const measured = measureColumnWidth(col);
          const min = getColumnMinWidth(col);
          const max = getColumnMaxWidth(col);
          measuredAutoWidths[col.key] = Math.max(min, Math.min(max, measured));
        });

      if (allowHorizontalOverflow) {
        const natural: Record<string, number> = {};

        renderedColumns.forEach((col) => {
          const min = getColumnMinWidth(col);
          const max = getColumnMaxWidth(col);

          let width: number | undefined;
          if (manuallyResizedColumnsRef.current.has(col.key) && columnWidths[col.key] != null) {
            width = columnWidths[col.key];
          } else if (isFixedColumnKey(col.key)) {
            width = measuredFixedWidths[col.key];
          } else if (col.autoWidth) {
            width = measuredAutoWidths[col.key];
          } else {
            width = parseWidthInputToNumber(col.width) ?? columnWidths[col.key];
          }

          if (width == null || Number.isNaN(width)) {
            width = measureColumnWidth(col);
          }

          natural[col.key] = Math.max(min, Math.min(max, width));
        });

        naturalWidthsRef.current = { ...natural };
        const display = reconcileWidthsToContainer(natural, containerWidth, { forceFit: false });
        setColumnWidths(display);

        prevColumnsSignatureRef.current = columnsSignature;
        prevShortNamesRef.current = useShortNames;
        initializedColumns.current = true;
        if (tableData.length > 0) {
          initializedWithDataRef.current = true;
        }
        return;
      }

      if (needsInitialization || columnsChanged || dataArrivedAfterEmptyInit) {
        const newWidths: Record<string, number> = {};
        let fixedTotal = 0;

        renderedColumns.forEach((col) => {
          if (isFixedColumnKey(col.key)) {
            const externalWidth = externalColumnWidths?.[col.key];
            let width = externalWidth ?? measuredFixedWidths[col.key] ?? measureColumnWidth(col);
            width = Math.max(getColumnMinWidth(col), Math.min(getColumnMaxWidth(col), width));
            newWidths[col.key] = width;
            naturalWidthsRef.current[col.key] = width;
            fixedTotal += width;
          } else if (col.autoWidth && !manuallyResizedColumnsRef.current.has(col.key)) {
            const externalWidth = externalColumnWidths?.[col.key];
            let width = externalWidth ?? measuredAutoWidths[col.key];
            if (width == null) {
              width = measureColumnWidth(col);
            }
            width = Math.max(getColumnMinWidth(col), Math.min(getColumnMaxWidth(col), width));
            newWidths[col.key] = width;
            naturalWidthsRef.current[col.key] = width;
            fixedTotal += width;
          }
        });

        const flexColumns = renderedColumns.filter(
          (col) =>
            !isFixedColumnKey(col.key) &&
            !(col.autoWidth && !manuallyResizedColumnsRef.current.has(col.key))
        );
        let remaining = containerWidth - fixedTotal;
        const flexWithoutExternal: GridColumnDefinition<T>[] = [];

        flexColumns.forEach((col) => {
          const externalWidth = externalColumnWidths?.[col.key];
          if (typeof externalWidth === 'number' && !Number.isNaN(externalWidth)) {
            let width = Math.max(
              getColumnMinWidth(col),
              Math.min(getColumnMaxWidth(col), externalWidth)
            );
            newWidths[col.key] = width;
            remaining -= width;
            naturalWidthsRef.current[col.key] = width;
          } else {
            flexWithoutExternal.push(col);
          }
        });

        if (flexWithoutExternal.length > 0) {
          if (remaining > 0) {
            const baseWidth = Math.floor(remaining / flexWithoutExternal.length);
            let remainder = remaining - baseWidth * flexWithoutExternal.length;

            flexWithoutExternal.forEach((col, index) => {
              let width = baseWidth;
              if (index === 0) {
                width += remainder;
              }
              width = Math.max(getColumnMinWidth(col), Math.min(getColumnMaxWidth(col), width));
              newWidths[col.key] = width;
              if (!allowHorizontalOverflow) {
                naturalWidthsRef.current[col.key] = width;
              }
            });
          } else {
            flexWithoutExternal.forEach((col) => {
              const fallback = Math.max(
                getColumnMinWidth(col),
                Math.min(
                  getColumnMaxWidth(col),
                  parseWidthInputToNumber(col.width) ?? getColumnMinWidth(col)
                )
              );
              newWidths[col.key] = fallback;
              if (
                naturalWidthsRef.current[col.key] == null ||
                Number.isNaN(naturalWidthsRef.current[col.key] as number)
              ) {
                naturalWidthsRef.current[col.key] = fallback;
              }
            });
          }
        }

        renderedColumns.forEach((col) => {
          if (!(col.key in newWidths)) {
            const existingWidth = columnWidths[col.key];
            if (typeof existingWidth === 'number' && !Number.isNaN(existingWidth)) {
              newWidths[col.key] = Math.max(
                getColumnMinWidth(col),
                Math.min(getColumnMaxWidth(col), existingWidth)
              );
              if (
                naturalWidthsRef.current[col.key] == null ||
                Number.isNaN(naturalWidthsRef.current[col.key] as number)
              ) {
                naturalWidthsRef.current[col.key] = newWidths[col.key];
              }
            } else {
              newWidths[col.key] = Math.max(
                getColumnMinWidth(col),
                Math.min(
                  getColumnMaxWidth(col),
                  parseWidthInputToNumber(col.width) ?? getColumnMinWidth(col)
                )
              );
              if (
                naturalWidthsRef.current[col.key] == null ||
                Number.isNaN(naturalWidthsRef.current[col.key] as number)
              ) {
                naturalWidthsRef.current[col.key] = newWidths[col.key];
              }
            }
          }
        });

        naturalWidthsRef.current = { ...newWidths };

        const reconciled = reconcileWidthsToContainer(newWidths, containerWidth);
        setColumnWidths(reconciled);
      } else if (shortNamesChanged) {
        const updated = { ...columnWidths };
        let mutated = false;

        Object.entries(measuredFixedWidths).forEach(([key, width]) => {
          const externalWidth = externalColumnWidths?.[key];
          const targetWidth = externalWidth ?? width;
          if (Math.abs((columnWidths[key] ?? 0) - targetWidth) > 0.5) {
            updated[key] = targetWidth;
            mutated = true;
          }
        });

        if (mutated) {
          naturalWidthsRef.current = { ...updated };

          const reconciled = reconcileWidthsToContainer(updated, containerWidth);
          setColumnWidths(reconciled);
        }
      }

      prevColumnsSignatureRef.current = columnsSignature;
      prevShortNamesRef.current = useShortNames;
      initializedColumns.current = true;
      if (tableData.length > 0) {
        initializedWithDataRef.current = true;
      }
    });

    return () => cancelAnimationFrame(rafHandle);
  }, [
    allowHorizontalOverflow,
    columnWidths,
    externalColumnWidths,
    getColumnMaxWidth,
    getColumnMinWidth,
    initializedColumns,
    isFixedColumnKey,
    manuallyResizedColumnsRef,
    measureColumnWidth,
    naturalWidthsRef,
    parseWidthInputToNumber,
    prevColumnsSignatureRef,
    prevShortNamesRef,
    reconcileWidthsToContainer,
    renderedColumns,
    setColumnWidths,
    tableData,
    tableRef,
    useShortNames,
  ]);
}
