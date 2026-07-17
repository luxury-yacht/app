/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.test.tsx
 *
 * Test suite for ClusterResourcesManager.
 * Covers key behaviors and edge cases for ClusterResourcesManager.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

import { ClusterResourcesManager } from './ClusterResourcesManager';

type ClusterKey = 'nodes' | 'rbac' | 'storage' | 'config' | 'crds' | 'custom' | 'events';
interface CapturedViewProps {
  activeTab: ClusterKey;
  nodesError?: string | null;
  eventsError?: string | null;
}

const { viewPropsRef, permissionState } = vi.hoisted(() => ({
  viewPropsRef: { current: null as CapturedViewProps | null },
  permissionState: new Map<
    string,
    { allowed: boolean; pending: boolean; reason?: string; entry?: { status: string } }
  >(),
}));

vi.mock('@modules/cluster/components/ClusterResourcesViews', () => ({
  __esModule: true,
  default: (props: CapturedViewProps) => {
    viewPropsRef.current = props;
    return <div data-testid="cluster-resources-view" />;
  },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a' }),
}));

const orchestratorMocks = vi.hoisted(() => ({
  resetDomain: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: orchestratorMocks,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermission: (kind: string, action: string) => {
    const key = `${kind}:${action}`;
    return permissionState.get(key) ?? { allowed: true, pending: false };
  },
}));

describe('ClusterResourcesManager', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    viewPropsRef.current = null;
    permissionState.clear();
    orchestratorMocks.resetDomain.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderManager = async (activeTab: ClusterKey) => {
    await act(async () => {
      root.render(<ClusterResourcesManager activeTab={activeTab} />);
      await Promise.resolve();
    });
  };

  it('resets every managed cluster domain when the kubeconfig starts changing', async () => {
    // This teardown-hygiene effect lived in the (deleted) ClusterResourcesContext
    // provider, which wrapped exactly this manager — same mount lifetime, so the
    // manager is its new home.
    const { eventBus } = await import('@/core/events');
    orchestratorMocks.resetDomain.mockClear();
    await renderManager('nodes');

    await act(async () => {
      eventBus.emit('kubeconfig:changing', undefined as never);
      await Promise.resolve();
    });

    const resetDomains = orchestratorMocks.resetDomain.mock.calls.map((call) => call[0]).sort();
    expect(resetDomains).toEqual([
      'cluster-attention',
      'cluster-config',
      'cluster-crds',
      'cluster-events',
      'cluster-rbac',
      'cluster-storage',
      'nodes',
    ]);
  });

  it('forwards per-view permission-derived errors downstream', async () => {
    permissionState.set('Node:list', {
      allowed: false,
      pending: false,
      reason: 'nodes denied',
      entry: { status: 'ready' },
    });

    await renderManager('nodes');

    const props = requireValue(viewPropsRef.current, 'expected captured cluster view props');
    expect(props).toBeTruthy();
    expect(props.activeTab).toBe('nodes');
    expect(props.nodesError).toBe('nodes denied');
  });
  it('respects permission denials and avoids loading', async () => {
    permissionState.set('Event:list', {
      allowed: false,
      pending: false,
      reason: 'forbidden',
      entry: { status: 'ready' },
    });
    await renderManager('events');

    const props = requireValue(viewPropsRef.current, 'expected captured cluster view props');
    expect(props.eventsError).toBe('forbidden');
  });
});
