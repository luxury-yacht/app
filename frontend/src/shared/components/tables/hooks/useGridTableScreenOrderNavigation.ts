/**
 * frontend/src/shared/components/tables/hooks/useGridTableScreenOrderNavigation.ts
 *
 * Keyboard row moves in screen order for a table with row details, or a table
 * nested in one: Up and Down walk from a parent row into its expanded table's
 * rows and back out, Alt+Up and Alt+Down skip expanded tables, and Home and End
 * reach the first and last row on screen.
 *
 * Focus moves here never let the browser scroll to reveal the table: WebKit
 * reveals a focused table's whole box, including rows clipped by its own
 * scroller, which jumps the parent. The keyboard navigation reveals only the
 * highlighted row.
 */

import type { GridTableRowDetailNavigation } from '@shared/components/tables/hooks/useGridTableRowDetailNavigation';
import type { RowDetailExit } from '@shared/components/tables/rowDetailNavigation';
import { type RefObject, useCallback, useLayoutEffect } from 'react';

interface ScreenOrderNavigationOptions<T> {
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  focusedRowIndex: number | null;
  openRows: ReadonlyMap<number, string>;
  rowDetailNavigation: GridTableRowDetailNavigation;
  hasRowDetail: boolean;
  focusByIndex: (index: number) => void;
  /** focusByIndex for keyboard moves, which also clears the view's selection. */
  focusByKeyboard: (index: number) => void;
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToIndex: (index: number) => boolean;
  gridRef: RefObject<HTMLTableElement | null>;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
}

export interface ScreenOrderNavigation {
  moveRow: (delta: 1 | -1) => boolean;
  jumpToStart: () => boolean;
  jumpToEnd: () => boolean;
  /** Present only for a table with row details or one nested in a detail. */
  moveParentRow?: (delta: 1 | -1) => boolean;
}

export function useGridTableScreenOrderNavigation<T>({
  tableData,
  keyExtractor,
  focusedRowIndex,
  openRows,
  rowDetailNavigation,
  hasRowDetail,
  focusByIndex,
  focusByKeyboard,
  moveSelectionByDelta,
  jumpToIndex,
  gridRef,
  lastNavigationMethodRef,
}: ScreenOrderNavigationOptions<T>): ScreenOrderNavigation {
  const { enterDetail, exitRef, parentNavigation } = rowDetailNavigation;
  const lastIndex = tableData.length - 1;

  const focusRowFromKeyboard = useCallback(
    (index: number) => {
      lastNavigationMethodRef.current = 'keyboard';
      focusByKeyboard(index);
      gridRef.current?.focus({ preventScroll: true });
    },
    [focusByKeyboard, gridRef, lastNavigationMethodRef]
  );

  // Moves the keyboard into the expanded table under the row at `index`.
  const enterRowDetail = useCallback(
    (index: number, position: 'first' | 'last') => {
      const rowKey = openRows.get(index);
      return rowKey !== undefined && enterDetail(rowKey, position);
    },
    [enterDetail, openRows]
  );

  // A nested table hands the keyboard back to this table's row at `index`.
  const exitToRow = (index: number, direction: RowDetailExit) => {
    switch (direction) {
      case 'home':
        focusRowFromKeyboard(0);
        return;
      case 'end':
        if (!enterRowDetail(lastIndex, 'last')) {
          focusRowFromKeyboard(lastIndex);
        }
        return;
      case 'up':
      case 'previous-parent-row':
        focusRowFromKeyboard(index);
        return;
      default:
        // Down from the last row's table has nowhere further to go.
        if (index < lastIndex) {
          focusRowFromKeyboard(index + 1);
        }
    }
  };
  exitRef.current = (rowKey, direction) => {
    const index = tableData.findIndex((item, i) => keyExtractor(item, i) === rowKey);
    if (index >= 0) {
      exitToRow(index, direction);
    }
  };

  // As a nested table, let the parent move the keyboard into this table.
  const register = parentNavigation?.register;
  const enterFromParent = useCallback(
    (position: 'first' | 'last') => {
      if (lastIndex < 0) {
        return false;
      }
      lastNavigationMethodRef.current = 'keyboard';
      focusByIndex(position === 'first' ? 0 : lastIndex);
      gridRef.current?.focus({ preventScroll: true });
      return true;
    },
    [focusByIndex, gridRef, lastIndex, lastNavigationMethodRef]
  );
  useLayoutEffect(() => {
    if (!register) {
      return undefined;
    }
    register({ enter: enterFromParent });
    return () => register(null);
  }, [enterFromParent, register]);

  const exitToParent = parentNavigation?.exit;
  // As a nested table, Up from the first row or Down from the last leaves it.
  const leaveAtEdge = useCallback(
    (delta: 1 | -1) => {
      const edge = delta > 0 ? lastIndex : 0;
      if (!exitToParent || focusedRowIndex !== edge) {
        return false;
      }
      exitToParent(delta > 0 ? 'down' : 'up');
      return true;
    },
    [exitToParent, focusedRowIndex, lastIndex]
  );
  // Down enters the expanded table under this row; Up enters the one above it.
  const enterAdjacentDetail = useCallback(
    (delta: 1 | -1) => {
      if (focusedRowIndex === null) {
        return false;
      }
      return delta > 0
        ? enterRowDetail(focusedRowIndex, 'first')
        : enterRowDetail(focusedRowIndex - 1, 'last');
    },
    [enterRowDetail, focusedRowIndex]
  );
  const moveRow = useCallback(
    (delta: 1 | -1) =>
      leaveAtEdge(delta) || enterAdjacentDetail(delta) || moveSelectionByDelta(delta),
    [enterAdjacentDetail, leaveAtEdge, moveSelectionByDelta]
  );

  const jumpToStart = useCallback(() => {
    if (exitToParent) {
      exitToParent('home');
      return true;
    }
    return jumpToIndex(0);
  }, [exitToParent, jumpToIndex]);

  const jumpToEnd = useCallback(() => {
    if (exitToParent) {
      exitToParent('end');
      return true;
    }
    return enterRowDetail(lastIndex, 'last') || jumpToIndex(lastIndex);
  }, [enterRowDetail, exitToParent, jumpToIndex, lastIndex]);

  const moveParentRow = useCallback(
    (delta: 1 | -1) => {
      if (exitToParent) {
        exitToParent(delta > 0 ? 'next-parent-row' : 'previous-parent-row');
        return true;
      }
      return moveSelectionByDelta(delta);
    },
    [exitToParent, moveSelectionByDelta]
  );

  return {
    moveRow,
    jumpToStart,
    jumpToEnd,
    moveParentRow: hasRowDetail || exitToParent ? moveParentRow : undefined,
  };
}
