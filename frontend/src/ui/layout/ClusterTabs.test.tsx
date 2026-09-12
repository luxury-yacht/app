/**
 * frontend/src/ui/layout/ClusterTabs.test.tsx
 *
 * Test suite for ClusterTabs.
 * Covers tab rendering, ordering, and close/select behaviors.
 */

import {
  resetClusterTabOrderCacheForTesting,
  setClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import ClusterTabs, { toClusterInsertIndex } from '@ui/layout/ClusterTabs';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import { installWindowProperty } from '@/test-utils/windowProperty';

vi.mock('@/core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));
vi.mock('@/ui/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useKeyboardSurface: vi.fn(),
}));

const clusterTransferBridge = vi.hoisted(() => ({
  request: vi.fn(async (..._args: unknown[]) => undefined),
  open: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('@/core/panel-windows', () => ({
  requestClusterTabTransfer: clusterTransferBridge.request,
  openClusterWindow: clusterTransferBridge.open,
}));

const persistenceBridge = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
  set: vi.fn<(order: string[]) => Promise<void>>().mockResolvedValue(undefined),
}));

const installClusterTabPersistence = (
  get: () => Promise<string[]>,
  set: (order: string[]) => Promise<void>
) => {
  const previousGet = persistenceBridge.get;
  const previousSet = persistenceBridge.set;
  persistenceBridge.get = vi.fn(get);
  persistenceBridge.set = vi.fn(set);
  return () => {
    persistenceBridge.get = previousGet;
    persistenceBridge.set = previousSet;
  };
};

vi.mock('@core/backend-api', () => ({
  GetClusterTabOrder: () => persistenceBridge.get(),
  SetClusterTabOrder: (order: string[]) => persistenceBridge.set(order),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  getWindowIdentity: () => 'app-a',
  onEvent: () => () => undefined,
}));

type MockState = {
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  kubeconfigsLoading: boolean;
  setSelectedKubeconfigs: (next: string[]) => Promise<void>;
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
  setActiveKubeconfig: ReturnType<typeof vi.fn<(config: string) => void>>;
  getClusterMeta: (config: string) => { id: string; name: string };
  loadKubeconfigs: () => Promise<void>;
};

const mockState: MockState = {
  selectedKubeconfigs: [],
  selectedKubeconfig: '',
  kubeconfigsLoading: false,
  setSelectedKubeconfigs: vi.fn().mockResolvedValue(undefined),
  closeKubeconfig: vi.fn().mockResolvedValue(undefined),
  setActiveKubeconfig: vi.fn(),
  getClusterMeta: (config: string) => ({ id: config, name: config }),
  loadKubeconfigs: vi.fn().mockResolvedValue(undefined),
};

const viewState = {
  viewType: 'overview',
  navigateToGlobal: vi.fn(),
  activateClusterWorkspace: vi.fn(),
};

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    ...mockState,
    selectedClusterIds: mockState.selectedKubeconfigs.map(
      (selection) => mockState.getClusterMeta(selection).id
    ),
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => viewState,
}));

describe('ClusterTabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resetClusterTabOrderCacheForTesting();
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    mockState.kubeconfigsLoading = false;
    mockState.setSelectedKubeconfigs = vi.fn().mockResolvedValue(undefined);
    mockState.closeKubeconfig = vi.fn().mockResolvedValue(undefined);
    mockState.setActiveKubeconfig = vi.fn();
    mockState.getClusterMeta = (config: string) => ({ id: config, name: config });
    mockState.loadKubeconfigs = vi.fn().mockResolvedValue(undefined);
    viewState.viewType = 'overview';
    viewState.navigateToGlobal.mockReset();
    viewState.activateClusterWorkspace.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderTabs = async (props: { onOpenCluster?: () => void } = {}) => {
    await act(async () => {
      root.render(
        <TabDragProvider>
          <ClusterTabs {...props} />
        </TabDragProvider>
      );
    });
  };

  it('excludes the synthetic Global tab from persisted drag positions', () => {
    expect(toClusterInsertIndex(0, true)).toBe(0);
    expect(toClusterInsertIndex(1, true)).toBe(0);
    expect(toClusterInsertIndex(2, true)).toBe(1);
    expect(toClusterInsertIndex(2, false)).toBe(2);
  });

  it.each(['Enter', ' '])(
    'visits every cluster with Tab and arrows, activating only on %s',
    async (activationKey) => {
      mockState.selectedKubeconfigs = ['a', 'b', 'c'];
      mockState.selectedKubeconfig = 'b';
      await act(async () => {
        root.render(
          <KeyboardProvider>
            <AppRegionNavigation />
            <TabDragProvider>
              <ClusterTabs />
            </TabDragProvider>
            <aside data-app-region="sidebar">
              <button type="button">Overview</button>
            </aside>
          </KeyboardProvider>
        );
      });
      const [globalTab, firstTab, activeTab, lastTab] =
        container.querySelectorAll<HTMLElement>('[role="tab"]');
      const button = (label: string) =>
        requireValue(container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`), label);
      const pressKey = async (key: string, modifiers: KeyboardEventInit = {}) => {
        await act(async () => {
          requireValue(document.activeElement, 'focused control').dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
          );
        });
      };
      const order = [
        globalTab,
        firstTab,
        button('Close a'),
        activeTab,
        button('Close b'),
        lastTab,
        button('Close c'),
        button('Open Cluster'),
      ];
      act(() => globalTab.focus());
      for (const control of order.slice(1)) {
        await pressKey('Tab');
        expect(document.activeElement).toBe(control);
      }
      for (const control of order.slice(0, -1).reverse()) {
        await pressKey('Tab', { shiftKey: true });
        expect(document.activeElement).toBe(control);
      }
      await pressKey('ArrowRight');
      expect(document.activeElement).toBe(firstTab);
      await pressKey('Tab');
      expect(document.activeElement).toBe(button('Close a'));
      await pressKey('Tab');
      expect(document.activeElement).toBe(activeTab);
      await pressKey('ArrowRight');
      expect(document.activeElement).toBe(lastTab);
      await pressKey('ArrowLeft');
      expect(document.activeElement).toBe(activeTab);
      await pressKey('ArrowRight');
      await pressKey('Tab', { ctrlKey: true });
      expect(document.activeElement).toBe(container.querySelector('aside button'));
      await pressKey('Tab', { ctrlKey: true, shiftKey: true });
      expect(document.activeElement).toBe(lastTab);
      expect(activeTab.getAttribute('aria-selected')).toBe('true');
      expect(mockState.setActiveKubeconfig).not.toHaveBeenCalled();
      expect(viewState.activateClusterWorkspace).not.toHaveBeenCalled();
      expect(viewState.navigateToGlobal).not.toHaveBeenCalled();
      await pressKey(activationKey);
      expect(mockState.setActiveKubeconfig).toHaveBeenCalledExactlyOnceWith('c');
      expect(viewState.activateClusterWorkspace).toHaveBeenCalledExactlyOnceWith('c');
    }
  );

  it('dismisses actions when their cluster closes and does not revive them on reopen', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs({ onOpenCluster: vi.fn() });
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.querySelector('.tab-item__label')?.textContent === 'b'
    );
    await act(async () =>
      tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    );
    expect(document.querySelector('[role="menu"]')).toBeTruthy();
    mockState.selectedKubeconfigs = ['a'];
    await renderTabs({ onOpenCluster: vi.fn() });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    mockState.selectedKubeconfigs = ['a', 'b'];
    await renderTabs({ onOpenCluster: vi.fn() });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens an inactive tab context menu and reorders the intended cluster', async () => {
    mockState.selectedKubeconfigs = ['a', 'b', 'c'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (el) => el.querySelector('.tab-item__label')?.textContent === 'b'
    );
    expect(tab).toBeTruthy();
    await act(async () =>
      tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    );
    const move = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (el) => el.textContent === 'Move tab right'
    );
    expect(move).toBeTruthy();
    await act(async () => move?.click());
    expect(
      Array.from(container.querySelectorAll('.tab-item__label')).map((el) => el.textContent)
    ).toEqual(['Global', 'a', 'c', 'b']);
    expect(persistenceBridge.set).toHaveBeenLastCalledWith(['a', 'c', 'b']);
    expect(mockState.setActiveKubeconfig).not.toHaveBeenCalled();
  });

  it.each([
    { ids: ['a'], target: 'a', moves: [] },
    { ids: ['a', 'b', 'c'], target: 'a', moves: ['Move tab right'] },
    { ids: ['a', 'b', 'c'], target: 'b', moves: ['Move tab left', 'Move tab right'] },
    { ids: ['a', 'b', 'c'], target: 'c', moves: ['Move tab left'] },
  ])(
    'shows only usable move commands with icons at the bottom for $target in $ids',
    async ({ ids, target, moves }) => {
      mockState.selectedKubeconfigs = ids;
      mockState.selectedKubeconfig = 'a';
      await renderTabs();
      const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
        (item) => item.querySelector('.tab-item__label')?.textContent === target
      );
      expect(tab).toBeDefined();
      await act(async () =>
        tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      );
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect
        .soft(items.map((item) => item.textContent))
        .toEqual(['Open in new window', 'Move to new window', 'Close', ...moves]);
      for (const moveItem of items.filter((item) => item.textContent?.startsWith('Move tab '))) {
        expect.soft(moveItem.querySelector('.context-menu-icon svg')).not.toBeNull();
        expect.soft(moveItem.getAttribute('aria-disabled')).toBe('false');
      }
      expect(document.querySelectorAll('.context-menu-divider')).toHaveLength(moves.length ? 2 : 1);
    }
  );

  it('renders the tab strip with a single cluster open', async () => {
    mockState.selectedKubeconfigs = ['a'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    expect(container.querySelector('.cluster-tabs')).not.toBeNull();
    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['a']);
  });

  it('closes the right-clicked inactive cluster through the existing close action', async () => {
    mockState.selectedKubeconfigs = ['/configs/kube:production', '/configs/kube:staging'];
    mockState.selectedKubeconfig = '/configs/kube:production';
    mockState.getClusterMeta = (selection) => ({
      id: selection.replace('/configs/', ''),
      name: selection.split(':')[1],
    });
    await renderTabs();
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (item) => item.querySelector('.tab-item__label')?.textContent === 'staging'
    );
    expect(tab).toBeDefined();
    await act(async () =>
      tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    );
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual([
      'Open in new window',
      'Move to new window',
      'Close',
      'Move tab left',
    ]);
    await act(async () => items.find((item) => item.textContent === 'Close')?.click());
    expect(mockState.closeKubeconfig).toHaveBeenCalledExactlyOnceWith('/configs/kube:staging');
    expect(mockState.setActiveKubeconfig).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens the right-clicked inactive cluster in a peer without changing local selection', async () => {
    mockState.selectedKubeconfigs = ['/configs/kube:production', '/configs/kube:staging'];
    mockState.selectedKubeconfig = '/configs/kube:production';
    mockState.getClusterMeta = (selection) => ({
      id: selection.replace('/configs/', ''),
      name: selection.split(':')[1],
    });
    await renderTabs();
    const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (item) => item.querySelector('.tab-item__label')?.textContent === 'staging'
    );
    await act(async () =>
      tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    );
    const open = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
      (item) => item.textContent === 'Open in new window'
    );
    await act(async () => open?.click());
    expect(clusterTransferBridge.open).toHaveBeenCalledExactlyOnceWith('app-a', 'kube:staging');
    expect(clusterTransferBridge.request).not.toHaveBeenCalled();
    expect(mockState.closeKubeconfig).not.toHaveBeenCalled();
    expect(mockState.setActiveKubeconfig).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('renders a non-closeable Global tab only when multiple clusters are open', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const globalTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.querySelector('.tab-item__label')?.textContent === 'Global'
    );
    expect(globalTab).toBeTruthy();
    expect(globalTab?.parentElement?.querySelector('.tab-item__close')).toBeNull();

    mockState.selectedKubeconfigs = ['a'];
    await renderTabs({ onOpenCluster: vi.fn() });
    expect(
      Array.from(container.querySelectorAll('.tab-item__label')).some(
        (label) => label.textContent === 'Global'
      )
    ).toBe(false);
  });

  it('selects Global independently from the foreground cluster', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    viewState.viewType = 'global';
    await renderTabs();

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const globalTab = tabs.find((tab) => tab.textContent?.trim() === 'Global');
    const clusterTab = tabs.find((tab) => tab.textContent?.trim().startsWith('b')) as HTMLElement;
    expect(globalTab?.getAttribute('aria-selected')).toBe('true');
    expect(
      tabs.find((tab) => tab.textContent?.trim().startsWith('a'))?.getAttribute('aria-selected')
    ).toBe('false');

    act(() => {
      clusterTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(viewState.activateClusterWorkspace).toHaveBeenCalledTimes(1);
    expect(mockState.setActiveKubeconfig).toHaveBeenCalledWith('b');
    expect(viewState.activateClusterWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.setActiveKubeconfig.mock.invocationCallOrder[0]
    );
  });

  it('enters Global without changing the foreground cluster', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const globalTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.textContent?.trim() === 'Global'
    ) as HTMLElement;
    act(() => {
      globalTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(viewState.navigateToGlobal).toHaveBeenCalledTimes(1);
    expect(mockState.setActiveKubeconfig).not.toHaveBeenCalled();
  });

  it('renders only the add-cluster button when no clusters are open', async () => {
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    await renderTabs();

    expect(container.querySelector('.cluster-tabs-add')).not.toBeNull();
    // No tab strip (and therefore no tabs) when there is nothing to switch between.
    expect(container.querySelector('.cluster-tabs')).toBeNull();
  });

  it('does not show the empty-selection affordance while saved clusters are loading', async () => {
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    mockState.kubeconfigsLoading = true;
    await renderTabs();

    expect(container.querySelector('.cluster-tabs-add')).toBeNull();
    expect(container.querySelector('.cluster-tabs')).toBeNull();
  });

  it('does not overwrite saved tab order while saved clusters are loading', async () => {
    const setClusterTabOrderMock = vi.fn().mockResolvedValue(undefined);
    const restorePersistence = installClusterTabPersistence(
      vi.fn().mockResolvedValue(['b', 'a']),
      setClusterTabOrderMock
    );
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    mockState.kubeconfigsLoading = true;

    try {
      await renderTabs();
      await act(async () => {
        await Promise.resolve();
      });

      expect(setClusterTabOrderMock).not.toHaveBeenCalled();
    } finally {
      restorePersistence();
    }
  });

  it('does not persist selection order before saved tab order hydrates', async () => {
    let resolveSavedOrder: ((order: string[]) => void) | undefined;
    const savedOrder = new Promise<string[]>((resolve) => {
      resolveSavedOrder = resolve;
    });
    const setClusterTabOrderMock = vi.fn().mockResolvedValue(undefined);
    const restorePersistence = installClusterTabPersistence(
      vi.fn().mockReturnValue(savedOrder),
      setClusterTabOrderMock
    );
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    mockState.kubeconfigsLoading = false;

    try {
      await renderTabs();
      expect(setClusterTabOrderMock).not.toHaveBeenCalled();

      await act(async () => {
        resolveSavedOrder?.(['b', 'a']);
        await savedOrder;
      });

      expect(setClusterTabOrderMock).not.toHaveBeenCalled();
      const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
        (node as HTMLElement).textContent?.trim()
      );
      expect(labels).toEqual(['Global', 'b', 'a']);
    } finally {
      restorePersistence();
    }
  });

  it('persists new clusters after selection and tab-order hydration complete', async () => {
    const setClusterTabOrderMock = vi.fn().mockResolvedValue(undefined);
    const restorePersistence = installClusterTabPersistence(
      vi.fn().mockResolvedValue(['b', 'a']),
      setClusterTabOrderMock
    );
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    mockState.kubeconfigsLoading = true;

    try {
      await renderTabs();
      expect(setClusterTabOrderMock).not.toHaveBeenCalled();

      mockState.selectedKubeconfigs = ['a', 'b', 'c'];
      mockState.selectedKubeconfig = 'a';
      mockState.kubeconfigsLoading = false;
      await renderTabs({ onOpenCluster: vi.fn() });

      expect(setClusterTabOrderMock).toHaveBeenCalledTimes(1);
      expect(setClusterTabOrderMock).toHaveBeenCalledWith(['b', 'a', 'c']);
    } finally {
      restorePersistence();
    }
  });

  it('invokes onOpenCluster when the add-cluster button is clicked', async () => {
    const onOpenCluster = vi.fn();
    mockState.selectedKubeconfigs = ['a'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs({ onOpenCluster });

    const addButton = container.querySelector('.cluster-tabs-add') as HTMLElement | null;
    expect(addButton).not.toBeNull();

    act(() => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOpenCluster).toHaveBeenCalledTimes(1);
  });

  it('shows the Open Cluster label next to the + by default', async () => {
    mockState.selectedKubeconfigs = ['a'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const addButton = container.querySelector('.cluster-tabs-add');
    expect(addButton?.textContent).toContain('Open Cluster');
  });

  it('remeasures Open Cluster label fit when the number of tabs changes', async () => {
    const originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientWidth'
    );
    const originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    );
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        return this.classList.contains('cluster-tabs-wrapper') ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        if (this.classList.contains('cluster-tabs-add')) {
          return 100;
        }
        if (this.classList.contains('tab-item')) {
          return 80;
        }
        return 0;
      },
    });
    const restoreResizeObserver = installWindowProperty(
      'ResizeObserver',
      class implements ResizeObserver {
        observe() {
          return undefined;
        }
        unobserve() {
          return undefined;
        }
        disconnect() {
          return undefined;
        }
      }
    );

    try {
      mockState.selectedKubeconfigs = ['a'];
      mockState.selectedKubeconfig = 'a';
      await renderTabs({ onOpenCluster: vi.fn() });
      expect(container.querySelector('.cluster-tabs-add__label')).not.toBeNull();

      mockState.selectedKubeconfigs = ['a', 'b', 'c'];
      await renderTabs({ onOpenCluster: vi.fn() });

      expect(container.querySelector('.cluster-tabs-add__label')).toBeNull();
    } finally {
      restoreResizeObserver();
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      }
      if (originalOffsetWidth) {
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
      }
    }
  });

  it('orders tabs by persisted drag order with selection-order fallback', async () => {
    setClusterTabOrder(['b']);
    mockState.selectedKubeconfigs = ['a', 'b', 'c'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['Global', 'b', 'a', 'c']);
  });

  it('uses persisted order when available', async () => {
    setClusterTabOrder(['b', 'a']);
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['Global', 'b', 'a']);
  });

  it('invokes setActiveKubeconfig when a tab is clicked', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const target = tabs.find((tab) => tab.textContent?.trim().startsWith('b')) as
      | HTMLElement
      | undefined;
    expect(target).toBeTruthy();

    act(() => {
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockState.setActiveKubeconfig).toHaveBeenCalledWith('b');
  });

  it('invokes closeKubeconfig when a tab is closed', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const targetTab = tabs.find(
      (tab) => tab.querySelector('.tab-item__label')?.textContent === 'b'
    );
    const closeButton = targetTab?.parentElement?.querySelector('.tab-item__close') as HTMLElement;

    expect(closeButton).toBeTruthy();
    await act(async () => {
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockState.closeKubeconfig).toHaveBeenCalledWith('b');
    expect(mockState.loadKubeconfigs).not.toHaveBeenCalled();
    expect(mockState.setSelectedKubeconfigs).not.toHaveBeenCalled();
  });

  it('dispatches rapid tab closes immediately without serializing behind backend work', async () => {
    const blockedClose = new Promise<void>(() => undefined);
    mockState.closeKubeconfig = vi
      .fn()
      .mockReturnValueOnce(blockedClose)
      .mockResolvedValue(undefined);
    mockState.selectedKubeconfigs = ['a', 'b', 'c'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const closeButtonFor = (label: string) => {
      const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
      const tab = tabs.find(
        (node) => node.querySelector('.tab-item__label')?.textContent === label
      );
      return tab?.parentElement?.querySelector('.tab-item__close') as HTMLElement | null;
    };

    const closeB = closeButtonFor('b');
    const closeC = closeButtonFor('c');
    expect(closeB).toBeTruthy();
    expect(closeC).toBeTruthy();

    act(() => {
      closeB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      closeC?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockState.closeKubeconfig).toHaveBeenNthCalledWith(1, 'b');
    expect(mockState.closeKubeconfig).toHaveBeenNthCalledWith(2, 'c');
  });

  it('shows filename:context for tabs with name collisions', async () => {
    // Two clusters with the same context name but different files.
    mockState.getClusterMeta = (config: string) => {
      if (config === '/kube/alpha:dev') {
        return { id: 'alpha:dev', name: 'dev' };
      }
      if (config === '/kube/beta:dev') {
        return { id: 'beta:dev', name: 'dev' };
      }
      if (config === '/kube/gamma:prod') {
        return { id: 'gamma:prod', name: 'prod' };
      }
      return { id: config, name: config };
    };
    mockState.selectedKubeconfigs = ['/kube/alpha:dev', '/kube/beta:dev', '/kube/gamma:prod'];
    mockState.selectedKubeconfig = '/kube/alpha:dev';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    // "dev" appears twice, so those tabs should show filename:context (alpha:dev, beta:dev).
    // "prod" is unique, so it shows just the context name.
    expect(labels).toEqual(['Global', 'alpha:dev', 'beta:dev', 'prod']);
  });
});

it('requests a cluster view transfer when a tab is dropped from another app window', async () => {
  const request = vi.fn(async () => undefined);
  clusterTransferBridge.request.mockImplementation(request);
  mockState.kubeconfigsLoading = false;
  mockState.selectedKubeconfigs = ['production'];
  mockState.selectedKubeconfig = 'production';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  try {
    await act(async () =>
      root.render(
        <TabDragProvider>
          <ClusterTabs />
        </TabDragProvider>
      )
    );
    const target = container.querySelector('.cluster-tabs-wrapper');
    if (!target) {
      throw new Error('Expected cluster tabs');
    }
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        getData: () =>
          JSON.stringify({
            kind: 'cluster-tab',
            clusterId: 'production',
            selection: 'production',
            sourceWindowName: 'app-b',
          }),
        types: ['application/x-luxury-yacht-tab', 'application/x-luxury-yacht-tab-cluster-tab'],
        dropEffect: 'move',
      },
    });
    await act(async () => target.dispatchEvent(drop));
    expect(request).toHaveBeenCalledWith(
      'app-a',
      expect.objectContaining({
        sourceWindowName: 'app-b',
        targetWindowName: 'app-a',
        clusterId: 'production',
      })
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
