/**
 * frontend/src/shared/components/tables/hooks/useGridTableShortcuts.test.tsx
 *
 * The table's own keys while its body has the keyboard: Page Down/Up move a
 * screenful of rows, Ctrl+Arrow (Command+Arrow on macOS) changes pages only
 * when there is a page to go to, Shift+F10 opens nothing in a table without a
 * row menu, and mouse hover is suppressed only while the body is focused.
 * Enter/Space, arrows, Home/End, and focus gating are in
 * GridTable.keyboard.test.tsx and GridTable.rowDetail.test.tsx. Runs the real
 * GridTable inside the production shell (keyboard and zoom owners) with only
 * the backend boundary faked (test-utils/appState).
 */

import GridTable, { type GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = Array.from({ length: 10 }, (_, index) => ({
  id: `cluster-a|row-${index}`,
  name: `row-${index}`,
}));

const app = installAppStateHarness();
// Spies this file installs, restored after each test; the harness keeps its own.
const spies: Array<{ mockRestore(): void }> = [];
const track = <S extends { mockRestore(): void }>(spy: S): S => {
  spies.push(spy);
  return spy;
};
let view: MountedApp;
let clientHeight: PropertyDescriptor | undefined;

beforeEach(async () => {
  // jsdom has no layout: the table body shows three 44px rows.
  clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('gridtable-wrapper') ? 132 : 0;
    },
  });
  view = await app.render(null);
});

afterEach(() => {
  if (clientHeight) {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
  }
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

const showTable = (props: Partial<GridTableProps<Row>> = {}) =>
  view.show(
    <>
      <GridTable
        data={rows}
        columns={[{ key: 'name', header: 'Name', render: (row: Row) => row.name }]}
        keyExtractor={(row) => row.id}
        virtualization={{ enabled: false }}
        {...props}
      />
      <input aria-label="Outside table" />
    </>
  );

const tableBody = () =>
  requireValue(view.container.querySelector<HTMLElement>('table[tabindex="0"]'), 'table body');

const focusedRows = () =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row--focused')).map((row) =>
    row.dataset.rowKey?.replace('cluster-a|', '')
  );

const press = async (target: HTMLElement, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('GridTable shortcuts', () => {
  it('moves a screenful of rows with Page Down and Page Up', async () => {
    await showTable();
    await act(async () => tableBody().focus());
    expect(focusedRows()).toEqual(['row-0']);

    await press(tableBody(), { key: 'PageDown' });
    expect(focusedRows()).toEqual(['row-3']);
    await press(tableBody(), { key: 'PageDown' });
    expect(focusedRows()).toEqual(['row-6']);
    await press(tableBody(), { key: 'PageUp' });
    expect(focusedRows()).toEqual(['row-3']);
  });

  it.each([
    { platform: 'Win32', modifier: { ctrlKey: true } },
    { platform: 'MacIntel', modifier: { metaKey: true } },
  ])('changes pages with $platform page keys when there is a page to go to', async (testCase) => {
    track(vi.spyOn(navigator, 'platform', 'get')).mockReturnValue(testCase.platform);
    const onPagePrevious = vi.fn();
    const onPageNext = vi.fn();
    await showTable({ onPagePrevious, onPageNext, canPagePrevious: true, canPageNext: true });
    await act(async () => tableBody().focus());

    const previous = await press(tableBody(), { key: 'ArrowLeft', ...testCase.modifier });
    const next = await press(tableBody(), { key: 'ArrowRight', ...testCase.modifier });

    expect(previous.defaultPrevented).toBe(true);
    expect(next.defaultPrevented).toBe(true);
    expect(onPagePrevious).toHaveBeenCalledTimes(1);
    expect(onPageNext).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'at both page boundaries', pagination: { canPagePrevious: false, canPageNext: false } },
    { name: 'in a table without pagination', pagination: null },
  ])('leaves Ctrl+Arrow unclaimed $name', async ({ pagination }) => {
    track(vi.spyOn(navigator, 'platform', 'get')).mockReturnValue('Win32');
    const onPagePrevious = vi.fn();
    const onPageNext = vi.fn();
    await showTable(pagination ? { onPagePrevious, onPageNext, ...pagination } : {});
    await act(async () => tableBody().focus());

    const previous = await press(tableBody(), { key: 'ArrowLeft', ctrlKey: true });
    const next = await press(tableBody(), { key: 'ArrowRight', ctrlKey: true });

    expect(previous.defaultPrevented).toBe(false);
    expect(next.defaultPrevented).toBe(false);
    expect(onPagePrevious).not.toHaveBeenCalled();
    expect(onPageNext).not.toHaveBeenCalled();
  });

  it('opens no row menu with Shift+F10 in a table without one', async () => {
    await showTable();
    await act(async () => tableBody().focus());

    const event = await press(tableBody(), { key: 'F10', shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  // Keyboard navigation owns the row highlight while the body is focused, so
  // the mouse's hover highlight is switched off until the table loses focus.
  it('suppresses mouse hover only while the table body is focused', async () => {
    await showTable();
    const hoverSuppressed = () => document.body.classList.contains('gridtable-disable-hover');
    expect(hoverSuppressed()).toBe(false);

    await act(async () => tableBody().focus());
    expect(hoverSuppressed()).toBe(true);

    await act(async () =>
      requireValue(
        view.container.querySelector<HTMLElement>('[aria-label="Outside table"]'),
        'outside input'
      ).focus()
    );
    expect(hoverSuppressed()).toBe(false);
  });
});
