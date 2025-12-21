import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useObjectPanelRefresh } from './useObjectPanelRefresh';
import type { PanelObjectData } from '../types';

const hoistedMocks = vi.hoisted(() => ({
  refreshManager: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn(),
    updateContext: vi.fn(),
  },
  useRefreshScopedDomain: vi.fn(),
  useRefreshWatcher: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: hoistedMocks.refreshManager,
  refreshOrchestrator: hoistedMocks.refreshOrchestrator,
}));

vi.mock('@/core/refresh/store', () => ({
  useRefreshScopedDomain: (...args: unknown[]) => hoistedMocks.useRefreshScopedDomain(...args),
}));

vi.mock('@/core/refresh/hooks/useRefreshWatcher', () => ({
  useRefreshWatcher: (...args: unknown[]) => hoistedMocks.useRefreshWatcher(...args),
}));

const mockRefreshManager = hoistedMocks.refreshManager;
const mockRefreshOrchestrator = hoistedMocks.refreshOrchestrator;
const mockUseRefreshScopedDomain = hoistedMocks.useRefreshScopedDomain;
const mockUseRefreshWatcher = hoistedMocks.useRefreshWatcher;

describe('useObjectPanelRefresh', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelRefresh> | null } = { current: null };

  const baseObjectData: PanelObjectData = {
    kind: 'Deployment',
    name: 'api',
    namespace: 'team-a',
  };

  const renderHook = async (
    override: Partial<Parameters<typeof useObjectPanelRefresh>[0]> = {}
  ) => {
    const propsRef = {
      current: {
        detailScope: 'team-a:deployment:api',
        objectKind: 'deployment',
        objectData: baseObjectData,
        isOpen: true,
        resourceDeleted: false,
        ...override,
      },
    };

    const HookHarness: React.FC = () => {
      resultRef.current = useObjectPanelRefresh(propsRef.current);
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    return {
      getResult: () => resultRef.current!,
      rerender: async (next?: Partial<Parameters<typeof useObjectPanelRefresh>[0]>) => {
        propsRef.current = { ...propsRef.current, ...next };
        await act(async () => {
          root.render(<HookHarness />);
          await Promise.resolve();
        });
      },
    };
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    mockRefreshManager.register.mockClear();
    mockRefreshManager.unregister.mockClear();
    mockRefreshOrchestrator.setScopedDomainEnabled.mockClear();
    mockRefreshOrchestrator.resetScopedDomain.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockResolvedValue(undefined);
    mockRefreshOrchestrator.updateContext.mockClear();
    mockUseRefreshWatcher.mockClear();
    mockUseRefreshScopedDomain.mockReset();
    mockUseRefreshScopedDomain.mockReturnValue({
      data: { details: { replicas: 3 } },
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

  it('registers refreshers, enables scoped domains, and fetches on mount', async () => {
    await renderHook();

    expect(mockRefreshManager.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'object-deployment', interval: 5000 })
    );
    expect(mockUseRefreshWatcher).toHaveBeenCalledWith(
      expect.objectContaining({ refresherName: 'object-deployment', enabled: true })
    );
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      'team-a:deployment:api',
      true
    );
    expect(mockRefreshOrchestrator.updateContext).not.toHaveBeenCalled();
  });

  it('cleans up refresh subscriptions on unmount', async () => {
    await renderHook();

    act(() => {
      root.unmount();
    });

    expect(mockRefreshManager.unregister).toHaveBeenCalledWith('object-deployment');
    expect(mockRefreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      'team-a:deployment:api',
      false
    );
    expect(mockRefreshOrchestrator.resetScopedDomain).toHaveBeenCalledWith(
      'object-details',
      'team-a:deployment:api'
    );
  });

  it('exposes fetch helper and derives loading/error state', async () => {
    const { getResult } = await renderHook();
    const { fetchResourceDetails, detailsLoading, detailsError, detailPayload } = getResult();

    expect(detailsLoading).toBe(false);
    expect(detailsError).toBeNull();
    expect(detailPayload).toEqual({ replicas: 3 });

    await fetchResourceDetails(true);
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      'team-a:deployment:api',
      expect.objectContaining({ isManual: true })
    );
  });
});
