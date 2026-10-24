/**
 * frontend/src/shared/components/tables/GridTableKeys.test.tsx
 *
 * Tab order inside a table's filter bar and at the table body's edge: Tab
 * walks the filter controls in screen order, including a leading query facet,
 * skips disabled toolbar buttons, and leaves the bar at its ends; Tab from the
 * body is left to app navigation and drops the focused-row highlight. Runs the
 * real GridTable inside the production shell (keyboard and zoom owners) with
 * only the backend boundary faked (test-utils/appState).
 */

import GridTable, {
  type GridColumnDefinition,
  type GridTableFilterConfig,
} from '@shared/components/tables/GridTable';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = ['a', 'b'].map((id) => ({ id: `cluster-a|${id}`, name: id }));
const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

const app = installAppStateHarness();
let view: MountedApp;

beforeEach(async () => {
  view = await app.render(null);
});

const showTable = (filters?: GridTableFilterConfig<Row>, data: Row[] = rows) =>
  view.show(
    <GridTable
      data={data}
      columns={columns}
      keyExtractor={(row) => row.id}
      filters={filters}
      enableColumnVisibilityMenu={Boolean(filters)}
      virtualization={{ enabled: false }}
    />
  );

const control = (selector: string) =>
  requireValue(view.container.querySelector<HTMLElement>(selector), `expected ${selector}`);

const SEARCH = '[data-gridtable-filter-role="search"] input';
const KIND = '[data-gridtable-filter-role="kind"] .dropdown-trigger';
const API_GROUPS = '[data-gridtable-filter-role="query-facet-apiGroups"] .dropdown-trigger';

/** Presses Tab where the keyboard is, as the user would; returns the event. */
const pressTab = async (shiftKey = false) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    document.activeElement?.dispatchEvent(event);
  });
  return event;
};

/** Where the keyboard is, named the way the user reads it. */
const focusedName = () => {
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest('[data-gridtable-filter-role="columns"]')) {
    return 'Columns';
  }
  return active?.getAttribute('aria-label') ?? active?.getAttribute('title') ?? '';
};

describe('GridTable filter bar Tab order', () => {
  it('moves backward into a leading query facet and forward out without trapping focus', async () => {
    await showTable({
      enabled: true,
      options: {
        // Query facets are backend-owned: only query-backed tables (Browse) show them.
        searchBehavior: 'query',
        showKindDropdown: true,
        kinds: ['Pod'],
        queryFacets: [
          {
            key: 'apiGroups',
            label: 'API groups',
            placeholder: 'All API groups',
            options: [{ label: 'core', value: '(core)' }],
            placement: 'before-kinds',
          },
        ],
      },
    });

    await act(async () => control(SEARCH).focus());
    await pressTab(true);
    expect(document.activeElement).toBe(control(KIND));
    await pressTab(true);
    expect(document.activeElement).toBe(control(API_GROUPS));
    await pressTab(false);
    expect(document.activeElement).toBe(control(KIND));

    // At the start of the bar, Shift+Tab is left to app navigation.
    await pressTab(true);
    expect((await pressTab(true)).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(control(API_GROUPS));
  });

  it('visits toolbar buttons in screen order, skipping disabled ones, before Columns', async () => {
    await showTable({
      enabled: true,
      options: {
        preActions: [
          { type: 'action', id: 'favorite', icon: <span />, onClick: vi.fn(), title: 'Favorite' },
          {
            type: 'action',
            id: 'disabled-extra',
            icon: <span />,
            onClick: vi.fn(),
            title: 'Disabled extra',
            disabled: true,
          },
        ],
      },
    });

    await act(async () => control(SEARCH).focus());
    const stops: string[] = [];
    for (let step = 0; step < 3; step += 1) {
      await pressTab();
      stops.push(focusedName());
    }

    expect(stops).toEqual(['Favorite', 'Download all matching rows', 'Columns']);
  });
});

describe('GridTable body Tab', () => {
  it('leaves Tab to app navigation and drops the focused-row highlight', async () => {
    await showTable();
    const table = control('table[tabindex="0"]');
    const focusedRows = () =>
      Array.from(view.container.querySelectorAll<HTMLElement>('.gridtable-row--focused')).map(
        (row) => row.dataset.rowKey
      );
    await act(async () => table.focus());
    expect(focusedRows()).toEqual(['cluster-a|a']);

    for (const shiftKey of [false, true]) {
      await act(async () => table.focus());
      const tab = await pressTab(shiftKey);
      expect(tab.defaultPrevented).toBe(false);
      expect(focusedRows()).toEqual([]);
    }
  });
});
