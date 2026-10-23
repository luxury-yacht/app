/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowDetailNavigation.ts
 *
 * A parent table's side of keyboard navigation into the tables nested in its
 * row details: which detail's table holds the keyboard, moving the keyboard
 * into one, and the context each detail gives its table.
 */

import { queryOwnRowDetails } from '@shared/components/tables/GridTable.utils';
import {
  type RowDetailExit,
  type RowDetailNavigation,
  RowDetailNavigationContext,
  type RowDetailNestedTable,
} from '@shared/components/tables/rowDetailNavigation';
import { type RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface RowDetailNavigationOptions {
  wrapperRef: RefObject<HTMLDivElement | null>;
  /** Open rows among the displayed rows: index to row key. */
  openRows: ReadonlyMap<number, string>;
  /** Clears the view's selection on this table's rows. */
  onRowSelectionClear?: () => void;
}

const noExit = () => undefined;

// A nested table's rows take focus through its own native table (AriaGrid).
// The detail renders inside the parent's table, so a detail control's nearest
// table is the parent's, which the detail does not contain.
const focusesNestedRows = (detail: HTMLElement, target: Node): boolean => {
  const table = (target instanceof Element ? target : target.parentElement)?.closest('table');
  return Boolean(table && detail.contains(table));
};

export interface GridTableRowDetailNavigation {
  /** The detail whose table holds the keyboard; null when the parent's rows do. */
  keyboardDetailKey: string | null;
  /**
   * Whether this table's rows hold the keyboard (and so the one row highlight):
   * neither a table nested in one of its details nor, when this table is itself
   * nested, another part of its parent holds it.
   */
  holdsKeyboard: boolean;
  /** This table's side as a table nested in a parent's row detail, if it is one. */
  parentNavigation: RowDetailNavigation | null;
  /** Set by the owner to move the keyboard from a detail's table back to its rows. */
  exitRef: RefObject<(rowKey: string, direction: RowDetailExit) => void>;
  /** Moves the keyboard into an open detail's table; false when it has no rows. */
  enterDetail: (rowKey: string, position: 'first' | 'last') => boolean;
  /** The context a detail gives the table nested in it. */
  getNavigation: (rowKey: string) => RowDetailNavigation;
}

export function useGridTableRowDetailNavigation({
  wrapperRef,
  openRows,
  onRowSelectionClear,
}: RowDetailNavigationOptions): GridTableRowDetailNavigation {
  const [focusedDetailKey, setFocusedDetailKey] = useState<string | null>(null);
  const tablesRef = useRef(new Map<string, RowDetailNestedTable>());
  const exitRef = useRef<(rowKey: string, direction: RowDetailExit) => void>(noExit);
  const parentNavigation = useContext(RowDetailNavigationContext);
  const onRowSelectionClearRef = useRef(onRowSelectionClear);
  onRowSelectionClearRef.current = onRowSelectionClear;

  // Focus decides where the keyboard is: in a detail's table once focus enters
  // that detail, back on the parent's rows once focus returns to them. Entering
  // a detail's rows, by click or keyboard, takes the one row highlight, so the
  // view's selection on the parent's rows clears; the detail's own controls
  // (its filter bar, its Close) leave the parent's row highlighted.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return undefined;
    }
    const track = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const detail = queryOwnRowDetails(wrapper).find((candidate) => candidate.contains(target));
      if (detail && focusesNestedRows(detail, target)) {
        onRowSelectionClearRef.current?.();
      }
      setFocusedDetailKey(detail?.dataset.rowDetailKey ?? null);
    };
    wrapper.addEventListener('focusin', track);
    return () => wrapper.removeEventListener('focusin', track);
  }, [wrapperRef]);

  // A detail that closes, or whose row leaves the table, hands the keyboard back.
  const detailOpen =
    focusedDetailKey === null || Array.from(openRows.values()).includes(focusedDetailKey);
  useEffect(() => {
    if (!detailOpen) {
      setFocusedDetailKey(null);
    }
  }, [detailOpen]);
  const keyboardDetailKey = detailOpen ? focusedDetailKey : null;

  const enterDetail = useCallback(
    (rowKey: string, position: 'first' | 'last') =>
      tablesRef.current.get(rowKey)?.enter(position) ?? false,
    []
  );

  // One context value per detail, kept while its keyboard state is unchanged so
  // the nested table does not re-render on every parent render.
  const parentHoldsKeyboard = parentNavigation?.holdsKeyboard ?? true;
  const navigationsRef = useRef(new Map<string, RowDetailNavigation>());
  const getNavigation = useCallback(
    (rowKey: string): RowDetailNavigation => {
      const holdsKeyboard = parentHoldsKeyboard && keyboardDetailKey === rowKey;
      const cached = navigationsRef.current.get(rowKey);
      if (cached?.holdsKeyboard === holdsKeyboard) {
        return cached;
      }
      const navigation: RowDetailNavigation = {
        holdsKeyboard,
        exit: cached?.exit ?? ((direction) => exitRef.current(rowKey, direction)),
        register:
          cached?.register ??
          ((table) => {
            if (table) {
              tablesRef.current.set(rowKey, table);
            } else {
              tablesRef.current.delete(rowKey);
            }
          }),
      };
      navigationsRef.current.set(rowKey, navigation);
      return navigation;
    },
    [keyboardDetailKey, parentHoldsKeyboard]
  );

  const holdsKeyboard = parentHoldsKeyboard && keyboardDetailKey === null;
  return {
    keyboardDetailKey,
    holdsKeyboard,
    parentNavigation,
    exitRef,
    enterDetail,
    getNavigation,
  };
}
