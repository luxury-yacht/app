import {
  isInNestedRowDetail,
  queryOwnGridTableElements,
  queryOwnRowDetails,
} from '@shared/components/tables/GridTable.utils';
import type { RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';

export const GRIDTABLE_INTERACTIVE_STOP_SELECTOR =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="menuitem"], [data-gridtable-interactive="true"]';

const updateRowTabStops = (wrapper: HTMLElement, rowKey: string | null, hasRowAction: boolean) => {
  for (const row of queryOwnGridTableElements(wrapper, '.gridtable-row')) {
    for (const control of row.querySelectorAll<HTMLElement>(GRIDTABLE_INTERACTIVE_STOP_SELECTOR)) {
      const repeatsRowAction =
        hasRowAction && Boolean(control.closest('[data-gridtable-row-action="true"]'));
      // Only markers inside the row count: a row detail's own Tab exclusion
      // (below) must not strand a nested table's row controls at -1.
      const excluded = control.closest<HTMLElement>('[data-focus-trap-ignore="true"]');
      const excludedFromTabOrder = excluded !== null && row.contains(excluded);
      control.tabIndex =
        row.dataset.rowKey === rowKey &&
        !control.matches(':disabled') &&
        !repeatsRowAction &&
        !excludedFromTabOrder
          ? 0
          : -1;
    }
  }
};

// Only the detail whose table holds the keyboard is in Tab order, so Tab never
// wanders into another row's nested table.
const updateDetailTabStops = (wrapper: HTMLElement, keyboardDetailKey: string | null) => {
  for (const detail of queryOwnRowDetails(wrapper)) {
    const reachable = detail.dataset.rowDetailKey === keyboardDetailKey;
    // The observer watches this attribute, so write only on change.
    if (reachable && detail.dataset.focusTrapIgnore !== undefined) {
      delete detail.dataset.focusTrapIgnore;
    } else if (!reachable && detail.dataset.focusTrapIgnore !== 'true') {
      detail.dataset.focusTrapIgnore = 'true';
    }
  }
};

const recoverRowControlFocus = (child: HTMLElement | null, table: HTMLElement | null) => {
  if (!child || (child.isConnected && !child.matches(':disabled') && !child.closest('[hidden]'))) {
    return;
  }
  if (document.activeElement === document.body || document.activeElement === child) {
    table?.focus();
  }
};

// Only the current row contributes controls to Tab order, and only while this
// table's rows hold the keyboard (not a table nested in one of its details).
// DOM focus stays on the table for arrow navigation, so virtual rows remain
// replaceable.
export function useGridTableRowControls(
  wrapperRef: RefObject<HTMLDivElement | null>,
  tableRef: RefObject<HTMLTableElement | null>,
  focusedRowKey: string | null,
  hasRowAction: boolean,
  keyboardDetailKey: string | null
) {
  const rowKey = keyboardDetailKey === null ? focusedRowKey : null;
  const focusedChild = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const sync = () => {
      updateRowTabStops(wrapper, rowKey, hasRowAction);
      updateDetailTabStops(wrapper, keyboardDetailKey);
      recoverRowControlFocus(focusedChild.current, tableRef.current);
    };
    const remember = () => {
      const active = document.activeElement;
      focusedChild.current =
        active instanceof HTMLElement &&
        wrapper.contains(active) &&
        !isInNestedRowDetail(wrapper, active) &&
        active.closest('.gridtable-row')
          ? active
          : null;
    };
    const returnToTable = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !focusedChild.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      tableRef.current?.focus();
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'disabled',
        'hidden',
        'data-gridtable-row-action',
        'data-focus-trap-ignore',
      ],
    });
    document.addEventListener('focusin', remember);
    wrapper.addEventListener('keydown', returnToTable);
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', remember);
      wrapper.removeEventListener('keydown', returnToTable);
    };
  }, [hasRowAction, keyboardDetailKey, rowKey, tableRef, wrapperRef]);
}
