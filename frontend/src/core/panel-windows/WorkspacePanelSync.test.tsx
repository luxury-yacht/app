import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PanelLifecycleGuardProvider } from './panelLifecycleGuards';
import { WorkspacePanelLifecycle } from './WorkspacePanelLifecycle';
import { usePanelWorkspaceSync, WorkspacePanelSync } from './WorkspacePanelSync';

const mocks = vi.hoisted(() => ({
  selected: ['production'],
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
  report: vi.fn(),
  close: vi.fn(),
  preflight: null as null | ((clusterId: string) => Promise<unknown>),
}));
vi.mock('@/core/app-state-access', () => ({ readPanelWorkspace: mocks.read }));
vi.mock('@/core/desktop-runtime', () => ({ getWindowIdentity: () => 'app-a' }));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterIds: mocks.selected,
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
    upsertOwnedPanel: mocks.upsert,
    panelIdsForCluster: () => ['api'],
    getOwnedPanel: () => ({ nativeLocation: null }),
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
function Probe() {
  sync = usePanelWorkspaceSync();
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
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

it.each([true, false])(
  'pauses full-window publication until close settles (accepted: %s)',
  async (accepted) => {
    let settle: (closed: boolean) => void = () => undefined;
    await act(async () => {
      settle = await sync.quiesceCluster('production');
    });
    mocks.publish.mockClear();
    mocks.read.mockClear();
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
      expect(mocks.publish).toHaveBeenLastCalledWith('app-a', []);
    } else {
      expect(mocks.publish).toHaveBeenLastCalledWith('app-a', [
        expect.objectContaining({ clusterId: 'production' }),
      ]);
      expect(mocks.read).toHaveBeenCalledWith('app-a', 'production');
    }
  }
);

it('resumes synchronization after a failed publication prevents cluster closure', async () => {
  mocks.publish.mockRejectedValueOnce(new Error('publication failed'));
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

it('preserves a provisional target while the directory still points to its source', async () => {
  sync.stage('move-1', [
    {
      clusterId: 'production',
      groupId: 'right',
      tabs: mocks.local.production,
      activePanelId: 'api',
    },
  ] as never);
  mocks.read.mockResolvedValue({
    revision: 2,
    panels: [
      {
        tab: mocks.local.production[0],
        location: { kind: 'docked', windowName: 'app-b', groupId: 'right' },
      },
    ],
  });
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.remove).not.toHaveBeenCalled();
  sync.settle('move-1');
  await act(async () => mocks.changed?.({ clusterId: 'production' }));
  expect(mocks.remove).toHaveBeenCalledWith('production', 'api');
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
    await mocks.preflight?.('production');
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
    closing = mocks.preflight?.('production');
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
