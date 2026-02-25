/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.test.tsx
 *
 * Verifies JobsTab renders job data, handles empty state, and passes
 * panel-scoped clusterId to useGridTablePersistence.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsTab } from './JobsTab';
import { types } from '@wailsjs/go/models';

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

const mockOpenWithObject = vi.fn();

// Return a panel-scoped objectData with a specific clusterId.
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({
    openWithObject: mockOpenWithObject,
    objectData: {
      clusterId: PANEL_CLUSTER_ID,
      clusterName: 'Panel Cluster A',
      kind: 'CronJob',
      name: 'my-cronjob',
      namespace: 'default',
    },
  }),
}));

// Provide a DIFFERENT global clusterId to prove JobsTab doesn't use it.
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

const makeJob = (overrides: Partial<types.JobSimpleInfo> = {}): types.JobSimpleInfo =>
  types.JobSimpleInfo.createFrom({
    kind: 'Job',
    name: 'test-job-1',
    namespace: 'default',
    status: 'Completed',
    completions: '1/1',
    succeeded: 1,
    failed: 0,
    active: 0,
    age: '5m',
    duration: '30s',
    ...overrides,
  });

describe('JobsTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    mockUseGridTablePersistence.mockClear();
    mockOpenWithObject.mockClear();
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
        <JobsTab jobs={[makeJob()]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    expect(mockUseGridTablePersistence).toHaveBeenCalled();
    const params = mockUseGridTablePersistence.mock.calls[0][0];
    expect(params.clusterIdentity).toBe(PANEL_CLUSTER_ID);
    expect(params.clusterIdentity).not.toBe(SIDEBAR_CLUSTER_ID);
  });

  it('renders without errors when jobs is empty', () => {
    act(() => {
      root.render(<JobsTab jobs={[]} loading={false} isActive={true} />);
    });

    // Should render the grid table (mocked) without crashing.
    expect(container.querySelector('[data-testid="grid-table"]')).toBeTruthy();
  });

  it('renders without errors when jobs are provided', () => {
    const jobs = [
      makeJob({ name: 'job-a', status: 'Completed' }),
      makeJob({ name: 'job-b', status: 'Failed' }),
    ];
    act(() => {
      root.render(
        <JobsTab
          jobs={jobs}
          loading={false}
          isActive={true}
          clusterId={PANEL_CLUSTER_ID}
          clusterName="Panel Cluster A"
        />
      );
    });

    expect(container.querySelector('[data-testid="grid-table"]')).toBeTruthy();
  });

  it('uses viewId "object-panel-jobs" for persistence', () => {
    act(() => {
      root.render(<JobsTab jobs={[makeJob()]} loading={false} isActive={true} />);
    });

    expect(mockUseGridTablePersistence).toHaveBeenCalled();
    const params = mockUseGridTablePersistence.mock.calls[0][0];
    expect(params.viewId).toBe('object-panel-jobs');
  });
});
