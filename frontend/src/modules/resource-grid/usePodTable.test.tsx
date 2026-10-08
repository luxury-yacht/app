/**
 * frontend/src/modules/resource-grid/usePodTable.test.tsx
 *
 * The shared pod table contract every pods table relies on: pod, owner and
 * node links keep complete cluster-scoped identity, cells read backend facts,
 * CPU/Memory read the query's metrics freshness, row actions honour
 * permissions, and visible pods drive per-namespace permission queries.
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type ResourceBar from '@shared/components/ResourceBar';
import { getTextContent } from '@shared/components/tables/GridTable.utils';
import type React from 'react';
import { act, isValidElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalRowTestOverrides, PodSnapshotEntry } from '@/core/refresh/types';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

const {
  openWithObjectMock,
  navigateToViewMock,
  navigationAvailable,
  permissionsRef,
  queryNamespacesPermissionsMock,
  runObjectActionMock,
  errorHandlerMock,
  confirmationPropsRef,
  POD_PERMISSIONS_SENTINEL,
} = vi.hoisted(() => ({
  openWithObjectMock: vi.fn(),
  navigateToViewMock: vi.fn(),
  navigationAvailable: { current: true },
  permissionsRef: { current: new Map<string, { allowed: boolean; pending: boolean }>() },
  queryNamespacesPermissionsMock: vi.fn(),
  runObjectActionMock: vi.fn(),
  errorHandlerMock: { handle: vi.fn() },
  confirmationPropsRef: { current: null as ConfirmationProps | null },
  POD_PERMISSIONS_SENTINEL: { feature: 'namespace-pods', specs: [] },
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({
    available: navigationAvailable.current,
    navigateToView: navigateToViewMock,
  }),
}));

vi.mock('@/core/capabilities', () => ({
  POD_PERMISSIONS: POD_PERMISSIONS_SENTINEL,
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns ?? ''}`,
  queryNamespacesPermissions: (...args: unknown[]) => queryNamespacesPermissionsMock(...args),
  useUserPermissions: () => permissionsRef.current,
}));

vi.mock('@core/backend-api', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...args),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: (props: ConfirmationProps) => {
    confirmationPropsRef.current = props;
    return null;
  },
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

import {
  type PodTable,
  type UsePodTableOptions,
  usePodNamespacePermissions,
  usePodTable,
} from './usePodTable';

const CLUSTER_ID = 'alpha:ctx';

const createPod = (
  override: CanonicalRowTestOverrides<PodSnapshotEntry> = {}
): PodSnapshotEntry => {
  const { ref, ...row } = override;
  return {
    ref: {
      clusterId: CLUSTER_ID,
      group: '',
      version: 'v1',
      kind: 'Pod',
      resource: 'pods',
      namespace: 'team-a',
      name: 'api',
      ...ref,
    },
    ownerKind: 'Deployment',
    ownerName: 'api',
    ownerApiVersion: 'apps/v1',
    node: 'node-a',
    status: 'Running',
    statusPresentation: 'ready',
    ready: '1/1',
    restarts: 0,
    age: '1m',
    portForwardAvailable: true,
    ...row,
  };
};

const tableRef: { current: PodTable | null } = { current: null };

const PodTableHarness: React.FC<UsePodTableOptions> = (options) => {
  const table = usePodTable(options);
  tableRef.current = table;
  return <>{table.actionModals}</>;
};

const PermissionsHarness: React.FC<{ pods: PodSnapshotEntry[]; fallbackClusterId?: string }> = ({
  pods,
  fallbackClusterId,
}) => {
  usePodNamespacePermissions(pods, fallbackClusterId);
  return null;
};

type LinkCell = {
  onClick: (event: {
    altKey: boolean;
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => void;
};
const click = (altKey = false) => ({ altKey, preventDefault: vi.fn(), stopPropagation: vi.fn() });

describe('usePodTable', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    tableRef.current = null;
    confirmationPropsRef.current = null;
    navigationAvailable.current = true;
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    queryNamespacesPermissionsMock.mockReset();
    queryNamespacesPermissionsMock.mockResolvedValue(undefined);
    runObjectActionMock.mockReset();
    runObjectActionMock.mockResolvedValue(undefined);
    errorHandlerMock.handle.mockReset();
    permissionsRef.current = new Map([
      ['Pod:delete:team-a', { allowed: true, pending: false }],
      ['Pod:create:team-a', { allowed: true, pending: false }],
    ]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderTable = (options: Partial<UsePodTableOptions> = {}) => {
    act(() => {
      root.render(
        <PodTableHarness
          fallbackClusterId={CLUSTER_ID}
          clusterName="alpha"
          showNamespaceColumn={false}
          {...options}
        />
      );
    });
    return requireValue(tableRef.current, 'expected the pod table');
  };

  const column = (table: PodTable, key: string) =>
    requireValue(
      table.columns.find((entry) => entry.key === key),
      `expected the ${key} column`
    );

  it.each(['Deployment', 'Widget'])(
    'opens and navigates a %s owner with its API group and the row cluster',
    (ownerKind) => {
      const pod = createPod({
        ref: { clusterId: 'OwnerCluster:Case' },
        ownerKind,
        ownerName: 'custom-owner',
        ownerApiVersion: 'operators.example.io/v1beta2',
      });
      const cell = requireReactElement<LinkCell>(
        column(renderTable(), 'owner').render(pod),
        'expected owner link'
      );
      const expected = expect.objectContaining({
        clusterId: 'OwnerCluster:Case',
        namespace: 'team-a',
        kind: ownerKind,
        name: 'custom-owner',
        group: 'operators.example.io',
        version: 'v1beta2',
      });

      act(() => cell.props.onClick(click()));
      expect(openWithObjectMock).toHaveBeenCalledWith(expected);
      act(() => cell.props.onClick(click(true)));
      expect(navigateToViewMock).toHaveBeenCalledWith(expected);
    }
  );

  it.each([
    { ownerKind: 'None', ownerName: 'None' },
    { ownerKind: 'Deployment', ownerName: 'missing-version' },
    { ownerKind: 'Widget', ownerName: 'missing-version' },
  ])('keeps incomplete owner identity display-only: $ownerKind/$ownerName', (owner) => {
    const pod = createPod({ ...owner, ownerApiVersion: undefined });
    const cell = column(renderTable(), 'owner').render(pod);

    expect(
      isValidElement<{ onClick?: unknown }>(cell) ? cell.props.onClick : undefined
    ).toBeUndefined();
  });

  it('opens the node in the pod row cluster', () => {
    const pod = createPod({ ref: { clusterId: 'RowCluster:Case' }, node: 'worker-b' });
    const cell = requireReactElement<LinkCell>(
      column(renderTable(), 'node').render(pod),
      'expected node link'
    );

    act(() => cell.props.onClick(click()));
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'RowCluster:Case',
        group: '',
        version: 'v1',
        kind: 'Node',
        name: 'worker-b',
      })
    );
  });

  it('opens the pod with the cluster name and navigates only when the workspace allows it', () => {
    const pod = createPod();
    const nameCell = requireReactElement<LinkCell>(
      column(renderTable(), 'name').render(pod),
      'expected pod name link'
    );
    act(() => nameCell.props.onClick(click()));
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: CLUSTER_ID,
        clusterName: 'alpha',
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
      })
    );
    act(() => nameCell.props.onClick(click(true)));
    expect(navigateToViewMock).toHaveBeenCalledOnce();

    // A native panel window has no workspace navigation; alt-click just opens.
    navigationAvailable.current = false;
    openWithObjectMock.mockReset();
    navigateToViewMock.mockReset();
    const panelCell = requireReactElement<LinkCell>(
      column(renderTable(), 'name').render(pod),
      'expected pod name link'
    );
    act(() => panelCell.props.onClick(click(true)));
    expect(navigateToViewMock).not.toHaveBeenCalled();
    expect(openWithObjectMock).toHaveBeenCalledOnce();
  });

  it('reads status, restarts and readiness from the backend row facts', () => {
    const table = renderTable();
    const warning = createPod({ statusPresentation: 'warning' });
    const restarted = createPod({ restarts: 2, ready: '2/3' });

    const status = requireReactElement<{ className?: string }>(
      column(table, 'status').render(warning),
      'expected status cell'
    );
    expect(status.props.className).toBe('status-text warning');

    const restarts = column(table, 'restarts');
    expect(getTextContent(restarts.render(warning))).toBe('-');
    expect(getTextContent(restarts.render(restarted))).toBe('2');
    expect(restarts.sortValue?.(warning)).toBe(0);
    expect(restarts.sortValue?.(restarted)).toBe(2);
    expect(column(table, 'ready').sortValue?.(restarted)).toBe(2000003);
  });

  it('sorts CPU and Memory by pod usage', () => {
    const table = renderTable();
    const pod = createPod({ cpuUsageMilli: 250, memoryUsageBytes: 64 * 1024 ** 2 });

    expect(column(table, 'cpu').sortable).toBe(true);
    expect(column(table, 'memory').sortable).toBe(true);
    expect(column(table, 'cpu').sortValue?.(pod)).toBe(250);
    expect(column(table, 'memory').sortValue?.(pod)).toBe(64 * 1024 ** 2);
  });

  it('marks CPU and Memory with the query metrics freshness without rebuilding columns', () => {
    const table = renderTable();
    const columns = table.columns;
    const pod = createPod({ cpuUsageMilli: 250, cpuRequestMilli: 500, cpuLimitMilli: 1000 });
    table.metricsRef.current = {
      stale: true,
      lastError: 'metrics unavailable',
      collectedAt: 1700000000,
      successCount: 1,
      failureCount: 1,
    };

    const cpu = requireReactElement<React.ComponentProps<typeof ResourceBar>>(
      column(table, 'cpu').render(pod),
      'expected CPU cell'
    );
    expect(cpu.props).toMatchObject({
      usage: 250,
      request: 500,
      limit: 1000,
      metricsStale: true,
      metricsError: 'metrics unavailable',
    });
    expect(renderTable().columns).toBe(columns);
  });

  it('adds the namespace column with the caller-supplied link only when asked', () => {
    expect(renderTable().columns.some((entry) => entry.key === 'namespace')).toBe(false);

    const onClick = vi.fn();
    const table = renderTable({
      showNamespaceColumn: true,
      namespaceLink: { onClick, isInteractive: () => true },
    });
    const cell = requireReactElement<LinkCell>(
      column(table, 'namespace').render(createPod({ ref: { namespace: 'team-b' } })),
      'expected namespace link'
    );
    act(() => cell.props.onClick(click()));
    expect(onClick).toHaveBeenCalledWith(
      expect.objectContaining({ ref: expect.objectContaining({ namespace: 'team-b' }) })
    );
  });

  it('opens the Map from the pod context menu using the pod identity', () => {
    const items = renderTable().getContextMenuItems(createPod());
    const mapItem = requireValue(
      items.find((item) => item.actionId === OBJECT_ACTION_IDS.viewMap),
      'expected Map item'
    );

    act(() => mapItem.onClick?.());
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: CLUSTER_ID,
      }),
      { initialTab: 'map' }
    );
  });

  it('gates Port Forward on the pod having forwardable ports', () => {
    const table = renderTable();
    const portForward = (pod: PodSnapshotEntry) =>
      requireValue(
        table
          .getContextMenuItems(pod)
          .find((item) => item.actionId === OBJECT_ACTION_IDS.portForward),
        'expected Port Forward item'
      );

    expect(portForward(createPod({ portForwardAvailable: true })).disabled).toBeFalsy();
    expect(portForward(createPod({ portForwardAvailable: false })).disabled).toBe(true);
  });

  it.each([
    ['unavailable', new Map()],
    ['pending', new Map([['Pod:delete:team-a', { allowed: true, pending: true }]])],
    ['denied', new Map([['Pod:delete:team-a', { allowed: false, pending: false }]])],
  ])('omits Delete while the permission is %s', (_label, permissions) => {
    permissionsRef.current = permissions;
    const items = renderTable().getContextMenuItems(createPod());

    expect(items.find((item) => item.actionId === OBJECT_ACTION_IDS.delete)).toBeUndefined();
  });

  const confirmDelete = async (table: PodTable) => {
    const deleteItem = requireValue(
      table
        .getContextMenuItems(createPod())
        .find((item) => item.actionId === OBJECT_ACTION_IDS.delete),
      'expected Delete item'
    );
    act(() => deleteItem.onClick?.());
    const confirmation = requireValue(confirmationPropsRef.current, 'expected delete confirmation');
    if (!confirmation.isOpen) {
      throw new Error('Expected the delete confirmation to open');
    }
    await act(async () => {
      await confirmation.onConfirm?.();
    });
  };

  it('deletes the pod by its complete identity after confirmation', async () => {
    await confirmDelete(renderTable());

    expect(runObjectActionMock).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: CLUSTER_ID,
        group: '',
        version: 'v1',
        kind: 'Pod',
        namespace: 'team-a',
        name: 'api',
      },
    });
  });

  it('reports a failed delete and closes the confirmation', async () => {
    runObjectActionMock.mockRejectedValueOnce(new Error('boom'));

    await confirmDelete(renderTable());

    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'Pod',
      name: 'api',
    });
    expect(confirmationPropsRef.current?.isOpen).toBe(false);
  });
});

describe('usePodNamespacePermissions', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    queryNamespacesPermissionsMock.mockReset();
    queryNamespacesPermissionsMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('queries pod permissions once per cluster and namespace of the visible pods', () => {
    const pods = [
      createPod({ ref: { name: 'a', namespace: 'team-a' } }),
      createPod({ ref: { name: 'b', namespace: 'team-a' } }),
      createPod({ ref: { name: 'c', namespace: 'team-b', clusterId: 'beta:ctx' } }),
    ];
    act(() => root.render(<PermissionsHarness pods={pods} fallbackClusterId={CLUSTER_ID} />));

    expect(queryNamespacesPermissionsMock).toHaveBeenCalledWith(
      [
        { namespace: 'team-a', clusterId: CLUSTER_ID },
        { namespace: 'team-b', clusterId: 'beta:ctx' },
      ],
      { specLists: [POD_PERMISSIONS_SENTINEL] }
    );
  });

  it('does not query when no pods are visible', () => {
    act(() => root.render(<PermissionsHarness pods={[]} fallbackClusterId={CLUSTER_ID} />));

    expect(queryNamespacesPermissionsMock).not.toHaveBeenCalled();
  });
});
