/**
 * frontend/src/core/capabilities/hooks.test.tsx
 *
 * Test suite for hooks.
 * Covers key behaviors and edge cases for hooks.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import type { CapabilityDescriptor } from './types';
import type { PermissionQueryDiagnostics } from './permissionTypes';
import type { PermissionStatus } from './bootstrap';
import { useCapabilities, type UseCapabilitiesOptions, useCapabilityDiagnostics } from './hooks';

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
  diagnosticListeners.forEach((listener) => listener());
};

vi.mock('./bootstrap', () => {
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

  const useUserPermissions = () => permissionStore.map;

  return {
    __esModule: true,
    useUserPermissions,
    getPermissionKey,
  };
});

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

  return {
    __esModule: true,
    subscribeDiagnostics,
    getPermissionQueryDiagnosticsSnapshot,
    getPermissionKey,
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
      update: {
        descriptors?: CapabilityDescriptor[];
        options?: UseCapabilitiesOptions;
      } = {}
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
    setPermissionMap(new Map());
    setDiagnosticsSnapshot([]);
    diagnosticListeners.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns idle state for descriptors not yet in the permission map', async () => {
    const hook = await renderCapabilitiesHook(
      [
        {
          id: 'namespace:pods:get:default',
          resourceKind: 'Pod',
          verb: 'get',
          namespace: 'default',
        },
      ],
      { ttlMs: 15000 }
    );

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

    (globalThis as any).window = globalThis.window ?? {};
    (window as any).go = {
      backend: {
        App: {
          QueryPermissions: mockQueryPermissions,
        },
      },
    };

    const hook = await renderCapabilitiesHook([
      {
        id: 'named:pods:get:default:my-pod',
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
    delete (window as any).go;
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
