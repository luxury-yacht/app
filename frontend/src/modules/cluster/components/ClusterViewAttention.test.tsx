import ClusterViewAttention from '@modules/cluster/components/ClusterViewAttention';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterAttentionFinding } from '@/core/refresh/types';

const { openWithObjectMock, queryParamsRef, tablePropsRef } = vi.hoisted(() => ({
  openWithObjectMock: vi.fn(),
  queryParamsRef: { current: null as Record<string, unknown> | null },
  tablePropsRef: { current: null as Record<string, unknown> | null },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a' }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@/hooks/useShortNames', () => ({ useShortNames: () => false }));

vi.mock('@modules/resource-grid/useQueryBackedResourceGridTable', () => ({
  useQueryBackedClusterResourceGridTable: (params: Record<string, unknown>) => {
    queryParamsRef.current = params;
    return {
      gridTableProps: { keyExtractor: params.keyExtractor },
      favModal: null,
      source: { rows: [], loading: false, loaded: true, error: null },
    };
  },
}));

vi.mock('@modules/resource-grid/ResourceInventoryTable', () => ({
  default: (props: Record<string, unknown>) => {
    tablePropsRef.current = props;
    return <div data-testid="attention-table" />;
  },
}));

const finding: ClusterAttentionFinding = {
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  ref: {
    clusterId: 'cluster-a',
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    resource: 'deployments',
    namespace: 'payments',
    name: 'checkout',
  },
  kind: 'Deployment',
  name: 'checkout',
  namespace: 'payments',
  severity: 'warning',
  status: '1/2 ready',
  reasons: ['Insufficient replicas'],
  age: '2m',
};

describe('ClusterViewAttention', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    openWithObjectMock.mockClear();
    queryParamsRef.current = null;
    tablePropsRef.current = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('binds the cluster-scoped Attention query with kind and namespace filters', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    expect(queryParamsRef.current).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        domain: 'cluster-attention',
        viewId: 'cluster-attention',
        showKindDropdown: true,
        showNamespaceFilters: true,
        defaultSortKey: 'severity',
      })
    );
    expect(tablePropsRef.current).not.toHaveProperty('onRowClick');
  });

  it('opens the complete object reference from the Name link', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current?.columns as
      | GridColumnDefinition<ClusterAttentionFinding>[]
      | undefined;
    expect(columns?.map((column) => column.header)).toEqual([
      'Kind',
      'Name',
      'Namespace',
      'Severity',
      'Status',
      'Finding',
      'Age',
    ]);
    const nameCell = columns?.find((column) => column.key === 'name')?.render(finding);
    expect(nameCell).toBeTruthy();
    const onClick = (
      nameCell as React.ReactElement<{ onClick: (event: { altKey: boolean }) => void }>
    ).props.onClick;
    act(() => onClick({ altKey: false }));

    expect(openWithObjectMock).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      clusterName: undefined,
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      resource: 'deployments',
      namespace: 'payments',
      name: 'checkout',
      uid: undefined,
    });
  });

  it('renders info findings with the info status style', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current?.columns as
      | GridColumnDefinition<ClusterAttentionFinding>[]
      | undefined;
    const severityCell = columns
      ?.find((column) => column.key === 'severity')
      ?.render({ ...finding, severity: 'info' });

    expect(severityCell).toBeTruthy();
    expect((severityCell as React.ReactElement<{ className?: string }>).props.className).toBe(
      'status-text info'
    );
  });
});
