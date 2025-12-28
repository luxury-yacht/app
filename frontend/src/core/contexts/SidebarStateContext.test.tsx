/**
 * frontend/src/core/contexts/SidebarStateContext.test.tsx
 *
 * Test suite for SidebarStateContext.
 * Ensures sidebar selection is scoped per cluster tab.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarStateProvider, useSidebarState } from './SidebarStateContext';

let mockClusterId = 'cluster-a';
let mockClusterIds = ['cluster-a', 'cluster-b'];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockClusterId,
    selectedClusterIds: mockClusterIds,
  }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  SetSidebarVisible: vi.fn(),
}));

describe('SidebarStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useSidebarState> | null } = { current: null };

  const Harness = () => {
    stateRef.current = useSidebarState();
    return null;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockClusterId = 'cluster-a';
    mockClusterIds = ['cluster-a', 'cluster-b'];
    stateRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <SidebarStateProvider>
          <Harness />
        </SidebarStateProvider>
      );
      await Promise.resolve();
    });
  };

  it('keeps sidebar selection isolated per cluster tab', async () => {
    await renderProvider();
    act(() => {
      stateRef.current?.setSidebarSelection({ type: 'namespace', value: 'default' });
    });
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'namespace', value: 'default' });

    mockClusterId = 'cluster-b';
    await renderProvider();
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'overview', value: 'overview' });

    act(() => {
      stateRef.current?.setSidebarSelection({ type: 'cluster', value: 'cluster' });
    });

    mockClusterId = 'cluster-a';
    await renderProvider();
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'namespace', value: 'default' });
  });

  it('clears sidebar selection when a tab is closed', async () => {
    mockClusterId = 'cluster-b';
    await renderProvider();
    act(() => {
      stateRef.current?.setSidebarSelection({ type: 'cluster', value: 'cluster' });
    });

    mockClusterIds = ['cluster-a'];
    await renderProvider();
    await act(async () => {
      await Promise.resolve();
    });
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'overview', value: 'overview' });
  });
});
