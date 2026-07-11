/**
 * frontend/src/core/data-access/useScopedRefreshDomainLifecycle.test.tsx
 *
 * Verifies scoped refresh-domain leasing, initial fetch, and release-on-unmount.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefreshDomain } from '@/core/refresh/types';
import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';

const mocks = vi.hoisted(() => ({
  acquireScopedDomainLease: vi.fn(),
  releaseScopedDomainLease: vi.fn(),
  fetchScopedDomain: vi.fn((..._args: unknown[]) => Promise.resolve()),
  getAutoRefreshEnabled: vi.fn(() => true),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    acquireScopedDomainLease: (...args: unknown[]) => mocks.acquireScopedDomainLease(...args),
    releaseScopedDomainLease: (...args: unknown[]) => mocks.releaseScopedDomainLease(...args),
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
  beforeEach(() => {
    mocks.acquireScopedDomainLease.mockClear();
    mocks.releaseScopedDomainLease.mockClear();
    mocks.fetchScopedDomain.mockClear();
    mocks.fetchScopedDomain.mockResolvedValue(undefined);
    mocks.getAutoRefreshEnabled.mockReturnValue(true);
  });

  it('acquires a lease for the current scope and releases it on unmount', () => {
    const hook = renderHook({
      domain: 'catalog',
      scope: 'cluster:test|catalog',
      enabled: true,
    });

    expect(mocks.acquireScopedDomainLease).toHaveBeenCalledWith(
      'catalog',
      'cluster:test|catalog',
      undefined
    );
    expect(mocks.releaseScopedDomainLease).not.toHaveBeenCalled();

    hook.unmount();

    expect(mocks.releaseScopedDomainLease).toHaveBeenCalledWith(
      'catalog',
      'cluster:test|catalog',
      undefined
    );
  });

  it('does not acquire a lease while disabled', () => {
    const hook = renderHook({
      domain: 'catalog',
      scope: 'cluster:test|catalog',
      enabled: false,
    });

    expect(mocks.acquireScopedDomainLease).not.toHaveBeenCalled();

    hook.unmount();

    expect(mocks.releaseScopedDomainLease).not.toHaveBeenCalled();
  });

  it('releases the replaced scope lease and acquires the new one on scope change', () => {
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

    expect(mocks.releaseScopedDomainLease).toHaveBeenCalledWith(
      'namespace-workloads',
      'cluster:test|namespace:team-a',
      { preserveState: true }
    );
    expect(mocks.acquireScopedDomainLease).toHaveBeenLastCalledWith(
      'namespace-workloads',
      'cluster:test|namespace:team-b',
      { preserveState: true }
    );

    hook.unmount();
  });

  it('passes preserveState so streaming domains keep cached snapshots', () => {
    const hook = renderHook({
      domain: 'object-details',
      scope: 'cluster:test|namespace:team-a|deployment:api',
      enabled: true,
      preserveState: true,
    });

    expect(mocks.acquireScopedDomainLease).toHaveBeenCalledWith(
      'object-details',
      'cluster:test|namespace:team-a|deployment:api',
      { preserveState: true }
    );

    hook.unmount();
  });

  it('fetches after acquiring when the caller requests a startup fetch', async () => {
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

    expect(mocks.acquireScopedDomainLease).toHaveBeenCalledWith(
      'object-map',
      'cluster:test|namespace:team-a|deployment:api',
      { preserveState: true }
    );
    expect(mocks.fetchScopedDomain).toHaveBeenCalledWith(
      'object-map',
      'cluster:test|namespace:team-a|deployment:api',
      { isManual: false, streamSignal: false }
    );

    hook.unmount();
  });

  it('blocks startup fetches while auto-refresh is paused but still releases on unmount', async () => {
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

    expect(mocks.releaseScopedDomainLease).toHaveBeenLastCalledWith(
      'object-helm-values',
      'cluster:test|namespace:team-a|helm:api',
      { preserveState: true }
    );
  });
});
