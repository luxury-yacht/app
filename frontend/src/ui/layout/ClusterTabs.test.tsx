/**
 * frontend/src/ui/layout/ClusterTabs.test.tsx
 *
 * Test suite for ClusterTabs.
 * Covers tab rendering, ordering, and close/select behaviors.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ClusterTabs from '@ui/layout/ClusterTabs';
import {
  resetClusterTabOrderCacheForTesting,
  setClusterTabOrder,
} from '@core/persistence/clusterTabOrder';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

type MockState = {
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  setSelectedKubeconfigs: (next: string[]) => Promise<void>;
  closeKubeconfig: (selectionOrClusterId: string) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
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

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => mockState,
}));

describe('ClusterTabs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    mockState.loadKubeconfigs = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderTabs = async () => {
    await act(async () => {
      root.render(
        <TabDragProvider>
          <ClusterTabs />
        </TabDragProvider>
      );
    });
  };

  it('hides the tab row when fewer than two clusters are open', async () => {
    mockState.selectedKubeconfigs = ['a'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    expect(container.querySelector('.cluster-tabs')).toBeNull();
  });

  it('orders tabs by persisted drag order with selection-order fallback', async () => {
    setClusterTabOrder(['b']);
    mockState.selectedKubeconfigs = ['a', 'b', 'c'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['b', 'a', 'c']);
  });

  it('uses persisted order when available', async () => {
    setClusterTabOrder(['b', 'a']);
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.tab-item__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['b', 'a']);
  });

  it('invokes setActiveKubeconfig when a tab is clicked', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const target = tabs.find((tab) => tab.textContent?.trim().startsWith('b')) as
      HTMLElement | undefined;
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
    const targetTab = tabs.find((tab) =>
      tab.querySelector('.tab-item__label')?.textContent?.includes('b')
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
      const tab = tabs.find((node) =>
        node.querySelector('.tab-item__label')?.textContent?.includes(label)
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
      if (config === '/kube/alpha:dev') return { id: 'alpha:dev', name: 'dev' };
      if (config === '/kube/beta:dev') return { id: 'beta:dev', name: 'dev' };
      if (config === '/kube/gamma:prod') return { id: 'gamma:prod', name: 'prod' };
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
    expect(labels).toEqual(['alpha:dev', 'beta:dev', 'prod']);
  });
});
