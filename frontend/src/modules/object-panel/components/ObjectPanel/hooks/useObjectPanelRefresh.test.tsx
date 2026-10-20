/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.test.tsx
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localFailure } from '@/core/refresh/refreshFailure';
import { requireValue } from '@/test-utils/requireValue';
import { useObjectPanelRefresh } from './useObjectPanelRefresh';

const hoistedMocks = vi.hoisted(() => ({
  refreshOrchestrator: {
    acquireScopedDomainLease: vi.fn(),
    releaseScopedDomainLease: vi.fn(),
    resetScopedDomain: vi.fn(),
    fetchScopedDomain: vi.fn(),
  },
  useRefreshScopedDomain: vi.fn(),
  autoRefreshLoadingState: {
    isPaused: false,
    isManualRefreshActive: false,
    suppressPassiveLoading: false,
  },
}));

vi.mock('@/core/refresh', () => ({
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

describe('useObjectPanelRefresh', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useObjectPanelRefresh> | null } = { current: null };

  const renderHook = async (
    override: Partial<Parameters<typeof useObjectPanelRefresh>[0]> = {}
  ) => {
    const propsRef = {
      current: {
        detailScope: 'cluster-a|team-a:apps/v1:deployment:api' as string | null,
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
      getResult: () =>
        requireValue(resultRef.current, 'expected test value in useObjectPanelRefresh.test.tsx'),
      rerender: async (next?: Partial<Parameters<typeof useObjectPanelRefresh>[0]>) => {
        propsRef.current = { ...propsRef.current, ...next };
        await act(async () => {
          root.render(<HookHarness />);
          await Promise.resolve();
        });
      },
    };
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    mockRefreshOrchestrator.acquireScopedDomainLease.mockClear();
    mockRefreshOrchestrator.releaseScopedDomainLease.mockClear();
    mockRefreshOrchestrator.resetScopedDomain.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();
    mockRefreshOrchestrator.fetchScopedDomain.mockResolvedValue(undefined);
    mockUseRefreshScopedDomain.mockReset();
    autoRefreshLoadingState.isPaused = false;
    autoRefreshLoadingState.isManualRefreshActive = false;
    autoRefreshLoadingState.suppressPassiveLoading = false;
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

  it('leases the details scope and fetches on mount', async () => {
    await renderHook();

    expect(mockRefreshOrchestrator.acquireScopedDomainLease).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|team-a:apps/v1:deployment:api',
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|team-a:apps/v1:deployment:api',
      expect.objectContaining({ intent: 'startup' })
    );
  });

  it('cleans up refresh subscriptions on unmount but preserves cached state', async () => {
    await renderHook();

    act(() => {
      root.unmount();
    });

    // Tier 1 responsiveness: stop refreshing this scope but keep the
    // cached snapshot in place. The cache is only freed via
    // ObjectPanelStateContext.closePanel when the user actually closes
    // the panel — this lets cluster-switch round-trips render instantly
    // from cache.
    expect(mockRefreshOrchestrator.releaseScopedDomainLease).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|team-a:apps/v1:deployment:api',
      { preserveState: true }
    );
    expect(mockRefreshOrchestrator.resetScopedDomain).not.toHaveBeenCalledWith(
      'object-details',
      'cluster-a|team-a:apps/v1:deployment:api'
    );
  });

  it('exposes fetch helper and derives loading/error state', async () => {
    const { getResult } = await renderHook();
    const { fetchResourceDetails, detailsLoading, detailsError, detail } = getResult();

    expect(detailsLoading).toBe(false);
    expect(detailsError).toBeNull();
    expect(detail?.details).toEqual({ replicas: 3 });

    await fetchResourceDetails('user');
    expect(mockRefreshOrchestrator.fetchScopedDomain).toHaveBeenCalledWith(
      'object-details',
      'cluster-a|team-a:apps/v1:deployment:api',
      expect.objectContaining({ intent: 'user' })
    );
  });

  it('exposes deletion metadata from the object-details envelope', async () => {
    const deletion = {
      deletionTimestamp: '2026-08-09T12:34:56Z',
      finalizers: ['example.com/cleanup'],
    };
    mockUseRefreshScopedDomain.mockReturnValue({
      data: { details: { replicas: 3 }, deletion },
      status: 'ready',
      error: null,
    });

    const { getResult } = await renderHook();

    expect(getResult().deletion).toEqual(deletion);
  });

  it('surfaces detail errors', async () => {
    mockUseRefreshScopedDomain.mockReturnValue({
      data: null,
      status: 'error',
      error: localFailure('fetch failed'),
    });
    const { getResult } = await renderHook();
    expect(getResult().detailsError).toEqual(localFailure('fetch failed'));
  });

  it('keeps the fetch helper inert without an object scope', async () => {
    const { getResult } = await renderHook({ detailScope: null });
    mockRefreshOrchestrator.fetchScopedDomain.mockClear();

    await getResult().fetchResourceDetails('user');

    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
    expect(mockRefreshOrchestrator.acquireScopedDomainLease).not.toHaveBeenCalled();
  });

  it('suppresses passive detail loading while auto-refresh is paused', async () => {
    autoRefreshLoadingState.isPaused = true;
    autoRefreshLoadingState.suppressPassiveLoading = true;
    mockUseRefreshScopedDomain.mockReturnValue({
      data: null,
      status: 'loading',
      error: null,
    });

    const { getResult } = await renderHook();

    expect(getResult().detailsLoading).toBe(false);
    expect(mockRefreshOrchestrator.fetchScopedDomain).not.toHaveBeenCalled();
  });
});
