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

// Track calls to useGridTablePersistence so we can inspect clusterIdentity.
const mockUseGridTablePersistence = vi.fn().mockReturnValue({
  sortConfig: null,
  setSortConfig: vi.fn(),
  columnWidths: null,
  setColumnWidths: vi.fn(),
  columnVisibility: null,
  setColumnVisibility: vi.fn(),
  filters: { search: '', kinds: [], namespaces: [] },
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
  default: () => <div data-testid="grid-table" />,
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

vi.mock('@shared/hooks/useObjectActions', () => ({
  buildObjectActionItems: () => [],
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
});
