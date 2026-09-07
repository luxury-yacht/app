import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ClusterPanelsMenu } from './ClusterPanelsMenu';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  open: vi.fn(),
  move: vi.fn(async () => undefined),
  items: [] as { label?: string; onClick?: () => void }[],
}));
vi.mock('@/core/app-state-access', () => ({ readPanelWorkspace: mocks.read }));
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
  requestClusterTabTransfer: vi.fn(),
  requestPanelTabTransfer: mocks.move,
  onPanelWorkspaceChanged: () => () => undefined,
}));
let root: ReactDOM.Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  vi.clearAllMocks();
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
