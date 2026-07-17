import ClusterViewAttention from '@modules/cluster/components/ClusterViewAttention';
import { StatusChip } from '@shared/components/StatusChip';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterAttentionFinding } from '@/core/refresh/types';

const {
  openWithObjectMock,
  ignoreObjectMock,
  ignoreTypeMock,
  restoreTypeMock,
  restoreObjectMock,
  queryPayloadRef,
  queryParamsRef,
  tablePropsRef,
} = vi.hoisted(() => ({
  openWithObjectMock: vi.fn(),
  ignoreObjectMock: vi.fn().mockResolvedValue({ ignoredObjects: [], findingTypes: [] }),
  ignoreTypeMock: vi.fn().mockResolvedValue({ ignoredObjects: [], findingTypes: [] }),
  restoreTypeMock: vi.fn().mockResolvedValue({ ignoredObjects: [], findingTypes: [] }),
  restoreObjectMock: vi.fn().mockResolvedValue({ ignoredObjects: [], findingTypes: [] }),
  queryPayloadRef: {
    current: {
      ignoreRules: { ignoredObjects: [], findingTypes: ['restarts'] },
      findingTypes: [
        { id: 'restarts', label: 'Restarts' },
        { id: 'replica-mismatch', label: 'Replica mismatch' },
      ],
    } as Record<string, unknown>,
  },
  queryParamsRef: { current: null as Record<string, unknown> | null },
  tablePropsRef: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/core/settings/clusterAttentionIgnores', () => ({
  ignoreClusterAttentionObject: ignoreObjectMock,
  ignoreClusterAttentionFindingType: ignoreTypeMock,
  restoreClusterAttentionFindingType: restoreTypeMock,
  restoreClusterAttentionObject: restoreObjectMock,
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
      queryPayload: queryPayloadRef.current,
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
    uid: 'uid-checkout',
  },
  kind: 'Deployment',
  name: 'checkout',
  namespace: 'payments',
  severity: 'warning',
  status: '1/2 ready',
  causes: [
    {
      type: 'replica-mismatch',
      label: 'Replica mismatch',
      message: '1/2 ready',
      severity: 'warning',
    },
  ],
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
    ignoreObjectMock.mockClear();
    ignoreTypeMock.mockClear();
    restoreTypeMock.mockClear();
    restoreObjectMock.mockClear();
    queryPayloadRef.current = {
      ignoreRules: { ignoredObjects: [], findingTypes: ['restarts'] },
      findingTypes: [
        { id: 'restarts', label: 'Restarts' },
        { id: 'replica-mismatch', label: 'Replica mismatch' },
      ],
    };
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
      kindAlias: undefined,
      resource: 'deployments',
      namespace: 'payments',
      name: 'checkout',
      uid: 'uid-checkout',
    });
  });

  it('renders every severity with the matching status chip', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current?.columns as
      | GridColumnDefinition<ClusterAttentionFinding>[]
      | undefined;
    const severityColumn = columns?.find((column) => column.key === 'severity');
    for (const [severity, variant] of [
      ['info', 'info'],
      ['warning', 'warning'],
      ['error', 'unhealthy'],
    ] as const) {
      const severityCell = severityColumn?.render({ ...finding, severity });

      expect(severityCell).toBeTruthy();
      expect((severityCell as React.ReactElement).type).toBe(StatusChip);
      expect(
        (severityCell as React.ReactElement<{ variant: string; children: React.ReactNode }>).props
      ).toEqual(expect.objectContaining({ variant, children: severity }));
    }
  });

  it('renders the active cause messages in the Finding column', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current
      ?.columns as GridColumnDefinition<ClusterAttentionFinding>[];
    expect(columns.find((column) => column.key === 'reason')?.render(finding)).toBe('1/2 ready');
  });

  it('offers exact-object and stable finding-type ignore actions', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const getItems = tablePropsRef.current?.getCustomContextMenuItems as (
      row: ClusterAttentionFinding,
      columnKey: string
    ) => Array<{ label?: string; onClick?: () => void }>;
    const items = getItems(finding, 'name');
    expect(items.map((item) => item.label)).toEqual([
      'Ignore this Deployment',
      'Ignore all “Replica mismatch” findings',
    ]);

    await act(async () => {
      items[0].onClick?.();
      items[1].onClick?.();
      await Promise.resolve();
    });
    expect(ignoreObjectMock).toHaveBeenCalledWith('cluster-a', finding.ref);
    expect(ignoreTypeMock).toHaveBeenCalledWith('cluster-a', 'replica-mismatch');
  });

  it('opens ignored-findings management and restores a type rule', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const postActions = (
      queryParamsRef.current?.filterOptionOverrides as
        | {
            postActions?: Array<{ onClick: () => void }>;
          }
        | undefined
    )?.postActions;
    act(() => postActions?.[0].onClick());
    expect(document.body.textContent).toContain('Ignored findings');
    const restore = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore'
    );
    expect(restore).toBeTruthy();
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(restoreTypeMock).toHaveBeenCalledWith('cluster-a', 'restarts');
  });

  it('restores an ignored exact object from management', async () => {
    queryPayloadRef.current = {
      ignoreRules: { ignoredObjects: [finding.ref], findingTypes: [] },
      findingTypes: [],
    };
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const postActions = (
      queryParamsRef.current?.filterOptionOverrides as
        | { postActions?: Array<{ onClick: () => void }> }
        | undefined
    )?.postActions;
    act(() => postActions?.[0].onClick());
    expect(document.body.textContent).toContain('Deployment payments/checkout');
    const restore = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore'
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(restoreObjectMock).toHaveBeenCalledWith('cluster-a', finding.ref);
  });
});
