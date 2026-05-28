import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScopedRefreshDomainLifecycle } from './useScopedRefreshDomainLifecycle';
import type { RefreshDomain } from '@/core/refresh/types';

const mocks = vi.hoisted(() => ({
  setScopedDomainEnabled: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: (...args: unknown[]) => mocks.setScopedDomainEnabled(...args),
  },
}));

interface HookProps {
  domain: RefreshDomain | null;
  scope: string | null;
  enabled: boolean;
  preserveState?: boolean;
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
});
