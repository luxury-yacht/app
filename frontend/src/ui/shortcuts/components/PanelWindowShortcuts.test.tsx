/**
 * frontend/src/ui/shortcuts/components/PanelWindowShortcuts.test.tsx
 *
 * A native panel window's side of the panel-window protocol
 * (PanelWindowShortcuts): closing its active tab only once the directory
 * authorizes it, and the window with its last tab; moving a tab out (accepting,
 * opening a tear-off window, removing the tab on commit, keeping it on
 * failure) and in (inserting it, acknowledging once mounted and published);
 * answering cluster-close, window-close, and application-quit preflights,
 * refused while a draft blocks, a move is in flight, or the window is not
 * ready; serializing its arrangement reports; and its application-menu
 * accelerators and native menu events. Runs in panel-window mode
 * (test-utils/appState): the real panel-window shell and its object-panel
 * state, dock, lifecycle guards, publication queue, and keyboard system; only
 * the backend boundary (RPCs, runtime events, the Wails window handle) is
 * faked.
 */

import { Window as WailsWindow } from '@wailsio/runtime';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '@/core/backend-api/models';
import {
  usePanelLifecycleGuard,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { objectPanelTabSnapshot } from '@/core/panel-windows/tabTransfer';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { isMacPlatform } from '@/utils/platform';

const app = installAppStateHarness({ windowName: 'panel-1' });
let dev: TestCluster;
let view: MountedApp;
let guards: ReturnType<typeof usePanelLifecycleGuardRegistry> | undefined;
/** Panels whose YAML tab holds an unsaved draft. */
let drafts = new Set<string>();
let draftFocused: string[] = [];

const api: ObjectIdentity = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'api',
};
const apiPod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'default',
  name: 'api-1',
};
const worker: ObjectIdentity = { ...api, name: 'worker' };

const refOf = (identity: ObjectIdentity) => ({ clusterId: dev.clusterId, ...identity });
const panelIdOf = (identity: ObjectIdentity) => objectPanelId(refOf(identity));
const tabOf = (identity: ObjectIdentity) =>
  objectPanelTabSnapshot(panelIdOf(identity), refOf(identity), 'details');

/** A YAML draft's lifecycle guard on every open panel, as the YAML tab registers it. */
function DraftGuard({ identity }: Readonly<{ identity: ObjectIdentity }>) {
  const panelId = panelIdOf(identity);
  usePanelLifecycleGuard(panelId, () =>
    drafts.has(panelId) ? { reason: 'unsaved-yaml', focus: () => draftFocused.push(panelId) } : null
  );
  return null;
}

function Probe() {
  guards = usePanelLifecycleGuardRegistry();
  return (
    <>
      {[api, apiPod, worker].map((identity) => (
        <DraftGuard key={identity.name} identity={identity} />
      ))}
    </>
  );
}

const registry = () => requireValue(guards, 'expected the panel lifecycle guards');

/** Opens panel window `panel-1` of dev holding `tabs`, the first active. */
const openPanelWindow = async (tabs: ObjectIdentity[] = [api, apiPod]) => {
  app.panelWindow(dev, { name: 'panel-1', transferId: 'opened', tabs: tabs.map(tabOf) });
  view = await app.render(<Probe />);
};

/** Delivers a backend event to this window. */
const deliver = async (name: string, data?: unknown) => {
  await act(async () => {
    app.events.emit(name, data);
  });
  await app.settle();
};

const press = async (key: string, modifiers: KeyboardEventInit = {}) => {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    );
  });
  await app.settle();
};

const primary = (): KeyboardEventInit => (isMacPlatform() ? { metaKey: true } : { ctrlKey: true });

/** The tabs the window's dock shows, in order. */
const tabIds = () =>
  Array.from(
    view.container.querySelectorAll<HTMLElement>(
      '[data-group-key="right"] [role="tab"][data-panel-id]'
    )
  ).map((tab) => tab.dataset.panelId);

const openPanelIds = () => view.openPanels().map((target) => objectPanelId(target as never));

const reports = (action: string) => app.errors.take((record) => record.context?.action === action);
const warnings = () => app.errors.take((record) => record.kinds.includes('warning'));

/** A request to move one of this window's tabs out, as the directory relays it. */
const outgoing = (identity: ObjectIdentity, targetKind = 'new-window') => ({
  transferId: `out-${identity.name}`,
  sourceWindowName: 'panel-1',
  targetWindowName: '',
  clusterId: dev.clusterId,
  sourceGroupId: 'right',
  targetGroupId: 'group-new',
  targetIndex: 0,
  targetKind,
  cursorX: 0,
  cursorY: 0,
  tab: tabOf(identity),
});

/** A request to insert another window's tab here, as the directory relays it. */
const incoming = (identity: ObjectIdentity, targetIndex = 1) => ({
  transferId: `in-${identity.name}`,
  sourceWindowName: 'panel-2',
  targetWindowName: 'panel-1',
  clusterId: dev.clusterId,
  sourceGroupId: 'right',
  targetGroupId: 'right',
  targetIndex,
  targetKind: 'panel-window',
  cursorX: 0,
  cursorY: 0,
  tab: tabOf(identity),
});

const clusterClose = (transactionId: string, target = {}) => ({
  transactionId,
  windowName: 'panel-1',
  clusterId: dev.clusterId,
  ...target,
});

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  for (const identity of [api, apiPod, worker]) {
    app.servePanel(dev, identity);
  }
  for (const method of [
    'AcceptPanelTabTransfer',
    'FailPanelTabTransfer',
    'AcknowledgePanelTransfer',
    'AcknowledgeClusterPanelClose',
    'AcknowledgePanelWindowClose',
    'AcknowledgeApplicationQuitPreflight',
    'RequestPanelTabClose',
    'ExecuteApplicationMenuCommand',
    'SetZoomLevel',
  ] as const) {
    app.backend.answer(method, () => undefined as never);
  }
  // A Deployment's panel asks whether an autoscaler manages it.
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  drafts = new Set();
  draftFocused = [];
  guards = undefined;
  vi.mocked(WailsWindow.Minimise).mockClear();
  vi.mocked(WailsWindow.OpenDevTools).mockReset().mockResolvedValue(undefined);
});

describe('closing tabs', () => {
  it('closes the active tab only once the directory authorizes it, and tells the directory', async () => {
    await openPanelWindow();

    await deliver('menu:close');
    expect(app.backend.calls('RequestPanelTabClose')).toEqual([['panel-1', panelIdOf(api)]]);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);

    await deliver('panel-window:tab-close-authorized', { panelId: panelIdOf(api) });

    expect(tabIds()).toEqual([panelIdOf(apiPod)]);
    expect(openPanelIds()).toEqual([panelIdOf(apiPod)]);
    expect(app.backend.calls('ClosePanelWorkspaceObject')).toEqual([
      ['panel-1', dev.clusterId, panelIdOf(api)],
    ]);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);
  });

  it('closes the window, not the tab, once the directory authorizes closing its last tab', async () => {
    await openPanelWindow([api]);

    await press('w', primary());
    expect(app.backend.calls('RequestPanelTabClose')).toEqual([['panel-1', panelIdOf(api)]]);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);

    await deliver('panel-window:tab-close-authorized', { panelId: panelIdOf(api) });

    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([['panel-1']]);
    expect(tabIds()).toEqual([panelIdOf(api)]);
  });

  it('keeps the last tab when the window cannot close', async () => {
    app.backend.answer('AcknowledgePanelWindowClose', () => {
      throw new Error('native close failed');
    });
    await openPanelWindow([api]);

    await deliver('panel-window:tab-close-authorized', { panelId: panelIdOf(api) });

    expect(reports('close-last-authorized-tab')).toHaveLength(1);
    expect(tabIds()).toEqual([panelIdOf(api)]);
    expect(openPanelIds()).toEqual([panelIdOf(api)]);
  });

  it('keeps a tab with an unsaved draft open and brings the draft forward', async () => {
    await openPanelWindow();
    drafts.add(panelIdOf(api));

    await deliver('menu:close');

    expect(app.backend.calls('RequestPanelTabClose')).toEqual([]);
    expect(draftFocused).toEqual([panelIdOf(api)]);
    expect(app.focusedWindows()).toEqual(['panel-1']);
    expect(warnings()).toHaveLength(1);
  });

  it('reports a close request the directory refuses', async () => {
    app.backend.answer('RequestPanelTabClose', () => {
      throw new Error('close unavailable');
    });
    await openPanelWindow();

    await deliver('menu:close');

    expect(reports('close-active-tab')).toHaveLength(1);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);
  });
});

describe('moving tabs out', () => {
  it('accepts a tear-off without waiting for its pending report, and removes the tab once committed', async () => {
    const releaseReport = app.backend.hold('PublishPanelWindowGroup');
    await openPanelWindow();
    const request = outgoing(apiPod);

    await deliver('panel-window:tab-transfer-requested', { request });

    expect(registry().firstBlocker([panelIdOf(apiPod)])?.reason).toBe('transfer-in-flight');
    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([['panel-1', request.transferId]]);
    expect(app.backend.calls('BeginPanelWindowOpen')).toEqual([
      ['panel-1', expect.objectContaining({ clusterId: dev.clusterId, tabs: [request.tab] })],
    ]);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);

    await deliver('panel-window:tab-transfer-committed', { request });

    expect(tabIds()).toEqual([panelIdOf(api)]);
    expect(registry().isFrozen()).toBe(false);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);
    await act(async () => releaseReport());
    await app.settle();
  });

  it('keeps the tab when its tear-off window cannot open', async () => {
    app.backend.answer('BeginPanelWindowOpen', () => {
      throw new Error('native window creation failed');
    });
    await openPanelWindow();
    const request = outgoing(apiPod);

    await deliver('panel-window:tab-transfer-requested', { request });
    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([['panel-1', request.transferId]]);
    expect(reports('accept-tab-transfer')).toHaveLength(1);

    await deliver('panel-window:tab-transfer-failed', { request, reason: 'window failed' });

    expect(registry().isFrozen()).toBe(false);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);
  });

  it('closes the window once its last tab has moved out', async () => {
    await openPanelWindow([api]);
    const request = outgoing(api, 'workspace');

    await deliver('panel-window:tab-transfer-requested', { request });
    await deliver('panel-window:tab-transfer-committed', { request });

    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([['panel-1']]);
  });

  it('refuses to move a tab with an unsaved draft', async () => {
    await openPanelWindow();
    drafts.add(panelIdOf(apiPod));
    const request = outgoing(apiPod);

    await deliver('panel-window:tab-transfer-requested', { request });

    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([['panel-1', request.transferId]]);
    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([]);
    expect(draftFocused).toEqual([panelIdOf(apiPod)]);
    expect(warnings()).toHaveLength(1);
  });
});

describe('moving tabs in', () => {
  it('inserts the tab at the requested place and acknowledges it once its arrangement is reported', async () => {
    await openPanelWindow();
    const releaseReport = app.backend.hold('PublishPanelWindowGroup');
    const request = incoming(worker, 1);

    await deliver('panel-window:tab-transfer-insert-requested', { request });

    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(worker), panelIdOf(apiPod)]);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([]);

    await act(async () => releaseReport());
    await app.settle();

    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      ['panel-1', request.transferId, true],
    ]);
    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([]);
  });

  it('refuses window close and application quit while an inserted tab is still moving', async () => {
    await openPanelWindow();
    await deliver('panel-window:tab-transfer-insert-requested', { request: incoming(worker) });

    await deliver('panel-window:application-quit-preflight-requested', {
      windowName: 'panel-1',
      transactionId: 'quit-while-moving',
    });
    await deliver('panel-window:close-requested', { windowName: 'panel-1', reason: '' });

    expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([
      ['panel-1', 'quit-while-moving', false],
    ]);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);
  });
});

describe('closing the window', () => {
  it('stays frozen until its last report lands, refusing tab moves meanwhile, then closes', async () => {
    const releaseReport = app.backend.hold('PublishPanelWindowGroup');
    await openPanelWindow();

    await deliver('panel-window:close-requested', { windowName: 'panel-1', reason: '' });
    expect(registry().isWindowFrozen()).toBe(true);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);

    const out = outgoing(apiPod);
    await deliver('panel-window:tab-transfer-requested', { request: out });
    const into = incoming(worker);
    await deliver('panel-window:tab-transfer-insert-requested', { request: into });
    expect(app.backend.calls('FailPanelTabTransfer')).toEqual([
      ['panel-1', out.transferId],
      ['panel-1', into.transferId],
    ]);
    expect(app.backend.calls('AcceptPanelTabTransfer')).toEqual([]);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);
    // The refused move tells the user to wait for the close.
    expect(warnings()).toHaveLength(1);

    await act(async () => releaseReport());
    await app.settle();

    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([['panel-1']]);
    expect(registry().isFrozen()).toBe(false);
  });

  it('keeps its tabs and unfreezes when the window cannot close', async () => {
    app.backend.answer('AcknowledgePanelWindowClose', () => {
      throw new Error('native close failed');
    });
    await openPanelWindow();

    await deliver('panel-window:close-requested', { windowName: 'panel-1', reason: '' });

    expect(reports('close-window')).toHaveLength(1);
    expect(tabIds()).toEqual([panelIdOf(api), panelIdOf(apiPod)]);
    expect(registry().isFrozen()).toBe(false);
  });

  it('allows application quit when clean and refuses it while a draft is unsaved', async () => {
    await openPanelWindow();

    await deliver('panel-window:application-quit-preflight-requested', {
      windowName: 'panel-1',
      transactionId: 'quit-clean',
    });
    expect(registry().isWindowFrozen()).toBe(true);
    // Another window refuses, so the quit settles without quitting.
    await deliver('panel-window:application-quit-preflight-settled', {
      windowName: 'panel-1',
      transactionId: 'quit-clean',
    });
    expect(registry().isFrozen()).toBe(false);
    drafts.add(panelIdOf(apiPod));
    await deliver('panel-window:application-quit-preflight-requested', {
      windowName: 'panel-1',
      transactionId: 'quit-dirty',
    });

    expect(app.backend.calls('AcknowledgeApplicationQuitPreflight')).toEqual([
      ['panel-1', 'quit-clean', true],
      ['panel-1', 'quit-dirty', false],
    ]);
    expect(draftFocused).toEqual([panelIdOf(apiPod)]);
    expect(warnings()).toHaveLength(1);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);
  });
});

describe('closing the cluster', () => {
  it('approves closing its cluster, freezing the cluster until the close settles', async () => {
    await openPanelWindow();

    await deliver('cluster-panel-close:requested', clusterClose('cluster-close'));

    expect(app.backend.calls('AcknowledgeClusterPanelClose')).toEqual([
      ['panel-1', 'cluster-close', true],
    ]);
    expect(registry().isClusterFrozen(dev.clusterId)).toBe(true);
    expect(app.backend.calls('AcknowledgePanelWindowClose')).toEqual([]);

    await deliver('cluster-panel-close:settled', clusterClose('cluster-close'));
    expect(registry().isClusterFrozen(dev.clusterId)).toBe(false);
  });

  it('ignores a close of another cluster or of another window’s panels', async () => {
    await openPanelWindow();

    await deliver(
      'cluster-panel-close:requested',
      clusterClose('foreign-window', { windowName: 'panel-2' })
    );
    await deliver(
      'cluster-panel-close:requested',
      clusterClose('foreign-cluster', { clusterId: 'prod:beta' })
    );

    expect(app.backend.calls('AcknowledgeClusterPanelClose')).toEqual([]);
    expect(registry().isFrozen()).toBe(false);
  });

  it('refuses while a draft is unsaved or a tab is moving', async () => {
    await openPanelWindow();
    drafts.add(panelIdOf(api));
    await deliver('cluster-panel-close:requested', clusterClose('with-draft'));
    expect(draftFocused).toEqual([panelIdOf(api)]);
    expect(warnings()).toHaveLength(1);

    drafts = new Set();
    await deliver('panel-window:tab-transfer-requested', { request: outgoing(apiPod) });
    await deliver('cluster-panel-close:requested', clusterClose('while-moving'));

    expect(app.backend.calls('AcknowledgeClusterPanelClose')).toEqual([
      ['panel-1', 'with-draft', false],
      ['panel-1', 'while-moving', false],
    ]);
    expect(registry().isClusterFrozen(dev.clusterId)).toBe(true);
    expect(registry().firstBlocker([panelIdOf(api)])).toBeNull();
  });

  it('refuses and reports when its arrangement cannot be reported first', async () => {
    app.backend.answer('PublishPanelWindowGroup', () => {
      throw new Error('panel publication failed');
    });
    await openPanelWindow();
    expect(reports('publish-panel-window-group')).toHaveLength(1);

    await deliver('cluster-panel-close:requested', clusterClose('unpublished'));

    expect(app.backend.calls('AcknowledgeClusterPanelClose')).toEqual([
      ['panel-1', 'unpublished', false],
    ]);
    // The close retries the report once; that failure is reported for the report and the close.
    expect(
      app.errors.take((record) => (record.error as Error).message === 'panel publication failed')
    ).toEqual([expect.objectContaining({ kinds: ['operational', 'operational'] })]);
    expect(app.backend.calls('PublishPanelWindowGroup')).toHaveLength(2);
    expect(registry().isClusterFrozen(dev.clusterId)).toBe(false);
  });

  it('reports an acknowledgement the directory rejects, and unfreezes once the close settles', async () => {
    app.backend.answer('AcknowledgeClusterPanelClose', () => {
      throw new Error('stale close transaction');
    });
    await openPanelWindow();

    await deliver('cluster-panel-close:requested', clusterClose('stale'));
    expect(reports('acknowledge-cluster-close')).toHaveLength(1);

    await deliver('cluster-panel-close:settled', clusterClose('stale'));
    expect(registry().isClusterFrozen(dev.clusterId)).toBe(false);
  });
});

describe('arrangement reports', () => {
  const activate = async (identity: ObjectIdentity) => {
    const tab = requireValue(
      view.container.querySelector<HTMLElement>(
        `[data-group-key="right"] [role="tab"][data-panel-id="${panelIdOf(identity)}"]`
      ),
      `expected the ${identity.name} tab`
    );
    await act(async () => tab.click());
    await app.settle();
  };

  it('reports the window’s arrangement one at a time, the latest last', async () => {
    const releaseFirst = app.backend.hold('PublishPanelWindowGroup');
    await openPanelWindow();
    expect(app.backend.calls('PublishPanelWindowGroup')).toHaveLength(1);

    await activate(apiPod);
    expect(app.backend.calls('PublishPanelWindowGroup')).toHaveLength(1);

    await act(async () => releaseFirst());
    await app.settle();

    const reported = app.backend.calls('PublishPanelWindowGroup');
    expect(reported).toHaveLength(2);
    expect(reported[1]).toEqual([
      'panel-1',
      expect.objectContaining({
        clusterId: dev.clusterId,
        groupId: 'right',
        tabs: [tabOf(api), tabOf(apiPod)],
        activePanelId: panelIdOf(apiPod),
      }),
    ]);
  });

  it('keeps reporting after a report fails', async () => {
    let failNext = true;
    app.backend.answer('PublishPanelWindowGroup', () => {
      if (failNext) {
        failNext = false;
        throw new Error('owner temporarily unavailable');
      }
    });
    await openPanelWindow();
    expect(reports('publish-panel-window-group')).toHaveLength(1);

    await activate(apiPod);

    expect(app.backend.calls('PublishPanelWindowGroup')).toHaveLength(2);
    expect(app.backend.calls('PublishPanelWindowGroup')[1]?.[1].activePanelId).toBe(
      panelIdOf(apiPod)
    );
  });
});

describe('before the window is ready', () => {
  it('ignores its menu events and accelerators, reports no arrangement, and refuses cluster close', async () => {
    const releaseReady = app.backend.hold('AcknowledgePanelWindowReady');
    await openPanelWindow();

    await deliver('menu:close');
    await press('w', primary());
    await deliver('debug:open-inspector');
    await deliver('cluster-panel-close:requested', clusterClose('unready'));

    expect(app.backend.calls('RequestPanelTabClose')).toEqual([]);
    expect(WailsWindow.OpenDevTools).not.toHaveBeenCalled();
    expect(app.backend.calls('PublishPanelWindowGroup')).toEqual([]);
    expect(app.backend.calls('AcknowledgeClusterPanelClose')).toEqual([
      ['panel-1', 'unready', false],
    ]);

    await act(async () => releaseReady());
    await app.settle();
    expect(app.backend.calls('PublishPanelWindowGroup')).toHaveLength(1);
  });
});

describe('application menu', () => {
  it('runs panel accelerators in this window and sends the others to the backend', async () => {
    await openPanelWindow();

    await press('w', primary());
    await press('=', primary());
    await press('m', primary());
    await press(',', primary());

    expect(app.backend.calls('RequestPanelTabClose')).toEqual([['panel-1', panelIdOf(api)]]);
    expect(app.backend.calls('SetZoomLevel')).toEqual([[110]]);
    expect(WailsWindow.Minimise).toHaveBeenCalledOnce();
    expect(app.backend.calls('ExecuteApplicationMenuCommand')).toEqual([
      [backend.ApplicationMenuCommand.ApplicationMenuCommandSettings],
    ]);
  });

  it('opens the inspector from the native Debug menu, and reports when it cannot', async () => {
    await openPanelWindow();

    await deliver('debug:open-inspector');
    expect(WailsWindow.OpenDevTools).toHaveBeenCalledOnce();

    vi.mocked(WailsWindow.OpenDevTools).mockRejectedValueOnce(new Error('inspector unavailable'));
    await deliver('debug:open-inspector');
    expect(reports('open-inspector')).toHaveLength(1);
  });
});
