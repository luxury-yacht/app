/**
 * frontend/src/core/panel-windows/WorkspacePanelSync.test.tsx
 *
 * The workspace window's panel synchronization: it reads, claims, and
 * publishes panels only for admitted cluster tabs, pauses a closing cluster,
 * follows the panel directory (retained panels, moves to native windows,
 * dock-backs, view moves), and lands every close intent before reopening.
 * Runs in the full app: its own WorkspacePanelSync, publication queue,
 * object-panel state, dock, kubeconfig owner, and WorkspacePanelLifecycle, with
 * open panels hosted by its layout. Only the backend boundary is faked
 * (test-utils/appState): a test scripts what the directory answers and rings
 * `panel-workspace:changed`, and `backend.hold` keeps a call in flight.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { panelwindow } from '@/core/backend-api/models';
import { makePodSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useDockablePanelContext } from '@/ui/dockable';
import { objectPanelTabSnapshot } from './tabTransfer';
import {
  type IncomingGroupTransfer,
  useIncomingGroupTransfers,
  usePanelWorkspaceOpen,
  usePanelWorkspaceSync,
} from './WorkspacePanelSync';

const app = installAppStateHarness();
let view: MountedApp;
let production: TestCluster;
let sync: ReturnType<typeof usePanelWorkspaceSync> | undefined;
let incoming: readonly IncomingGroupTransfer[] = [];
let dock: ReturnType<typeof useDockablePanelContext> | undefined;

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
  for (const name of ['api', 'worker', 'second']) {
    app.servePanel(cluster, pod(name));
  }
};
const panelIdOf = (name: string, cluster = production) => objectPanelId(podRef(cluster, name));
const tabOf = (name: string, cluster = production) =>
  objectPanelTabSnapshot(panelIdOf(name, cluster), podRef(cluster, name), 'details');

function Probe() {
  sync = usePanelWorkspaceSync();
  incoming = useIncomingGroupTransfers();
  dock = useDockablePanelContext();
  return null;
}

const workspace = () => requireValue(sync, 'panel workspace sync');
const isOpenHere = (name: string) => view.owners().objectPanels.openPanels.has(panelIdOf(name));
const dockedIn = (groupId: 'right' | 'bottom') =>
  requireValue(dock, 'dock').getClusterTabGroups(production.clusterId)[groupId].tabs;

const openPod = async (name: string) => {
  await act(async () => {
    view.owners().objectPanel.openWithObject(podRef(production, name));
  });
  await app.settle();
};

const closePod = async (name: string) => {
  await act(async () => {
    view.owners().objectPanels.closePanel(production.clusterId, panelIdOf(name));
  });
  await app.settle();
};

const start = async ({ open = ['api'] }: { open?: string[] } = {}) => {
  production = app.cluster({ name: 'dev', context: 'production' });
  serveCluster(production);
  view = await app.mountApp(<Probe />);
  for (const name of open) {
    await openPod(name);
  }
};

/** The directory now answers `panels` for production; it rings its change. */
const directorySays = async (revision: number, panels: panelwindow.WorkspacePanel[]) => {
  app.backend.answer('GetPanelWorkspace', () => ({ revision, panels }));
  await ringDirectory();
};

const ringDirectory = async () => {
  await act(async () => {
    app.events.emit('panel-workspace:changed', { clusterId: production.clusterId });
  });
  await app.settle();
};

const readsOf = (cluster: TestCluster) =>
  app.backend.calls('GetPanelWorkspace').filter(([, clusterId]) => clusterId === cluster.clusterId);
const publishedGroups = () => app.backend.calls('PublishDockedPanels').map(([, groups]) => groups);
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];
const lastPublication = () => last(publishedGroups());

const location = (
  kind: panelwindow.PanelLocationKind,
  windowName: string,
  groupId: string,
  index = 0
): panelwindow.PanelLocation => ({ kind, windowName, groupId, index, active: true });

const retained = (name: string, index = 0): panelwindow.WorkspacePanel => ({
  tab: tabOf(name),
  location: location(panelwindow.PanelLocationKind.PanelLocationRetained, '', 'bottom', index),
});

/** Answers claims of retained panels: each answer is `'claim'`, `'fail'`, or a held claim. */
const claimAnswers = (...answers: Array<'claim' | 'fail' | { release?: () => void }>) => {
  app.backend.answer('OpenPanelWorkspaceObject', (windowName, tab) => {
    const answer = answers.shift() ?? 'claim';
    const claimed = {
      panel: {
        tab,
        location: location(panelwindow.PanelLocationKind.PanelLocationDocked, windowName, 'bottom'),
      },
      render: true,
    };
    if (answer === 'fail') {
      throw new Error('claim failed');
    }
    if (answer === 'claim') {
      return claimed;
    }
    return new Promise((resolve) => {
      answer.release = () => resolve(claimed);
    });
  });
};

/** Records ClosePanelWorkspaceObject and OpenPanelWorkspaceObject in one timeline. */
const recordCloseAndOpen = (closeAnswers: Array<'land' | 'fail'>) => {
  const timeline: string[] = [];
  app.backend.answer('ClosePanelWorkspaceObject', (_windowName, _clusterId, panelId) => {
    timeline.push(`close ${panelId}`);
    if ((closeAnswers.shift() ?? 'land') === 'fail') {
      throw new Error('ipc unavailable');
    }
  });
  app.backend.answer('OpenPanelWorkspaceObject', (windowName, tab) => {
    timeline.push(`open ${tab.panelId}`);
    return {
      panel: {
        tab,
        location: location(panelwindow.PanelLocationKind.PanelLocationDocked, windowName, 'right'),
      },
      render: true,
    };
  });
  return timeline;
};

const takeReports = (action: string) =>
  app.errors.take((record) => record.context?.action === action);

describe('in the workspace window', () => {
  it('waits for confirmed tab membership before panel reads and opens, then resumes on admission', async () => {
    await start({ open: [] });
    const staging = app.cluster({ name: 'dev', context: 'staging', open: false });
    serveCluster(staging);
    // The user opens a cluster tab; the backend has not admitted it yet.
    const admit = app.backend.hold('ApplyClusterWorkspace');
    act(() => {
      void view.owners().kubeconfig.openKubeconfig(staging.selection);
    });
    await app.settle();
    expect(view.owners().kubeconfig.selectedClusterIds).toContain(staging.clusterId);

    expect(await workspace().readCluster(staging.clusterId)).toBeNull();
    expect(await workspace().openPanel(tabOf('api', staging))).toBeNull();
    expect(readsOf(staging)).toEqual([]);
    expect(app.backend.calls('OpenPanelWorkspaceObject')).toEqual([]);

    await act(async () => admit());
    await app.settle();
    await ringDirectory();

    expect(await workspace().readCluster(staging.clusterId)).not.toBeNull();
    await act(async () => {
      await workspace().openPanel(tabOf('api', staging));
    });
    expect(app.backend.calls('OpenPanelWorkspaceObject')).toEqual([
      [app.windowName, tabOf('api', staging)],
    ]);
  });

  it.each([true, false])(
    'leaves a closing cluster out of publications until its close settles (accepted: %s)',
    async (accepted) => {
      await start();
      let settle: (closed: boolean) => void = () => undefined;
      await act(async () => {
        settle = await workspace().quiesceCluster(production.clusterId);
      });
      // Publications only arrange, so leaving the cluster out closes nothing.
      expect(lastPublication()).toEqual([]);
      const published = publishedGroups().length;
      const read = readsOf(production).length;

      await ringDirectory();
      expect(publishedGroups()).toHaveLength(published);
      expect(readsOf(production)).toHaveLength(read);

      await act(async () => settle(accepted));
      await ringDirectory();
      if (accepted) {
        expect(publishedGroups()).toHaveLength(published);
        expect(readsOf(production)).toHaveLength(read);
      } else {
        expect(lastPublication()).toEqual([
          expect.objectContaining({ clusterId: production.clusterId }),
        ]);
        expect(readsOf(production).length).toBeGreaterThan(read);
      }
    }
  );

  it('resumes synchronization after a failed publication prevents cluster closure', async () => {
    app.backend.answer('PublishDockedPanels', () => {
      throw new Error('publication failed');
    });
    await start();

    await act(async () => {
      await expect(workspace().quiesceCluster(production.clusterId)).rejects.toThrow(
        'publication failed'
      );
    });
    app.backend.answer('PublishDockedPanels', () => undefined);
    await app.settle();

    expect(await workspace().readCluster(production.clusterId)).toEqual(
      expect.objectContaining({
        panels: [
          expect.objectContaining({ tab: expect.objectContaining({ panelId: panelIdOf('api') }) }),
        ],
      })
    );
    await expect(workspace().flush()).resolves.toBeUndefined();
    expect(takeReports('publish-docked-panels').length).toBeGreaterThan(0);
  });

  it('rejects stale menu reads and object opens after the cluster selection commits', async () => {
    await start({ open: [] });
    const staging = app.cluster({ name: 'dev', context: 'staging', open: false });
    serveCluster(staging);
    await act(async () => {
      await view.owners().kubeconfig.openKubeconfig(staging.selection);
    });
    await act(async () => {
      await view.owners().kubeconfig.closeKubeconfig(production.selection);
    });
    await app.settle();
    expect(view.owners().kubeconfig.managedClusterIds).toEqual([staging.clusterId]);
    const read = readsOf(production).length;
    const opened = app.backend.calls('OpenPanelWorkspaceObject').length;

    expect(await workspace().readCluster(production.clusterId)).toBeNull();
    expect(await workspace().openPanel(tabOf('api'))).toBeNull();
    expect(readsOf(production)).toHaveLength(read);
    expect(app.backend.calls('OpenPanelWorkspaceObject')).toHaveLength(opened);
  });

  it('publishes local groups and removes a stale source after a directory change', async () => {
    await start();
    expect(lastPublication()).toEqual([
      expect.objectContaining({
        clusterId: production.clusterId,
        tabs: [expect.objectContaining({ panelId: panelIdOf('api') })],
        activePanelId: panelIdOf('api'),
      }),
    ]);

    // Another window took the panel into a native window.
    await directorySays(2, [
      {
        tab: tabOf('api'),
        location: location(
          panelwindow.PanelLocationKind.PanelLocationWindow,
          'panel-1',
          'floating'
        ),
      },
    ]);

    expect(isOpenHere('api')).toBe(false);
    expect(dockedIn('right')).not.toContain(panelIdOf('api'));
  });

  it('drains an object open and prevents its late result from remounting a closing cluster', async () => {
    await start();
    const claim = app.backend.hold('OpenPanelWorkspaceObject');

    const opening = workspace().openPanel(tabOf('worker'));
    let paused = false;
    const closing = workspace()
      .quiesceCluster(production.clusterId)
      .then((resume) => {
        paused = true;
        return resume;
      });
    await app.settle();
    const pausedBeforeOpenFinished = paused;
    await act(async () => claim());
    const result = await opening;
    const settle = await closing;
    await act(async () => settle(false));

    expect(pausedBeforeOpenFinished).toBe(false);
    expect(result).toBeNull();
  });

  it('returns the latest source groups for a cluster-view handoff', async () => {
    await start();
    const staging = app.cluster({ name: 'dev', context: 'staging', open: false });

    await workspace().flush();

    expect(workspace().groupsForCluster(production.clusterId)).toEqual([
      expect.objectContaining({ tabs: [expect.objectContaining({ panelId: panelIdOf('api') })] }),
    ]);
    expect(workspace().groupsForCluster(staging.clusterId)).toEqual([]);
  });

  it('does not read a revoked cluster while the frontend still displays its closing tab', async () => {
    await start();
    // The backend revokes the view, and its directory changes as it does.
    app.backend.answer('CloseClusterView', (windowName, clusterId) => {
      app.backend.answer('GetPanelWorkspace', () => {
        throw new Error(`window "${windowName}" does not display cluster "${clusterId}"`);
      });
      app.events.emit('panel-workspace:changed', { clusterId });
      return true;
    });

    await act(async () => {
      await view.owners().kubeconfig.closeKubeconfig(production.selection);
    });
    await app.settle();

    expect(app.backend.calls('CloseClusterView')).toHaveLength(1);
    expect(app.errors.records()).toEqual([]);
  });

  it('finishes an in-flight directory read before revoking its cluster view', async () => {
    await start();
    const read = app.backend.hold('GetPanelWorkspace');
    act(() => {
      app.events.emit('panel-workspace:changed', { clusterId: production.clusterId });
    });
    let closing!: Promise<void>;
    act(() => {
      closing = view.owners().kubeconfig.closeKubeconfig(production.selection);
    });
    await app.settle();
    const revokedBeforeRead = app.backend.calls('CloseClusterView').length;

    await act(async () => read());
    await act(async () => {
      await closing;
    });

    expect(revokedBeforeRead).toBe(0);
    expect(app.backend.calls('CloseClusterView')).toHaveLength(1);
  });

  it('does not announce the renderer until cluster hydration finishes', async () => {
    const content = document.createElement('div');
    content.className = 'content';
    document.body.appendChild(content);
    production = app.cluster({ name: 'dev', context: 'production' });
    app.namespaces(production, ['default']);
    const hydrate = app.backend.hold('GetKubeconfigs');
    view = await app.render(null);

    expect(app.backend.calls('AcknowledgePanelWorkspaceReady')).toEqual([]);
    await act(async () => hydrate());
    await app.settle();

    expect(app.backend.calls('AcknowledgePanelWorkspaceReady')).toEqual([[app.windowName]]);
  });

  it('recovers an unchanged docked snapshot when close preparation flushes again', async () => {
    let refusals = 1;
    app.backend.answer('PublishDockedPanels', (_windowName, groups) => {
      if ((groups ?? []).length > 0 && refusals > 0) {
        refusals -= 1;
        throw new Error('temporary failure');
      }
    });
    await start();
    const published = publishedGroups().length;

    await expect(workspace().flush()).resolves.toBeUndefined();

    expect(publishedGroups().slice(published)).toEqual([
      [expect.objectContaining({ clusterId: production.clusterId })],
    ]);
    expect(takeReports('publish-docked-panels')).toHaveLength(1);
  });
});

describe('retained panels', () => {
  it('restores newly retained panels after an earlier empty read, and again after a claim failure', async () => {
    await start({ open: [] });
    claimAnswers('fail', 'claim');

    await directorySays(2, [retained('api')]);
    expect(app.backend.calls('OpenPanelWorkspaceObject')).toHaveLength(1);
    expect(isOpenHere('api')).toBe(false);
    await ringDirectory();

    expect(app.backend.calls('OpenPanelWorkspaceObject')).toHaveLength(2);
    expect(isOpenHere('api')).toBe(true);
    expect(dockedIn('bottom')).toEqual([panelIdOf('api')]);
    app.errors.take((record) => (record.error as Error).message === 'claim failed');
  });

  it('mounts an accepted retained panel even if the next claim fails', async () => {
    await start({ open: [] });
    claimAnswers('claim', 'fail');

    await directorySays(2, [retained('api'), retained('second', 1)]);

    expect(isOpenHere('api')).toBe(true);
    expect(dockedIn('bottom')).toEqual([panelIdOf('api')]);
    expect(isOpenHere('second')).toBe(false);
    app.errors.take((record) => (record.error as Error).message === 'claim failed');
  });

  it('processes a retained-panel notification received while an earlier claim is pending', async () => {
    await start({ open: [] });
    const first: { release?: () => void } = {};
    claimAnswers(first, 'claim');
    let reads = 0;
    app.backend.answer('GetPanelWorkspace', () => {
      reads += 1;
      return reads === 1
        ? { revision: 2, panels: [retained('api')] }
        : { revision: 3, panels: [retained('second')] };
    });

    await ringDirectory();
    await ringDirectory();
    await act(async () => requireValue(first.release, 'first claim')());
    await app.settle();

    expect(dockedIn('bottom')).toContain(panelIdOf('second'));
  });
});

describe('moves the directory targets at this view', () => {
  // A native window docking its group into this view. The directory keeps
  // the source placement until commit and records this view as the target.
  const dockingPanel = (
    overrides: Partial<panelwindow.WorkspacePanel> = {}
  ): panelwindow.WorkspacePanel => ({
    tab: tabOf('api'),
    location: location(panelwindow.PanelLocationKind.PanelLocationWindow, 'panel-1', 'native'),
    transfer: {
      transferId: 'dock-1',
      target: location(panelwindow.PanelLocationKind.PanelLocationDocked, app.windowName, 'bottom'),
    },
    ...overrides,
  });

  // The view acknowledges a move once its provisional copy is mounted; the
  // directory's next read reflects the outcome.
  const startTarget = async () => {
    app.backend.answer('AcknowledgePanelTransfer', () => undefined);
    await start();
  };

  it('lists a dock-back group the directory targets at this view and keeps its provisional copy', async () => {
    await startTarget();

    await directorySays(2, [dockingPanel()]);

    expect(incoming).toEqual([
      {
        transferId: 'dock-1',
        clusterId: production.clusterId,
        sourceWindowName: 'panel-1',
        groupId: 'bottom',
        insertIndex: 0,
        view: false,
        tabs: [tabOf('api')],
        activePanelId: panelIdOf('api'),
      },
    ]);
    expect(isOpenHere('api')).toBe(true);
    expect(app.backend.calls('AcknowledgePanelTransfer')).toEqual([
      [app.windowName, 'dock-1', true],
    ]);
  });

  it.each([
    ['the directory cancels the move', () => [dockingPanel({ transfer: undefined })]],
    ['the native source closes with its panels', () => []],
  ])('drops the provisional copy when %s', async (_case, panels) => {
    await startTarget();
    await directorySays(2, [dockingPanel()]);

    await directorySays(3, panels());

    expect(incoming).toEqual([]);
    expect(isOpenHere('api')).toBe(false);
    expect(dockedIn('right')).not.toContain(panelIdOf('api'));
  });

  it('keeps the copy once the directory commits the dock to this view', async () => {
    await startTarget();
    await directorySays(2, [dockingPanel()]);

    await directorySays(3, [
      {
        tab: tabOf('api'),
        location: location(
          panelwindow.PanelLocationKind.PanelLocationDocked,
          app.windowName,
          'bottom'
        ),
      },
    ]);

    expect(incoming).toEqual([]);
    expect(isOpenHere('api')).toBe(true);
  });

  it('ignores an older directory read that predates the move', async () => {
    await startTarget();
    await directorySays(2, [dockingPanel()]);

    await directorySays(1, [dockingPanel({ transfer: undefined })]);

    expect(incoming).toHaveLength(1);
    expect(isOpenHere('api')).toBe(true);
  });

  it('lists each group of a cluster view move as a view move', async () => {
    app.backend.answer('AcknowledgePanelTransfer', () => undefined);
    await start({ open: ['api', 'worker'] });
    const viewPanel = (name: string, groupId: string): panelwindow.WorkspacePanel => ({
      tab: tabOf(name),
      location: location(panelwindow.PanelLocationKind.PanelLocationDocked, 'workspace-2', groupId),
      transfer: {
        transferId: 'view-1',
        view: true,
        target: location(
          panelwindow.PanelLocationKind.PanelLocationDocked,
          app.windowName,
          groupId
        ),
      },
    });

    await directorySays(2, [viewPanel('api', 'right'), viewPanel('worker', 'bottom')]);

    expect(incoming).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transferId: 'view-1',
          groupId: 'right',
          view: true,
          tabs: [tabOf('api')],
        }),
        expect.objectContaining({
          transferId: 'view-1',
          groupId: 'bottom',
          view: true,
          tabs: [tabOf('worker')],
        }),
      ])
    );
    expect(incoming).toHaveLength(2);
  });
});

describe('close intents', () => {
  it('reopens an object only after this view retries its failed close', async () => {
    await start();
    const timeline = recordCloseAndOpen(['fail', 'land']);
    await closePod('api');

    await act(async () => {
      await workspace().openPanel(tabOf('api'));
    });

    expect(timeline).toEqual([
      `close ${panelIdOf('api')}`,
      `close ${panelIdOf('api')}`,
      `open ${panelIdOf('api')}`,
    ]);
    expect(takeReports('close-panel')).toHaveLength(1);
  });

  it('refuses to reopen an object while its close cannot land', async () => {
    await start();
    const timeline = recordCloseAndOpen(['fail', 'fail', 'land']);
    await closePod('api');

    await expect(workspace().openPanel(tabOf('api'))).rejects.toThrow('ipc unavailable');
    expect(timeline.filter((entry) => entry.startsWith('open'))).toEqual([]);
    await act(async () => workspace().flush());

    expect(timeline).toEqual([
      `close ${panelIdOf('api')}`,
      `close ${panelIdOf('api')}`,
      `close ${panelIdOf('api')}`,
    ]);
    // The failure is reported once, not again for each retry.
    expect(takeReports('close-panel')).toHaveLength(1);
  });

  it("reopens an object while another object's close is still failing", async () => {
    await start({ open: ['api', 'worker'] });
    const timeline = recordCloseAndOpen(['fail', 'land']);
    await closePod('worker');

    await act(async () => {
      await workspace().openPanel(tabOf('api'));
    });

    expect(timeline).toEqual([`close ${panelIdOf('worker')}`, `open ${panelIdOf('api')}`]);
    await act(async () => workspace().flush());
    expect(last(timeline)).toBe(`close ${panelIdOf('worker')}`);
    expect(takeReports('close-panel')).toHaveLength(1);
  });

  it('reopens an object only after a close still in flight lands', async () => {
    await start();
    const timeline = recordCloseAndOpen([]);
    const land = app.backend.hold('ClosePanelWorkspaceObject');
    await closePod('api');

    const opening = workspace().openPanel(tabOf('api'));
    await app.settle();
    expect(timeline).toEqual([]);
    await act(async () => land());
    await act(async () => {
      await opening;
    });

    expect(timeline).toEqual([`close ${panelIdOf('api')}`, `open ${panelIdOf('api')}`]);
  });

  it('sends a close intent for each panel the user closes and drains it on flush', async () => {
    await start({ open: ['api', 'worker'] });
    const timeline = recordCloseAndOpen([]);
    const land = app.backend.hold('ClosePanelWorkspaceObject');
    await closePod('api');
    await closePod('worker');

    let flushed = false;
    const flushing = workspace()
      .flush()
      .then(() => {
        flushed = true;
      });
    await app.settle();
    expect(app.backend.calls('ClosePanelWorkspaceObject')).toEqual([
      [app.windowName, production.clusterId, panelIdOf('api')],
    ]);
    expect(flushed).toBe(false);
    await act(async () => land());
    await act(async () => flushing);

    expect(last(app.backend.calls('ClosePanelWorkspaceObject'))).toEqual([
      app.windowName,
      production.clusterId,
      panelIdOf('worker'),
    ]);
    expect(flushed).toBe(true);
    expect(timeline).toEqual([`close ${panelIdOf('api')}`, `close ${panelIdOf('worker')}`]);
  });
});

describe('in a native panel window', () => {
  let open: ReturnType<typeof usePanelWorkspaceOpen> | undefined;
  let objects: ReturnType<typeof useObjectPanelState> | undefined;
  function NativeProbe() {
    open = usePanelWorkspaceOpen();
    objects = useObjectPanelState();
    return null;
  }

  const startPanelWindow = async () => {
    production = app.cluster({ name: 'dev', context: 'production' });
    app.namespaces(production, ['default']);
    const api = app.object(production, {
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'api',
    });
    app.snapshots.serve('object-details', api.scopes.detailScope ?? '', {
      detailType: 'pod',
      details: { name: 'api', namespace: 'default' },
    } as never);
    // The window renders its pod panel, which reads the namespace's pods.
    app.snapshots.serve(
      'pods',
      buildRefreshScope('pods', {
        clusterId: production.clusterId,
        selector: { kind: 'namespace', namespace: 'default' },
      }),
      makePodSnapshotPayload({
        clusterId: production.clusterId,
        clusterName: production.clusterName,
      })
    );
    app.panelWindow(production, { tabs: [tabOf('api')] });
    await app.render(<NativeProbe />);
    await act(async () => {
      requireValue(objects, 'panel window objects').closePanel(
        production.clusterId,
        panelIdOf('api')
      );
    });
    await app.settle();
  };

  it('opens from a native window only after its failed close is retried', async () => {
    const timeline = recordCloseAndOpen(['fail', 'land']);
    await startPanelWindow();

    await act(async () => {
      await requireValue(open, 'native open')(tabOf('api'));
    });

    expect(last(app.backend.calls('ClosePanelWorkspaceObject'))).toEqual([
      'panel-1',
      production.clusterId,
      panelIdOf('api'),
    ]);
    expect(timeline).toEqual([
      `close ${panelIdOf('api')}`,
      `close ${panelIdOf('api')}`,
      `open ${panelIdOf('api')}`,
    ]);
    expect(takeReports('close-panel')).toHaveLength(1);
  });

  it('refuses to open from a native window while its close cannot land', async () => {
    const timeline = recordCloseAndOpen(['fail', 'fail', 'land']);
    await startPanelWindow();

    await expect(requireValue(open, 'native open')(tabOf('api'))).rejects.toThrow(
      'ipc unavailable'
    );

    expect(timeline.filter((entry) => entry.startsWith('open'))).toEqual([]);
    expect(takeReports('close-panel')).toHaveLength(1);
  });
});
