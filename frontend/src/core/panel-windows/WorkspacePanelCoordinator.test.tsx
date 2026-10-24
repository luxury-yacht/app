/**
 * frontend/src/core/panel-windows/WorkspacePanelCoordinator.test.tsx
 *
 * The workspace window's panel coordinator: floating a group or one tab into a
 * native window, tearing off and dropping tabs across windows, answering the
 * registry's tab-transfer requests, tearing off a cluster tab, auto-floating
 * panels when the user prefers floating, and mounting the moves the directory
 * targets at this view. Runs in the full app: its own coordinator, dock, guard
 * registry, object-panel state, publication queue, and kubeconfig owner, with
 * open panels hosted by its layout; gestures go through the real tab bars and
 * dock controls. Only the backend boundary is faked (test-utils/appState).
 *
 * Window close, quit, and cluster close preflights are covered by
 * WorkspacePanelLifecycle.test.tsx; directory reads and close intents by
 * WorkspacePanelSync.test.tsx; group float success and refusal by
 * panelWindowFloat.test.tsx.
 */

import { TAB_DRAG_DATA_TYPE } from '@shared/components/tabs/dragCoordinator';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { panelwindow } from '@/core/backend-api/models';
import { acknowledgePanelWindowReady } from '@/core/panel-windows';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { DockablePanel, useDockablePanelContext } from '@/ui/dockable';
import ClusterTabs from '@/ui/layout/ClusterTabs';
import { usePanelLifecycleGuard } from './panelLifecycleGuards';
import { objectPanelTabSnapshot } from './tabTransfer';

const app = installAppStateHarness();
let view: MountedApp;
let production: TestCluster;
let staging: TestCluster;
let dock: ReturnType<typeof useDockablePanelContext> | undefined;
let unsaved = new Set<string>();

const pod = (name: string) => ({
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name,
});
const podRef = (cluster: TestCluster, name: string) => ({
  clusterId: cluster.clusterId,
  ...pod(name),
});

/** Serves what the cluster's start screen and its pods' panels read. */
const serveCluster = (cluster: TestCluster) => {
  app.namespaces(cluster, ['default']);
  app.startScreen(cluster);
  for (const name of ['api', 'worker', 'related']) {
    app.servePanel(cluster, pod(name));
  }
};
const panelIdOf = (name: string, cluster = production) => objectPanelId(podRef(cluster, name));
const tabOf = (name: string, cluster = production) =>
  objectPanelTabSnapshot(panelIdOf(name, cluster), podRef(cluster, name), 'details');

function DockProbe() {
  dock = useDockablePanelContext();
  return null;
}

// The panels the user has edited without saving block moves and closes.
function UnsavedGuards() {
  for (const name of ['api', 'worker']) {
    // biome-ignore lint/correctness/useHookAtTopLevel: the list is fixed
    usePanelLifecycleGuard(panelIdOf(name), () =>
      unsaved.has(name) ? { reason: 'unsaved-yaml', focus: () => undefined } : null
    );
  }
  return null;
}

const workspaceDock = () => requireValue(dock, 'dock');
const isOpenHere = (name: string, cluster = production) =>
  view.owners().objectPanels.openPanels.has(panelIdOf(name, cluster));
const groupTabs = (groupKey: 'right' | 'bottom', cluster = production) =>
  workspaceDock().getClusterTabGroups(cluster.clusterId)[groupKey].tabs;
const windowFrozen = () =>
  view.container.querySelector('.panel-lifecycle-surface')?.hasAttribute('inert') ?? false;

const openPod = async (name: string, cluster = production) => {
  await act(async () => {
    view.owners().objectPanel.openWithObject(podRef(cluster, name));
  });
  await app.settle();
};

const start = async ({
  open = ['api'],
  twoClusters = false,
  extra = null as React.ReactNode,
}: {
  open?: string[];
  twoClusters?: boolean;
  extra?: React.ReactNode;
} = {}) => {
  unsaved = new Set();
  production = app.cluster({ name: 'dev', context: 'production' });
  serveCluster(production);
  if (twoClusters) {
    staging = app.cluster({ name: 'dev', context: 'staging' });
    serveCluster(staging);
  }
  for (const method of [
    'RequestPanelTabTransfer',
    'AcceptPanelTabTransfer',
    'FailPanelTabTransfer',
    'AcknowledgePanelTransfer',
    'RequestClusterTabTransfer',
  ] as const) {
    app.backend.answer(method, () => undefined);
  }
  view = await app.mountApp(
    <>
      <DockProbe />
      <UnsavedGuards />
      {extra}
    </>
  );
  for (const name of open) {
    await openPod(name);
  }
};

const emitHere = async (name: string, payload: object) => {
  await act(async () => {
    app.events.emit(name, payload, { sender: app.windowName });
  });
  await app.settle();
};

const takeReports = (action: string) =>
  app.errors.take((record) => record.context?.action === action);
const takeWarnings = () =>
  app.errors.take((record) => record.kinds.includes('warning')).map(({ kinds }) => kinds);

// Native drag-and-drop, as the webview dispatches it.
function createDataTransfer(): DataTransfer {
  const store = new Map<string, string>();
  return {
    dropEffect: 'none',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    get types() {
      return [...store.keys()];
    },
    setData: (format: string, data: string) => {
      store.set(format, data);
    },
    getData: (format: string) => store.get(format) ?? '',
    clearData: () => {
      store.clear();
    },
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

const dispatchDrag = (
  target: EventTarget,
  type: string,
  dataTransfer: DataTransfer,
  position: { clientX?: number; clientY?: number; screenX?: number; screenY?: number } = {}
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: position.clientX ?? 20 },
    clientY: { value: position.clientY ?? 10 },
    screenX: { value: position.screenX ?? 0 },
    screenY: { value: position.screenY ?? 0 },
  });
  target.dispatchEvent(event);
  return event;
};

const dockTab = (name: string) =>
  requireValue(
    view.container.ownerDocument.querySelector<HTMLElement>(
      `[role="tab"][data-panel-id="${panelIdOf(name)}"]`
    ),
    `${name} tab`
  );

/** Drags a tab out of the window and lets go where no window takes it. */
const tearOff = async (source: HTMLElement, screen: { x: number; y: number }) => {
  const transfer = createDataTransfer();
  await act(async () => {
    dispatchDrag(source, 'dragstart', transfer);
  });
  await act(async () => {
    dispatchDrag(source, 'dragend', transfer, {
      clientX: -5,
      clientY: 10,
      screenX: screen.x,
      screenY: screen.y,
    });
  });
  await app.settle();
};

/** Drops a tab dragged from a native panel window onto a dock edge here. */
const dropFromNativeWindow = async (name: string, groupKey: 'right' | 'bottom') => {
  const bar = requireValue(
    view.container.ownerDocument.querySelector(
      `[data-group-key="${groupKey}"] .dockable-tab-bar-shell`
    ),
    `${groupKey} tab bar`
  );
  const transfer = createDataTransfer();
  transfer.setData(
    TAB_DRAG_DATA_TYPE,
    JSON.stringify({
      kind: 'dockable-tab',
      panelId: panelIdOf(name),
      sourceGroupId: 'native-group-1',
      sourceWindowGroupId: 'native-group-1',
      sourceWindowName: 'panel-1',
      clusterId: production.clusterId,
      tab: tabOf(name),
    })
  );
  await act(async () => {
    dispatchDrag(bar, 'dragenter', transfer, { clientX: 900 });
    dispatchDrag(bar, 'dragover', transfer, { clientX: 900 });
    dispatchDrag(bar, 'drop', transfer, { clientX: 900 });
  });
  await app.settle();
};

const placement = (windowName: string, groupId: string, index = 0) => ({
  kind: panelwindow.PanelLocationKind.PanelLocationDocked,
  windowName,
  groupId,
  index,
  active: true,
});

/** The directory lists `name` moving from native window `panel-1` into this view. */
const directoryListsMove = async (
  name: string,
  {
    transferId = 'dock-1',
    groupId = 'bottom',
    index = 0,
    view: viewMove = false,
    cluster = production,
  }: {
    transferId?: string;
    groupId?: string;
    index?: number;
    view?: boolean;
    cluster?: TestCluster;
  } = {}
) => {
  app.backend.answer('GetPanelWorkspace', (_windowName, clusterId) => ({
    revision: 2,
    panels:
      clusterId === cluster.clusterId
        ? [
            {
              tab: tabOf(name, cluster),
              location: {
                kind: panelwindow.PanelLocationKind.PanelLocationWindow,
                windowName: 'panel-1',
                groupId: 'native',
                index: 0,
                active: true,
              },
              transfer: {
                transferId,
                ...(viewMove ? { view: true } : {}),
                target: placement(app.windowName, groupId, index),
              },
            },
          ]
        : [],
  }));
  await emitHere('panel-workspace:changed', { clusterId: cluster.clusterId });
};

const directoryListsNothing = async () => {
  app.backend.answer('GetPanelWorkspace', () => ({ revision: 3, panels: [] }));
  await emitHere('panel-workspace:changed', { clusterId: production.clusterId });
};

const tabTransferRequest = (
  name: string,
  overrides: Partial<panelwindow.TabTransferRequest> = {}
): panelwindow.TabTransferRequest =>
  ({
    transferId: 'tab-transfer-1',
    sourceWindowName: app.windowName,
    targetWindowName: 'panel-2',
    clusterId: production.clusterId,
    sourceGroupId: 'right',
    targetGroupId: 'native-group-2',
    targetIndex: 0,
    targetKind: 'panel-window',
    cursorX: 0,
    cursorY: 0,
    tab: tabOf(name),
    ...overrides,
  }) as panelwindow.TabTransferRequest;

describe('focus', () => {
  it('hands cross-cluster focus to the dock before the panel registers', async () => {
    await start({ open: [], twoClusters: true });

    // Another window asks this view to focus a panel it is about to receive.
    await emitHere('panel-workspace:focus-requested', {
      clusterId: staging.clusterId,
      panelId: panelIdOf('related', staging),
    });
    expect(view.owners().kubeconfig.selectedClusterId).toBe(staging.clusterId);
    // The directory then hands the panel to this view: retained until this
    // view claims it, then docked here.
    const claimed = () =>
      app.backend
        .calls('OpenPanelWorkspaceObject')
        .some(([, tab]) => tab.panelId === panelIdOf('related', staging));
    app.backend.answer('GetPanelWorkspace', (_windowName, clusterId) => ({
      revision: claimed() ? 3 : 2,
      panels:
        clusterId === staging.clusterId
          ? [
              {
                tab: tabOf('related', staging),
                location: claimed()
                  ? placement(app.windowName, 'right')
                  : {
                      kind: panelwindow.PanelLocationKind.PanelLocationRetained,
                      windowName: '',
                      groupId: 'right',
                      index: 0,
                      active: true,
                    },
              },
            ]
          : [],
    }));
    await emitHere('panel-workspace:changed', { clusterId: staging.clusterId });

    expect(isOpenHere('related', staging)).toBe(true);
    expect(document.activeElement?.closest('[data-panel-id]')?.getAttribute('data-panel-id')).toBe(
      panelIdOf('related', staging)
    );
  });
});

describe('cluster tab tear-off', () => {
  it.each([
    { name: 'last cluster tab', twoClusters: false },
    { name: 'one of several cluster tabs', twoClusters: true },
  ])('moves the dragged $name to a new window', async ({ twoClusters }) => {
    await start({ open: [], twoClusters, extra: <ClusterTabs /> });
    const productionTab = requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('.cluster-tabs [role="tab"]')).find((tab) =>
        tab.textContent?.includes('production')
      ),
      'production cluster tab'
    );

    await tearOff(productionTab, { x: 1925, y: 100 });

    expect(app.backend.calls('RequestClusterTabTransfer')).toEqual([
      [
        app.windowName,
        expect.objectContaining({
          sourceWindowName: app.windowName,
          targetWindowName: '',
          clusterId: production.clusterId,
          dropPosition: { x: 1925, y: 100 },
        }),
      ],
    ]);
  });

  it.each([
    { x: 1925, y: 100 },
    { x: -1100, y: 200 },
    { x: 0, y: 0 },
  ])('keeps the screen position $x, $y where the tab was let go', async (screen) => {
    await start({ open: [], twoClusters: true, extra: <ClusterTabs /> });
    const productionTab = requireValue(
      Array.from(document.querySelectorAll<HTMLElement>('.cluster-tabs [role="tab"]')).find((tab) =>
        tab.textContent?.includes('production')
      ),
      'production cluster tab'
    );

    await tearOff(productionTab, screen);

    expect(app.backend.calls('RequestClusterTabTransfer')).toEqual([
      [app.windowName, expect.objectContaining({ dropPosition: screen })],
    ]);
  });
});

describe('floating a group', () => {
  it('keeps the source group until its own new window is ready, starting only one transfer', async () => {
    await start();

    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'floating');
      workspaceDock().requestGroupMove?.('right', 'floating');
    });
    await app.settle();

    expect(app.backend.calls('BeginPanelWindowOpen')).toHaveLength(1);
    // The repeated request finds the group moving and tells the user to wait.
    expect(takeWarnings()).toEqual([['warning']]);
    const [[, snapshot]] = app.backend.calls('BeginPanelWindowOpen');
    // Another window's group opening does not touch this one.
    await emitHere('panel-window:opened', {
      windowName: 'panel-9',
      transferId: snapshot.transferId,
      sourceWindowName: 'workspace-other',
      clusterId: production.clusterId,
      groupId: snapshot.groupId,
      tabs: snapshot.tabs,
    });
    expect(isOpenHere('api')).toBe(true);

    await act(async () => {
      await acknowledgePanelWindowReady('panel-1', snapshot.transferId);
    });
    await app.settle();

    expect(isOpenHere('api')).toBe(false);
    expect(groupTabs('right')).toEqual([]);
  });

  it('floats the whole group with its active tab', async () => {
    await start({ open: ['api', 'worker'] });

    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'floating');
    });
    await app.settle();

    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([
      [
        app.windowName,
        expect.objectContaining({
          tabs: [
            expect.objectContaining({ panelId: panelIdOf('api') }),
            expect.objectContaining({ panelId: panelIdOf('worker') }),
          ],
          activePanelId: panelIdOf('worker'),
        }),
      ],
    ]);
  });

  it('floats only the tab the user picked from its menu', async () => {
    await start({ open: ['api', 'worker'] });

    await act(async () => {
      workspaceDock().requestTabMove(panelIdOf('api'), 'floating');
    });
    await app.settle();

    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([]);
    expect(app.backend.calls('RequestPanelTabTransfer')).toEqual([
      [app.windowName, expect.objectContaining({ targetKind: 'new-window', tab: tabOf('api') })],
    ]);
  });

  it('docks a group to the other edge without opening a window', async () => {
    await start();

    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'bottom');
    });
    await app.settle();

    expect(groupTabs('bottom')).toEqual([panelIdOf('api')]);
    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([]);
  });

  it('refuses to float a group with unsaved changes and tells the user', async () => {
    await start();
    unsaved.add('api');

    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'floating');
    });
    await app.settle();

    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([]);
    expect(takeWarnings()).toEqual([['warning']]);
  });

  it('offers Float only for object panels, never for app-wide panels', async () => {
    await start({
      extra: (
        <DockablePanel panelId="diagnostics" title="Diagnostics" isOpen defaultPosition="bottom">
          <div />
        </DockablePanel>
      ),
    });
    const floatControl = (groupKey: string) =>
      document.querySelector(
        `[data-group-key="${groupKey}"] [aria-label="Undock panel to floating window"]`
      );

    expect(floatControl('right')).not.toBeNull();
    expect(floatControl('bottom')).toBeNull();
  });
});

describe('auto-floating when the user prefers floating panels', () => {
  const openFloating = async () => {
    app.preferences({
      defaultObjectPanelPosition: 'floating',
      objectPanelFloatingWidth: 720,
      objectPanelFloatingHeight: 560,
    });
    await start({ open: [] });
    await openPod('api');
    return app.backend.calls('BeginPanelWindowOpen');
  };

  it('opens the native window with the floating panel bounds', async () => {
    const opens = await openFloating();

    expect(opens).toEqual([
      [
        app.windowName,
        expect.objectContaining({
          tabs: [expect.objectContaining({ panelId: panelIdOf('api') })],
          initialBounds: { x: 0, y: 0, width: 720, height: 560 },
        }),
      ],
    ]);
  });

  it('docks the panel on the right when the native window cannot open', async () => {
    app.backend.answer('BeginPanelWindowOpen', () => {
      throw new Error('native open failed');
    });

    await openFloating();

    expect(groupTabs('right')).toEqual([panelIdOf('api')]);
    expect(takeReports('float-group')).toHaveLength(1);
  });

  it('docks the panel on the right when its window closes before it is ready', async () => {
    const [[, snapshot]] = await openFloating();

    await emitHere('panel-window:closed', {
      windowName: 'panel-1',
      clusterId: production.clusterId,
      groupId: snapshot.groupId,
    });

    expect(groupTabs('right')).toEqual([panelIdOf('api')]);
  });
});

describe('dragging tabs between windows', () => {
  it('starts a clean tab drag and blocks one with unsaved changes', async () => {
    await start();

    const clean = dispatchDrag(dockTab('api'), 'dragstart', createDataTransfer());
    await act(async () => undefined);
    unsaved.add('api');
    const guarded = dispatchDrag(dockTab('api'), 'dragstart', createDataTransfer());

    expect(clean.defaultPrevented).toBe(false);
    expect(guarded.defaultPrevented).toBe(true);
    expect(takeWarnings()).toEqual([['warning']]);
  });

  it('tears off only the dragged tab and keeps its docked source until the new window is ready', async () => {
    await start({ open: ['api', 'worker'] });

    await tearOff(dockTab('api'), { x: 2200, y: 300 });

    const [[, request]] = app.backend.calls('RequestPanelTabTransfer');
    expect(request).toMatchObject({
      targetKind: 'new-window',
      cursorX: 2200,
      cursorY: 300,
      tab: { panelId: panelIdOf('api') },
    });
    expect(isOpenHere('api')).toBe(true);

    // The registry asks this view to hand the tab to a new window.
    await emitHere('panel-window:tab-transfer-requested', { request });
    const [[, snapshot]] = app.backend.calls('BeginPanelWindowOpen');
    expect(snapshot).toMatchObject({
      tabs: [expect.objectContaining({ panelId: panelIdOf('api') })],
      initialPositionAnchor: { x: 2200, y: 300 },
      useInitialPosition: true,
    });
    expect(isOpenHere('api')).toBe(true);

    await act(async () => {
      await acknowledgePanelWindowReady('panel-1', snapshot.transferId);
    });
    await app.settle();

    expect(isOpenHere('api')).toBe(false);
    expect(isOpenHere('worker')).toBe(true);
  });

  it('reports a tear-off the registry rejects', async () => {
    await start();
    app.backend.answer('RequestPanelTabTransfer', () => {
      throw new Error('registry unavailable');
    });

    await tearOff(dockTab('api'), { x: 1800, y: 500 });

    expect(takeReports('tear-off-tab')).toHaveLength(1);
  });

  it('requests a drop from a native window and mounts it where the directory places the move', async () => {
    await start();

    await dropFromNativeWindow('worker', 'right');

    const [[windowName, request]] = app.backend.calls('RequestPanelTabTransfer');
    expect(windowName).toBe(app.windowName);
    expect(request).toMatchObject({
      sourceWindowName: 'panel-1',
      targetKind: 'workspace',
      targetWindowName: app.windowName,
      targetGroupId: 'right',
      tab: tabOf('worker'),
    });
    // Nothing mounts until the directory lists the move.
    expect(isOpenHere('worker')).toBe(false);

    await directoryListsMove('worker', {
      transferId: request.transferId,
      groupId: 'right',
      index: 1,
    });

    expect(groupTabs('right')).toEqual([panelIdOf('api'), panelIdOf('worker')]);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, request.transferId, true],
    ]);
  });

  it('reports a drop the registry rejects', async () => {
    await start();
    app.backend.answer('RequestPanelTabTransfer', () => {
      throw new Error('registry unavailable');
    });

    await dropFromNativeWindow('worker', 'right');

    expect(takeReports('request-tab-drop')).toHaveLength(1);
  });
});

describe("answering the registry's tab-transfer requests", () => {
  it('removes a docked source tab only after an existing native target commits', async () => {
    await start();
    const request = tabTransferRequest('api');

    await emitHere('panel-window:tab-transfer-requested', { request });

    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([
      [app.windowName, request.transferId],
    ]);
    expect(isOpenHere('api')).toBe(true);
    await emitHere('panel-window:tab-transfer-committed', { request });

    expect(isOpenHere('api')).toBe(false);
  });

  it.each([
    [
      'its claimed source group is not where the tab is',
      () => tabTransferRequest('api', { sourceGroupId: 'bottom' }),
    ],
    ['this view no longer holds the tab', () => tabTransferRequest('worker')],
  ])('refuses a transfer when %s', async (_case, request) => {
    await start();

    await emitHere('panel-window:tab-transfer-requested', { request: request() });

    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([[app.windowName, 'tab-transfer-1']]);
    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([]);
    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([]);
  });

  it('refuses a transfer of a tab with unsaved changes and tells the user', async () => {
    await start();
    unsaved.add('api');

    await emitHere('panel-window:tab-transfer-requested', { request: tabTransferRequest('api') });

    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([[app.windowName, 'tab-transfer-1']]);
    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([]);
    expect(takeWarnings()).toEqual([['warning']]);
  });

  it('fails and reports an existing native target that cannot accept the transfer', async () => {
    await start();
    app.backend.answer('AcceptPanelTabTransfer', () => {
      throw new Error('target unavailable');
    });

    await emitHere('panel-window:tab-transfer-requested', { request: tabTransferRequest('api') });

    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([[app.windowName, 'tab-transfer-1']]);
    expect(takeReports('accept-tab-transfer')).toHaveLength(1);
  });

  it('fails and reports a torn-off tab whose new window cannot open', async () => {
    await start();
    app.backend.answer('BeginPanelWindowOpen', () => {
      throw new Error('window unavailable');
    });

    await emitHere('panel-window:tab-transfer-requested', {
      request: tabTransferRequest('api', {
        targetWindowName: '',
        targetGroupId: 'new-native-group',
        targetKind: 'new-window' as panelwindow.TabTransferTarget,
        cursorX: 1800,
        cursorY: 500,
      }),
    });

    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([[app.windowName, 'tab-transfer-1']]);
    expect(takeReports('accept-tab-transfer')).toHaveLength(1);
  });
});

describe('moves the directory targets at this view', () => {
  it('mounts a dock-back group and acknowledges once it is visible and published', async () => {
    await start();
    const publish = app.backend.hold('PublishDockedPanels');

    await directoryListsMove('worker');

    expect(groupTabs('bottom')).toEqual([panelIdOf('worker')]);
    expect(windowFrozen()).toBe(true);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([]);
    await act(async () => publish());
    await app.settle();

    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, 'dock-1', true],
    ]);
  });

  it('shows the target cluster before acknowledging a dock-back into it', async () => {
    await start({ twoClusters: true });

    await directoryListsMove('worker', { cluster: staging });

    expect(view.owners().kubeconfig.selectedClusterId).toBe(staging.clusterId);
    expect(groupTabs('bottom', staging)).toEqual([panelIdOf('worker', staging)]);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, 'dock-1', true],
    ]);
  });

  it('asks the directory to cancel a move whose commit fails', async () => {
    await start();
    app.backend.answer('AcknowledgePanelTransfer', (_windowName, _transferId, mounted) => {
      if (mounted) {
        throw new Error('commit failed');
      }
    });

    await directoryListsMove('worker');

    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, 'dock-1', true],
      [app.windowName, 'dock-1', false],
    ]);
    expect(app.errors.take(() => true)).toHaveLength(1);
  });

  it('mounts a cluster view move but leaves its handoff to the cluster coordinator', async () => {
    await start();

    await directoryListsMove('worker', { transferId: 'view-1', view: true });

    expect(groupTabs('bottom')).toEqual([panelIdOf('worker')]);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([]);
    expect(windowFrozen()).toBe(false);
  });

  it('releases the move guard once the directory stops listing the transfer', async () => {
    await start();
    app.backend.answer('AcknowledgePanelTransfer', () => new Promise<void>(() => undefined));
    await directoryListsMove('worker');
    expect(windowFrozen()).toBe(true);

    await directoryListsNothing();

    expect(windowFrozen()).toBe(false);
  });

  it('refuses an incoming move while another transaction freezes this view', async () => {
    await start();
    app.backend.answer('AcknowledgeWorkspaceWindowClose', () => undefined);
    const publish = app.backend.hold('PublishDockedPanels');
    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'bottom');
    });
    // The window is closing and waits for its publication.
    await emitHere('workspace-window:close-requested', { windowName: app.windowName });

    await directoryListsMove('worker');

    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, 'dock-1', false],
    ]);
    expect(isOpenHere('worker')).toBe(false);
    await act(async () => publish());
    await app.settle();
  });
});
