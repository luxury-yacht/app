/**
 * frontend/src/core/capabilities/hooks.test.tsx
 *
 * Test suite for hooks.
 * Covers key behaviors and edge cases for hooks.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '@/core/events';
import { installWindowProperty } from '@/test-utils/windowProperty';
import { type UseCapabilitiesOptions, useCapabilities, useCapabilityDiagnostics } from './hooks';
import type { PermissionQueryDiagnostics, PermissionStatus } from './permissionTypes';
import type { CapabilityDescriptor } from './types';

const lifecycleMock = vi.hoisted(() => ({
  current: undefined as
    | undefined
    | {
        isClusterReady: (clusterId: string) => boolean;
      },
}));

vi.mock('@/core/contexts/ClusterLifecycleContext', () => ({
  useOptionalClusterLifecycle: () => lifecycleMock.current,
}));

const permissionStore: { map: Map<string, PermissionStatus> } = { map: new Map() };
const setPermissionMap = (map: Map<string, PermissionStatus>) => {
  permissionStore.map = map;
};

const diagnosticListeners = new Set<() => void>();
let diagnosticsSnapshot: PermissionQueryDiagnostics[] = [];
const setDiagnosticsSnapshot = (next: PermissionQueryDiagnostics[]) => {
  diagnosticsSnapshot = next;
};
const emitDiagnosticsUpdate = () => {
  diagnosticListeners.forEach((listener) => {
    listener();
  });
};

vi.mock('./permissionStore', () => {
  const subscribeDiagnostics = vi.fn((listener: () => void) => {
    diagnosticListeners.add(listener);
    return () => {
      diagnosticListeners.delete(listener);
    };
  });
  const getPermissionQueryDiagnosticsSnapshot = vi.fn(() => diagnosticsSnapshot);

  const getPermissionKey = (
    resourceKind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null
  ) => {
    const kind = resourceKind.toLowerCase();
    const action = verb.toLowerCase();
    const ns = namespace ? namespace.toLowerCase() : 'cluster';
    const sub = subresource ? subresource.toLowerCase() : '';
    return `${kind}|${action}|${ns}|${sub}`;
  };

  // useUserPermissions reads the store via useSyncExternalStore; tests drive
  // updates by swapping the map and re-rendering, so subscribe is inert.
  const subscribeUserPermissions = vi.fn(() => () => undefined);
  const getUserPermissionMap = vi.fn(() => permissionStore.map);

  return {
    __esModule: true,
    subscribeDiagnostics,
    getPermissionQueryDiagnosticsSnapshot,
    getPermissionKey,
    subscribeUserPermissions,
    getUserPermissionMap,
  };
});

const renderCapabilitiesHook = async (
  descriptors: CapabilityDescriptor[],
  options: UseCapabilitiesOptions = {}
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const props = { descriptors, options };
  const result: { current: ReturnType<typeof useCapabilities> | null } = { current: null };

  const HookConsumer: React.FC<typeof props> = (incoming) => {
    result.current = useCapabilities(incoming.descriptors, incoming.options);
    return null;
  };

  const render = async () => {
    await act(async () => {
      root.render(<HookConsumer {...props} />);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  };

  await render();

  return {
    get current() {
      if (!result.current) {
        throw new Error('Hook result not initialised');
      }
      return result.current;
    },
    async rerender(
      update: { descriptors?: CapabilityDescriptor[]; options?: UseCapabilitiesOptions } = {}
    ) {
      if (update.descriptors) {
        props.descriptors = update.descriptors;
      }
      if (update.options) {
        props.options = update.options;
      }
      await render();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const renderDiagnosticsHook = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const result: { current: PermissionQueryDiagnostics[] | null } = { current: null };

  const HookConsumer: React.FC = () => {
    result.current = useCapabilityDiagnostics();
    return null;
  };

  await act(async () => {
    root.render(<HookConsumer />);
    await Promise.resolve();
  });

  return {
    get current() {
      if (!result.current) {
        throw new Error('Diagnostics hook not initialised');
      }
      return result.current;
    },
    async rerender() {
      await act(async () => {
        root.render(<HookConsumer />);
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useCapabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventBus.clear();
    lifecycleMock.current = undefined;
    setPermissionMap(new Map());
    setDiagnosticsSnapshot([]);
    diagnosticListeners.clear();
  });

  afterEach(() => {
    eventBus.clear();
    vi.clearAllMocks();
  });

  it('returns idle state for descriptors not yet in the permission map', async () => {
    const hook = await renderCapabilitiesHook([
      {
        id: 'namespace:pods:get:default',
        resourceKind: 'Pod',
        verb: 'get',
        namespace: 'default',
      },
    ]);

    // Unnamed descriptor not in the map => idle/pending state.
    expect(hook.current.loading).toBe(true);
    expect(hook.current.ready).toBe(false);
    expect(hook.current.isAllowed('namespace:pods:get:default')).toBe(false);
    expect(hook.current.getState('namespace:pods:get:default')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'idle',
    });

    await hook.unmount();
  });

  it('filters out invalid descriptors (empty id or missing verb/resourceKind)', async () => {
    const hook = await renderCapabilitiesHook([
      {
        id: ' namespace:pods:get:default ',
        resourceKind: ' Pod ',
        verb: ' get ',
        namespace: ' default ',
      },
      {
        id: '',
        resourceKind: 'Deployment',
        verb: 'patch',
      },
    ]);

    // The second descriptor has an empty id after normalization, so it should be filtered out.
    // Only the first descriptor should produce a state entry.
    expect(hook.current.getState('namespace:pods:get:default')).toMatchObject({
      pending: true,
      status: 'idle',
    });

    await hook.unmount();
  });

  it('does nothing when disabled', async () => {
    const hook = await renderCapabilitiesHook(
      [
        {
          id: 'cluster:nodes:list',
          resourceKind: 'Node',
          verb: 'list',
        },
      ],
      { enabled: false }
    );

    expect(hook.current.loading).toBe(false);
    expect(hook.current.ready).toBe(false);
    expect(hook.current.getState('cluster:nodes:list')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'idle',
    });

    await hook.unmount();
  });

  it('derives capability states from the permission map', async () => {
    const descriptors: CapabilityDescriptor[] = [
      { id: 'cluster:nodes:list', resourceKind: 'Node', verb: 'list' },
      {
        id: 'namespace:pods:delete:alpha',
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'alpha',
      },
    ];

    const allowedStatus: PermissionStatus = {
      id: 'cluster:nodes:list',
      allowed: true,
      pending: false,
      descriptor: {
        clusterId: 'default',
        group: null,
        version: null,
        resourceKind: 'Node',
        verb: 'list',
        namespace: null,
        subresource: null,
      },
      entry: {
        status: 'ready',
      },
      reason: null,
      error: null,
      source: 'ssrr',
      feature: undefined,
    };

    const pendingStatus: PermissionStatus = {
      id: 'namespace:pods:delete:alpha',
      allowed: false,
      pending: true,
      descriptor: {
        clusterId: 'default',
        group: null,
        version: null,
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'alpha',
        subresource: null,
      },
      entry: {
        status: 'loading',
      },
      reason: null,
      error: null,
      source: null,
      feature: undefined,
    };

    // The getPermissionKey mock uses kind|verb|ns|sub format.
    setPermissionMap(
      new Map([
        ['node|list|cluster|', allowedStatus],
        ['pod|delete|alpha|', pendingStatus],
      ])
    );

    const hook = await renderCapabilitiesHook(descriptors);

    expect(hook.current.loading).toBe(true);
    expect(hook.current.ready).toBe(false);
    expect(hook.current.isAllowed('cluster:nodes:list')).toBe(true);
    expect(hook.current.getState('namespace:pods:delete:alpha')).toMatchObject({
      pending: true,
      status: 'loading',
    });

    const deniedStatus: PermissionStatus = {
      ...pendingStatus,
      pending: false,
      error: 'denied',
      descriptor: pendingStatus.descriptor,
      entry: {
        status: 'error',
      },
    };

    setPermissionMap(
      new Map([
        ['node|list|cluster|', allowedStatus],
        ['pod|delete|alpha|', deniedStatus],
      ])
    );

    await hook.rerender();

    expect(hook.current.loading).toBe(false);
    expect(hook.current.ready).toBe(true);
    expect(hook.current.getState('namespace:pods:delete:alpha')).toMatchObject({
      pending: false,
      status: 'error',
      reason: 'denied',
    });

    await hook.unmount();
  });

  it('queries named-resource descriptors via QueryPermissions RPC', async () => {
    // Set up the window.go.backend.App.QueryPermissions mock.
    const mockQueryPermissions = vi.fn().mockResolvedValue({
      results: [
        {
          id: 'named:pods:get:default:my-pod',
          clusterId: '',
          resourceKind: 'Pod',
          verb: 'get',
          namespace: 'default',
          subresource: '',
          name: 'my-pod',
          allowed: true,
          source: 'ssar',
          reason: '',
          error: '',
        },
      ],
    });

    const restoreGo = installWindowProperty('go', {
      backend: {
        App: {
          QueryPermissions: mockQueryPermissions,
        },
      },
    });

    const hook = await renderCapabilitiesHook([
      {
        id: 'named:pods:get:default:my-pod',
        clusterId: 'test-cluster',
        resourceKind: 'Pod',
        verb: 'get',
        namespace: 'default',
        name: 'my-pod',
      },
    ]);

    // Wait for the async QueryPermissions call to resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockQueryPermissions).toHaveBeenCalledTimes(1);
    expect(hook.current.isAllowed('named:pods:get:default:my-pod')).toBe(true);
    expect(hook.current.getState('named:pods:get:default:my-pod')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });

    await hook.unmount();

    // Clean up.
    restoreGo();
  });

  it('requeries named-resource descriptors when refreshKey changes', async () => {
    const mockQueryPermissions = vi.fn().mockResolvedValue({ results: [] });
    const restoreGo = installWindowProperty('go', {
      backend: { App: { QueryPermissions: mockQueryPermissions } },
    });
    const descriptors: CapabilityDescriptor[] = [
      {
        id: 'named:pods:get:default:my-pod',
        clusterId: 'test-cluster',
        group: '',
        version: 'v1',
        resourceKind: 'Pod',
        verb: 'get',
        namespace: 'default',
        name: 'my-pod',
      },
    ];
    const hook = await renderCapabilitiesHook(descriptors, { refreshKey: 0 });

    expect(mockQueryPermissions).toHaveBeenCalledTimes(1);

    await hook.rerender({ options: { refreshKey: 1 } });

    expect(mockQueryPermissions).toHaveBeenCalledTimes(2);

    await hook.unmount();
    restoreGo();
  });

  it('waits for cluster readiness before querying named-resource descriptors', async () => {
    lifecycleMock.current = {
      isClusterReady: () => false,
    };
    const mockQueryPermissions = vi.fn().mockResolvedValue({
      results: [
        {
          id: 'named:nodes:patch:node-a',
          clusterId: 'test-cluster',
          resourceKind: 'Node',
          verb: 'patch',
          namespace: '',
          subresource: '',
          name: 'node-a',
          allowed: true,
          source: 'ssar',
          reason: '',
          error: '',
        },
      ],
    });

    const restoreGo = installWindowProperty('go', {
      backend: {
        App: {
          QueryPermissions: mockQueryPermissions,
        },
      },
    });

    const hook = await renderCapabilitiesHook([
      {
        id: 'named:nodes:patch:node-a',
        clusterId: 'test-cluster',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        verb: 'patch',
        name: 'node-a',
      },
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockQueryPermissions).not.toHaveBeenCalled();
    expect(hook.current.getState('named:nodes:patch:node-a')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
      reason: 'Cluster is not ready',
    });

    lifecycleMock.current = {
      isClusterReady: (clusterId: string) => clusterId === 'test-cluster',
    };
    await act(async () => {
      eventBus.emit('cluster:lifecycle', {
        clusterId: 'test-cluster',
        state: 'ready',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mockQueryPermissions).toHaveBeenCalledTimes(1));
    expect(hook.current.getState('named:nodes:patch:node-a')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });

    await hook.unmount();
    restoreGo();
  });

  it('keeps transient cluster activation errors pending and retries named descriptors on ready', async () => {
    const mockQueryPermissions = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            id: 'named:nodes:patch:node-a',
            clusterId: 'test-cluster',
            resourceKind: 'Node',
            verb: 'patch',
            namespace: '',
            subresource: '',
            name: 'node-a',
            allowed: false,
            source: 'error',
            reason:
              'failed to resolve resource kind "Node": cluster test-cluster:test-cluster not active',
            error: '',
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: 'named:nodes:patch:node-a',
            clusterId: 'test-cluster',
            resourceKind: 'Node',
            verb: 'patch',
            namespace: '',
            subresource: '',
            name: 'node-a',
            allowed: true,
            source: 'ssar',
            reason: '',
            error: '',
          },
        ],
      });

    const restoreGo = installWindowProperty('go', {
      backend: {
        App: {
          QueryPermissions: mockQueryPermissions,
        },
      },
    });

    const hook = await renderCapabilitiesHook([
      {
        id: 'named:nodes:patch:node-a',
        clusterId: 'test-cluster',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        verb: 'patch',
        name: 'node-a',
      },
    ]);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockQueryPermissions).toHaveBeenCalledTimes(1);
    expect(hook.current.getState('named:nodes:patch:node-a')).toMatchObject({
      allowed: false,
      pending: true,
      status: 'loading',
    });

    await act(async () => {
      eventBus.emit('cluster:lifecycle', {
        clusterId: 'test-cluster',
        state: 'ready',
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mockQueryPermissions).toHaveBeenCalledTimes(2));
    expect(hook.current.getState('named:nodes:patch:node-a')).toMatchObject({
      allowed: true,
      pending: false,
      status: 'ready',
    });

    await hook.unmount();
    restoreGo();
  });
});

describe('useCapabilityDiagnostics', () => {
  beforeEach(() => {
    setDiagnosticsSnapshot([]);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('subscribes to diagnostics updates and reflects new snapshots', async () => {
    setDiagnosticsSnapshot([
      {
        key: 'namespace:alpha',
        namespace: 'alpha',
        method: 'ssrr',
        pendingCount: 1,
        inFlightCount: 0,
        consecutiveFailureCount: 0,
        totalChecks: 0,
        lastDescriptors: [],
      },
    ]);

    const hook = await renderDiagnosticsHook();
    expect(hook.current).toHaveLength(1);
    expect(hook.current[0]?.namespace).toBe('alpha');

    setDiagnosticsSnapshot([
      {
        key: 'namespace:beta',
        namespace: 'beta',
        method: 'ssrr',
        pendingCount: 0,
        inFlightCount: 1,
        consecutiveFailureCount: 2,
        totalChecks: 0,
        lastDescriptors: [],
      },
    ]);
    await act(async () => {
      emitDiagnosticsUpdate();
    });

    await hook.rerender();
    expect(hook.current).toHaveLength(1);
    expect(hook.current[0]?.namespace).toBe('beta');

    await hook.unmount();
  });
});
