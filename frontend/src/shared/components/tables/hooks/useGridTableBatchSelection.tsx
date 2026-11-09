/**
 * frontend/src/shared/components/tables/hooks/useGridTableBatchSelection.tsx
 *
 * Batch-select mode: the toolbar button, the checkbox column that exists only
 * while the mode is on, and row-click selection. Only rows on screen count as
 * selected, because destructive actions take concrete visible rows
 * (docs/architecture/large-data.md).
 */

import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { BatchSelectIcon } from '@shared/components/icons/SharedIcons';
import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableBatchAction,
  GridTableBatchSelection,
} from '@shared/components/tables/GridTable.types';
import { GRIDTABLE_INTERACTIVE_STOP_SELECTOR } from '@shared/components/tables/hooks/useGridTableRowControls';
import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

const GRIDTABLE_BATCH_COLUMN_KEY = '__batch-select';

const BATCH_COLUMN_WIDTH = 34;
const NO_ROWS_SELECTED: ReadonlySet<string> = new Set();

export interface GridTableBatchContextValue {
  selectedKeys: ReadonlySet<string>;
  keyByRow: ReadonlyMap<unknown, string>;
  visibleCount: number;
  selectedVisibleCount: number;
  toggleKey: (key: string, extendRange: boolean) => void;
  toggleAllVisible: () => void;
}

// Cells are cached by row and render function, so a checkbox reads its state
// from context; the column's render function never changes with the selection.
export const GridTableBatchContext = createContext<GridTableBatchContextValue | null>(null);

const BatchRowCheckbox: React.FC<{ row: unknown }> = ({ row }) => {
  const batch = useContext(GridTableBatchContext);
  const rowKey = batch?.keyByRow.get(row);
  if (!batch || rowKey === undefined) {
    return null;
  }
  return (
    <input
      type="checkbox"
      className="gridtable-batch-check"
      aria-label="Select row"
      checked={batch.selectedKeys.has(rowKey)}
      onChange={(event) =>
        batch.toggleKey(rowKey, (event.nativeEvent as MouseEvent).shiftKey === true)
      }
    />
  );
};

const BatchHeaderCheckbox: React.FC = () => {
  const batch = useContext(GridTableBatchContext);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = batch?.selectedVisibleCount ?? 0;
  const total = batch?.visibleCount ?? 0;
  const indeterminate = selected > 0 && selected < total;
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  if (!batch) {
    return null;
  }
  return (
    <input
      ref={inputRef}
      type="checkbox"
      className="gridtable-batch-check"
      aria-label="Select all rows on this page"
      checked={total > 0 && selected === total}
      onChange={batch.toggleAllVisible}
    />
  );
};

/** Floats over the bottom of the table while the selected rows have an action. */
const GridTableBatchBar: React.FC<{ actions: GridTableBatchAction[]; pending: boolean }> = ({
  actions,
  pending,
}) => (
  <div className="gridtable-batch-bar-anchor">
    <div className="gridtable-batch-bar" role="toolbar" aria-label="Batch Operations">
      <span className="gridtable-batch-bar-title">Batch Operations</span>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className={`gridtable-batch-action${action.danger ? ' gridtable-batch-action--danger' : ''}`}
          disabled={pending}
          onClick={action.onRun}
        >
          <span className="gridtable-batch-action-icon">{action.icon}</span>
          <span className="gridtable-batch-action-label">{action.label}</span>
        </button>
      ))}
    </div>
  </div>
);

const buildBatchColumn = <T,>(): GridColumnDefinition<T> => ({
  key: GRIDTABLE_BATCH_COLUMN_KEY,
  header: 'Select',
  renderHeader: () => <BatchHeaderCheckbox />,
  render: (row) => <BatchRowCheckbox row={row} />,
  width: BATCH_COLUMN_WIDTH,
  minWidth: BATCH_COLUMN_WIDTH,
  maxWidth: BATCH_COLUMN_WIDTH,
  resizable: false,
  hideable: false,
  sortable: false,
  className: 'gridtable-batch-column',
});

/** The checkbox column is transient, so its width never reaches saved table state. */
const omitBatchColumnWidth = (
  widths: Record<string, ColumnWidthState>
): Record<string, ColumnWidthState> => {
  const saved = { ...widths };
  delete saved[GRIDTABLE_BATCH_COLUMN_KEY];
  return saved;
};

const addAll = (keys: ReadonlySet<string>, added: readonly string[]): Set<string> => {
  const next = new Set(keys);
  for (const key of added) {
    next.add(key);
  }
  return next;
};

const rangeBetween = (keys: readonly string[], from: string, to: string): string[] => {
  const start = keys.indexOf(from);
  const end = keys.indexOf(to);
  if (start < 0 || end < 0) {
    return [to];
  }
  return keys.slice(Math.min(start, end), Math.max(start, end) + 1);
};

interface UseGridTableBatchSelectionOptions<T> {
  batchSelection: GridTableBatchSelection<T> | undefined;
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  orderedColumns: GridColumnDefinition<T>[];
  renderedColumns: GridColumnDefinition<T>[];
  onColumnWidthsChange?: (widths: Record<string, ColumnWidthState>) => void;
  isRowSelected?: (item: T, index: number) => boolean;
}

export function useGridTableBatchSelection<T>({
  batchSelection,
  tableData,
  keyExtractor,
  orderedColumns,
  renderedColumns,
  onColumnWidthsChange,
  isRowSelected: viewIsRowSelected,
}: UseGridTableBatchSelectionOptions<T>) {
  const active = batchSelection?.active ?? false;
  const selectedKeys = batchSelection?.selectedKeys ?? NO_ROWS_SELECTED;
  const onSelectedKeysChange = batchSelection?.onSelectedKeysChange;
  const anchorRef = useRef<string | null>(null);

  const visibleKeys = useMemo(
    () => (active ? tableData.map((row, index) => keyExtractor(row, index)) : []),
    [active, keyExtractor, tableData]
  );
  const keyByRow = useMemo(() => {
    const keys = new Map<unknown, string>();
    tableData.forEach((row, index) => {
      if (active) {
        keys.set(row, visibleKeys[index]);
      }
    });
    return keys;
  }, [active, tableData, visibleKeys]);
  const selectedRows = useMemo(
    () =>
      tableData.flatMap((row, index) =>
        selectedKeys.has(visibleKeys[index]) ? [{ row, key: visibleKeys[index] }] : []
      ),
    [selectedKeys, tableData, visibleKeys]
  );
  const selectedVisibleCount = selectedRows.length;

  const toggleKey = useCallback(
    (key: string, extendRange: boolean) => {
      if (extendRange && anchorRef.current !== null) {
        onSelectedKeysChange?.(
          addAll(selectedKeys, rangeBetween(visibleKeys, anchorRef.current, key))
        );
        return;
      }
      anchorRef.current = key;
      const next = new Set(selectedKeys);
      if (!next.delete(key)) {
        next.add(key);
      }
      onSelectedKeysChange?.(next);
    },
    [onSelectedKeysChange, selectedKeys, visibleKeys]
  );

  const toggleAllVisible = useCallback(() => {
    if (selectedVisibleCount === visibleKeys.length) {
      const next = new Set(selectedKeys);
      for (const key of visibleKeys) {
        next.delete(key);
      }
      onSelectedKeysChange?.(next);
      return;
    }
    onSelectedKeysChange?.(addAll(selectedKeys, visibleKeys));
  }, [onSelectedKeysChange, selectedKeys, selectedVisibleCount, visibleKeys]);

  const clearSelection = useCallback(() => {
    anchorRef.current = null;
    onSelectedKeysChange?.(NO_ROWS_SELECTED);
  }, [onSelectedKeysChange]);

  const contextValue = useMemo<GridTableBatchContextValue | null>(
    () =>
      active
        ? {
            selectedKeys,
            keyByRow,
            visibleCount: visibleKeys.length,
            selectedVisibleCount,
            toggleKey,
            toggleAllVisible,
          }
        : null,
    [
      active,
      keyByRow,
      selectedKeys,
      selectedVisibleCount,
      toggleAllVisible,
      toggleKey,
      visibleKeys.length,
    ]
  );

  // The checkbox column joins after the order and visibility controllers, so the
  // Columns menu, saved column state, and downloads never see it.
  const batchColumn = useMemo(() => (active ? buildBatchColumn<T>() : null), [active]);
  const layoutColumns = useMemo(
    () => (batchColumn ? [batchColumn, ...orderedColumns] : orderedColumns),
    [batchColumn, orderedColumns]
  );
  const layoutRenderedColumns = useMemo(
    () => (batchColumn ? [batchColumn, ...renderedColumns] : renderedColumns),
    [batchColumn, renderedColumns]
  );
  const saveColumnWidths = useMemo(
    () =>
      onColumnWidthsChange
        ? (widths: Record<string, ColumnWidthState>) =>
            onColumnWidthsChange(omitBatchColumnWidth(widths))
        : undefined,
    [onColumnWidthsChange]
  );

  const handleRowPointerClick = useCallback(
    (row: T, event: React.MouseEvent) => {
      // A link in the row (Kind, Name) keeps opening its object.
      if (event.target instanceof Element) {
        if (event.target.closest(GRIDTABLE_INTERACTIVE_STOP_SELECTOR)) {
          return;
        }
      }
      const key = keyByRow.get(row);
      if (key !== undefined) {
        toggleKey(key, event.shiftKey);
      }
    },
    [keyByRow, toggleKey]
  );

  const isBatchRowSelected = useCallback(
    (row: T) => {
      const key = keyByRow.get(row);
      return key !== undefined && selectedKeys.has(key);
    },
    [keyByRow, selectedKeys]
  );

  const onActiveChange = batchSelection?.onActiveChange;
  const getActions = batchSelection?.getActions;
  const toolbarItems = useMemo<IconBarItem[]>(() => {
    if (!onActiveChange || !getActions) {
      return [];
    }
    return [
      {
        type: 'toggle',
        id: 'gridtable-batch-select',
        icon: <BatchSelectIcon width={18} height={18} />,
        title: active ? 'Exit batch select' : 'Batch select',
        active,
        onClick: () => {
          clearSelection();
          onActiveChange(!active);
        },
      },
    ];
  }, [active, clearSelection, getActions, onActiveChange]);

  const actions = useMemo(
    () => (active && getActions ? getActions(selectedRows) : []),
    [active, getActions, selectedRows]
  );

  const bar =
    selectedVisibleCount > 0 && actions.length > 0 ? (
      <GridTableBatchBar actions={actions} pending={Boolean(batchSelection?.actionsPending)} />
    ) : null;

  return {
    active,
    layoutColumns,
    layoutRenderedColumns,
    saveColumnWidths,
    contextValue,
    toolbarItems,
    bar,
    isRowSelected: active ? isBatchRowSelected : viewIsRowSelected,
    handleRowPointerClick: active ? handleRowPointerClick : undefined,
  };
}
