import type { RefObject } from 'react';
import { useLayoutEffect, useRef } from 'react';

export const GRIDTABLE_INTERACTIVE_STOP_SELECTOR =
  'button, a[href], input, textarea, select, summary, [role="button"], [role="menuitem"], [data-gridtable-interactive="true"]';

const updateRowTabStops = (wrapper: HTMLElement, rowKey: string | null, hasRowAction: boolean) => {
  for (const row of wrapper.querySelectorAll<HTMLElement>('.gridtable-row')) {
    for (const control of row.querySelectorAll<HTMLElement>(GRIDTABLE_INTERACTIVE_STOP_SELECTOR)) {
      const repeatsRowAction =
        hasRowAction && Boolean(control.closest('[data-gridtable-row-action="true"]'));
      const excludedFromTabOrder = control.closest('[data-focus-trap-ignore="true"]');
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

const recoverRowControlFocus = (child: HTMLElement | null, table: HTMLElement | null) => {
  if (!child || (child.isConnected && !child.matches(':disabled') && !child.closest('[hidden]'))) {
    return;
  }
  if (document.activeElement === document.body || document.activeElement === child) {
    table?.focus();
  }
};

// Only the current row contributes controls to Tab order. DOM focus stays on
// the table for arrow navigation, so virtual rows remain replaceable.
export function useGridTableRowControls(
  wrapperRef: RefObject<HTMLDivElement | null>,
  tableRef: RefObject<HTMLTableElement | null>,
  rowKey: string | null,
  hasRowAction: boolean
) {
  const focusedChild = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    const sync = () => {
      updateRowTabStops(wrapper, rowKey, hasRowAction);
      recoverRowControlFocus(focusedChild.current, tableRef.current);
    };
    const remember = () => {
      const active = document.activeElement;
      focusedChild.current =
        active instanceof HTMLElement &&
        wrapper.contains(active) &&
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
  }, [hasRowAction, rowKey, tableRef, wrapperRef]);
}
