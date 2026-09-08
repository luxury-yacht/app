import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ClusterPanelsMenu } from './ClusterPanelsMenu';

const mocks = vi.hoisted(() => ({
  clusters: ['production'],
  openCluster: vi.fn(async () => undefined),
  moveCluster: vi.fn(async () => undefined),
  closeCluster: vi.fn(),
  dismiss: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterIds: mocks.clusters }),
}));
vi.mock('@/core/desktop-runtime', () => ({ getWindowIdentity: () => 'workspace-2' }));
vi.mock('@/core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));
vi.mock('@/ui/shortcuts', () => ({ useKeyboardSurface: vi.fn() }));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));
vi.mock('./index', () => ({
  requestClusterTabTransfer: mocks.moveCluster,
  openClusterWindow: mocks.openCluster,
}));
let root: ReactDOM.Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = ReactDOM.createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  mocks.clusters = ['production'];
});
const renderMenu = async () => {
  await act(async () =>
    root.render(
      <ClusterPanelsMenu
        clusterId="production"
        position={{ x: 10, y: 10 }}
        onClose={mocks.dismiss}
        onCloseCluster={mocks.closeCluster}
      />
    )
  );
};
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

it('renders the three cluster actions with icons and a separator before Close', async () => {
  await renderMenu();
  expect(menuItems().map((item) => item.textContent)).toEqual([
    'Open in new window',
    'Move to new window',
    'Close',
  ]);
  expect(menuItems().every((item) => item.querySelector('.context-menu-icon svg'))).toBe(true);
  expect(document.querySelector('.context-menu-header')).toBeNull();
  expect(document.querySelectorAll('.context-menu-divider')).toHaveLength(1);
  const items = menuItems();
  expect(
    items[items.length - 1]?.previousElementSibling?.classList.contains('context-menu-divider')
  ).toBe(true);
});

it('closes the requested cluster through its supplied close action and dismisses the menu', async () => {
  await renderMenu();
  const close = menuItems().find((item) => item.textContent === 'Close');
  expect(close).toBeDefined();
  await act(async () => close?.click());
  expect(mocks.closeCluster).toHaveBeenCalledOnce();
  expect(mocks.dismiss).toHaveBeenCalledOnce();
  expect(mocks.moveCluster).not.toHaveBeenCalled();
  expect(mocks.openCluster).not.toHaveBeenCalled();
});

it.each([
  { clusters: ['production'], disabled: false },
  { clusters: ['production', 'staging'], disabled: false },
  { clusters: ['staging', 'development'], disabled: true },
])('opens another view without a transfer for $clusters', async ({ clusters, disabled }) => {
  mocks.clusters = clusters;
  await renderMenu();
  const open = menuItems().find((item) => item.textContent === 'Open in new window');
  expect(open).toBeDefined();
  expect(open?.getAttribute('aria-disabled')).toBe(String(disabled));
  await act(async () => open?.click());
  if (disabled) {
    expect(mocks.openCluster).not.toHaveBeenCalled();
  } else {
    expect(mocks.openCluster).toHaveBeenCalledExactlyOnceWith('workspace-2', 'production');
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  }
  expect(mocks.moveCluster).not.toHaveBeenCalled();
  expect(mocks.closeCluster).not.toHaveBeenCalled();
});

it.each([
  { clusters: ['production'], disabled: false },
  { clusters: ['production', 'staging'], disabled: false },
  { clusters: ['staging', 'development'], disabled: true },
])(
  'moves through the existing transfer lifecycle for $clusters',
  async ({ clusters, disabled }) => {
    mocks.clusters = clusters;
    await renderMenu();
    const open = menuItems().find((item) => item.textContent === 'Move to new window');
    expect(open).toBeDefined();
    expect(open?.getAttribute('aria-disabled')).toBe(String(disabled));
    await act(async () => open?.click());
    if (disabled) {
      expect(mocks.moveCluster).not.toHaveBeenCalled();
    } else {
      expect(mocks.moveCluster).toHaveBeenCalledWith(
        'workspace-2',
        expect.objectContaining({
          clusterId: 'production',
          sourceWindowName: 'workspace-2',
          targetWindowName: '',
        })
      );
    }
  }
);

it.each([
  { label: 'Open in new window', command: mocks.openCluster, action: 'open-cluster-window' },
  { label: 'Move to new window', command: mocks.moveCluster, action: 'move-cluster-window' },
])('reports a failed $label without closing the source', async ({ label, command, action }) => {
  const error = new Error('native window unavailable');
  command.mockRejectedValueOnce(error);
  await renderMenu();
  await act(async () =>
    menuItems()
      .find((item) => item.textContent === label)
      ?.click()
  );
  expect(mocks.report).toHaveBeenCalledWith(error, {
    source: 'ClusterPanelsMenu',
    action,
    clusterId: 'production',
  });
  expect(mocks.closeCluster).not.toHaveBeenCalled();
});
