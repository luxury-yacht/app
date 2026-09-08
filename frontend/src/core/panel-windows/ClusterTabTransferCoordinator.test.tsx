import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClusterTabTransferCoordinator } from './ClusterTabTransferCoordinator';

const mocks = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: never) => void>,
  accept: vi.fn(async () => undefined),
  ack: vi.fn(async () => undefined),
  fail: vi.fn(async () => undefined),
  flush: vi.fn(async () => undefined),
  stage: vi.fn(),
  settle: vi.fn(),
  freeze: vi.fn(),
  release: vi.fn(),
  blocker: null as null | { focus: () => void },
  frozen: false,
  groups: [] as unknown[],
  load: vi.fn(async () => undefined),
  restoreNav: vi.fn(),
  restoreTables: vi.fn(async () => undefined),
  dock: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  detach: vi.fn(),
  discard: vi.fn(),
  report: vi.fn(),
}));
vi.mock('./index', () => {
  const on = (name: string) => (handler: (event: never) => void) => {
    mocks.handlers[name] = handler;
    return () => undefined;
  };
  return {
    acceptClusterTabTransfer: mocks.accept,
    acknowledgeClusterTabTransfer: mocks.ack,
    failClusterTabTransfer: mocks.fail,
    onClusterTabTransferRequested: on('source'),
    onClusterTabTransferInsert: on('insert'),
    onClusterTabTransferCommitted: on('committed'),
    onClusterTabTransferFailed: on('failed'),
  };
});
vi.mock('@/core/desktop-runtime', () => ({ getWindowIdentity: () => 'app-a' }));
vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    getClusterNavigationState: () => ({
      viewType: 'namespace',
      previousView: 'overview',
      activeNamespaceView: 'workloads',
      activeClusterView: null,
    }),
    restoreClusterNavigationState: mocks.restoreNav,
  }),
}));
vi.mock('@/core/contexts/SidebarStateContext', () => ({
  useSidebarState: () => ({
    getClusterSidebarSelection: () => ({ type: 'namespace', value: 'payments' }),
    setSidebarSelectionForCluster: vi.fn(),
  }),
}));
vi.mock('@/modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ getClusterNamespace: () => 'payments', setSelectedNamespace: vi.fn() }),
}));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterIds: ['production'],
    selectedClusterId: 'production',
    selectedKubeconfigs: ['prod-selection'],
    getClusterMeta: () => ({ id: 'production' }),
    setActiveKubeconfig: vi.fn(),
    loadKubeconfigs: mocks.load,
  }),
}));
vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({ upsertOwnedPanel: mocks.upsert, removeOwnedPanel: mocks.remove }),
}));
vi.mock('@/ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: { right: { tabs: [] }, bottom: { tabs: [] } },
    dockPanelGroup: mocks.dock,
    detachPanelGroup: mocks.detach,
    discardPanelLayouts: mocks.discard,
  }),
}));
vi.mock('./WorkspacePanelSync', () => ({
  usePanelWorkspaceSync: () => ({
    flush: mocks.flush,
    stage: mocks.stage,
    settle: mocks.settle,
    groupsForCluster: () => mocks.groups,
  }),
}));
vi.mock('./panelLifecycleGuards', () => ({
  usePanelLifecycleGuardRegistry: () => ({
    firstBlocker: () => mocks.blocker,
    isFrozen: () => mocks.frozen,
    freeze: mocks.freeze,
    releaseTransfer: mocks.release,
  }),
}));
vi.mock('@/shared/components/tables/persistence/gridTablePersistence', () => ({
  captureClusterTableState: async () => ({}),
  restoreClusterTableState: mocks.restoreTables,
}));
vi.mock('@/core/persistence/clusterTabOrder', () => ({
  getClusterTabOrder: () => [],
  setClusterTabOrder: vi.fn(),
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));
const request = {
  transferId: 'move-1',
  sourceWindowName: 'app-a',
  targetWindowName: 'app-b',
  clusterId: 'production',
  targetIndex: 0,
};
const snapshot = {
  schemaVersion: 1,
  groups: [],
  viewState: JSON.stringify({
    clusterId: 'production',
    navigation: {
      viewType: 'namespace',
      previousView: 'overview',
      activeNamespaceView: 'workloads',
      activeClusterView: null,
    },
    namespace: 'payments',
    sidebar: { type: 'namespace', value: 'payments' },
    tables: {},
  }),
};
let root: ReactDOM.Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.blocker = null;
  mocks.frozen = false;
  mocks.groups = [];
  container = document.createElement('div');
  root = ReactDOM.createRoot(container);
  await act(async () => root.render(<ClusterTabTransferCoordinator />));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it('freezes and flushes the source before handing off its local view state', async () => {
  await act(async () => mocks.handlers.source({ request } as never));
  expect(mocks.freeze).toHaveBeenCalledWith('move-1', []);
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.accept.mock.invocationCallOrder[0]
  );
  expect(mocks.accept).toHaveBeenCalledWith(
    'app-a',
    'move-1',
    expect.objectContaining({ schemaVersion: 1, groups: [] })
  );
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.release).not.toHaveBeenCalled();
});
it('refuses a dirty source without staging the destination', async () => {
  mocks.blocker = { focus: vi.fn() };
  await act(async () => mocks.handlers.source({ request } as never));
  expect(mocks.fail).toHaveBeenCalledWith('app-a', 'move-1');
  expect(mocks.accept).not.toHaveBeenCalled();
  expect(mocks.freeze).not.toHaveBeenCalled();
});
it.each(['source', 'insert'])(
  'rejects a %s transfer while the renderer is closing',
  async (role) => {
    mocks.frozen = true;
    const event = {
      request:
        role === 'source'
          ? request
          : { ...request, sourceWindowName: 'app-b', targetWindowName: 'app-a' },
      snapshot,
      targetAlreadyOpen: true,
    };
    await act(async () => mocks.handlers[role](event as never));
    expect(mocks.fail).toHaveBeenCalledWith('app-a', 'move-1');
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(mocks.freeze).not.toHaveBeenCalled();
  }
);
it('reuses existing destination navigation and acknowledges only after publication', async () => {
  await act(async () =>
    mocks.handlers.insert({
      request: { ...request, sourceWindowName: 'app-b', targetWindowName: 'app-a' },
      snapshot,
      targetAlreadyOpen: true,
    } as never)
  );
  expect(mocks.restoreNav).not.toHaveBeenCalled();
  expect(mocks.restoreTables).not.toHaveBeenCalled();
  expect(mocks.ack).toHaveBeenCalledWith('app-a', 'move-1');
  expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.ack.mock.invocationCallOrder[0]
  );
});
it('restores the source navigation when the destination tab is new', async () => {
  await act(async () =>
    mocks.handlers.insert({
      request: { ...request, sourceWindowName: 'app-b', targetWindowName: 'app-a' },
      snapshot,
      targetAlreadyOpen: false,
    } as never)
  );
  expect(mocks.restoreNav).toHaveBeenCalledWith(
    'production',
    expect.objectContaining({ viewType: 'namespace' })
  );
  expect(mocks.restoreTables).toHaveBeenCalledWith('production', {});
});

it('waits for exact panel reconstruction and removes the provisional copy on rollback', async () => {
  const tab = {
    kind: 'object',
    panelId: 'pod-api',
    activeView: 'yaml',
    objectRef: {
      clusterId: 'production',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'payments',
      name: 'api',
    },
  };
  const group = {
    clusterId: 'production',
    groupId: 'bottom',
    tabs: [tab],
    activePanelId: tab.panelId,
  };
  const event = {
    request: { ...request, sourceWindowName: 'app-b', targetWindowName: 'app-a' },
    snapshot: { ...snapshot, groups: [group] },
    targetAlreadyOpen: true,
  };
  await act(async () => mocks.handlers.insert(event as never));
  expect(mocks.upsert).toHaveBeenCalledWith(tab.objectRef, 'yaml', {
    kind: 'docked',
    edge: 'bottom',
  });
  expect(mocks.dock).toHaveBeenCalledWith('production', ['pod-api'], 'pod-api', 'bottom');
  expect(mocks.ack).not.toHaveBeenCalled();
  mocks.groups = [{ ...group, tabs: [{ ...tab, activeView: 'details' }] }];
  await act(async () => root.render(<ClusterTabTransferCoordinator />));
  expect(mocks.ack).not.toHaveBeenCalled();
  mocks.groups = [group];
  await act(async () => root.render(<ClusterTabTransferCoordinator />));
  expect(mocks.ack).toHaveBeenCalledWith('app-a', 'move-1');
  await act(async () => mocks.handlers.failed(event as never));
  expect(mocks.remove).toHaveBeenCalledWith('production', 'pod-api');
  expect(mocks.release).toHaveBeenCalledWith('move-1');
});
