/**
 * frontend/src/core/panel-windows/ClusterTabTransferCoordinator.test.tsx
 *
 * Moving a cluster tab between app windows. The source freezes its panels,
 * lands its publication, and hands off its view state; a dirty or closing
 * source refuses. The target restores navigation only for a new tab and
 * acknowledges once its publication lands and the directory's panels are
 * mounted. Runs in the full app: its own coordinator, publication queue, guard
 * registry, view state, namespace, and kubeconfig owners, with open panels
 * hosted by its layout; transfer events and the directory come from the faked
 * backend (test-utils/appState).
 */

import { act } from 'react';
import { expect, it } from 'vitest';
import { panelwindow } from '@/core/backend-api/models';
import { makeNamespaceWorkloadSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import { useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import { usePanelLifecycleGuard } from './panelLifecycleGuards';
import { objectPanelTabSnapshot } from './tabTransfer';

const app = installAppStateHarness();
let view: MountedApp;
let production: TestCluster;
let dock: ReturnType<typeof useDockablePanelContext> | undefined;

const apiRef = () => ({
  clusterId: production.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'payments',
  name: 'api',
});
const apiPanelId = () => objectPanelId(apiRef());

function DockProbe() {
  dock = useDockablePanelContext();
  return null;
}

function UnsavedApiPanel() {
  usePanelLifecycleGuard(apiPanelId(), () => ({ reason: 'unsaved-yaml', focus: () => undefined }));
  return null;
}

const navigation = {
  viewType: 'namespace',
  previousView: 'overview',
  activeNamespaceView: 'workloads',
  activeClusterView: null,
};
const snapshot = () => ({
  schemaVersion: 1,
  viewState: JSON.stringify({
    clusterId: production.clusterId,
    navigation,
    namespace: 'payments',
    sidebar: { type: 'namespace', value: 'payments' },
    tables: {},
  }),
});
const sourceRequest = () => ({
  transferId: 'move-1',
  sourceWindowName: app.windowName,
  targetWindowName: 'workspace-2',
  clusterId: production.clusterId,
  targetIndex: 0,
});
const targetRequest = () => ({
  ...sourceRequest(),
  sourceWindowName: 'workspace-2',
  targetWindowName: app.windowName,
});

const emit = async (name: string, payload: object) => {
  await act(async () => {
    app.events.emit(name, payload, { sender: app.windowName });
  });
  await app.settle();
};
const requestSource = () => emit('cluster-tab-transfer:requested', { request: sourceRequest() });
const insertTarget = (
  options: { targetAlreadyOpen: boolean; groups?: panelwindow.WorkspaceGroup[] } = {
    targetAlreadyOpen: true,
  }
) =>
  emit('cluster-tab-transfer:insert', {
    request: targetRequest(),
    snapshot: snapshot(),
    groups: options.groups ?? [],
    targetAlreadyOpen: options.targetAlreadyOpen,
  });

const windowFrozen = () =>
  view.container.querySelector('.panel-lifecycle-surface')?.hasAttribute('inert') ?? false;

/** Moves the docked panel to the other edge, so the window has a placement to publish. */
const rearrange = async () => {
  const dockContext = requireValue(dock, 'dock');
  const edge =
    getGroupForPanel(dockContext.tabGroups, apiPanelId()) === 'bottom' ? 'right' : 'bottom';
  await act(async () => dockContext.requestTabMove(apiPanelId(), edge));
};

const start = async ({ openApi = true, extra = null as React.ReactNode } = {}) => {
  production = app.cluster({ name: 'dev', context: 'production' });
  app.namespaces(production, ['default', 'payments']);
  app.startScreen(production);
  const { clusterId: _clusterId, ...api } = apiRef();
  app.servePanel(production, api);
  // A restored namespace view lists its workloads (a sorted, paged query).
  app.snapshots.respond((request) =>
    request.domain === 'namespace-workloads'
      ? snapshotResponse({
          domain: 'namespace-workloads',
          scope: request.scope,
          version: 1,
          payload: makeNamespaceWorkloadSnapshotPayload({
            clusterId: production.clusterId,
            clusterName: production.clusterName,
          }),
        })
      : undefined
  );
  app.backend.answer('AcceptClusterTabTransfer', () => undefined);
  app.backend.answer('AcknowledgeClusterTabTransfer', () => undefined);
  app.backend.answer('FailClusterTabTransfer', () => undefined);
  app.backend.answer('AcknowledgeWorkspaceWindowClose', () => undefined);
  view = await app.mountApp(
    <>
      <DockProbe />
      {extra}
    </>
  );
  if (openApi) {
    await act(async () => {
      view.owners().objectPanel.openWithObject(apiRef());
    });
    await app.settle();
  }
};

it('freezes and flushes the source before handing off its local view state', async () => {
  await start();
  const publish = app.backend.hold('PublishDockedPanels');
  await rearrange();

  await requestSource();

  expect(windowFrozen()).toBe(true);
  expect(app.backend.calls('AcceptClusterTabTransfer')).toEqual([]);
  await act(async () => publish());
  await app.settle();

  const [[windowName, transferId, handoff]] = app.backend.calls('AcceptClusterTabTransfer');
  expect([windowName, transferId]).toEqual([app.windowName, 'move-1']);
  expect(JSON.parse(handoff.viewState)).toEqual(
    expect.objectContaining({ clusterId: production.clusterId })
  );
  // The directory, not this renderer, decides which docked panels move.
  expect(handoff).not.toHaveProperty('groups');
  expect(view.owners().objectPanels.openPanels.has(apiPanelId())).toBe(true);
  expect(windowFrozen()).toBe(true);
});

it('refuses a dirty source without staging the destination', async () => {
  await start({ extra: <UnsavedApiPanel /> });

  await requestSource();

  expect(app.backend.calls('FailClusterTabTransfer')).toEqual([[app.windowName, 'move-1']]);
  expect(app.backend.calls('AcceptClusterTabTransfer')).toEqual([]);
  expect(windowFrozen()).toBe(false);
  // The user is told why.
  expect(
    app.errors.take((record) => record.kinds.includes('warning')).map(({ kinds }) => kinds)
  ).toEqual([['warning']]);
});

it.each([
  ['source', requestSource],
  ['insert', () => insertTarget()],
] as const)('rejects a %s transfer while the renderer is closing', async (role, transfer) => {
  await start();
  const publish = app.backend.hold('PublishDockedPanels');
  await rearrange();
  await emit('workspace-window:close-requested', { windowName: app.windowName });

  await transfer();

  expect(app.backend.calls('FailClusterTabTransfer')).toEqual([[app.windowName, 'move-1']]);
  expect(app.backend.calls('AcceptClusterTabTransfer')).toEqual([]);
  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([]);
  // A refused source tells the user its panels are busy; a target just refuses.
  expect(
    app.errors.take((record) => record.kinds.includes('warning')).map(({ kinds }) => kinds)
  ).toEqual(role === 'source' ? [['warning']] : []);
  await act(async () => publish());
  await app.settle();
});

it('reuses existing destination navigation and acknowledges only after publication', async () => {
  await start();
  const before = view.owners().viewState?.getClusterNavigationState(production.clusterId);
  const publish = app.backend.hold('PublishDockedPanels');
  await rearrange();

  await insertTarget({ targetAlreadyOpen: true });

  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([]);
  await act(async () => publish());
  await app.settle();
  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([[app.windowName, 'move-1']]);
  expect(view.owners().viewState?.getClusterNavigationState(production.clusterId)).toEqual(before);
  expect(view.owners().namespace.getClusterNamespace(production.clusterId)).not.toBe('payments');
});

it('restores the source navigation when the destination tab is new', async () => {
  await start({ openApi: false });

  await insertTarget({ targetAlreadyOpen: false });

  expect(view.owners().viewState?.getClusterNavigationState(production.clusterId)).toEqual(
    expect.objectContaining(navigation)
  );
  expect(view.owners().namespace.getClusterNamespace(production.clusterId)).toBe('payments');
  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([[app.windowName, 'move-1']]);
});

it('acknowledges once the directory-listed panels are mounted, without mounting them itself', async () => {
  await start({ openApi: false });
  const tab = objectPanelTabSnapshot(apiPanelId(), apiRef(), 'yaml');
  const group: panelwindow.WorkspaceGroup = {
    clusterId: production.clusterId,
    groupId: 'bottom',
    tabs: [tab],
    activePanelId: tab.panelId,
  };

  await insertTarget({ targetAlreadyOpen: true, groups: [group] });

  expect(windowFrozen()).toBe(true);
  // The panel projection, not the coordinator, mounts the copies.
  expect(view.owners().objectPanels.openPanels.has(apiPanelId())).toBe(false);
  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([]);

  // The directory lists the panels moving with the view, targeted at this view.
  const placement = (windowName: string) => ({
    kind: panelwindow.PanelLocationKind.PanelLocationDocked,
    windowName,
    groupId: 'bottom',
    index: 0,
    active: true,
  });
  app.backend.answer('GetPanelWorkspace', () => ({
    revision: 2,
    panels: [
      {
        tab,
        location: placement('workspace-2'),
        transfer: { transferId: 'move-1', view: true, target: placement(app.windowName) },
      },
    ],
  }));
  await emit('panel-workspace:changed', { clusterId: production.clusterId });

  expect(view.owners().objectPanels.openPanels.has(apiPanelId())).toBe(true);
  expect(app.backend.calls('AcknowledgeClusterTabTransfer')).toEqual([[app.windowName, 'move-1']]);

  // The move fails: the target drops its copies and accepts input again.
  await emit('cluster-tab-transfer:failed', {
    request: targetRequest(),
    snapshot: snapshot(),
    groups: [group],
    targetAlreadyOpen: true,
  });

  expect(view.owners().objectPanels.openPanels.has(apiPanelId())).toBe(false);
  expect(windowFrozen()).toBe(false);
});
