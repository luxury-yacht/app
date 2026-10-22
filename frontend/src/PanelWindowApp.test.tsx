/**
 * frontend/src/PanelWindowApp.test.tsx
 *
 * A native panel window: it boots from its descriptor (cluster, tabs, active
 * view), acknowledges readiness or rolls the transfer back, shows its own
 * warnings, and routes tab menu docks, tab closes, dock-backs, drops, and
 * tear-offs through the panel-window protocol. Runs the real panel-window
 * shell through the panel bootstrap (test-utils/appState panel-window mode):
 * its object-panel state, dock, guard registry, and object panels; only the
 * backend boundary is faked.
 */

import { TAB_DRAG_DATA_TYPE } from '@shared/components/tabs/dragCoordinator';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePanelLifecycleGuard } from '@/core/panel-windows/panelLifecycleGuards';
import { objectPanelTabSnapshot } from '@/core/panel-windows/tabTransfer';
import { makePodSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useDockablePanelContext } from '@/ui/dockable';
import { errorHandler } from '@/utils/errorHandler';

const app = installAppStateHarness({ windowName: 'panel-1' });
let view: MountedApp;
let dev: TestCluster;
let dock: ReturnType<typeof useDockablePanelContext> | undefined;
let unsaved = false;

const podIdentity = { group: '', version: 'v1', kind: 'Pod', namespace: 'default', name: 'api' };
const serviceIdentity = { ...podIdentity, kind: 'Service' };
const refOf = (identity: typeof podIdentity) => ({ clusterId: dev.clusterId, ...identity });
const panelIdOf = (identity: typeof podIdentity) => objectPanelId(refOf(identity));
const tabOf = (identity: typeof podIdentity, activeView = 'details') =>
  objectPanelTabSnapshot(panelIdOf(identity), refOf(identity), activeView);

function Probe() {
  dock = useDockablePanelContext();
  usePanelLifecycleGuard(panelIdOf(podIdentity), () =>
    unsaved ? { reason: 'unsaved-yaml', focus: () => undefined } : null
  );
  return null;
}

/**
 * Opens panel window `panel-1` holding `tabs`, as a transfer opened it, and
 * serves the reads its object panels make.
 */
const openPanelWindow = async ({
  tabs = () => [tabOf(podIdentity, 'events')],
  transferId = 'transfer-panel-window',
}: {
  tabs?: () => ReturnType<typeof tabOf>[];
  transferId?: string;
} = {}) => {
  unsaved = false;
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  for (const identity of [podIdentity, serviceIdentity]) {
    const object = app.object(dev, identity);
    app.snapshots.serve('object-details', object.scopes.detailScope ?? '', {
      detailType: identity.kind.toLowerCase(),
      details: { name: identity.name, namespace: identity.namespace },
    } as never);
    if (object.scopes.eventsScope) {
      app.snapshots.serve('object-events', object.scopes.eventsScope, {
        clusterId: dev.clusterId,
        clusterName: dev.clusterName,
        events: [],
      } as never);
    }
  }
  app.snapshots.serve(
    'pods',
    buildRefreshScope('pods', {
      clusterId: dev.clusterId,
      selector: { kind: 'namespace', namespace: 'default' },
    }),
    makePodSnapshotPayload({ clusterId: dev.clusterId, clusterName: dev.clusterName })
  );
  app.panelWindow(dev, { name: 'panel-1', transferId, tabs: tabs() });
  view = await app.render(<Probe />);
};

beforeEach(() => {
  for (const method of [
    'RequestPanelTabTransfer',
    'RequestPanelTabClose',
    'BeginPanelWindowDock',
    'FailPanelWindowTransfer',
  ] as const) {
    app.backend.answer(method, () => undefined as never);
  }
});

const workspaceDock = () => requireValue(dock, 'panel window dock');
const takeReports = (action: string) =>
  app.errors.take((record) => record.context?.action === action);

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

const tabElement = (identity: typeof podIdentity) =>
  requireValue(
    view.container.querySelector<HTMLElement>(
      `[role="tab"][data-panel-id="${panelIdOf(identity)}"]`
    ),
    `${identity.kind} tab`
  );

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

describe('booting from its descriptor', () => {
  it('shows its cluster, tabs, and active view, and acknowledges readiness', async () => {
    await openPanelWindow();

    expect(
      view.container.querySelector('.panel-window-app')?.getAttribute('data-native-panel-window')
    ).toBe('panel-1');
    expect(view.container.querySelector('.app-header-title')?.textContent).toBe(dev.clusterName);
    expect(
      view.container.querySelector(
        `[data-group-key="right"] [data-panel-id="${panelIdOf(podIdentity)}"]`
      )
    ).not.toBeNull();
    expect(
      Array.from(view.container.querySelectorAll('[role="tab"][aria-selected="true"]')).map(
        (tab) => tab.textContent
      )
    ).toEqual(expect.arrayContaining([expect.stringMatching(/events/i)]));
    expect(app.backend.calls('AcknowledgePanelWindowReady')).toEqual([
      ['panel-1', 'transfer-panel-window'],
    ]);
  });

  it('shows a warning inside the floating window that raised it', async () => {
    await openPanelWindow();

    await act(async () => {
      errorHandler.warn('Save or discard your YAML changes before closing or moving this panel.', {
        title: 'Unsaved YAML changes',
      });
    });

    expect(view.container.textContent).toContain('Unsaved YAML changes');
    expect(app.errors.take((record) => record.kinds.includes('warning'))).toHaveLength(1);
  });

  it('reports and rolls back a failed ready acknowledgement', async () => {
    app.backend.answer('AcknowledgePanelWindowReady', () => {
      throw new Error('window disappeared');
    });

    await openPanelWindow({ transferId: 'transfer-ready-failure' });

    expect(app.backend.calls('FailPanelWindowTransfer')).toEqual([
      ['panel-1', 'panel-1', 'transfer-ready-failure'],
    ]);
    expect(takeReports('acknowledge-ready')).toHaveLength(1);
  });

  it('reports when the registry already finished the ready-failure cleanup', async () => {
    app.backend.answer('AcknowledgePanelWindowReady', () => {
      throw new Error('owner unavailable');
    });
    app.backend.answer('FailPanelWindowTransfer', () => {
      throw new Error('panel window is not live');
    });

    await openPanelWindow({ transferId: 'transfer-cleanup-complete' });

    expect(takeReports('fail-ready-transfer')).toHaveLength(1);
    expect(takeReports('acknowledge-ready')).toHaveLength(1);
  });
});

describe('routing tabs through the panel-window protocol', () => {
  it('routes a tab menu dock through a single-tab transfer and reports a failed request', async () => {
    await openPanelWindow();

    await act(async () => {
      workspaceDock().requestTabMove(panelIdOf(podIdentity), 'right');
    });
    await app.settle();

    expect(app.backend.calls('RequestPanelTabTransfer')).toEqual([
      [
        'panel-1',
        expect.objectContaining({
          sourceGroupId: 'right',
          targetWindowName: '',
          targetGroupId: 'right',
          targetKind: 'workspace',
          tab: tabOf(podIdentity, 'events'),
        }),
      ],
    ]);
    expect(app.backend.calls('BeginPanelWindowDock')).toEqual([]);

    app.backend.answer('RequestPanelTabTransfer', () => {
      throw new Error('target failed');
    });
    await act(async () => {
      workspaceDock().requestTabMove(panelIdOf(podIdentity), 'bottom');
    });
    await app.settle();
    expect(takeReports('move-panel-tab').map(({ context }) => context?.clusterId)).toEqual([
      dev.clusterId,
    ]);
  });

  it('asks the registry to close a tab instead of closing it locally', async () => {
    await openPanelWindow();

    await act(async () => {
      workspaceDock().closeTab(panelIdOf(podIdentity));
    });
    await app.settle();

    expect(app.backend.calls('RequestPanelTabClose')).toEqual([
      ['panel-1', panelIdOf(podIdentity)],
    ]);
  });

  it('docks the whole group back into an app window, unless it has unsaved changes', async () => {
    await openPanelWindow({ tabs: () => [tabOf(podIdentity, 'events'), tabOf(serviceIdentity)] });

    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'floating');
    });
    expect(app.backend.calls('BeginPanelWindowDock')).toEqual([]);

    unsaved = true;
    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'bottom');
    });
    expect(app.backend.calls('BeginPanelWindowDock')).toEqual([]);
    expect(app.errors.take((record) => record.kinds.includes('warning'))).toHaveLength(1);

    unsaved = false;
    await act(async () => {
      workspaceDock().requestGroupMove?.('right', 'bottom');
    });
    await app.settle();

    expect(app.backend.calls('BeginPanelWindowDock')).toEqual([
      [
        'panel-1',
        'bottom',
        expect.objectContaining({
          sourceWindowName: 'panel-1',
          clusterId: dev.clusterId,
          activePanelId: panelIdOf(podIdentity),
          tabs: [
            expect.objectContaining({ panelId: panelIdOf(podIdentity), activeView: 'events' }),
            expect.objectContaining({ panelId: panelIdOf(serviceIdentity) }),
          ],
        }),
      ],
    ]);
  });

  it('requests a drop from another native window into this one', async () => {
    await openPanelWindow();
    const bar = requireValue(
      view.container.querySelector('[data-group-key="right"] .dockable-tab-bar-shell'),
      'tab bar'
    );
    const transfer = createDataTransfer();
    transfer.setData(
      TAB_DRAG_DATA_TYPE,
      JSON.stringify({
        kind: 'dockable-tab',
        panelId: panelIdOf(serviceIdentity),
        sourceGroupId: 'right',
        sourceWindowGroupId: 'group-2',
        sourceWindowName: 'panel-2',
        clusterId: dev.clusterId,
        tab: tabOf(serviceIdentity),
      })
    );

    await act(async () => {
      dispatchDrag(bar, 'dragenter', transfer, { clientX: 900 });
      dispatchDrag(bar, 'dragover', transfer, { clientX: 900 });
      dispatchDrag(bar, 'drop', transfer, { clientX: 900 });
    });
    await app.settle();

    expect(app.backend.calls('RequestPanelTabTransfer')).toEqual([
      [
        'panel-1',
        expect.objectContaining({
          sourceWindowName: 'panel-2',
          targetWindowName: 'panel-1',
          targetKind: 'panel-window',
          targetIndex: 1,
        }),
      ],
    ]);
  });

  it.each([
    ['its last tab', () => [tabOf(podIdentity, 'events')]],
    ['one of several tabs', () => [tabOf(podIdentity, 'events'), tabOf(serviceIdentity)]],
  ])('tears %s out into a new window', async (_case, tabs) => {
    await openPanelWindow({ tabs });

    await tearOff(tabElement(podIdentity), { x: 2100, y: 400 });

    expect(app.backend.calls('RequestPanelTabTransfer')).toEqual([
      [
        'panel-1',
        expect.objectContaining({
          sourceWindowName: 'panel-1',
          targetWindowName: '',
          targetKind: 'new-window',
          cursorX: 2100,
          cursorY: 400,
          tab: expect.objectContaining({ panelId: panelIdOf(podIdentity) }),
        }),
      ],
    ]);
  });
});
