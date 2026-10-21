import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clusterWorkspaceStore } from '@/core/cluster-workspace/clusterWorkspaceStore';
import type { ClusterClosePreflight } from '@/modules/kubernetes/config/KubeconfigContext';
import { PanelLifecycleGuardProvider } from './panelLifecycleGuards';
import { nativePanelPublication } from './publicationQueue';
import { useClosedPanelIntents } from './useClosedPanelIntents';
import { WorkspacePanelLifecycle } from './WorkspacePanelLifecycle';
import {
  useIncomingGroupTransfers,
  usePanelWorkspaceOpen,
  usePanelWorkspaceSync,
  WorkspacePanelSync,
} from './WorkspacePanelSync';

const mocks = vi.hoisted(() => ({
  selected: ['production'],
  visible: null as string[] | null,
  loading: false,
  local: {
    production: [
      {
        kind: 'object',
        panelId: 'api',
        activeView: 'yaml',
        objectRef: {
          clusterId: 'production',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'default',
          name: 'api',
        },
      },
    ],
  },
  layout: {
    right: { tabs: ['api'], activeTab: 'api' },
    bottom: { tabs: [], activeTab: null },
    floating: [],
  },
  read: vi.fn(),
  publish: vi.fn(async () => undefined),
  ready: vi.fn(async () => undefined),
  changed: null as null | ((event: { clusterId: string }) => void),
  remove: vi.fn(),
  detach: vi.fn(),
  discard: vi.fn(),
  upsert: vi.fn(),
  dock: vi.fn(),
  open: vi.fn(),
  closeIntent: vi.fn(async (..._args: unknown[]) => undefined),
  closedListener: null as null | ((clusterId: string, panelIds: string[]) => void),
  report: vi.fn(),
  close: vi.fn(),
  preflight: null as ClusterClosePreflight | null,
}));
vi.mock('@/core/app-state-access', () => ({ readPanelWorkspace: mocks.read }));
vi.mock('@/core/backend-api', () => ({
  GetClusterWorkspaceStateForWindow: async () => ({
    selectedKubeconfigs: ['production'],
    visibleClusterId: 'production',
    clusters: {},
  }),
}));
vi.mock('@/core/desktop-runtime', () => ({
  getWindowIdentity: () => 'app-a',
  onEvent: () => () => undefined,
}));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterIds: mocks.visible ?? mocks.selected,
    managedClusterIds: mocks.selected,
    getClusterMeta: (selection: string) => ({ id: selection, name: selection }),
    kubeconfigsLoading: mocks.loading,
    registerClusterClosePreflight: (handler: typeof mocks.preflight) => {
      mocks.preflight = handler;
      return () => undefined;
    },
  }),
}));
vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useLocalPanelSnapshots: () => mocks.local,
  useObjectPanelState: () => ({
    removeOwnedPanel: mocks.remove,
    restorePanelTabs: mocks.upsert,
    panelIdsForCluster: () => ['api'],
    getOwnedPanel: () => ({ nativeLocation: null }),
    subscribeClosedPanels: (listener: typeof mocks.closedListener) => {
      mocks.closedListener = listener;
      return () => {
        mocks.closedListener = null;
      };
    },
  }),
}));
vi.mock('@/ui/dockable', () => ({
  useDockablePanelContext: () => ({
    getClusterTabGroups: () => mocks.layout,
    tabGroups: mocks.layout,
    dockPanelGroup: mocks.dock,
    detachPanelGroup: mocks.detach,
    discardPanelLayouts: mocks.discard,
    focusPanel: vi.fn(),
  }),
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));
vi.mock('./index', () => ({
  acknowledgePanelWorkspaceReady: mocks.ready,
  openPanelWorkspaceObject: mocks.open,
  closePanelWorkspaceObject: mocks.closeIntent,
  publishDockedPanels: mocks.publish,
  closeClusterView: mocks.close,
  onWorkspaceCloseRequested: () => () => undefined,
  onApplicationQuitPreflightRequested: () => () => undefined,
  onApplicationQuitPreflightSettled: () => () => undefined,
  onPanelWorkspaceChanged: (handler: typeof mocks.changed) => {
    mocks.changed = handler;
    return () => {
      mocks.changed = null;
    };
  },
}));
let root: ReactDOM.Root;
let container: HTMLDivElement;
let sync: ReturnType<typeof usePanelWorkspaceSync>;
let incoming: ReturnType<typeof useIncomingGroupTransfers>;
let releaseWorkspace: () => void;
function Probe() {
  sync = usePanelWorkspaceSync();
  incoming = useIncomingGroupTransfers();
  return null;
}
beforeEach(async () => {
  clusterWorkspaceStore.resetForTests();
  mocks.visible = null;
  vi.clearAllMocks();
  releaseWorkspace = clusterWorkspaceStore.acquire();
  await clusterWorkspaceStore.hydrate();
  mocks.selected = ['production'];
  mocks.read.mockResolvedValue({ revision: 1, panels: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
  await act(async () =>
    root.render(
      <WorkspacePanelSync>
        <Probe />
      </WorkspacePanelSync>
    )
  );
});

it('waits for confirmed tab membership before panel reads, opens, and publication, then resumes on admission', async () => {
  await act(
    async () =>
      await clusterWorkspaceStore.reconcileCommand(
        async () => ({
          state: {
            selectedKubeconfigs: [],
            visibleClusterId: '',
            clusters: {},
          },
        }),
        () => true
      )
  );
  mocks.read.mockClear();
  mocks.open.mockClear();
  mocks.publish.mockClear();
  await act(async () => {
    root.render(
      <WorkspacePanelSync key="pending-admission">
        <Probe />
      </WorkspacePanelSync>
    );
  });
  expect(await sync.readCluster('production')).toBeNull();
  expect(await sync.openPanel(mocks.local.production[0] as never)).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  await act(
    async () =>
      await clusterWorkspaceStore.reconcileCommand(
        async () => ({
          state: {
            selectedKubeconfigs: ['production'],
            visibleClusterId: 'production',
            clusters: {},
          },
        }),
        () => true
      )
  );
  expect(mocks.read).toHaveBeenCalledWith('app-a', 'production');
  expect(mocks.publish).toHaveBeenCalledWith('app-a', [
    expect.objectContaining({ clusterId: 'production' }),
  ]);
  await sync.openPanel(mocks.local.production[0] as never);
  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.report).not.toHaveBeenCalled();
});

it.each([true, false])(
  'leaves a closing cluster out of publications until its close settles (accepted: %s)',
  async (accepted) => {
    let settle: (closed: boolean) => void = () => undefined;
    await act(async () => {
      settle = await sync.quiesceCluster('production');
    });
    // Publications only arrange, so leaving the cluster out closes nothing.
    expect(mocks.publish).toHaveBeenLastCalledWith('app-a', []);
    mocks.publish.mockClear();
    mocks.read.mockClear();
    mocks.visible = [];
    await act(async () =>
      root.render(
        <WorkspacePanelSync>
          <Probe />
        </WorkspacePanelSync>
      )
    );
    await act(async () => mocks.changed?.({ clusterId: 'production' }));
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    if (!accepted) {
      mocks.visible = null;
    }
    await act(async () => settle(accepted));
    if (accepted) {
      expect(mocks.publish).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      mocks.selected = [];
      await act(async () =>
        root.render(
          <WorkspacePanelSync>
            <Probe />
          </WorkspacePanelSync>
        )
      );
      expect(mocks.publish).not.toHaveBeenCalled();
    } else {
      expect(mocks.publish).toHaveBeenLastCalledWith('app-a', [
        expect.objectContaining({ clusterId: 'production' }),
      ]);
      expect(mocks.read).toHaveBeenCalledWith('app-a', 'production');
    }
  }
);

it('resumes synchronization after a failed publication prevents cluster closure', async () => {
  // The initial snapshot, the one without the closing cluster, and its retry.
  mocks.publish
    .mockRejectedValueOnce(new Error('publication failed'))
    .mockRejectedValueOnce(new Error('publication failed'))
    .mockRejectedValueOnce(new Error('publication failed'));
  await act(async () =>
    root.render(
      <WorkspacePanelSync key="failure">
        <Probe />
      </WorkspacePanelSync>
    )
  );
  await act(async () => {
    await expect(sync.quiesceCluster('production')).rejects.toThrow('publication failed');
  });
  await act(async () => undefined);
  expect(await sync.readCluster('production')).toEqual({ revision: 1, panels: [] });
  await expect(sync.flush()).resolves.toBeUndefined();
});

it('rejects stale menu reads and object opens after the cluster selection commits', async () => {
  mocks.selected = [];
  await act(async () =>
    root.render(
      <WorkspacePanelSync>
        <Probe />
      </WorkspacePanelSync>
    )
  );
  mocks.read.mockClear();
  mocks.open.mockClear();
  expect(await sync.readCluster('production')).toBeNull();
  expect(await sync.openPanel(mocks.local.production[0] as never)).toBeNull();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});
afterEach(async () => {
  await act(async () => root.unmount());
  releaseWorkspace();
  container.remove();
});

it('publishes local groups and removes a stale source after a directory change', async () => {
  expect(mocks.publish).toHaveBeenCalledWith('app-a', [
    expect.objectContaining({
      clusterId: 'production',
      tabs: mocks.local.production,
      activePanelId: 'api',
    }),
  ]);
  mocks.read.mockResolvedValue({
    revision: 2,
    panels: [
      {
        tab: mocks.local.production[0],
        location: { kind: 'panel-window', windowName: 'panel-1', groupId: 'floating' },
      },
    ],
  });
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.remove).toHaveBeenCalledWith('production', 'api');
  expect(mocks.detach).toHaveBeenCalledWith('production', ['api']);
});

it('drains an object open and prevents its late result from remounting a closing cluster', async () => {
  let finish: (value: unknown) => void = () => undefined;
  mocks.open.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const opening = sync.openPanel(mocks.local.production[0] as never);
  let paused = false;
  const closing = sync.quiesceCluster('production').then((resume) => {
    paused = true;
    return resume;
  });
  await act(async () => undefined);
  const pausedBeforeOpenFinished = paused;
  finish({ render: true, panel: { tab: mocks.local.production[0] } });
  const result = await opening;
  const settle = await closing;
  await act(async () => settle(false));
  expect(pausedBeforeOpenFinished).toBe(false);
  expect(result).toBeNull();
});

it('returns the latest source groups for a cluster-view handoff', async () => {
  await sync.flush();
  expect(sync.groupsForCluster('production')).toEqual([
    expect.objectContaining({ tabs: mocks.local.production }),
  ]);
  expect(sync.groupsForCluster('staging')).toEqual([]);
});

it('does not read a revoked cluster while the frontend still displays its closing tab', async () => {
  await act(async () =>
    root.render(
      <PanelLifecycleGuardProvider>
        <WorkspacePanelSync>
          <WorkspacePanelLifecycle />
          <Probe />
        </WorkspacePanelSync>
      </PanelLifecycleGuardProvider>
    )
  );
  mocks.report.mockClear();
  mocks.close.mockImplementationOnce(async () => {
    mocks.read.mockRejectedValue(new Error('window "app-a" does not display cluster "production"'));
    mocks.changed?.({ clusterId: 'production' });
    return true;
  });
  await act(async () => {
    await mocks.preflight?.('production', Promise.resolve());
  });
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.report).not.toHaveBeenCalled();
});

it('finishes an in-flight directory read before revoking its cluster view', async () => {
  await act(async () =>
    root.render(
      <PanelLifecycleGuardProvider>
        <WorkspacePanelSync>
          <WorkspacePanelLifecycle />
          <Probe />
        </WorkspacePanelSync>
      </PanelLifecycleGuardProvider>
    )
  );
  let resolveRead: (value: unknown) => void = () => undefined;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      })
  );
  act(() => mocks.changed?.({ clusterId: 'production' }));
  let closing: Promise<unknown> | undefined;
  await act(async () => {
    closing = mocks.preflight?.('production', Promise.resolve());
  });
  const calledBeforeRead = mocks.close.mock.calls.length;
  await act(async () => {
    resolveRead({ revision: 2, panels: [] });
    await closing;
  });
  expect(calledBeforeRead).toBe(0);
});

it('does not announce the renderer until cluster hydration finishes', async () => {
  mocks.ready.mockClear();
  mocks.loading = true;
  await act(async () =>
    root.render(
      <WorkspacePanelSync key="loading">
        <Probe />
      </WorkspacePanelSync>
    )
  );
  expect(mocks.ready).not.toHaveBeenCalled();
  mocks.loading = false;
  await act(async () =>
    root.render(
      <WorkspacePanelSync key="loading">
        <Probe />
      </WorkspacePanelSync>
    )
  );
  expect(mocks.ready).toHaveBeenCalledWith('app-a');
});

it('recovers an unchanged docked snapshot when close preparation flushes again', async () => {
  mocks.publish.mockRejectedValueOnce(new Error('temporary failure'));
  await act(async () =>
    root.render(
      <WorkspacePanelSync key="retry">
        <Probe />
      </WorkspacePanelSync>
    )
  );
  mocks.publish.mockClear();
  await expect(sync.flush()).resolves.toBeUndefined();
  expect(mocks.publish).toHaveBeenCalledWith('app-a', [
    expect.objectContaining({ clusterId: 'production' }),
  ]);
});

it('restores newly retained panels after an earlier empty read, and again after a claim failure', async () => {
  const tab = mocks.local.production[0];
  const retained = {
    tab,
    location: { kind: 'retained', windowName: '', groupId: 'bottom', index: 0, active: true },
  };
  mocks.read.mockResolvedValue({ revision: 2, panels: [retained] });
  mocks.open.mockRejectedValueOnce(new Error('temporary claim failure'));
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.open).toHaveBeenCalledOnce();
  mocks.open.mockResolvedValue({ render: true, panel: retained });
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(mocks.dock).toHaveBeenCalledWith('production', ['api'], 'api', 'bottom', undefined);
});

it('mounts an accepted retained panel even if the next claim fails', async () => {
  const first = {
    tab: mocks.local.production[0],
    location: { kind: 'retained', groupId: 'bottom', index: 0 },
  };
  const second = {
    ...first,
    tab: { ...first.tab, panelId: 'second' },
    location: { ...first.location, index: 1 },
  };
  mocks.read.mockResolvedValue({ revision: 2, panels: [first, second] });
  mocks.open
    .mockResolvedValueOnce({ render: true, panel: first })
    .mockRejectedValueOnce(new Error('claim failed'));
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.dock).toHaveBeenCalledWith('production', ['api'], 'api', 'bottom', undefined);
});

it('processes a retained-panel notification received while an earlier claim is pending', async () => {
  const first = {
    tab: mocks.local.production[0],
    location: { kind: 'retained', groupId: 'bottom', index: 0 },
  };
  const second = { ...first, tab: { ...first.tab, panelId: 'second' } };
  let finish: (value: unknown) => void = () => undefined;
  mocks.read
    .mockResolvedValueOnce({ revision: 2, panels: [first] })
    .mockResolvedValue({ revision: 3, panels: [second] });
  mocks.open
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue({ render: true, panel: second });
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  await act(async () => finish({ render: true, panel: first }));
  expect(mocks.dock).toHaveBeenCalledWith('production', ['second'], 'second', 'bottom', undefined);
});

// A native window docking its group into this app view ('app-a'). The directory
// keeps the source placement until commit and records this view as the target.
const dockingPanel = (overrides: Record<string, unknown> = {}) => ({
  tab: mocks.local.production[0],
  location: {
    kind: 'panel-window',
    windowName: 'panel-1',
    groupId: 'native',
    index: 0,
    active: true,
  },
  transfer: {
    transferId: 'dock-1',
    target: { kind: 'docked', windowName: 'app-a', groupId: 'bottom', index: 0, active: true },
  },
  ...overrides,
});

async function readDirectory(revision: number, panels: unknown[]) {
  mocks.read.mockResolvedValue({ revision, panels });
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
}

it('lists a dock-back group the directory targets at this view and keeps its provisional copy', async () => {
  await readDirectory(2, [dockingPanel()]);
  expect(incoming).toEqual([
    {
      transferId: 'dock-1',
      clusterId: 'production',
      sourceWindowName: 'panel-1',
      groupId: 'bottom',
      insertIndex: 0,
      view: false,
      tabs: [mocks.local.production[0]],
      activePanelId: 'api',
    },
  ]);
  expect(mocks.detach).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it.each([
  ['the directory cancels the move', [dockingPanel({ transfer: undefined })]],
  ['the native source closes with its panels', []],
])('drops the provisional copy when %s', async (_case, panels) => {
  await readDirectory(2, [dockingPanel()]);
  await readDirectory(3, panels);
  expect(incoming).toEqual([]);
  expect(mocks.detach).toHaveBeenCalledWith('production', ['api']);
  expect(mocks.remove).toHaveBeenCalledWith('production', 'api');
});

it('keeps the copy once the directory commits the dock to this view', async () => {
  await readDirectory(2, [dockingPanel()]);
  await readDirectory(3, [
    {
      tab: mocks.local.production[0],
      location: { kind: 'docked', windowName: 'app-a', groupId: 'bottom', index: 0, active: true },
    },
  ]);
  expect(incoming).toEqual([]);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('ignores an older directory read that predates the move', async () => {
  await readDirectory(2, [dockingPanel()]);
  await readDirectory(1, [dockingPanel({ transfer: undefined })]);
  expect(incoming).toHaveLength(1);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('lists each group of a cluster view move as a view move', async () => {
  const [api] = mocks.local.production;
  const worker = { ...api, panelId: 'worker', objectRef: { ...api.objectRef, name: 'worker' } };
  const viewPanel = (tab: typeof api, groupId: string) => ({
    tab,
    location: { kind: 'docked', windowName: 'app-b', groupId, index: 0, active: true },
    transfer: {
      transferId: 'view-1',
      view: true,
      target: { kind: 'docked', windowName: 'app-a', groupId, index: 0, active: true },
    },
  });
  await readDirectory(2, [viewPanel(api, 'right'), viewPanel(worker, 'bottom')]);
  expect(incoming).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ transferId: 'view-1', groupId: 'right', view: true, tabs: [api] }),
      expect.objectContaining({
        transferId: 'view-1',
        groupId: 'bottom',
        view: true,
        tabs: [worker],
      }),
    ])
  );
  expect(incoming).toHaveLength(2);
});

it('reopens an object only after this view retries its failed close', async () => {
  const tab = mocks.local.production[0] as never;
  mocks.closeIntent.mockRejectedValueOnce(new Error('ipc unavailable'));
  act(() => mocks.closedListener?.('production', ['api']));
  await act(async () => undefined);
  mocks.open.mockResolvedValueOnce({ render: true });

  await act(async () => {
    await sync.openPanel(tab);
  });

  expect(mocks.closeIntent).toHaveBeenCalledTimes(2);
  expect(mocks.closeIntent.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.open.mock.invocationCallOrder[0] ?? 0
  );
});

it('refuses to reopen an object while its close cannot land', async () => {
  const offline = new Error('ipc unavailable');
  mocks.closeIntent.mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);
  act(() => mocks.closedListener?.('production', ['api']));
  await act(async () => undefined);

  await expect(sync.openPanel(mocks.local.production[0] as never)).rejects.toBe(offline);
  expect(mocks.open).not.toHaveBeenCalled();
  await act(async () => sync.flush());
  expect(mocks.closeIntent).toHaveBeenCalledTimes(3);
});

it("reopens an object while another object's close is still failing", async () => {
  mocks.closeIntent.mockRejectedValueOnce(new Error('ipc unavailable'));
  act(() => mocks.closedListener?.('production', ['worker']));
  await act(async () => undefined);
  mocks.open.mockResolvedValueOnce({ render: true });

  await act(async () => {
    await sync.openPanel(mocks.local.production[0] as never);
  });

  expect(mocks.open).toHaveBeenCalledOnce();
  expect(mocks.closeIntent).toHaveBeenCalledOnce();
  await act(async () => sync.flush());
  expect(mocks.closeIntent).toHaveBeenCalledTimes(2);
});

it('reopens an object only after a close still in flight lands', async () => {
  let release: () => void = () => undefined;
  mocks.closeIntent.mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        release = () => resolve(undefined);
      })
  );
  act(() => mocks.closedListener?.('production', ['api']));
  mocks.open.mockResolvedValueOnce({ render: true });

  const opening = sync.openPanel(mocks.local.production[0] as never);
  await act(async () => undefined);
  expect(mocks.open).not.toHaveBeenCalled();
  release();
  await act(async () => {
    await opening;
  });
  expect(mocks.open).toHaveBeenCalledOnce();
});

it('opens from a native window only after its failed close is retried', async () => {
  const nativeContainer = document.createElement('div');
  const nativeRoot = ReactDOM.createRoot(nativeContainer);
  let open: ReturnType<typeof usePanelWorkspaceOpen> | undefined;
  function NativeProbe() {
    useClosedPanelIntents(nativePanelPublication, 'panel-1');
    open = usePanelWorkspaceOpen();
    return null;
  }
  await act(async () => nativeRoot.render(<NativeProbe />));
  mocks.closeIntent.mockRejectedValueOnce(new Error('ipc unavailable'));
  act(() => mocks.closedListener?.('production', ['api']));
  await act(async () => undefined);
  mocks.open.mockResolvedValueOnce({ render: true });

  await act(async () => {
    await open?.(mocks.local.production[0] as never);
  });

  expect(mocks.closeIntent).toHaveBeenCalledTimes(2);
  expect(mocks.closeIntent).toHaveBeenLastCalledWith('panel-1', 'production', 'api');
  expect(mocks.closeIntent.mock.invocationCallOrder[1]).toBeLessThan(
    mocks.open.mock.invocationCallOrder[0] ?? 0
  );
  await act(async () => nativeRoot.unmount());
});

it('refuses to open from a native window while its close cannot land', async () => {
  const nativeRoot = ReactDOM.createRoot(document.createElement('div'));
  let open: ReturnType<typeof usePanelWorkspaceOpen> | undefined;
  function NativeProbe() {
    useClosedPanelIntents(nativePanelPublication, 'panel-1');
    open = usePanelWorkspaceOpen();
    return null;
  }
  await act(async () => nativeRoot.render(<NativeProbe />));
  const offline = new Error('ipc unavailable');
  mocks.closeIntent.mockRejectedValueOnce(offline).mockRejectedValueOnce(offline);
  act(() => mocks.closedListener?.('production', ['api']));
  await act(async () => undefined);

  await expect(open?.(mocks.local.production[0] as never)).rejects.toBe(offline);
  expect(mocks.open).not.toHaveBeenCalled();
  await act(async () => nativePanelPublication.flush());
  await act(async () => nativeRoot.unmount());
});

it('sends a close intent for each panel the user closes and drains it on flush', async () => {
  let release: () => void = () => undefined;
  mocks.closeIntent.mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        release = () => resolve(undefined);
      })
  );
  act(() => mocks.closedListener?.('production', ['api', 'worker']));
  let flushed = false;
  const flushing = sync.flush().then(() => {
    flushed = true;
  });
  await act(async () => undefined);
  expect(mocks.closeIntent).toHaveBeenCalledWith('app-a', 'production', 'api');
  expect(flushed).toBe(false);
  release();
  await act(async () => flushing);
  expect(mocks.closeIntent).toHaveBeenLastCalledWith('app-a', 'production', 'worker');
  expect(flushed).toBe(true);
});
