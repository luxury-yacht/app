/**
 * frontend/src/modules/resource-grid/ResourceInventoryTable.test.tsx
 *
 * The wrapper must SURFACE the controller's error: a failed source renders a
 * visible error banner — never just the generic "No data available" empty
 * table (which is indistinguishable from a healthy empty result).
 */
import type { GridTableProps } from '@shared/components/tables/GridTable';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  name: string;
}

const gridTablePropsRef: { current: GridTableProps<Row> | null } = { current: null };

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: (props: GridTableProps<Row>) => {
    gridTablePropsRef.current = props;
    return (
      <div data-testid="grid-table">
        {props.data.length === 0
          ? (props.emptyMessage ?? 'No data available')
          : props.data.map((row: { name: string }) => <div key={row.name}>{row.name}</div>)}
      </div>
    );
  },
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ResourceInventoryTable from './ResourceInventoryTable';
import {
  type ResourceInventorySourceState,
  resetResourceInventoryRowCache,
} from './useResourceInventoryTable';

const columns = [{ key: 'name', header: 'Name', render: (row: Row) => row.name }];

let container: HTMLDivElement;
let root: ReactDOM.Root;

const src = (o: Partial<ResourceInventorySourceState<Row>>): ResourceInventorySourceState<Row> => ({
  rows: [],
  loading: false,
  loaded: true,
  error: null,
  completeness: 'complete',
  ...o,
});

const renderTable = (source: ResourceInventorySourceState<Row>, boundRows?: Row[]) => {
  act(() => {
    root.render(
      <ResourceInventoryTable<Row>
        source={source}
        gridTableProps={{
          keyExtractor: (row: Row) => row.name,
          ...(boundRows ? { data: boundRows } : {}),
        }}
        spinnerMessage="Loading..."
        emptyMessage="No rows found"
        columns={columns}
      />
    );
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
  gridTablePropsRef.current = null;
  resetResourceInventoryRowCache();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('ResourceInventoryTable error surface', () => {
  it('renders the errored empty state without any in-table banner', () => {
    // Error details belong to the refresh error toasts; the table only
    // distinguishes an errored empty from a genuine empty.
    renderTable(src({ error: 'connection reset while listing pods' }));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Unable to load data');
    expect(container.textContent).not.toContain('No data available');
  });

  it('renders a permission-classified error as the designed permission state', () => {
    // A typed 403 is a settled, designed state (e.g. a domain the identity
    // cannot read under a namespace scope) — never the generic failure text.
    renderTable(src({ error: 'pods is forbidden: User cannot list resource' }));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Insufficient permissions');
    expect(container.textContent).not.toContain('Unable to load data');
  });

  it('does not show the settled-empty message while errored', () => {
    renderTable(src({ error: 'boom' }));
    expect(container.textContent).not.toContain('No rows found');
  });

  it('shows no banner on a healthy result', () => {
    renderTable(src({ rows: [{ name: 'row-1' }] }));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('row-1');
  });

  it('keeps rows visible when an error arrives with rows present', () => {
    renderTable(src({ rows: [{ name: 'row-1' }], error: 'refresh failed' }));
    expect(container.textContent).toContain('row-1');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('renders the binding-owned row order while the live source rows are active', () => {
    const sourceRows = [{ name: 'alpha' }, { name: 'bravo' }];
    renderTable(src({ rows: sourceRows }), [...sourceRows].reverse());

    expect(gridTablePropsRef.current?.data.map(({ name }) => name)).toEqual(['bravo', 'alpha']);
  });

  it('keeps controller replay rows when the live binding is transiently empty', () => {
    renderTable(src({ rows: [{ name: 'cached' }], cacheKey: 'cluster-a|namespaces' }), [
      { name: 'cached' },
    ]);
    renderTable(src({ rows: [], loading: true, cacheKey: 'cluster-a|namespaces' }), []);

    expect(gridTablePropsRef.current?.data.map(({ name }) => name)).toEqual(['cached']);
  });
});
