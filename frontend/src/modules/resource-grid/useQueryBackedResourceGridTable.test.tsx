import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  useQueryBackedClusterResourceGridTable,
  useQueryBackedNamespaceResourceGridTable,
} from './useQueryBackedResourceGridTable';
import type { TypedQueryPayload } from './typedResourceQueryScope';

const {
  liveDomainStateRef,
  lifecycleCallsRef,
  scopedDomainCallsRef,
  useTypedResourceQueryMock,
  useClusterResourceGridTableMock,
  useNamespaceResourceGridTableMock,
} = vi.hoisted(() => ({
  liveDomainStateRef: {
    current: {
      version: 1,
      checksum: '',
      lastUpdated: 11,
    },
  },
  lifecycleCallsRef: { current: [] as unknown[] },
  scopedDomainCallsRef: { current: [] as Array<[string, string]> },
  useTypedResourceQueryMock: vi.fn(),
  useClusterResourceGridTableMock: vi.fn(),
  useNamespaceResourceGridTableMock: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  useRefreshScopedDomain: (domain: string, scope: string) => {
    scopedDomainCallsRef.current.push([domain, scope]);
    return liveDomainStateRef.current;
  },
}));

vi.mock('@/core/data-access', () => ({
  useScopedRefreshDomainLifecycle: (params: unknown) => {
    lifecycleCallsRef.current.push(params);
  },
}));

vi.mock('./useTypedResourceQuery', () => ({
  TYPED_QUERY_PAGE_LIMIT_OPTIONS: [25, 50, 100, 250, 500, 1000],
  useTypedResourceQuery: (params: unknown) => useTypedResourceQueryMock(params),
}));

vi.mock('./useResourceGridTable', () => ({
  useClusterResourceGridTable: (params: any) => useClusterResourceGridTableMock(params),
  useNamespaceResourceGridTable: (params: any) => useNamespaceResourceGridTableMock(params),
}));

interface TestRow {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
}

interface TestPayload extends TypedQueryPayload {
  rows?: TestRow[];
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

const selectRows = (payload: TestPayload) => payload.rows ?? [];

const publishedTableState = {
  filters: DEFAULT_GRID_TABLE_FILTER_STATE,
  sortConfig: { key: 'name', direction: 'asc' } as const,
};

const paginationLoading = (
  result:
    | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
    | undefined
): boolean | undefined =>
  ((result?.gridTableProps as any)?.paginationControls as any)?.props?.loading;

describe('useQueryBackedResourceGridTable live invalidation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    liveDomainStateRef.current = {
      version: 1,
      checksum: '',
      lastUpdated: 11,
    };
    scopedDomainCallsRef.current = [];
    lifecycleCallsRef.current = [];
    useTypedResourceQueryMock.mockReset();
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
  });

  it('passes cluster scoped live refresh revisions into typed queries', () => {
    const Probe: React.FC = () => {
      useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        localData: [row],
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
        enabled: true,
        preserveState: true,
        fetchOnEnable: false,
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: '1::11',
      })
    );

    liveDomainStateRef.current = {
      version: 2,
      checksum: 'fresh',
      lastUpdated: 22,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'nodes',
        liveDataVersion: '2:fresh:22',
      })
    );
  });

  it('passes namespace scoped live refresh revisions into typed queries', () => {
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'pods',
        label: 'All Namespaces Pods',
        localData: [row],
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
        enabled: true,
        preserveState: true,
        fetchOnEnable: false,
      })
    );
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: '1::11',
      })
    );

    liveDomainStateRef.current = {
      version: 3,
      checksum: '',
      lastUpdated: 33,
    };

    act(() => {
      root.render(<Probe />);
    });

    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'pods',
        liveDataVersion: '3::33',
      })
    );
  });

  it('seeds cluster query state from the configured default sort before persistence publishes', () => {
    const Probe: React.FC = () => {
      useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'cluster-events',
        label: 'Cluster Events',
        localData: [row],
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
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'cluster-events',
        sortConfig: { key: 'age', direction: 'desc' },
      })
    );
  });

  it('seeds namespace query state from the configured default sort before persistence publishes', () => {
    const Probe: React.FC = () => {
      useQueryBackedNamespaceResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'namespace-events',
        label: 'All Namespaces Events',
        localData: [row],
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
    expect(useTypedResourceQueryMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        domain: 'namespace-events',
        sortConfig: { key: 'age', direction: 'desc' },
      })
    );
  });

  it('does not expose table loading during a query refresh that already has rows', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        localData: [],
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

    expect(result?.loading).toBe(false);
    expect(paginationLoading(result)).toBe(false);
  });

  it('exposes table loading during a query load with no rows yet', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        localData: [],
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

    expect(result?.loading).toBe(true);
    expect(paginationLoading(result)).toBe(false);
  });

  it('exposes pagination loading only while a pagination request is in flight', async () => {
    let result:
      | ReturnType<typeof useQueryBackedClusterResourceGridTable<TestPayload, TestRow>>
      | undefined;
    const Probe: React.FC = () => {
      result = useQueryBackedClusterResourceGridTable<TestPayload, TestRow>({
        enabled: true,
        clusterId: 'cluster-a',
        domain: 'nodes',
        label: 'Cluster Nodes',
        localData: [],
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

    expect(result?.loading).toBe(false);
    expect(paginationLoading(result)).toBe(true);
  });
});
