import ClusterViewAttention from '@modules/cluster/components/ClusterViewAttention';
import { StatusChip } from '@shared/components/StatusChip';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  requestGridTableFilters,
  setPendingGridTableFilterRequest,
} from '@shared/components/tables/hooks/useGridTableExternalFilters';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterAttentionFinding } from '@/core/refresh/types';

const {
  openWithObjectMock,
  ignoreObjectMock,
  ignoreTypeMock,
  ignoreGlobalTypeMock,
  restoreTypeMock,
  restoreGlobalTypeMock,
  restoreObjectMock,
  queryPayloadRef,
  queryParamsRef,
  tablePropsRef,
  persistenceRef,
} = vi.hoisted(() => ({
  openWithObjectMock: vi.fn(),
  ignoreObjectMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  ignoreTypeMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  ignoreGlobalTypeMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  restoreTypeMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  restoreGlobalTypeMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  restoreObjectMock: vi
    .fn()
    .mockResolvedValue({ objectFindings: [], clusterFindingTypes: [], globalFindingTypes: [] }),
  queryPayloadRef: {
    current: {
      ignoreRules: {
        objectFindings: [],
        clusterFindingTypes: ['restarts'],
        globalFindingTypes: [],
      },
      findingTypes: [
        { id: 'restarts', label: 'Restarts' },
        { id: 'replica-mismatch', label: 'Replica mismatch' },
      ],
    } as Record<string, unknown>,
  },
  queryParamsRef: { current: null as Record<string, unknown> | null },
  tablePropsRef: { current: null as Record<string, unknown> | null },
  persistenceRef: {
    current: { hydrated: true, setFilters: vi.fn() },
  },
}));

vi.mock('@/core/settings/clusterAttentionIgnores', () => ({
  ignoreClusterAttentionObjectFinding: ignoreObjectMock,
  ignoreClusterAttentionFindingType: ignoreTypeMock,
  ignoreGlobalAttentionFindingType: ignoreGlobalTypeMock,
  restoreClusterAttentionFindingType: restoreTypeMock,
  restoreGlobalAttentionFindingType: restoreGlobalTypeMock,
  restoreClusterAttentionObjectFinding: restoreObjectMock,
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
      persistence: persistenceRef.current,
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

const getManageIgnoredFindingsAction = () => {
  const postActions = (
    queryParamsRef.current?.filterOptionOverrides as
      | {
          postActions?: Array<{ id?: string; onClick?: () => void }>;
        }
      | undefined
  )?.postActions;
  return postActions?.find((item) => item.id === 'attention-ignored-findings');
};

const openIgnoredFindings = () => {
  const manageAction = getManageIgnoredFindingsAction();
  if (!manageAction?.onClick) {
    throw new Error('expected Manage ignored findings action');
  }
  act(() => manageAction.onClick?.());
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
    ignoreGlobalTypeMock.mockClear();
    restoreTypeMock.mockClear();
    restoreGlobalTypeMock.mockClear();
    restoreObjectMock.mockClear();
    queryPayloadRef.current = {
      ignoreRules: {
        objectFindings: [],
        clusterFindingTypes: ['restarts'],
        globalFindingTypes: [],
      },
      findingTypes: [
        { id: 'restarts', label: 'Restarts' },
        { id: 'replica-mismatch', label: 'Replica mismatch' },
      ],
    };
    queryParamsRef.current = null;
    tablePropsRef.current = null;
    persistenceRef.current = { hydrated: true, setFilters: vi.fn() };
    setPendingGridTableFilterRequest(null);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setPendingGridTableFilterRequest(null);
  });

  it('applies a staged Overview filter request after table persistence hydrates', async () => {
    persistenceRef.current = { hydrated: false, setFilters: vi.fn() };
    const filters = {
      ...DEFAULT_GRID_TABLE_FILTER_STATE,
      kinds: { mode: 'some' as const, values: ['Pod'] },
      queryFacets: { findings: { mode: 'some' as const, values: ['restarts'] } },
    };
    requestGridTableFilters({
      clusterId: 'cluster-a',
      destinationViewId: 'cluster-attention',
      filters,
    });

    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });
    expect(persistenceRef.current.setFilters).not.toHaveBeenCalled();

    persistenceRef.current = { ...persistenceRef.current, hydrated: true };
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    expect(persistenceRef.current.setFilters).toHaveBeenCalledWith(filters);
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

  it('keeps ignored-findings management as a standard action when ignore rules exist', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    expect(getManageIgnoredFindingsAction()).not.toHaveProperty('active');
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
      'Namespace',
      'Name',
      'Severity',
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

  it('folds the current status into Finding without duplicating cause details', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current
      ?.columns as GridColumnDefinition<ClusterAttentionFinding>[];
    const rendered = columns
      .find((column) => column.key === 'reason')
      ?.render({
        ...finding,
        status: 'Updating',
        causes: [
          {
            type: 'workload-unhealthy',
            label: 'Unhealthy workloads',
            message: 'Updating',
            severity: 'warning',
          },
          ...(finding.causes ?? []),
        ],
      });
    const markup = renderToStaticMarkup(rendered);
    const cell = document.createElement('div');
    cell.innerHTML = markup;

    expect(cell.querySelector('.attention-finding-labels')?.textContent).toBe(
      'Unhealthy workloads · Replica mismatch'
    );
    expect(cell.querySelector('.attention-finding-details')?.textContent).toBe(
      'Updating · 1/2 ready'
    );
  });

  it('does not repeat a status that matches the finding severity', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    const columns = queryParamsRef.current
      ?.columns as GridColumnDefinition<ClusterAttentionFinding>[];
    const rendered = columns
      .find((column) => column.key === 'reason')
      ?.render({
        ...finding,
        kind: 'Event',
        severity: 'warning',
        status: 'Warning',
        causes: [
          {
            type: 'warning-event',
            label: 'Warning events',
            message: 'BackOff · Back-off restarting failed container',
            severity: 'warning',
          },
        ],
      });
    const markup = renderToStaticMarkup(rendered);
    const cell = document.createElement('div');
    cell.innerHTML = markup;

    expect(cell.querySelector('.attention-finding-details')?.textContent).toBe(
      'BackOff · Back-off restarting failed container'
    );
  });

  it('offers object, cluster, and global ignore scopes for each finding', async () => {
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
      'Ignore "Replica mismatch" for this object only',
      'Ignore "Replica mismatch" in this cluster',
      'Ignore "Replica mismatch" in all clusters',
    ]);

    await act(async () => {
      items[0].onClick?.();
      items[1].onClick?.();
      items[2].onClick?.();
      await Promise.resolve();
    });
    expect(ignoreObjectMock).toHaveBeenCalledWith('cluster-a', finding.ref, 'replica-mismatch');
    expect(ignoreTypeMock).toHaveBeenCalledWith('cluster-a', 'replica-mismatch');
    expect(ignoreGlobalTypeMock).toHaveBeenCalledWith('cluster-a', 'replica-mismatch');
  });

  it('opens ignored-findings management and restores a type rule', async () => {
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    openIgnoredFindings();
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

  it('restores an object-scoped finding from management', async () => {
    queryPayloadRef.current = {
      ignoreRules: {
        objectFindings: [{ ref: finding.ref, findingType: 'replica-mismatch' }],
        clusterFindingTypes: [],
        globalFindingTypes: [],
      },
      findingTypes: [],
    };
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    openIgnoredFindings();
    expect(document.body.textContent).toContain('Deployment payments/checkout');
    const restore = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore'
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(restoreObjectMock).toHaveBeenCalledWith('cluster-a', finding.ref, 'replica-mismatch');
  });

  it('renders each ignored scope as an independently styled modal section', async () => {
    queryPayloadRef.current = {
      ignoreRules: {
        objectFindings: [{ ref: finding.ref, findingType: 'replica-mismatch' }],
        clusterFindingTypes: ['restarts'],
        globalFindingTypes: ['warning-event'],
      },
      findingTypes: [
        { id: 'replica-mismatch', label: 'Replica mismatch' },
        { id: 'restarts', label: 'Restarts' },
        { id: 'warning-event', label: 'Warning events' },
      ],
    };
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    openIgnoredFindings();

    const sections = Array.from(document.body.querySelectorAll('.attention-ignored-section'));
    expect(
      sections.map(
        (section) => section.querySelector('.attention-ignored-section-title')?.textContent
      )
    ).toEqual(['Object-Specific', 'This Cluster', 'All Clusters']);
    expect(document.body.querySelector('.object-panel-section')).toBeNull();
  });

  it('restores an all-cluster finding type from management', async () => {
    queryPayloadRef.current = {
      ignoreRules: {
        objectFindings: [],
        clusterFindingTypes: [],
        globalFindingTypes: ['warning-event'],
      },
      findingTypes: [{ id: 'warning-event', label: 'Warning events' }],
    };
    await act(async () => {
      root.render(<ClusterViewAttention />);
      await Promise.resolve();
    });

    openIgnoredFindings();
    expect(document.body.textContent).toContain('All Clusters');
    const restore = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Restore'
    );
    await act(async () => {
      restore?.click();
      await Promise.resolve();
    });
    expect(restoreGlobalTypeMock).toHaveBeenCalledWith('cluster-a', 'warning-event');
  });
});
