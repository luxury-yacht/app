import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import type { CapabilityDescriptor, CapabilityNamespaceDiagnostics } from './types';
import type { PermissionStatus } from './bootstrap';
import { useCapabilities, type UseCapabilitiesOptions, useCapabilityDiagnostics } from './hooks';
import { registerAdHocCapabilities, getPermissionKey } from './bootstrap';
import { ensureCapabilityEntries, requestCapabilities } from './store';

const permissionStore: { map: Map<string, PermissionStatus> } = { map: new Map() };
const setPermissionMap = (map: Map<string, PermissionStatus>) => {
  permissionStore.map = map;
};

const diagnosticListeners = new Set<() => void>();
let diagnosticsSnapshot: CapabilityNamespaceDiagnostics[] = [];
const setDiagnosticsSnapshot = (next: CapabilityNamespaceDiagnostics[]) => {
  diagnosticsSnapshot = next;
};
const emitDiagnosticsUpdate = () => {
  diagnosticListeners.forEach((listener) => listener());
};

vi.mock('./bootstrap', () => {
  const registerAdHocCapabilities = vi.fn();

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
    registerAdHocCapabilities,
    useUserPermissions,
    getPermissionKey,
  };
});

vi.mock('./store', () => {
  const ensureCapabilityEntries = vi.fn();
  const requestCapabilities = vi.fn();
  const subscribeDiagnostics = vi.fn((listener: () => void) => {
    diagnosticListeners.add(listener);
    return () => {
      diagnosticListeners.delete(listener);
    };
  });
  const getCapabilityDiagnosticsSnapshot = vi.fn(() => diagnosticsSnapshot);
  return {
    __esModule: true,
    ensureCapabilityEntries,
    requestCapabilities,
    subscribeDiagnostics,
    getCapabilityDiagnosticsSnapshot,
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
  const result: { current: CapabilityNamespaceDiagnostics[] | null } = { current: null };

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

  it('registers and requests capability descriptors when enabled', async () => {
    const registerAdHocMock = vi.mocked(registerAdHocCapabilities);
    const ensureEntriesMock = vi.mocked(ensureCapabilityEntries);
    const requestCapabilitiesMock = vi.mocked(requestCapabilities);

    const hook = await renderCapabilitiesHook(
      [
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
      ],
      { ttlMs: 15000 }
    );

    expect(registerAdHocMock).toHaveBeenCalledTimes(1);
    const [registeredDescriptors] = registerAdHocMock.mock.calls[0];
    expect(registeredDescriptors).toHaveLength(1);
    expect(registeredDescriptors[0]).toMatchObject({
      id: 'namespace:pods:get:default',
      resourceKind: 'Pod',
      verb: 'get',
      namespace: 'default',
    });

    expect(ensureEntriesMock).toHaveBeenCalledWith(registeredDescriptors);
    expect(requestCapabilitiesMock).toHaveBeenCalledWith(registeredDescriptors, {
      ttlMs: 15000,
      force: undefined,
    });

    expect(hook.current.loading).toBe(true);
    expect(hook.current.ready).toBe(false);
    expect(hook.current.isAllowed('namespace:pods:get:default')).toBe(false);

    await hook.unmount();
  });

  it('does nothing when disabled', async () => {
    const registerAdHocMock = vi.mocked(registerAdHocCapabilities);
    const ensureEntriesMock = vi.mocked(ensureCapabilityEntries);
    const requestCapabilitiesMock = vi.mocked(requestCapabilities);

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

    expect(registerAdHocMock).not.toHaveBeenCalled();
    expect(ensureEntriesMock).not.toHaveBeenCalled();
    expect(requestCapabilitiesMock).not.toHaveBeenCalled();
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
        id: 'cluster:nodes:list',
        resourceKind: 'Node',
        verb: 'list',
      },
      entry: {
        key: 'node|list|cluster|',
        request: {
          id: 'cluster:nodes:list',
          resourceKind: 'Node',
          verb: 'list',
        },
        status: 'ready',
      },
      reason: undefined,
      error: null,
      feature: undefined,
    };

    const pendingStatus: PermissionStatus = {
      id: 'namespace:pods:delete:alpha',
      allowed: false,
      pending: true,
      descriptor: {
        id: 'namespace:pods:delete:alpha',
        resourceKind: 'Pod',
        verb: 'delete',
        namespace: 'alpha',
      },
      entry: {
        key: 'pod|delete|alpha|',
        request: {
          id: 'namespace:pods:delete:alpha',
          resourceKind: 'Pod',
          verb: 'delete',
          namespace: 'alpha',
        },
        status: 'loading',
      },
      reason: undefined,
      error: null,
      feature: undefined,
    };

    setPermissionMap(
      new Map([
        [getPermissionKey('Node', 'list', null, null), allowedStatus],
        [getPermissionKey('Pod', 'delete', 'alpha', null), pendingStatus],
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
        ...pendingStatus.entry,
        status: 'error',
        error: 'denied',
      },
    };

    setPermissionMap(
      new Map([
        [getPermissionKey('Node', 'list', null, null), allowedStatus],
        [getPermissionKey('Pod', 'delete', 'alpha', null), deniedStatus],
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

  it('re-requests capabilities when force, ttl, or refreshKey change', async () => {
    const requestCapabilitiesMock = vi.mocked(requestCapabilities);

    const descriptor: CapabilityDescriptor = {
      id: 'namespace:configmaps:list:team',
      resourceKind: 'ConfigMap',
      verb: 'list',
      namespace: 'team',
    };

    const hook = await renderCapabilitiesHook([descriptor], {
      ttlMs: 1000,
      force: false,
      refreshKey: 0,
    });

    expect(requestCapabilitiesMock).toHaveBeenCalledTimes(1);

    requestCapabilitiesMock.mockClear();
    await hook.rerender({
      options: { ttlMs: 2500, force: true, refreshKey: 1 },
    });

    expect(requestCapabilitiesMock).toHaveBeenCalledWith(expect.any(Array), {
      ttlMs: 2500,
      force: true,
    });

    await hook.unmount();
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
        pendingCount: 1,
        inFlightCount: 0,
        consecutiveFailureCount: 0,
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
        pendingCount: 0,
        inFlightCount: 1,
        consecutiveFailureCount: 2,
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
