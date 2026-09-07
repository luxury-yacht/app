import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
}));
vi.mock('@/core/app-state-access', () => ({ readPanelWorkspace: mocks.read }));
vi.mock('@/core/desktop-runtime', () => ({ getWindowIdentity: () => 'app-a' }));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterIds: mocks.selected, kubeconfigsLoading: mocks.loading }),
}));
vi.mock('@/modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  useLocalPanelSnapshots: () => mocks.local,
  useObjectPanelState: () => ({ removeOwnedPanel: mocks.remove, upsertOwnedPanel: mocks.upsert }),
}));
vi.mock('@/ui/dockable', () => ({
  useDockablePanelContext: () => ({
    getClusterTabGroups: () => mocks.layout,
    tabGroups: mocks.layout,
    dockPanelGroup: mocks.dock,
    detachPanelGroup: mocks.detach,
    discardPanelLayouts: mocks.discard,
  }),
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));
vi.mock('./index', () => ({
  acknowledgePanelWorkspaceReady: mocks.ready,
  openPanelWorkspaceObject: mocks.open,
  publishDockedPanels: mocks.publish,
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
