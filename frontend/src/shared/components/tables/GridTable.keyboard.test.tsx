import { ZoomProvider } from '@core/contexts/ZoomContext';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import GridTable from './GridTable';

// Keep table rendering, focus state, shortcut registration, and dispatch real.
// Only desktop integration is replaced in this DOM regression suite.
vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => false,
  onEvent: () => () => undefined,
}));

const rows = [{ id: 'cluster-a|one', name: 'One' }];
const columns = [{ key: 'name', header: 'Name', render: (row: (typeof rows)[number]) => row.name }];

describe('GridTable keyboard integration', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([false, true])(
    'visits the header between filters and body through app navigation (empty: %s)',
    async (empty) => {
      await act(async () => {
        root.render(
          <KeyboardProvider>
            <ZoomProvider>
              <AppRegionNavigation />
              <main data-app-region="content" tabIndex={-1}>
                <GridTable
                  data={empty ? [] : rows}
                  columns={columns.map((column) => ({ ...column, sortable: true }))}
                  keyExtractor={(row) => row.id}
                  filters={{ enabled: true }}
                  onSort={vi.fn()}
                />
              </main>
            </ZoomProvider>
          </KeyboardProvider>
        );
      });
      const sortButton = requireValue(
        container.querySelector<HTMLButtonElement>('.gridtable-sort-button'),
        'sort button'
      );
      const table = requireValue(
        container.querySelector<HTMLTableElement>('table[tabindex="0"]'),
        'table'
      );
      const targets = getTabbableElements(container);
      const lastFilter = requireValue(targets[targets.indexOf(sortButton) - 1], 'last filter');

      await act(async () => lastFilter.focus());
      const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      await act(async () => {
        lastFilter.dispatchEvent(forward);
      });
      expect(forward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(sortButton);

      await act(async () => table.focus());
      const backward = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        table.dispatchEvent(backward);
      });
      expect(backward.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(sortButton);
    }
  );

  it('gates paging and row menus by the focused table, including after blur and refocus', async () => {
    const nextPage = vi.fn();
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ZoomProvider>
            <GridTable
              data={rows}
              columns={columns}
              keyExtractor={(row) => row.id}
              enableContextMenu
              getCustomContextMenuItems={() => [{ label: 'Inspect row', onClick: vi.fn() }]}
              onPageNext={nextPage}
              canPageNext
            />
            <input aria-label="Outside table" />
          </ZoomProvider>
        </KeyboardProvider>
      );
    });

    const table = requireValue(
      container.querySelector<HTMLTableElement>('table[tabindex="0"]'),
      'table'
    );
    const input = requireValue(container.querySelector('input'), 'outside input');
    const press = async (target: HTMLElement, init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      await act(async () => target.dispatchEvent(event));
      return event;
    };
    const pageKey = { key: 'ArrowRight', ctrlKey: true };

    await act(async () => table.focus());
    expect((await press(table, pageKey)).defaultPrevented).toBe(true);
    expect(nextPage).toHaveBeenCalledTimes(1);

    await act(async () => input.focus());
    expect((await press(input, pageKey)).defaultPrevented).toBe(false);
    expect(nextPage).toHaveBeenCalledTimes(1);
    expect((await press(input, { key: 'F10', shiftKey: true })).defaultPrevented).toBe(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();

    await act(async () => table.focus());
    await press(table, pageKey);
    expect(nextPage).toHaveBeenCalledTimes(2);
    await press(table, { key: 'F10', shiftKey: true });
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Inspect row');
  });
});
