import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { createAgeColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import type React from 'react';
import { act, isValidElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import type {
  ClusterResourceGridTableParams,
  NamespaceResourceGridTableParams,
} from './resourceGridTableTypes';
import type { TypedQueryPayload } from './typedResourceQueryScope';
import {
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from './useQueryBackedResourceGridTable';
import type { UseTypedResourceQueryParams } from './useTypedResourceQuery';

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
      sourceVersions?: Record<string, string>;
      signalVersions?: Record<string, string>;
      streamRevision?: number;
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
  useTypedResourceQueryMock:
    vi.fn<(params: UseTypedResourceQueryParams<TestPayload, TestRow>) => unknown>(),
  useClusterResourceGridTableMock:
    vi.fn<(params: ClusterResourceGridTableParams<TestRow>) => unknown>(),
  useNamespaceResourceGridTableMock:
    vi.fn<(params: NamespaceResourceGridTableParams<TestRow>) => unknown>(),
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
  useTypedResourceQuery: (params: UseTypedResourceQueryParams<TestPayload, TestRow>) =>
    useTypedResourceQueryMock(params),
}));

vi.mock('./useResourceGridTable', () => ({
  useClusterResourceGridTable: (params: ClusterResourceGridTableParams<TestRow>) =>
    useClusterResourceGridTableMock(params),
  useNamespaceResourceGridTable: (params: NamespaceResourceGridTableParams<TestRow>) =>
    useNamespaceResourceGridTableMock(params),
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

const columns: GridColumnDefinition<TestRow>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (resourceRow) => resourceRow.name,
  },
];

const row: TestRow = {
  kind: 'Pod',
  name: 'api',
  namespace: 'team-a',
  clusterId: 'cluster-a',
};

const selectRows = (payload: TestPayload) => payload.rows ?? [];
const publishedTableState = {
  filters: DEFAULT_GRID_TABLE_FILTER_STATE,
  sortConfig: { key: 'name', direction: 'asc' } as const,
};

const requireTableStatePublisher = (
  params:
    | Pick<ClusterResourceGridTableParams<TestRow>, 'onTableStateChange'>
    | Pick<NamespaceResourceGridTableParams<TestRow>, 'onTableStateChange'>
    | undefined
) => requireValue(params?.onTableStateChange, 'expected the resource table state publisher');

interface TestPaginationControlProps {
  loading?: boolean;
  onPageSizeChange?: (value: number) => void;
}

const paginationControlProps = (
  result:
    | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
    | undefined
): TestPaginationControlProps | undefined => {
  const tableProps = result?.gridTableProps as { paginationControls?: unknown } | undefined;
  const paginationControls = tableProps?.paginationControls;
  return isValidElement<TestPaginationControlProps>(paginationControls)
    ? paginationControls.props
    : undefined;
};

const paginationLoading = (
  result:
    | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
    | undefined
): boolean | undefined => paginationControlProps(result)?.loading;

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

  it('issues exactly one typed query per render — metrics are joined at serve, never a second domain query', async () => {
    const cpuSortState = {
      filters: DEFAULT_GRID_TABLE_FILTER_STATE,
      sortConfig: { key: 'cpu', direction: 'desc' } as const,
    };
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns,
        keyExtractor: (item) => item.name,
      });
      return null;
    };
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
      requireTableStatePublisher(params)(cpuSortState);
      await Promise.resolve();
    });

    // The CPU sort rides the single base query (the backend sorts by the
    // serve-time joined usage); there is no metric-domain query and no
    // rowKeys hydration leg.
    const callsPerRender = useTypedResourceQueryMock.mock.calls;
    expect(callsPerRender.every(([params]) => params.domain === 'pods')).toBe(true);
    expect(callsPerRender.some(([params]) => params.predicates?.rowKeys !== undefined)).toBe(false);
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        enabled: true,
        sortConfig: { key: 'cpu', direction: 'desc' },
      })
    );
    // Exactly one typed query per render: total calls == render count. Two
    // renders happened (initial + sort publish), each may re-render once for
    // state settles; every call must target the base domain with no siblings.
    const distinctParamsPerRender = new Set(callsPerRender.map(([params]) => params.label));
    expect(distinctParamsPerRender).toEqual(new Set(['Namespace Pods']));
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
    // No doorbell has rung yet: the identity is the (empty) doorbell clocks.
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: 'object: metric:',
      })
    );

    // Doorbell shape: signalVersions + the folded sourceVersion
    // (bumpSourceVersionOnly writes both).
    liveDomainStateRef.current = {
      status: 'ready',
      data: {},
      version: 2,
      sourceVersion: 'node-2',
      signalVersions: { object: 'node-2' },
      checksum: 'fresh',
      lastUpdated: 22,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: 'object:node-2 metric:',
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
    // No doorbell has rung yet: the identity is the (empty) doorbell clocks.
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: 'object: metric:',
      })
    );

    liveDomainStateRef.current = {
      status: 'ready',
      data: {},
      version: 3,
      sourceVersion: 'pods-3',
      signalVersions: { object: 'pods-3' },
      checksum: '',
      lastUpdated: 33,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: 'object:pods-3 metric:',
      })
    );
  });

  it('refetches on a metric-only doorbell: the folded sourceVersion advances while data, object version, and checksum stay unchanged', () => {
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

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ domain: 'pods', liveDataVersion: 'object: metric:' })
    );

    // Mirror what resourceStreamManager.bumpSourceVersionOnly writes when the
    // backend metric doorbell arrives (version = the poller collection
    // revision): the metric SIGNAL clock AND the folded sourceVersion advance.
    // Data, object version, and checksum stay untouched — no object event
    // happened.
    const doorbellRevision = '1719964800000000000';
    liveDomainStateRef.current = {
      ...liveDomainStateRef.current,
      status: 'ready',
      sourceVersion: doorbellRevision,
      signalVersions: { metric: doorbellRevision },
      streamRevision: 1,
      lastUpdated: 12,
    };

    act(() => {
      root.render(<Probe />);
    });

    // The refetch identity keys on the doorbell clocks, so the metric tick
    // alone — no object change — must produce a new liveDataVersion.
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: `object: metric:${doorbellRevision}`,
      })
    );
  });

  it('apply-driven folded sourceVersion churn must NOT change the refetch identity (no echo)', () => {
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

    // Doorbell shape: signalVersions + folded sourceVersion (what
    // bumpSourceVersionOnly writes).
    liveDomainStateRef.current = {
      ...liveDomainStateRef.current,
      sourceVersion: 'node-doorbell-1',
      signalVersions: { object: 'node-doorbell-1' },
    };
    act(() => {
      root.render(<Probe />);
    });
    const callsAfterMount = useTypedResourceQueryMock.mock.calls.length;
    const identityAtMount = useTypedResourceQueryMock.mock.calls[callsAfterMount - 1][0]
      .liveDataVersion as string;

    // ANOTHER consumer's fetch of the same base scope lands: the apply
    // rewrites the folded sourceVersion (and payload sourceVersions) but never
    // touches signalVersions. Keying the table on the folded value made this
    // look like a new signal — a 304 echo fetch per sibling fetch, per cycle
    // (observed live in the Web Inspector as 0-byte 304s after each 200 pair).
    liveDomainStateRef.current = {
      ...liveDomainStateRef.current,
      sourceVersion: 'validator-from-sibling-apply',
      sourceVersions: { object: 'watermark-7', metric: '1719964800000000000' },
      lastUpdated: 99,
    };
    act(() => {
      root.render(<Probe />);
    });

    const calls = useTypedResourceQueryMock.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0];
    expect(lastCall.liveDataVersion).toBe(identityAtMount);
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
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      | ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
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
        // The gate opened; no doorbell has rung, so the identity is the
        // (empty) object clock.
        liveDataVersion: 'object:',
      })
    );
  });

  it('allows the first cluster query when the live base domain is idle', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
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
      | ReturnType<typeof useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
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
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.loading).toBe(false);
    expect(paginationLoading(result)).toBe(false);
  });

  it('exposes table loading during a query load with no rows yet', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.loading).toBe(true);
    expect(paginationLoading(result)).toBe(false);
  });

  it('uses empty query results by default when local rows exist', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
      await Promise.resolve();
    });

    expect(result?.source.rows).toEqual([]);
    expect(useClusterResourceGridTableMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: [] })
    );
  });

  it('exposes pagination loading only while a pagination request is in flight', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
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
        requireTableStatePublisher(calls[calls.length - 1]?.[0])(state);
        await Promise.resolve();
      });
    };

    // Render before hydration: the table publishes its DEFAULT state.
    persistenceHydratedRef.current = false;
    act(() => {
      root.render(<Probe />);
    });
    await publish(publishedTableState);
    expect(useTypedResourceQueryMock.mock.calls.some(([params]) => params.enabled)).toBe(false);

    // Hydration commits, but the post-hydration publish has not run yet (it is
    // an effect). The query must NOT fire with the stale default filters.
    persistenceHydratedRef.current = true;
    act(() => {
      root.render(<Probe />);
    });
    expect(useTypedResourceQueryMock.mock.calls.some(([params]) => params.enabled)).toBe(false);

    // The post-hydration publish lands with the persisted filters — only now
    // does the query run, and with those filters.
    const hydratedState = {
      filters: { ...DEFAULT_GRID_TABLE_FILTER_STATE, search: 'persisted' },
      sortConfig: { key: 'name', direction: 'asc' } as const,
    };
    await publish(hydratedState);
    const enabledCalls = useTypedResourceQueryMock.mock.calls.filter(([params]) => params.enabled);
    expect(enabledCalls.length).toBeGreaterThan(0);
    expect(enabledCalls[0][0].filters).toEqual(hydratedState.filters);
  });

  it('uses persisted rows per page for the query and saves page size changes', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
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
      requireTableStatePublisher(params)(publishedTableState);
      await Promise.resolve();
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageLimit: 250 })
    );

    const paginationProps = requireValue(
      paginationControlProps(result),
      'expected query-backed pagination controls'
    );
    requireValue(
      paginationProps.onPageSizeChange,
      'expected page-size callback on pagination controls'
    )(500);

    expect(setPageSizeMock).toHaveBeenCalledWith(500);
  });

  it('lets age text advance without issuing another query', async () => {
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
    let renderedAgeCell: React.ReactNode = null;
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'Namespace Pods',
        selectRows,
        viewId: 'namespace-pods',
        namespace: 'team-a',
        columns: ageColumns,
        keyExtractor: (item) => item.name,
      });
      return <>{renderedAgeCell}</>;
    };

    useTypedResourceQueryMock.mockImplementation(() => ({
      rows: [ageRow],
      payload: { rows: [ageRow] },
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
      fetchAllRows: vi.fn().mockResolvedValue([ageRow]),
    }));
    useNamespaceResourceGridTableMock.mockImplementation((params) => {
      renderedAgeCell = params.data[0] ? params.columns[0]?.render(params.data[0]) : null;
      return {
        gridTableProps: {
          data: params.data,
        },
        favModal: null,
      };
    });

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await act(async () => {
      const calls = useNamespaceResourceGridTableMock.mock.calls;
      const params = calls[calls.length - 1]?.[0];
      requireTableStatePublisher(params)(publishedTableState);
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
});
