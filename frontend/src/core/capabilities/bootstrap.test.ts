/**
 * frontend/src/core/capabilities/bootstrap.test.ts
 *
 * Test suite for bootstrap.
 * Covers key behaviors and edge cases for bootstrap.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityEntry, NormalizedCapabilityDescriptor } from './types';
import type { CapabilityDefinition } from './catalog';
import { eventBus } from '@/core/events';

const ensureCapabilityEntries = vi.fn();
const requestCapabilities = vi.fn();
const resetCapabilityStore = vi.fn();
const storeListeners = new Set<() => void>();

const snapshotEntries = vi.fn(
  (
    keys: readonly string[],
    descriptorMap: ReadonlyMap<string, NormalizedCapabilityDescriptor>
  ): CapabilityEntry[] =>
    keys
      .map((key) => {
        const descriptor = descriptorMap.get(key);
        if (!descriptor) {
          return null;
        }
        return {
          key,
          request: descriptor,
          status: 'ready',
          result: {
            id: descriptor.id,
            verb: descriptor.verb,
            resourceKind: descriptor.resourceKind,
            namespace: descriptor.namespace,
            allowed: true,
          },
          error: null,
        } satisfies CapabilityEntry;
      })
      .filter(Boolean) as CapabilityEntry[]
);

const subscribeCapabilities = vi.fn((listener: () => void) => {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
});

vi.mock('./store', () => ({
  ensureCapabilityEntries,
  requestCapabilities,
  resetCapabilityStore,
  snapshotEntries,
  subscribe: subscribeCapabilities,
}));

const windowListenerRegistry = new Map<string, Set<EventListener>>();
const originalAddEventListener = window.addEventListener.bind(window);
const originalRemoveEventListener = window.removeEventListener.bind(window);

const loadBootstrap = async () => {
  const module = await import('./bootstrap');
  module.__resetCapabilitiesStateForTests();
  return module;
};

const clearWindowListeners = () => {
  windowListenerRegistry.forEach((listeners, type) => {
    listeners.forEach((listener) => originalRemoveEventListener(type, listener));
  });
  windowListenerRegistry.clear();
};

beforeEach(() => {
  ensureCapabilityEntries.mockClear();
  requestCapabilities.mockClear();
  resetCapabilityStore.mockClear();
  snapshotEntries.mockClear();
  subscribeCapabilities.mockClear();
  storeListeners.clear();
  clearWindowListeners();

  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    const typed = String(type);
    if (!windowListenerRegistry.has(typed)) {
      windowListenerRegistry.set(typed, new Set());
    }
    windowListenerRegistry.get(typed)!.add(listener as EventListener);
    return originalAddEventListener(type, listener, options);
  });

  vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    const typed = String(type);
    windowListenerRegistry.get(typed)?.delete(listener as EventListener);
    return originalRemoveEventListener(type, listener, options);
  });
});

afterEach(() => {
  (window.addEventListener as unknown as { mockRestore: () => void }).mockRestore();
  (window.removeEventListener as unknown as { mockRestore: () => void }).mockRestore();
  clearWindowListeners();
});

describe('capabilities bootstrap helpers', () => {
  it('registers namespace capability definitions and dedupes existing entries', async () => {
    const bootstrap = await loadBootstrap();
    const { registerNamespaceCapabilityDefinitions } = bootstrap;

    const definition: CapabilityDefinition = {
      id: 'namespace:workloads:patch:default',
      scope: 'namespace',
      feature: 'Nodes pod actions',
      descriptor: {
        id: 'namespace:workloads:patch:default',
        resourceKind: 'Deployment',
        verb: 'patch',
      },
    };

    registerNamespaceCapabilityDefinitions(' default ', [
      definition,
      { ...definition, id: 'duplicate', descriptor: { ...definition.descriptor } },
      {
        id: 'invalid',
        scope: 'namespace',
        descriptor: { id: '', resourceKind: 'Service', verb: 'get' },
      },
    ]);

    expect(ensureCapabilityEntries).toHaveBeenCalledTimes(1);
    const [addedDescriptors] = ensureCapabilityEntries.mock.calls[0];
    expect(addedDescriptors).toHaveLength(1);
    expect(addedDescriptors[0]).toMatchObject({
      id: 'namespace:workloads:patch:default',
      resourceKind: 'Deployment',
      verb: 'patch',
      namespace: 'default',
    });

    expect(requestCapabilities).toHaveBeenCalledWith(addedDescriptors, {
      force: false,
      ttlMs: undefined,
    });

    ensureCapabilityEntries.mockClear();
    requestCapabilities.mockClear();

    registerNamespaceCapabilityDefinitions('default', [definition]);
    expect(ensureCapabilityEntries).not.toHaveBeenCalled();
    expect(requestCapabilities).not.toHaveBeenCalled();

    requestCapabilities.mockClear();
    registerNamespaceCapabilityDefinitions('default', [definition], {
      force: true,
      ttlMs: 90000,
    });
    expect(requestCapabilities).toHaveBeenCalledTimes(1);
    const [forceDescriptors, forceOptions] = requestCapabilities.mock.calls[0];
    expect(forceDescriptors).toHaveLength(1);
    expect(forceOptions).toEqual({ force: true, ttlMs: 90000 });
  });

  it('registers ad-hoc capabilities and notifies listeners only when new descriptors are added', async () => {
    const bootstrap = await loadBootstrap();
    const { registerAdHocCapabilities, getUserPermission, subscribeUserPermissions } = bootstrap;

    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    const adHocDescriptor: NormalizedCapabilityDescriptor = {
      id: 'adhoc:roles:get:team-a',
      resourceKind: 'Role',
      verb: 'get',
      namespace: 'team-a',
    };

    registerAdHocCapabilities([adHocDescriptor, { ...adHocDescriptor }]);

    expect(ensureCapabilityEntries).toHaveBeenCalledTimes(1);
    expect(ensureCapabilityEntries.mock.calls[0][0]).toHaveLength(1);
    expect(listener).toHaveBeenCalledTimes(1);

    const permission = getUserPermission('Role', 'get', 'team-a');
    expect(permission?.descriptor.id).toBe(adHocDescriptor.id);

    ensureCapabilityEntries.mockClear();
    listener.mockClear();

    registerAdHocCapabilities([{ ...adHocDescriptor }]);
    expect(ensureCapabilityEntries).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('evaluates namespace permissions with default TTL and force flags', async () => {
    const bootstrap = await loadBootstrap();
    const {
      registerNamespaceCapabilityDefinitions,
      evaluateNamespacePermissions,
      DEFAULT_CAPABILITY_TTL_MS,
    } = bootstrap;

    const definition: CapabilityDefinition = {
      id: 'namespace:configmaps:list:metrics',
      scope: 'namespace',
      descriptor: {
        id: 'namespace:configmaps:list:metrics',
        resourceKind: 'ConfigMap',
        verb: 'list',
      },
    };

    registerNamespaceCapabilityDefinitions('metrics', [definition]);

    ensureCapabilityEntries.mockClear();
    requestCapabilities.mockClear();

    evaluateNamespacePermissions('metrics');

    expect(ensureCapabilityEntries).toHaveBeenCalledTimes(1);
    expect(requestCapabilities).toHaveBeenCalledWith(expect.any(Array), {
      force: false,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    });

    requestCapabilities.mockClear();
    evaluateNamespacePermissions('metrics', { force: true });
    expect(requestCapabilities).toHaveBeenCalledWith(expect.any(Array), {
      force: true,
      ttlMs: DEFAULT_CAPABILITY_TTL_MS,
    });

    evaluateNamespacePermissions('  ');
    expect(requestCapabilities).toHaveBeenCalledTimes(1);
  });

  it('bootstraps cluster permissions once and reacts to kubeconfig events', async () => {
    const bootstrap = await loadBootstrap();
    const { initializeUserPermissionsBootstrap, getUserPermission, subscribeUserPermissions } =
      bootstrap;

    const listener = vi.fn();
    const unsubscribe = subscribeUserPermissions(listener);

    initializeUserPermissionsBootstrap();

    expect(subscribeCapabilities).toHaveBeenCalledTimes(1);
    expect(requestCapabilities).toHaveBeenCalledWith(expect.any(Array), { force: true });

    const clusterPermission = getUserPermission('Namespace', 'list');
    expect(clusterPermission?.allowed).toBe(true);

    requestCapabilities.mockClear();
    initializeUserPermissionsBootstrap();
    expect(subscribeCapabilities).toHaveBeenCalledTimes(1);
    expect(requestCapabilities).toHaveBeenCalledWith(expect.any(Array), { force: false });

    eventBus.emit('kubeconfig:changing', '');
    expect(resetCapabilityStore).toHaveBeenCalledTimes(1);

    requestCapabilities.mockClear();
    eventBus.emit('kubeconfig:changed', '');
    expect(requestCapabilities).toHaveBeenCalledWith(expect.any(Array), { force: true });

    listener.mockClear();
    storeListeners.forEach((notify) => notify());
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });
});
