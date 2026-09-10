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

  it('tabs through only the current row controls and returns to row navigation', async () => {
    const onRowClick = vi.fn();
    const action = vi.fn();
    const data = [...rows, { id: 'cluster-a|two', name: 'Two' }];
    await act(async () =>
      root.render(
        <KeyboardProvider>
          <ZoomProvider>
            <AppRegionNavigation />
            <main data-app-region="content">
              <GridTable
                data={data}
                keyExtractor={(item) => item.id}
                onRowClick={onRowClick}
                virtualization={{ enabled: false }}
                columns={[
                  ...columns,
                  {
                    key: 'actions',
                    header: 'Actions',
                    render: (row) => (
                      <>
                        <button type="button" onClick={action}>
                          {row.name} action
                        </button>
                        <button type="button" disabled>
                          Unavailable
                        </button>
                        <a href="#details">{row.name} details</a>
                      </>
                    ),
                  },
                ]}
              />
              <button type="button">After table</button>
            </main>
          </ZoomProvider>
        </KeyboardProvider>
      )
    );
    const table = requireValue(
      container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'table'
    );
    const press = async (key: string, shiftKey = false) => {
      await act(async () =>
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            shiftKey,
            bubbles: true,
            cancelable: true,
          })
        )
      );
    };
    await act(async () => table.focus());
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('One action');
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(action).toHaveBeenCalledOnce();
    expect(onRowClick).not.toHaveBeenCalled();
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('One details');
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('After table');
    await press('Tab', true);
    expect(document.activeElement?.textContent).toBe('One details');
    await press('Escape');
    expect(document.activeElement).toBe(table);
    await press('ArrowDown');
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('Two action');
    await press('Tab', true);
    expect(document.activeElement).toBe(table);
    await press('Enter');
    expect(onRowClick).toHaveBeenCalledWith({ id: 'cluster-a|two', name: 'Two' });
    expect(getTabbableElements(container).some((el) => el.textContent === 'One action')).toBe(
      false
    );
  });

  it.each(['Enter', ' '])(
    'does not activate a table row when %s belongs to its child button',
    async (key) => {
      const onRowClick = vi.fn();
      await act(async () =>
        root.render(
          <KeyboardProvider>
            <ZoomProvider>
              <GridTable
                data={rows}
                columns={[
                  {
                    key: 'action',
                    header: 'Action',
                    render: () => (
                      <button type="button" aria-label="Row action">
                        Action
                      </button>
                    ),
                  },
                ]}
                keyExtractor={(item) => item.id}
                onRowClick={onRowClick}
              />
            </ZoomProvider>
          </KeyboardProvider>
        )
      );
      const button = requireValue(
        container.querySelector<HTMLElement>('[aria-label="Row action"]'),
        'row action'
      );
      await act(async () => button.focus());
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      await act(async () => {
        button.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(false);
      expect(onRowClick).not.toHaveBeenCalled();
    }
  );

  it('recovers table focus when the current row control disappears', async () => {
    const render = async (data: typeof rows) =>
      act(async () =>
        root.render(
          <KeyboardProvider>
            <ZoomProvider>
              <GridTable
                data={data}
                keyExtractor={(item) => item.id}
                virtualization={{ enabled: false }}
                columns={[
                  {
                    key: 'action',
                    header: 'Action',
                    render: () => <button type="button">Open</button>,
                  },
                ]}
              />
            </ZoomProvider>
          </KeyboardProvider>
        )
      );
    await render(rows);
    const table = requireValue(
      container.querySelector<HTMLElement>('table[tabindex="0"]'),
      'table'
    );
    const button = requireValue(
      container.querySelector<HTMLElement>('.gridtable-row button'),
      'action'
    );
    await act(async () => button.focus());
    await render([]);
    expect(document.activeElement).toBe(table);
    expect(getTabbableElements(container)).not.toContain(button);
  });

  it.each([false, true])(
    'retains row activation and hover ownership (empty: %s)',
    async (empty) => {
      const onRowClick = vi.fn();
      await act(async () =>
        root.render(
          <KeyboardProvider>
            <ZoomProvider>
              <GridTable
                data={empty ? [] : rows}
                columns={[
                  ...columns,
                  {
                    key: 'action',
                    header: 'Action',
                    render: () => (
                      <button type="button" aria-label="Row action">
                        Action
                      </button>
                    ),
                  },
                ]}
                keyExtractor={(item) => item.id}
                onRowClick={onRowClick}
                virtualization={{ enabled: false }}
              />
            </ZoomProvider>
          </KeyboardProvider>
        )
      );
      const table = requireValue(
        container.querySelector<HTMLElement>('table[tabindex="0"]'),
        'table'
      );
      await act(async () => {
        table.focus();
      });
      await act(async () => {
        table.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      });
      expect(onRowClick).toHaveBeenCalledTimes(empty ? 0 : 1);
      if (empty) {
        return;
      }
      const button = requireValue(
        container.querySelector<HTMLElement>('[aria-label="Row action"]'),
        'row action'
      );
      const row = requireValue(container.querySelector<HTMLElement>('.gridtable-row'), 'row');
      await act(async () => button.focus());
      await act(async () => {
        row.dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })
        );
      });
      expect(row.classList.contains('gridtable-row--focused')).toBe(false);
      await act(async () => {
        row.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
        );
      });
      await act(async () => {
        button.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      });
      expect(onRowClick).toHaveBeenCalledTimes(1);
    }
  );

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
                  keyExtractor={(item) => item.id}
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
              keyExtractor={(item) => item.id}
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
