import type { GridColumnDefinition, GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NamespaceApplicationSummary } from '@/core/refresh/types';

const mocks = vi.hoisted(() => ({
  openWithObject: vi.fn(),
  navigateToView: vi.fn(),
  queryConfig: { current: null as unknown },
  tableProps: { current: null as unknown },
  rows: [] as NamespaceApplicationSummary[],
  ungroupedWorkloads: 0,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a' }),
}));

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    isInteractive: () => true,
    getClassName: () => 'object-panel-link',
  }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.openWithObject }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: mocks.navigateToView }),
}));

vi.mock('@modules/resource-grid/useQueryBackedResourceGridTable', () => ({
  useQueryBackedNamespaceResourceGridTable: (config: unknown) => {
    mocks.queryConfig.current = config;
    return {
      gridTableProps: {
        data: mocks.rows,
        columns: (config as { columns: GridColumnDefinition<NamespaceApplicationSummary>[] })
          .columns,
        keyExtractor: (
          config as { keyExtractor: GridTableProps<NamespaceApplicationSummary>['keyExtractor'] }
        ).keyExtractor,
      },
      favModal: null,
      source: { status: 'ready', tableMode: 'Query Backed Static' },
      queryPayload: { ungroupedWorkloads: mocks.ungroupedWorkloads },
    };
  },
}));

vi.mock('@modules/resource-grid/ResourceInventoryTable', () => ({
  default: (props: { gridTableProps: GridTableProps<NamespaceApplicationSummary> }) => {
    mocks.tableProps.current = props.gridTableProps;
    return <div data-testid="applications-table" />;
  },
}));

import NsViewApplications from './NsViewApplications';

const application = (
  overrides: Partial<NamespaceApplicationSummary> = {}
): NamespaceApplicationSummary => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
  kind: 'Application',
  name: 'payments',
  namespace: 'team-a',
  confidence: 'high',
  evidence: ['helm'],
  root: {
    clusterId: 'cluster-a',
    group: 'helm.sh',
    version: 'v3',
    kind: 'HelmRelease',
    resource: 'helmreleases',
    namespace: 'team-a',
    name: 'payments',
  },
  workloadCount: 3,
  needsAttention: 0,
  workloadKinds: ['Deployment', 'CronJob'],
  status: 'Healthy',
  statusPresentation: 'ready',
  ...overrides,
});

describe('NsViewApplications', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mocks.openWithObject.mockReset();
    mocks.navigateToView.mockReset();
    mocks.queryConfig.current = null;
    mocks.tableProps.current = null;
    mocks.rows = [
      application(),
      application({ name: 'labeled', confidence: 'low', evidence: ['label'], root: undefined }),
    ];
    mocks.ungroupedWorkloads = 2;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderView = async () => {
    await act(async () => {
      root.render(<NsViewApplications namespace="team-a" />);
      await Promise.resolve();
    });
    return mocks.tableProps.current as GridTableProps<NamespaceApplicationSummary>;
  };

  it('uses the static query-backed application domain and surfaces ungrouped workloads', async () => {
    await renderView();
    expect(mocks.queryConfig.current).toMatchObject({
      queryTableMode: 'Query Backed Static',
      domain: 'namespace-applications',
      viewId: 'namespace-applications',
    });
    expect(container.textContent).toContain('2 workloads have no application evidence');
    expect(container.querySelector('.applications-view')).not.toBeNull();
  });

  it('opens only groups with a complete root reference', async () => {
    const props = await renderView();
    const nameColumn = props.columns.find((column) => column.key === 'name');
    expect(nameColumn).toBeTruthy();

    const helmCell = nameColumn?.render(mocks.rows[0]);
    expect(renderToStaticMarkup(helmCell)).toContain('gridtable-link');
    const helmButton = helmCell as React.ReactElement<{
      onClick: (event: {
        altKey: boolean;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => void;
    }>;
    act(() =>
      helmButton.props.onClick({ altKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() })
    );
    expect(mocks.openWithObject).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: 'helm.sh',
        version: 'v3',
        kind: 'HelmRelease',
        namespace: 'team-a',
        name: 'payments',
      })
    );

    expect(renderToStaticMarkup(nameColumn?.render(mocks.rows[1]))).not.toContain('gridtable-link');
    expect(mocks.openWithObject).toHaveBeenCalledTimes(1);
  });

  it('explains confidence and uses backend status presentation', async () => {
    const props = await renderView();
    const confidenceColumn = props.columns.find((column) => column.key === 'confidence');
    const statusColumn = props.columns.find((column) => column.key === 'status');
    expect(renderToStaticMarkup(confidenceColumn?.render(mocks.rows[0]))).toContain(
      'Confirmed by active Helm release storage'
    );
    expect(renderToStaticMarkup(statusColumn?.render(mocks.rows[0]))).toContain(
      'status-text ready'
    );
  });
});
