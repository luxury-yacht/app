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
import ClusterTabs, { toClusterInsertIndex } from '@ui/layout/ClusterTabs';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWindowProperty } from '@/test-utils/windowProperty';

type MockState = {
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  setSelectedKubeconfigs: (next: string[]) => Promise<void>;
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
  setActiveKubeconfig: ReturnType<typeof vi.fn<(config: string) => void>>;
  getClusterMeta: (config: string) => { id: string; name: string };
  loadKubeconfigs: () => Promise<void>;
};

const mockState: MockState = {
  selectedKubeconfigs: [],
  selectedKubeconfig: '',
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
  useKubeconfig: () => mockState,
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

  it('renders a non-closeable Global tab only when multiple clusters are open', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const globalTab = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.querySelector('.tab-item__label')?.textContent === 'Global'
    );
    expect(globalTab).toBeTruthy();
    expect(globalTab?.querySelector('.tab-item__close')).toBeNull();

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
    const closeButton = targetTab?.querySelector('.tab-item__close') as HTMLElement;

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
      return tab?.querySelector('.tab-item__close') as HTMLElement | null;
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
