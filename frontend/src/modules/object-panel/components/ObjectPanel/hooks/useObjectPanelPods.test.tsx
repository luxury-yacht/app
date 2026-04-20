import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useObjectPanelPods } from './useObjectPanelPods';

const hoistedMocks = vi.hoisted(() => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  },
  useRefreshScopedDomain: vi.fn(),
  autoRefreshLoadingState: {
    isPaused: false,
    isManualRefreshActive: false,
    suppressPassiveLoading: false,
  },
}));

vi.mock('@/core/refresh/orchestrator', () => ({
  refreshOrchestrator: hoistedMocks.refreshOrchestrator,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => hoistedMocks.useRefreshScopedDomain(...args),
}));

vi.mock('@/core/refresh/hooks/useAutoRefreshLoadingState', () => ({
  useAutoRefreshLoadingState: () => hoistedMocks.autoRefreshLoadingState,
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => !hoistedMocks.autoRefreshLoadingState.isPaused,
}));

const mockRefreshOrchestrator = hoistedMocks.refreshOrchestrator;
const mockUseRefreshScopedDomain = hoistedMocks.useRefreshScopedDomain;
const autoRefreshLoadingState = hoistedMocks.autoRefreshLoadingState;

describe('useObjectPanelPods', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelPods> | null } = { current: null };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.resetScopedDomain.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();
    mockUseRefreshScopedDomain.mockReset();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
    mockUseRefreshScopedDomain.mockReturnValue({
      data: { pods: [], metrics: null },
      status: 'ready',
      error: null,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderHook = async (override: Partial<Parameters<typeof useObjectPanelPods>[0]> = {}) => {
    const propsRef = {
      current: {
        objectData: {
          clusterId: 'alpha',
          kind: 'Deployment',
          name: 'api',
          namespace: 'team-a',
        },
        objectKind: 'deployment',
        isOpen: true,
        activeTab: 'pods' as const,
        ...override,
      },
    };

    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelPods(propsRef.current);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return {
      getResult: () => resultRef.current!,
    };
  };

  it('enables the pods domain and uses startup fetch intent on mount', async () => {
    await renderHook();

    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'pods',
      'alpha|workload:team-a:Deployment:api',
      true
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'pods',
      'alpha|workload:team-a:Deployment:api',
      { isManual: false }
    );
  });

  it('suppresses passive loading while paused and blocks startup fetches', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    mockUseRefreshScopedDomain.mockReturnValue({
      data: null,
      status: 'loading',
      error: null,
    });

    const { getResult } = await renderHook();

    expect(getResult().loading).toBe(false);
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
  });
});
