import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { createAgeColumn } from '@shared/components/tables/columnFactories';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from './useQueryBackedResourceGridTable';
import type { TypedQueryPayload } from './typedResourceQueryScope';

const {
  liveDomainStateRef,
  liveDomainStatesRef,
  lifecycleCallsRef,
  scopedDomainCallsRef,
  useTypedResourceQueryMock,
  useClusterResourceGridTableMock,
  useNamespaceResourceGridTableMock,
  persistedPageSizeRef,
  persistenceHydratedRef,
  persistedFiltersRef,
  setPageSizeMock,
} = vi.hoisted(() => ({
  liveDomainStateRef: {
    current: {
      status: 'ready' as string,
      data: {},
      version: 1,
      sourceVersion: 'source:1',
      checksum: '',
      lastUpdated: 11,
    } as {
      status?: string;
      data?: unknown;
      version?: number;
      sourceVersion?: string;
      checksum?: string;
      lastUpdated?: number;
    },
  },
  liveDomainStatesRef: {
    current: {} as Record<
      string,
      {
        status?: string;
        data?: unknown;
        version?: number;
        sourceVersion?: string;
        checksum?: string;
        lastUpdated?: number;
      }
    >,
  },
  lifecycleCallsRef: { current: [] as unknown[] },
  scopedDomainCallsRef: { current: [] as Array<[string, string]> },
  useTypedResourceQueryMock: vi.fn(),
  useClusterResourceGridTableMock: vi.fn(),
  useNamespaceResourceGridTableMock: vi.fn(),
  persistedPageSizeRef: { current: null as number | null },
  persistenceHydratedRef: { current: true },
  persistedFiltersRef: { current: null as Record<string, unknown> | null },
  setPageSizeMock: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (domain: string, scope: string) => {
    scopedDomainCallsRef.current.push([domain, scope]);
    return (
      liveDomainStatesRef.current[`${domain}|${scope}`] ??
      liveDomainStatesRef.current[domain] ??
      liveDomainStateRef.current
    );
  },
}));

vi.mock('@/core/data-access', () => ({
  useScopedRefreshDomainLifecycle: (params: unknown) => {
    lifecycleCallsRef.current.push(params);
  },
}));

vi.mock('./useTypedResourceQuery', () => ({
  useTypedResourceQuery: (params: unknown) => useTypedResourceQueryMock(params),
}));

vi.mock('./useResourceGridTable', () => ({
  useClusterResourceGridTable: (params: any) => useClusterResourceGridTableMock(params),
  useNamespaceResourceGridTable: (params: any) => useNamespaceResourceGridTableMock(params),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    storageKey: 'gridtable:v1:cluster-a:cluster-nodes',
    sortConfig: null,
    setSortConfig: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    filters: persistedFiltersRef.current ?? DEFAULT_GRID_TABLE_FILTER_STATE,
    setFilters: vi.fn(),
    pageSize: persistedPageSizeRef.current,
    setPageSize: setPageSizeMock,
    hydrated: persistenceHydratedRef.current,
    resetState: vi.fn(),
  }),
}));

interface TestRow {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
  cpuUsage?: string;
  age?: string;
  ageTimestamp?: number;
}

interface TestPayload extends TypedQueryPayload {
  rows?: TestRow[];
}

interface TestMetricRow {
  rowKey: string;
  cpuUsage: string;
}

interface TestMetricPayload extends TypedQueryPayload {
  rows?: TestMetricRow[];
  metrics?: { stale: boolean; collectedAt?: number };
}

const columns: GridColumnDefinition<TestRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => row.name,
  },
];

const row: TestRow = {
  kind: 'Pod',
  name: 'api',
  namespace: 'team-a',
  clusterId: 'cluster-a',
};

const workerRow: TestRow = {
  kind: 'Pod',
  name: 'worker',
  namespace: 'team-a',
  clusterId: 'cluster-a',
};

const selectRows = (payload: TestPayload) => payload.rows ?? [];
const testMetricOverlay = {
  domain: 'pods-metrics' as const,
  label: 'Pod Metrics',
  selectRows: (payload: unknown) => (payload as TestMetricPayload).rows ?? [],
  getBaseRowKey: (item: TestRow) => `${item.namespace ?? ''}/${item.name}`.toLowerCase(),
  getMetricRowKey: (item: unknown) => (item as TestMetricRow).rowKey,
  mergeMetric: (item: TestRow, metric: unknown): TestRow => ({
    ...item,
    cpuUsage: (metric as TestMetricRow | undefined)?.cpuUsage ?? item.cpuUsage,
  }),
};

const publishedTableState = {
  filters: DEFAULT_GRID_TABLE_FILTER_STATE,
  sortConfig: { key: 'name', direction: 'asc' } as const,
};

const paginationLoading = (
  result:
    ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined
): boolean | undefined =>
  ((result?.gridTableProps as any)?.paginationControls as any)?.props?.loading;

const paginationTotalCount = (
  result:
    | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
    | ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>>
    | undefined
): number | undefined =>
  ((result?.gridTableProps as any)?.paginationControls as any)?.props?.totalCount;

describe('useQueryBackedResourceGridTable live invalidation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    liveDomainStateRef.current = {
      status: 'ready',
      data: {},
      version: 1,
      sourceVersion: 'source:1',
      checksum: '',
      lastUpdated: 11,
    };
    liveDomainStatesRef.current = {};
    scopedDomainCallsRef.current = [];
    lifecycleCallsRef.current = [];
    useTypedResourceQueryMock.mockReset();
    persistedPageSizeRef.current = null;
    persistenceHydratedRef.current = true;
    persistedFiltersRef.current = null;
    setPageSizeMock.mockReset();
    useTypedResourceQueryMock.mockReturnValue({
      rows: [row],
      loading: false,
      loaded: true,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 1,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    const tableResult = {
      gridTableProps: {
        data: [row],
      },
      favModal: null,
    };
    useClusterResourceGridTableMock.mockReset();
    useClusterResourceGridTableMock.mockReturnValue(tableResult);
    useNamespaceResourceGridTableMock.mockReset();
    useNamespaceResourceGridTableMock.mockReturnValue(tableResult);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('passes cluster scoped live refresh revisions into typed queries', () => {
    const Probe: React.FC = () => {
      useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(scopedDomainCallsRef.current).toContainEqual(['nodes', 'cluster-a|']);
    expect(lifecycleCallsRef.current).toContainEqual(
      expect.objectContaining({
        domain: 'nodes',
        scope: 'cluster-a|',
        preserveState: true,
        fetchOnEnable: false,
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: 'source:1',
      })
    );

    liveDomainStateRef.current = {
      status: 'ready',
      data: {},
      version: 2,
      sourceVersion: 'source:2',
      checksum: 'fresh',
      lastUpdated: 22,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: 'source:2',
      })
    );
  });

  it('passes namespace scoped live refresh revisions into typed queries', () => {
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        selectRows,
        viewId: 'namespace-pods',
        namespace: ALL_NAMESPACES_SCOPE,
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(scopedDomainCallsRef.current).toContainEqual(['pods', 'cluster-a|namespace:all']);
    expect(lifecycleCallsRef.current).toContainEqual(
      expect.objectContaining({
        domain: 'pods',
        scope: 'cluster-a|namespace:all',
        preserveState: true,
        fetchOnEnable: false,
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: 'source:1',
      })
    );

    liveDomainStateRef.current = {
      status: 'ready',
      data: {},
      version: 3,
      sourceVersion: 'source:3',
      checksum: '',
      lastUpdated: 33,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: 'source:3',
      })
    );
  });

  it('seeds cluster query state from the configured default sort before persistence publishes', () => {
    const Probe: React.FC = () => {
      useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'cluster-events',
        label: 'Cluster Events',
        selectRows,
        viewId: 'cluster-events',
        columns,
        keyExtractor: (item) => item.name,
        defaultSortKey: 'age',
        defaultSortDirection: 'desc',
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useClusterResourceGridTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultSortKey: 'age',
        defaultSortDirection: 'desc',
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'cluster-events',
        sortConfig: { key: 'age', direction: 'desc' },
      })
    );
  });

  it('seeds namespace query state from the configured default sort before persistence publishes', () => {
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'namespace-events',
        label: 'All Namespaces Events',
        selectRows,
        viewId: 'namespace-events',
        namespace: ALL_NAMESPACES_SCOPE,
        columns,
        keyExtractor: (item) => item.name,
        defaultSort: { key: 'age', direction: 'desc' },
      });
      return null;
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useNamespaceResourceGridTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultSort: { key: 'age', direction: 'desc' },
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'namespace-events',
        sortConfig: { key: 'age', direction: 'desc' },
      })
    );
  });

  it('keeps cluster tables in initial loading until the typed query can run', () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(result?.source.loading).toBe(true);
    expect(result?.source.loaded).toBe(false);
  });

  it('keeps namespace tables in initial loading until the typed query can run', () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        selectRows,
        viewId: 'namespace-pods',
        namespace: ALL_NAMESPACES_SCOPE,
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useNamespaceResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(result?.source.loading).toBe(true);
    expect(result?.source.loaded).toBe(false);
  });

  it('does not run the first typed query while the live base domain is still initialising', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'cluster-config',
        label: 'Cluster Configuration',
        selectRows,
        viewId: 'cluster-config',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    liveDomainStateRef.current = {
      status: 'initialising',
      data: null,
      version: 1,
      checksum: '',
      lastUpdated: 11,
    };
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    );
    expect(result?.source.loading).toBe(true);
    expect(result?.source.loaded).toBe(false);

    liveDomainStateRef.current = {
      status: 'ready',
      data: { resources: [] },
      version: 2,
      sourceVersion: 'source:ready',
      checksum: 'ready',
      lastUpdated: 22,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'cluster-config',
        liveDataVersion: 'source:ready',
      })
    );
  });

  it('allows the first cluster query when the live base domain is idle', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    liveDomainStateRef.current = {
      status: 'idle',
      data: null,
      version: undefined,
      checksum: undefined,
      lastUpdated: undefined,
    };
    useTypedResourceQueryMock.mockReturnValue({
      rows: [],
      loading: false,
      loaded: false,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 0,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'nodes', enabled: true })
    );
    expect(result?.source.loading).toBe(true);
    expect(result?.source.loaded).toBe(false);
    expect(result?.source.rows).toEqual([]);
  });

  it('allows the first namespace query when the live base domain is idle', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'namespace-config',
        label: 'All Namespaces Config',
        selectRows,
        viewId: 'namespace-config',
        namespace: ALL_NAMESPACES_SCOPE,
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    liveDomainStateRef.current = {
      status: 'idle',
      data: null,
      version: undefined,
      checksum: undefined,
      lastUpdated: undefined,
    };
    useTypedResourceQueryMock.mockReturnValue({
      rows: [],
      loading: false,
      loaded: false,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 0,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useNamespaceResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'namespace-config', enabled: true })
    );
    expect(result?.source.loading).toBe(true);
    expect(result?.source.loaded).toBe(false);
    expect(result?.source.rows).toEqual([]);
  });

  it('does not expose table loading during a query refresh that already has rows', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockReturnValue({
      rows: [row],
      loading: true,
      loaded: true,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 1,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [row],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.loading).toBe(false);
    expect(paginationLoading(result)).toBe(false);
  });

  it('exposes table loading during a query load with no rows yet', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockReturnValue({
      rows: [],
      loading: true,
      loaded: false,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 0,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.loading).toBe(true);
    expect(paginationLoading(result)).toBe(false);
  });

  it('uses empty query results by default when local rows exist', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockReturnValue({
      rows: [],
      loading: false,
      loaded: true,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 0,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: {
        data: params.data,
      },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.rows).toEqual([]);
    expect(useClusterResourceGridTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [] })
    );
  });

  it('exposes pagination loading only while a pagination request is in flight', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockReturnValue({
      rows: [row],
      loading: true,
      loaded: true,
      error: null,
      continueToken: 'next-page',
      hasPrevious: false,
      isRequestingMore: true,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: 2,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [row],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.loading).toBe(false);
    expect(paginationLoading(result)).toBe(true);
  });

  it('never issues the first query with pre-hydration filters', async () => {
    const Probe: React.FC = () => {
      useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };
    const publish = async (state: typeof publishedTableState) => {
      await act(async () => {
        const calls = useClusterResourceGridTableMock.mock.calls;
        calls[calls.length - 1]?.[0].onTableStateChange(state);
        await Promise.resolve();
      });
    };

    // Render before hydration: the table publishes its DEFAULT state.
    persistenceHydratedRef.current = false;
    act(() => {
      root.render(<Probe />);
    });
    await publish(publishedTableState);
    expect(useTypedResourceQueryMock.mock.calls.some((call: any[]) => call[0].enabled)).toBe(false);

    // Hydration commits, but the post-hydration publish has not run yet (it is
    // an effect). The query must NOT fire with the stale default filters.
    persistenceHydratedRef.current = true;
    act(() => {
      root.render(<Probe />);
    });
    expect(useTypedResourceQueryMock.mock.calls.some((call: any[]) => call[0].enabled)).toBe(false);

    // The post-hydration publish lands with the persisted filters — only now
    // does the query run, and with those filters.
    const hydratedState = {
      filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'persisted' },
      sortConfig: { key: 'name', direction: 'asc' } as const,
    };
    await publish(hydratedState);
    const enabledCalls = useTypedResourceQueryMock.mock.calls.filter(
      (call: any[]) => call[0].enabled
    );
    expect(enabledCalls.length).toBeGreaterThan(0);
    expect(enabledCalls[0][0].filters).toEqual(hydratedState.filters);
  });

  it('uses persisted rows per page for the query and saves page size changes', async () => {
    let result:
      ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>> | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        selectRows,
        viewId: 'cluster-nodes',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    persistedPageSizeRef.current = 250;
    useTypedResourceQueryMock.mockReturnValue({
      rows: [row],
      loading: false,
      loaded: true,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 250,
      totalCount: 1,
      totalIsExact: true,
      filterOptions: {},
      dynamic: null,
    });
    useClusterResourceGridTableMock.mockReturnValue({
      gridTableProps: {
        data: [row],
      },
      favModal: null,
    });

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useClusterResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageLimit: 250 })
    );

    const paginationControls = (result?.gridTableProps as any)?.paginationControls;
    paginationControls.props.onPageSizeChange(500);

    expect(setPageSizeMock).toHaveBeenCalledWith(500);
  });

  it('overlays object-sorted rows from a separate metric domain query', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const metricPayload: TestMetricPayload = {
      rows: [{ rowKey: 'team-a/api', cpuUsage: '250m' }],
      metrics: { stale: false, collectedAt: 123 },
    };
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isMetricDomain = params.domain === 'pods-metrics';
      return {
        rows: isMetricDomain ? metricPayload.rows : [{ ...row, cpuUsage: '0m' }],
        payload: isMetricDomain ? metricPayload : { rows: [{ ...row, cpuUsage: '0m' }] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: 1,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: vi.fn().mockResolvedValue([]),
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.rows).toEqual([{ ...row, cpuUsage: '250m' }]);
    expect(result?.metricPayload).toEqual(metricPayload);
    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods-metrics',
        predicates: { rowKeys: 'team-a/api' },
      })
    );
  });

  it('keeps the base query decoupled when only the metric domain source version changes', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const metricPayload: TestMetricPayload = {
      rows: [{ rowKey: 'team-a/api', cpuUsage: '250m' }],
      metrics: { stale: false, collectedAt: 123 },
    };
    const scopeKey = 'cluster-a|namespace:team-a';
    liveDomainStatesRef.current = {
      [`pods|${scopeKey}`]: {
        status: 'ready',
        data: {},
        version: 1,
        sourceVersion: 'base:1',
        checksum: 'base',
        lastUpdated: 11,
      },
      [`pods-metrics|${scopeKey}`]: {
        status: 'ready',
        data: {},
        version: 1,
        sourceVersion: 'metric:1',
        checksum: 'metric-1',
        lastUpdated: 12,
      },
    };
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };
    const queryResult = (rows: unknown[], payload: unknown, enabled: boolean) => ({
      rows: enabled ? rows : [],
      payload: enabled ? payload : { rows: [] },
      loading: false,
      loaded: enabled,
      error: null,
      continueToken: null,
      hasPrevious: false,
      isRequestingMore: false,
      loadMore: vi.fn(),
      loadPrevious: vi.fn(),
      pageIndex: 1,
      pageSize: 50,
      totalCount: enabled ? rows.length : 0,
      totalIsExact: true,
      filterOptions: {},
      kindVocabulary: null,
      dynamic: null,
      fetchAllRows: vi.fn().mockResolvedValue([]),
    });
    useTypedResourceQueryMock.mockImplementation((params: any) => {
      if (params.domain === 'pods-metrics') {
        return queryResult(metricPayload.rows ?? [], metricPayload, params.enabled);
      }
      return queryResult(
        [{ ...row, cpuUsage: undefined }],
        { rows: [{ ...row, cpuUsage: undefined }] },
        params.enabled
      );
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    const lastCall = (calls: any[]) => calls[calls.length - 1];
    const latestEnabledBaseCall = () =>
      lastCall(
        useTypedResourceQueryMock.mock.calls
          .map((call: any[]) => call[0])
          .filter((params: any) => params.domain === 'pods' && params.enabled && !params.predicates)
      );
    const latestEnabledMetricOverlayCall = () =>
      lastCall(
        useTypedResourceQueryMock.mock.calls
          .map((call: any[]) => call[0])
          .filter(
            (params: any) => params.domain === 'pods-metrics' && params.enabled && params.predicates
          )
      );

    expect(latestEnabledBaseCall()).toEqual(
      expect.objectContaining({
        enabled: true,
        liveDataVersion: 'base:1',
      })
    );
    expect(latestEnabledMetricOverlayCall()).toEqual(
      expect.objectContaining({
        enabled: true,
        liveDataVersion: 'metric:1',
      })
    );
    expect(result?.source.loading).toBe(false);

    liveDomainStatesRef.current = {
      ...liveDomainStatesRef.current,
      [`pods-metrics|${scopeKey}`]: {
        status: 'ready',
        data: {},
        version: 2,
        sourceVersion: 'metric:2',
        checksum: 'metric-2',
        lastUpdated: 22,
      },
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(latestEnabledBaseCall()).toEqual(
      expect.objectContaining({
        enabled: true,
        liveDataVersion: 'base:1',
      })
    );
    expect(latestEnabledMetricOverlayCall()).toEqual(
      expect.objectContaining({
        enabled: true,
        liveDataVersion: 'metric:2',
      })
    );
    expect(result?.source.loading).toBe(false);
  });

  it('exports object-sorted rows with all matching metric overlays applied', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const metricPayload: TestMetricPayload = {
      rows: [{ rowKey: 'team-a/api', cpuUsage: '250m' }],
      metrics: { stale: false, collectedAt: 123 },
    };
    const baseFetchAllRows = vi.fn().mockResolvedValue([row, workerRow]);
    const metricFetchAllRows = vi.fn().mockResolvedValue([
      { rowKey: 'team-a/api', cpuUsage: '250m' },
      { rowKey: 'team-a/worker', cpuUsage: '900m' },
      { rowKey: 'team-a/missing', cpuUsage: '100m' },
    ]);
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isMetricDomain = params.domain === 'pods-metrics';
      return {
        rows: isMetricDomain ? metricPayload.rows : [{ ...row, cpuUsage: undefined }],
        payload: isMetricDomain ? metricPayload : { rows: [{ ...row, cpuUsage: undefined }] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: 1,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: isMetricDomain ? metricFetchAllRows : baseFetchAllRows,
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    await expect(result?.gridTableProps.fetchAllRows?.()).resolves.toEqual([
      { ...row, cpuUsage: '250m' },
      { ...workerRow, cpuUsage: '900m' },
    ]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ResourceGridTable] Metric rows did not match standard rows',
      expect.objectContaining({
        baseDomain: 'pods',
        metricDomain: 'pods-metrics',
        label: 'Namespace Pods',
        source: 'fetchAllRows',
        rowKeys: ['team-a/missing'],
      })
    );
    consoleErrorSpy.mockRestore();
    expect(metricFetchAllRows).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        predicates: { rowKeys: 'team-a/api|team-a/worker' },
        sortConfig: { key: 'name', direction: 'asc' },
      })
    );
  });

  it('uses the metric domain for CPU-sorted membership and hydrates base rows by row key', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const metricPayload: TestMetricPayload = {
      rows: [
        { rowKey: 'team-a/worker', cpuUsage: '900m' },
        { rowKey: 'team-a/api', cpuUsage: '250m' },
      ],
      metrics: { stale: false, collectedAt: 456 },
    };
    const cpuSortState = {
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'cpu', direction: 'desc' } as const,
    };
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isMetricDomain = params.domain === 'pods-metrics';
      const isHydrationQuery = params.domain === 'pods' && params.predicates?.rowKeys;
      return {
        rows: isMetricDomain ? metricPayload.rows : isHydrationQuery ? [row, workerRow] : [],
        payload: isMetricDomain
          ? metricPayload
          : { rows: isHydrationQuery ? [row, workerRow] : [] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: 2,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: vi.fn().mockResolvedValue([]),
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(cpuSortState);
      await Promise.resolve();
    });

    expect(result?.source.rows).toEqual([
      { ...workerRow, cpuUsage: '900m' },
      { ...row, cpuUsage: '250m' },
    ]);
    expect(result?.metricPayload).toEqual(metricPayload);
    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods-metrics',
        enabled: true,
        sortConfig: { key: 'cpu', direction: 'desc' },
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'pods',
        enabled: true,
        predicates: { rowKeys: 'team-a/api|team-a/worker' },
      })
    );
  });

  it('lets age text advance without issuing another base or metric query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
    const ageRow: TestRow = {
      ...row,
      age: 'stale',
      ageTimestamp: Date.parse('2026-01-01T00:00:00Z'),
    };
    const ageColumns: GridColumnDefinition<TestRow>[] = [
      createAgeColumn<TestRow>('age', 'Age', (item) => item.age ?? '-'),
    ];
    const Probe: React.FC = () => {
      const table = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns: ageColumns,
        keyExtractor: (item) => item.name,
      });
      return <>{(table.gridTableProps as any).ageCell}</>;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isBaseDomain = params.domain === 'pods';
      return {
        rows: isBaseDomain ? [ageRow] : [],
        payload: { rows: isBaseDomain ? [ageRow] : [] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: isBaseDomain ? 1 : 0,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: vi.fn().mockResolvedValue(isBaseDomain ? [ageRow] : []),
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: {
        data: params.data,
        ageCell: params.data[0] ? params.columns[0]?.render(params.data[0]) : null,
      },
      favModal: null,
    }));

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(publishedTableState);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('10s');
    const queryCallCount = useTypedResourceQueryMock.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    expect(container.textContent).toBe('11s');
    expect(useTypedResourceQueryMock).toHaveBeenCalledTimes(queryCallCount);
  });

  it('logs CPU-sorted metric rows that do not hydrate to standard rows', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const metricPayload: TestMetricPayload = {
      rows: [
        { rowKey: 'team-a/worker', cpuUsage: '900m' },
        { rowKey: 'team-a/missing', cpuUsage: '250m' },
      ],
      metrics: { stale: false, collectedAt: 456 },
    };
    const cpuSortState = {
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'cpu', direction: 'desc' } as const,
    };
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isMetricDomain = params.domain === 'pods-metrics';
      const isHydrationQuery = params.domain === 'pods' && params.predicates?.rowKeys;
      return {
        rows: isMetricDomain ? metricPayload.rows : isHydrationQuery ? [workerRow] : [],
        payload: isMetricDomain ? metricPayload : { rows: isHydrationQuery ? [workerRow] : [] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: 2,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: vi.fn().mockResolvedValue([]),
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(cpuSortState);
      await Promise.resolve();
    });

    expect(result?.source.rows).toEqual([{ ...workerRow, cpuUsage: '900m' }]);
    expect(paginationTotalCount(result)).toBe(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ResourceGridTable] Metric rows did not match standard rows',
      expect.objectContaining({
        baseDomain: 'pods',
        metricDomain: 'pods-metrics',
        label: 'Namespace Pods',
        rowKeys: ['team-a/missing'],
      })
    );
    consoleErrorSpy.mockRestore();
  });

  it('exports CPU-sorted rows by walking metric rows and hydrating all matching base rows', async () => {
    let result:
      ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>> | undefined;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sidecarRow: TestRow = {
      kind: 'Pod',
      name: 'sidecar',
      namespace: 'team-a',
      clusterId: 'cluster-a',
    };
    const metricPayload: TestMetricPayload = {
      rows: [
        { rowKey: 'team-a/worker', cpuUsage: '900m' },
        { rowKey: 'team-a/api', cpuUsage: '250m' },
      ],
      metrics: { stale: false, collectedAt: 456 },
    };
    const metricFetchAllRows = vi.fn().mockResolvedValue([
      { rowKey: 'team-a/worker', cpuUsage: '900m' },
      { rowKey: 'team-a/api', cpuUsage: '250m' },
      { rowKey: 'team-a/sidecar', cpuUsage: '100m' },
      { rowKey: 'team-a/missing', cpuUsage: '50m' },
    ]);
    const hydrationFetchAllRows = vi.fn().mockResolvedValue([workerRow, row, sidecarRow]);
    const cpuSortState = {
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'cpu', direction: 'desc' } as const,
    };
    const Probe: React.FC = () => {
      result = useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        metricOverlay: testMetricOverlay,
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };

    useTypedResourceQueryMock.mockImplementation((params: any) => {
      const isMetricDomain = params.domain === 'pods-metrics';
      const isHydrationQuery = params.domain === 'pods' && params.predicates?.rowKeys;
      return {
        rows: isMetricDomain ? metricPayload.rows : isHydrationQuery ? [workerRow, row] : [],
        payload: isMetricDomain
          ? metricPayload
          : { rows: isHydrationQuery ? [workerRow, row] : [] },
        loading: false,
        loaded: true,
        error: null,
        continueToken: null,
        hasPrevious: false,
        isRequestingMore: false,
        loadMore: vi.fn(),
        loadPrevious: vi.fn(),
        pageIndex: 1,
        pageSize: 50,
        totalCount: 3,
        totalIsExact: true,
        filterOptions: {},
        kindVocabulary: null,
        dynamic: null,
        fetchAllRows: isMetricDomain
          ? metricFetchAllRows
          : isHydrationQuery
            ? hydrationFetchAllRows
            : vi.fn().mockResolvedValue([]),
      };
    });
    useNamespaceResourceGridTableMock.mockImplementation((params) => ({
      gridTableProps: { data: params.data },
      favModal: null,
    }));

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      params.onTableStateChange(cpuSortState);
      await Promise.resolve();
    });

    await expect(result?.gridTableProps.fetchAllRows?.()).resolves.toEqual([
      { ...workerRow, cpuUsage: '900m' },
      { ...row, cpuUsage: '250m' },
      { ...sidecarRow, cpuUsage: '100m' },
    ]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ResourceGridTable] Metric rows did not match standard rows',
      expect.objectContaining({
        baseDomain: 'pods',
        metricDomain: 'pods-metrics',
        label: 'Namespace Pods',
        source: 'fetchAllRows',
        rowKeys: ['team-a/missing'],
      })
    );
    consoleErrorSpy.mockRestore();
    expect(metricFetchAllRows).toHaveBeenCalledWith();
    expect(hydrationFetchAllRows).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: DEFAULT_GRID_TABLE_FILTER_STATE,
        predicates: { rowKeys: 'team-a/api|team-a/missing|team-a/sidecar|team-a/worker' },
        sortConfig: { key: 'name', direction: 'asc' },
      })
    );
  });
});
