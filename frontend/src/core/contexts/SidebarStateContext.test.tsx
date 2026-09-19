/**
 * frontend/src/core/contexts/SidebarStateContext.test.tsx
 *
 * Test suite for SidebarStateContext.
 * Ensures sidebar selection is scoped per cluster tab.
 */

import { act, StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetSidebarVisible } from '@/core/backend-api';

import { SidebarStateProvider, useSidebarState } from './SidebarStateContext';

let mockClusterId = 'cluster-a';
let mockClusterIds = ['cluster-a', 'cluster-b'];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockClusterId,
    selectedClusterIds: mockClusterIds,
  }),
}));

vi.mock('@core/backend-api', () => ({
  SetSidebarVisible: vi.fn(),
}));

vi.mock('@/core/desktop-runtime', () => ({ desktopRuntimeAvailable: () => true }));

describe('SidebarStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useSidebarState> | null } = { current: null };

  const Harness = () => {
    stateRef.current = useSidebarState();
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
        <StrictMode>
          <SidebarStateProvider>
            <Harness />
          </SidebarStateProvider>
        </StrictMode>
      );
      await Promise.resolve();
    });
  };

  it('publishes each committed visibility change to the native menu once', async () => {
    await renderProvider();
    vi.mocked(SetSidebarVisible).mockClear();
    for (const visible of [false, true]) {
      act(() => stateRef.current?.toggleSidebar());
      expect(stateRef.current?.isSidebarVisible).toBe(visible);
      expect(SetSidebarVisible).toHaveBeenCalledExactlyOnceWith(visible);
      vi.mocked(SetSidebarVisible).mockClear();
    }
  });

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

  it('can prepare another cluster selection without mutating the active cluster', async () => {
    await renderProvider();

    act(() => {
      stateRef.current?.setSidebarSelectionForCluster('cluster-b', {
        type: 'cluster',
        value: 'cluster',
      });
    });
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'overview', value: 'overview' });

    mockClusterId = 'cluster-b';
    await renderProvider();
    expect(stateRef.current?.sidebarSelection).toEqual({ type: 'cluster', value: 'cluster' });
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
