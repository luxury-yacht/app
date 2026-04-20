import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClusterMetricsAvailability } from './useMetricsAvailability';

const hoisted = vi.hoisted(() => ({
  refreshOrchestrator: {
    setScopedDomainEnabled: vi.fn(),
  },
  requestRefreshDomain: vi.fn().mockResolvedValue({ status: 'executed' }),
  kubeconfigStateRef: {
    current: {
      selectedClusterId: 'cluster-1',
      selectedClusterIds: ['cluster-1'],
    },
  },
  viewStateRef: {
    current: {
      viewType: 'namespace',
    },
  },
  domainStateRef: {
    current: {
      data: null,
      status: 'idle',
      error: null,
    },
  },
  scopedDomainCalls: [] as Array<[string, string]>,
}));

vi.mock('@/core/data-access', () => ({
  requestRefreshDomain: (...args: unknown[]) => hoisted.requestRefreshDomain(...args),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: hoisted.refreshOrchestrator,
  useRefreshScopedDomain: (domain: string, scope: string) => {
    hoisted.scopedDomainCalls.push([domain, scope]);
    return hoisted.domainStateRef.current;
  },
}));

vi.mock('@/core/contexts/ViewStateContext', () => ({
  useViewState: () => hoisted.viewStateRef.current,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => hoisted.kubeconfigStateRef.current,
}));

describe('useClusterMetricsAvailability', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const resultRef: { current: ReturnType<typeof useClusterMetricsAvailability> | null } = {
    current: null,
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    resultRef.current = null;
    hoisted.refreshOrchestrator.setScopedDomainEnabled.mockReset();
    hoisted.requestRefreshDomain.mockClear();
    hoisted.kubeconfigStateRef.current = {
      selectedClusterId: 'cluster-1',
      selectedClusterIds: ['cluster-1'],
    };
    hoisted.viewStateRef.current = {
      viewType: 'namespace',
    };
    hoisted.domainStateRef.current = {
      data: null,
      status: 'idle',
      error: null,
    };
    hoisted.scopedDomainCalls.length = 0;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('uses the active cluster scope instead of the multi-cluster selection set', async () => {
    hoisted.kubeconfigStateRef.current = {
      selectedClusterId: 'cluster-1',
      selectedClusterIds: ['cluster-1', 'cluster-2'],
    };

    const HookHarness: React.FC = () => {
      resultRef.current = useClusterMetricsAvailability();
      return null;
    };

    await act(async () => {
      root.render(<HookHarness />);
      await Promise.resolve();
    });

    expect(hoisted.scopedDomainCalls).toContainEqual(['cluster-overview', 'cluster-1|']);
    expect(hoisted.refreshOrchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
      'cluster-overview',
      'cluster-1|',
      true
    );
    expect(hoisted.requestRefreshDomain).toHaveBeenCalledWith({
      domain: 'cluster-overview',
      scope: 'cluster-1|',
      reason: 'startup',
    });
  });
});
