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

type MockState = {
  selectedKubeconfigs: string[];
  selectedKubeconfig: string;
  setSelectedKubeconfigs: (next: string[]) => Promise<void>;
  setActiveKubeconfig: (config: string) => void;
  getClusterMeta: (config: string) => { id: string; name: string };
};

const mockState: MockState = {
  selectedKubeconfigs: [],
  selectedKubeconfig: '',
  setSelectedKubeconfigs: vi.fn().mockResolvedValue(undefined),
  setActiveKubeconfig: vi.fn(),
  getClusterMeta: (config: string) => ({ id: config, name: config }),
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
    localStorage.clear();
    mockState.selectedKubeconfigs = [];
    mockState.selectedKubeconfig = '';
    mockState.setSelectedKubeconfigs = vi.fn().mockResolvedValue(undefined);
    mockState.setActiveKubeconfig = vi.fn();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderTabs = async () => {
    await act(async () => {
      root.render(<ClusterTabs />);
    });
  };

  it('hides the tab row when fewer than two clusters are open', async () => {
    mockState.selectedKubeconfigs = ['a'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    expect(container.querySelector('.cluster-tabs')).toBeNull();
  });

  it('orders tabs by persisted drag order with selection-order fallback', async () => {
    localStorage.setItem('clusterTabs:order', JSON.stringify(['b']));
    mockState.selectedKubeconfigs = ['a', 'b', 'c'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.cluster-tab__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['b', 'a', 'c']);
  });

  it('uses persisted order when available', async () => {
    localStorage.setItem('clusterTabs:order', JSON.stringify(['b', 'a']));
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const labels = Array.from(container.querySelectorAll('.cluster-tab__label')).map((node) =>
      (node as HTMLElement).textContent?.trim()
    );
    expect(labels).toEqual(['b', 'a']);
  });

  it('invokes setActiveKubeconfig when a tab is clicked', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const buttons = Array.from(container.querySelectorAll('.cluster-tab__button'));
    const target = buttons.find((button) => button.textContent?.trim() === 'b') as
      | HTMLButtonElement
      | undefined;
    expect(target).toBeTruthy();

    act(() => {
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockState.setActiveKubeconfig).toHaveBeenCalledWith('b');
  });

  it('invokes setSelectedKubeconfigs when a tab is closed', async () => {
    mockState.selectedKubeconfigs = ['a', 'b'];
    mockState.selectedKubeconfig = 'a';
    await renderTabs();

    const tabs = Array.from(container.querySelectorAll('.cluster-tab'));
    const targetTab = tabs.find((tab) =>
      tab.querySelector('.cluster-tab__label')?.textContent?.includes('b')
    );
    const closeButton = targetTab?.querySelector('.cluster-tab__close') as HTMLButtonElement;

    expect(closeButton).toBeTruthy();
    await act(async () => {
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockState.setSelectedKubeconfigs).toHaveBeenCalledWith(['a']);
  });
});
