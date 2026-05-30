/**
 * frontend/src/core/data-access/useScopedRefreshDomainLifecycle.test.tsx
 *
 * Verifies scoped refresh-domain enablement, initial fetch, and cleanup.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';
import type { RefreshDomain } from '@/core/refresh/types';

const mocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
  fetchScopedDomain: vi.fn((..._args: unknown[]) => Promise.resolve()),
  getAutoRefreshEnabled: vi.fn(() => true),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => mocks.setScopedDomainEnabled(...args),
    fetchScopedDomain: (...args: unknown[]) => mocks.fetchScopedDomain(...args),
  },
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mocks.getAutoRefreshEnabled(),
}));

interface HookProps {
  domain: RefreshDomain | null;
  scope: string | null;
  enabled: boolean;
  preserveState?: boolean;
  fetchOnEnable?: 'background' | 'startup' | 'user' | false;
  onFetchError?: (error: unknown) => void;
}

const renderHook = (initialProps: HookProps) => {
  const propsRef = { current: initialProps };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness: React.FC = () => {
    useScopedRefreshDomainLifecycle(propsRef.current);
    return null;
  };

  act(() => {
    root.render(<Harness />);
  });

  return {
    rerender(next: HookProps) {
      propsRef.current = next;
      act(() => {
        root.render(<Harness />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useScopedRefreshDomainLifecycle', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mocks.setScopedDomainEnabled.mockClear();
    mocks.fetchScopedDomain.mockClear();
    mocks.fetchScopedDomain.mockResolvedValue(undefined);
    mocks.getAutoRefreshEnabled.mockReturnValue(true);
  });

  it('enables the current scope and disables it on unmount', () => {
    const hook = renderHook({
      domain: 'catalog',
      scope: 'cluster:test|catalog',
      enabled: true,
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'catalog',
      'cluster:test|catalog',
      true
    );

    hook.unmount();

    expect(mocks.setScopedDomainEnabled).toHaveBeenLastCalledWith(
      'catalog',
      'cluster:test|catalog',
      false
    );
  });

  it('preserves state when disabling a replaced scope', () => {
    const hook = renderHook({
      domain: 'namespace-workloads',
      scope: 'cluster:test|namespace:team-a',
      enabled: true,
      preserveState: true,
    });

    hook.rerender({
      domain: 'namespace-workloads',
      scope: 'cluster:test|namespace:team-b',
      enabled: true,
      preserveState: true,
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'namespace-workloads',
      'cluster:test|namespace:team-a',
      false,
      { preserveState: true }
    );
    expect(mocks.setScopedDomainEnabled).toHaveBeenLastCalledWith(
      'namespace-workloads',
      'cluster:test|namespace:team-b',
      true,
      { preserveState: true }
    );

    hook.unmount();
  });

  it('preserves state when enabling so streaming domains keep cached snapshots', () => {
    const hook = renderHook({
      domain: 'object-details',
      scope: 'cluster:test|namespace:team-a|deployment:api',
      enabled: true,
      preserveState: true,
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-details',
      'cluster:test|namespace:team-a|deployment:api',
      true,
      { preserveState: true }
    );

    hook.unmount();
  });

  it('fetches after enabling when the caller requests a startup fetch', async () => {
    const hook = renderHook({
      domain: 'object-map',
      scope: 'cluster:test|namespace:team-a|deployment:api',
      enabled: true,
      preserveState: true,
      fetchOnEnable: 'startup',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.setScopedDomainEnabled).toHaveBeenCalledWith(
      'object-map',
      'cluster:test|namespace:team-a|deployment:api',
      true,
      { preserveState: true }
    );
    expect(mocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-map',
      'cluster:test|namespace:team-a|deployment:api',
      { isManual: false }
    );

    hook.unmount();
  });

  it('blocks startup fetches while auto-refresh is paused but still preserves lifecycle cleanup', async () => {
    mocks.getAutoRefreshEnabled.mockReturnValue(false);

    const hook = renderHook({
      domain: 'object-helm-values',
      scope: 'cluster:test|namespace:team-a|helm:api',
      enabled: true,
      preserveState: true,
      fetchOnEnable: 'startup',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.fetchScopedDomain).not.toHaveBeenCalled();

    hook.unmount();

    expect(mocks.setScopedDomainEnabled).toHaveBeenLastCalledWith(
      'object-helm-values',
      'cluster:test|namespace:team-a|helm:api',
      false,
      { preserveState: true }
    );
  });
});
