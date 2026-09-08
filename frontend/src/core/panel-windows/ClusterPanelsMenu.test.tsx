import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ClusterPanelsMenu } from './ClusterPanelsMenu';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  open: vi.fn(),
  move: vi.fn(async () => undefined),
  clusters: ['production'],
  moveCluster: vi.fn(async () => undefined),
  items: [] as { label?: string; disabled?: boolean; onClick?: () => void }[],
}));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterIds: mocks.clusters }),
}));
vi.mock('./WorkspacePanelSync', () => ({
  usePanelWorkspaceSync: () => ({ readCluster: mocks.read }),
}));
vi.mock('@/core/desktop-runtime', () => ({ getWindowIdentity: () => 'workspace-2' }));
vi.mock('@/modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.open }),
}));
vi.mock('@/shared/components/ContextMenu', () => ({
  default: ({ items }: { items: typeof mocks.items }) => {
    mocks.items = items;
    return null;
  },
}));
vi.mock('./index', () => ({
  requestClusterTabTransfer: mocks.moveCluster,
  requestPanelTabTransfer: mocks.move,
  onPanelWorkspaceChanged: () => () => undefined,
}));
let root: ReactDOM.Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.clearAllMocks();
  mocks.clusters = ['production'];
});
it('shows shared panels and requests a guarded move from the actual renderer', async () => {
  const tab = {
    panelId: 'api',
    kind: 'object',
    activeView: 'yaml',
    objectRef: {
      clusterId: 'production',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'api',
    },
  };
  mocks.read.mockResolvedValue({
    revision: 1,
    panels: [
      {
        tab,
        location: {
          kind: 'panel-window',
          windowName: 'panel-3',
          groupId: 'group-a',
          index: 0,
          active: true,
        },
      },
    ],
  });
  root = ReactDOM.createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <ClusterPanelsMenu
        clusterId="production"
        clusterName="Production"
        position={{ x: 10, y: 10 }}
        onClose={() => undefined}
      />
    )
  );
  expect(mocks.items.some((item) => item.label?.includes('Pod default/api'))).toBe(true);
  mocks.items.find((item) => item.label?.startsWith('Show'))?.onClick?.();
  expect(mocks.open).toHaveBeenCalledWith(tab.objectRef);
  await act(async () => mocks.items.find((item) => item.label === 'Move here')?.onClick?.());
  expect(mocks.move).toHaveBeenCalledWith(
    'workspace-2',
    expect.objectContaining({
      sourceWindowName: 'panel-3',
      targetWindowName: 'workspace-2',
      clusterId: 'production',
      sourceGroupId: 'group-a',
      targetGroupId: 'right',
      tab,
    })
  );
});

it.each([
  { clusters: ['production'], disabled: false },
  { clusters: ['production', 'staging'], disabled: false },
  { clusters: ['staging', 'development'], disabled: true },
])('gates the new-window menu action for $clusters', async ({ clusters, disabled }) => {
  mocks.clusters = clusters;
  mocks.read.mockResolvedValue({ revision: 1, panels: [] });
  root = ReactDOM.createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <ClusterPanelsMenu
        clusterId="production"
        clusterName="Production"
        position={{ x: 10, y: 10 }}
        onClose={() => undefined}
      />
    )
  );
  const move = mocks.items.find((item) => item.label === 'Move cluster to new window');
  expect(move).toBeDefined();
  expect(Boolean(move?.disabled)).toBe(disabled);
  if (!disabled) {
    await act(async () => move?.onClick?.());
    expect(mocks.moveCluster).toHaveBeenCalledWith(
      'workspace-2',
      expect.objectContaining({
        clusterId: 'production',
        sourceWindowName: 'workspace-2',
        targetWindowName: '',
      })
    );
  }
});
