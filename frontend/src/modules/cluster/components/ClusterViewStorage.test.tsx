/**
 * frontend/src/modules/cluster/components/ClusterViewStorage.test.tsx
 *
 * Test suite for ClusterViewStorage.
 * Covers key behaviors and edge cases for ClusterViewStorage.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterViewStorage from '@modules/cluster/components/ClusterViewStorage';

const gridTablePropsRef: { current: any } = { current: null };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [] },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResource: vi.fn(),
}));

const basePV = {
  kind: 'PersistentVolume',
  name: 'pv-1',
  capacity: '10Gi',
  accessModes: 'ReadWriteOnce',
  status: 'Bound',
  claim: 'team-a/claim',
  storageClass: 'standard',
  age: '1d',
};

describe('ClusterViewStorage', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewStorage data={[basePV]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.columnVisibility).toBe(null);
    expect(props.filters?.value).toEqual({ search: '', kinds: [], namespaces: [] });
    expect(props.columnWidths).toBe(null);
  });
});
