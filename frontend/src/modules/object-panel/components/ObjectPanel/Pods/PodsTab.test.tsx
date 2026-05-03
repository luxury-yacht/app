/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.test.tsx
 *
 * Verifies PodsTab uses the panel-scoped clusterId for table persistence,
 * not the global sidebar selection.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PodsTab } from './PodsTab';

const { useTableSortMock } = vi.hoisted(() => ({
  useTableSortMock: vi.fn(
    (data: unknown[], _defaultKey?: string, _defaultDir?: any, opts?: any) => ({
      sortedData: data,
      sortConfig: opts?.controlledSort ?? null,
      handleSort: vi.fn(),
    })
  ),
}));

// Track calls to useGridTablePersistence so we can inspect clusterIdentity.
const gridTablePropsRef: { current: any } = { current: null };
const mockUseGridTablePersistence = vi.fn().mockReturnValue({
  sortConfig: null,
  setSortConfig: vi.fn(),
  columnWidths: null,
  setColumnWidths: vi.fn(),
  columnVisibility: null,
  setColumnVisibility: vi.fn(),
  filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
  setFilters: vi.fn(),
  resetState: vi.fn(),
});

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: (...args: any[]) => mockUseGridTablePersistence(...args),
}));

const PANEL_CLUSTER_ID = 'panel-cluster-A';
const SIDEBAR_CLUSTER_ID = 'sidebar-cluster-B';

// Return a panel-scoped objectData with a specific clusterId.
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: vi.fn(),
    objectData: {
      clusterId: PANEL_CLUSTER_ID,
      clusterName: 'Panel Cluster A',
      kind: 'Deployment',
      name: 'my-deploy',
      namespace: 'default',
    },
  }),
}));

// Provide a DIFFERENT global clusterId to prove PodsTab doesn't use it.
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: SIDEBAR_CLUSTER_ID,
    selectedClusterName: 'Sidebar Cluster B',
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    onNamespaceSelect: vi.fn(),
    setActiveNamespaceTab: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    setSelectedNamespace: vi.fn(),
  }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@shared/components/tables/GridTable', () => ({
  default: (props: any) => {
    gridTablePropsRef.current = props;
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@hooks/useTableSort', () => ({
  useTableSort: (...args: any[]) => (useTableSortMock as any)(...args),
}));

vi.mock('../shared.css', () => ({}));

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('PodsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    mockUseGridTablePersistence.mockClear();
    gridTablePropsRef.current = null;
    useTableSortMock.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('passes panel-scoped clusterId to useGridTablePersistence, not the global sidebar selection', () => {
    act(() => {
      root.render(
        <PodsTab pods={[]} metrics={null} loading={false} error={null} isActive={true} />
      );
    });

    expect(mockUseGridTablePersistence).toHaveBeenCalled();
    const params = mockUseGridTablePersistence.mock.calls[0][0];
    expect(params.clusterIdentity).toBe(PANEL_CLUSTER_ID);
    expect(params.clusterIdentity).not.toBe(SIDEBAR_CLUSTER_ID);
  });

  it('uses canonical pod row keys', () => {
    const pod = {
      name: 'api',
      namespace: 'team-a',
      clusterId: PANEL_CLUSTER_ID,
      clusterName: 'Panel Cluster A',
      ownerKind: 'Deployment',
      ownerName: 'api',
      node: 'node-a',
      status: 'Running',
      ready: '1/1',
      restarts: 0,
      age: '1m',
    } as any;

    act(() => {
      root.render(
        <PodsTab pods={[pod]} metrics={null} loading={false} error={null} isActive={true} />
      );
    });

    expect(gridTablePropsRef.current.keyExtractor(pod)).toBe('panel-cluster-A|/v1/Pod/team-a/api');
  });

  it('passes rowIdentity into useTableSort for live pod reuse', () => {
    const pod = {
      name: 'api',
      namespace: 'team-a',
      clusterId: PANEL_CLUSTER_ID,
    } as any;

    act(() => {
      root.render(
        <PodsTab pods={[pod]} metrics={null} loading={false} error={null} isActive={true} />
      );
    });

    const options = useTableSortMock.mock.calls[0]?.[3];
    expect(options?.rowIdentity).toBeTypeOf('function');
    expect(options.rowIdentity(pod, 0)).toBe('panel-cluster-A|/v1/Pod/team-a/api');
  });

  it('uses the shared filter placeholder for the local table filter', () => {
    act(() => {
      root.render(
        <PodsTab pods={[]} metrics={null} loading={false} error={null} isActive={true} />
      );
    });

    expect(gridTablePropsRef.current.filters.options.searchPlaceholder).toBeUndefined();
  });
});
