/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Jobs/JobsTab.test.tsx
 *
 * Verifies JobsTab renders job data, handles empty state, and passes
 * panel-scoped clusterId to useGridTablePersistence.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { types } from '@wailsjs/go/models';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';
import { JobsTab } from './JobsTab';

interface CapturedJobRow {
  kind: string;
  name: string;
  namespace: string;
  status: string;
  statusPresentation?: string;
  completions: string;
  duration?: string;
  age: string;
  ageTimestamp?: number;
  clusterId?: string | null;
  clusterName?: string | null;
}

// Track calls to useGridTablePersistence so we can inspect clusterIdentity.
const gridTablePropsRef: { current: GridTableProps<CapturedJobRow> | null } = { current: null };
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
  useGridTablePersistence: (...args: unknown[]) => mockUseGridTablePersistence(...args),
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
  default: (props: GridTableProps<CapturedJobRow>) => {
    gridTablePropsRef.current = props;
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: {},
}));

const getGridTableProps = () =>
  requireValue(gridTablePropsRef.current, 'expected captured GridTable props in JobsTab.test.tsx');

const getGridColumn = (key: string) =>
  requireValue(
    getGridTableProps().columns.find((column) => column.key === key),
    `expected ${key} column in JobsTab.test.tsx`
  );

const getContextMenuItems = (row: CapturedJobRow) =>
  requireValue(
    getGridTableProps().getCustomContextMenuItems,
    'expected context-menu factory in JobsTab.test.tsx'
  )(row, 'name');

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('../shared.css', () => ({}));

const makeJob = (overrides: Partial<types.JobSimpleInfo> = {}): types.JobSimpleInfo =>
  types.JobSimpleInfo.createFrom({
    kind: 'Job',
    name: 'test-job-1',
    namespace: 'default',
    status: 'Completed',
    statusState: 'True',
    statusPresentation: 'ready',
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
    gridTablePropsRef.current = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
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

  it('offers the all-matching-rows export scope like every other resource table', async () => {
    const jobs = [makeJob({ name: 'job-a' }), makeJob({ name: 'job-b' })];
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

    // fetchAllRows arms the scope toggle + Copy + Export trio in the filter bar.
    expect(getGridTableProps().exportFilename).toBe('object-panel-jobs');
    const allRows = await requireValue(
      getGridTableProps().fetchAllRows,
      'expected all-rows fetcher in JobsTab.test.tsx'
    )();
    expect(allRows).toHaveLength(2);
  });

  it('uses viewId "object-panel-jobs" for persistence', () => {
    act(() => {
      root.render(<JobsTab jobs={[makeJob()]} loading={false} isActive={true} />);
    });

    expect(mockUseGridTablePersistence).toHaveBeenCalled();
    const params = mockUseGridTablePersistence.mock.calls[0][0];
    expect(params.viewId).toBe('object-panel-jobs');
  });

  it('uses canonical job row keys', () => {
    const job = makeJob({ name: 'nightly', namespace: 'ops' });

    act(() => {
      root.render(
        <JobsTab jobs={[job]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    expect(getGridTableProps().keyExtractor({ ...job, clusterId: PANEL_CLUSTER_ID }, 0)).toBe(
      'panel-cluster-A|batch/v1/Job/ops/nightly'
    );
  });

  it('uses backend statusPresentation for the job status class', () => {
    const job = makeJob({ name: 'nightly', namespace: 'ops', statusPresentation: 'error' });

    act(() => {
      root.render(
        <JobsTab jobs={[job]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    const jobRow = requireValue(getGridTableProps().data[0], 'expected job row');
    const cell = requireReactElement<{ className?: string }>(
      getGridColumn('status').render(jobRow),
      'expected status cell element in JobsTab.test.tsx'
    );
    expect(cell.props.className).toBe('status-text error');
  });

  it('publishes sortable local job columns for displayed job facts', () => {
    const job = makeJob({ name: 'nightly', namespace: 'ops' });

    act(() => {
      root.render(
        <JobsTab jobs={[job]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    const sortableKeys = getGridTableProps()
      .columns.filter((column) => column.sortable !== false)
      .map((column) => column.key)
      .sort((left: string, right: string) => left.localeCompare(right));
    expect(sortableKeys).toEqual(['age', 'completions', 'duration', 'name', 'namespace', 'status']);
  });

  it('renders Job age from the live age timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    const createdAt = Date.parse('2026-01-01T00:00:00Z');
    const job = makeJob({ age: 'stale', ageTimestamp: createdAt });

    act(() => {
      root.render(
        <JobsTab jobs={[job]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    const ageColumn = getGridColumn('age');
    const cellContainer = document.createElement('div');
    document.body.appendChild(cellContainer);
    const cellRoot = ReactDOM.createRoot(cellContainer);
    try {
      act(() => {
        cellRoot.render(
          ageColumn.render(requireValue(getGridTableProps().data[0], 'expected job row'))
        );
      });
      expect(cellContainer.textContent).toBe('10s');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cellContainer.textContent).toBe('11s');
    } finally {
      act(() => cellRoot.unmount());
      cellContainer.remove();
    }
  });

  it('opens the Map from the job context menu', () => {
    const job = makeJob({ name: 'nightly', namespace: 'ops' });

    act(() => {
      root.render(
        <JobsTab jobs={[job]} loading={false} isActive={true} clusterId={PANEL_CLUSTER_ID} />
      );
    });

    const row = requireValue(getGridTableProps().data[0], 'expected job row');
    const objectMapItem = getContextMenuItems(row).find(
      (item) => item.actionId === OBJECT_ACTION_IDS.viewMap
    );
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(mockOpenWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Job',
        name: 'nightly',
        namespace: 'ops',
        clusterId: PANEL_CLUSTER_ID,
        group: 'batch',
        version: 'v1',
      }),
      { initialTab: 'map' }
    );
  });

  it('uses the shared filter placeholder for the local table filter', () => {
    act(() => {
      root.render(<JobsTab jobs={[]} loading={false} isActive={true} />);
    });

    expect(getGridTableProps().filters?.options?.searchPlaceholder).toBeUndefined();
  });
});
