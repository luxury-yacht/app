/**
 * frontend/src/modules/cluster/components/ClusterViewNodes.test.tsx
 *
 * Test suite for ClusterViewNodes.
 * Covers key behaviors and edge cases for ClusterViewNodes.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterViewNodes from '@modules/cluster/components/ClusterViewNodes';

const gridTablePropsRef: { current: any } = { current: null };
const openWithObjectMock = vi.fn();

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
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'path:context',
    selectedClusterId: 'path:context',
    selectedClusterIds: ['path:context'],
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
    sortedData: data,
    sortConfig: opts?.controlledSort ?? { key: '', direction: null },
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
  }),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: () => ({
    data: { metrics: null, nodes: [] },
    status: 'idle',
    isManual: false,
  }),
  refreshManager: { triggerManualRefresh: vi.fn() },
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const baseNode = {
  name: 'node-1',
  status: 'Ready',
  roles: 'worker',
  version: 'v1.28.0',
  internalIP: '10.0.0.1',
  externalIP: '',
  cpuCapacity: '4',
  cpuAllocatable: '4',
  cpuUsage: '1',
  memoryCapacity: '8Gi',
  memoryAllocatable: '8Gi',
  memoryUsage: '2Gi',
  pods: 3,
  podsAllocatable: 50,
  podsCapacity: 50,
  taints: [],
  labels: {},
  restarts: 0,
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
};

describe('ClusterViewNodes', () => {
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
    openWithObjectMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewNodes data={[baseNode as any]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({ search: '', kinds: [], namespaces: [] });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it('opens the object panel with cluster metadata when clicking a node name', async () => {
    await act(async () => {
      root.render(<ClusterViewNodes data={[baseNode as any]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    const nameColumn = props.columns.find((column: any) => column.key === 'name');
    const cell = nameColumn.render(props.data[0]);

    // Trigger the column click handler to exercise object navigation.
    act(() => {
      cell.props.onClick?.({ stopPropagation: () => {} });
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Node',
        name: 'node-1',
        clusterId: 'alpha:ctx',
        clusterName: 'alpha',
      })
    );
  });
});
