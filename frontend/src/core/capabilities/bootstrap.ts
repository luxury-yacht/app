/**
 * frontend/src/core/capabilities/bootstrap.ts
 *
 * User permissions bootstrap for initializing and managing
 * capability evaluations and registrations.
 */

import { useSyncExternalStore } from 'react';

import {
  ensureCapabilityEntries,
  requestCapabilities,
  resetCapabilityStore,
  snapshotEntries,
  subscribe as subscribeCapabilities,
} from './store';
import type { CapabilityEntry, NormalizedCapabilityDescriptor } from './types';
import { CLUSTER_CAPABILITIES, type CapabilityDefinition } from './catalog';
import { createCapabilityKey, normalizeDescriptor } from './utils';
import { eventBus, type UnsubscribeFn } from '@/core/events';

export const DEFAULT_CAPABILITY_TTL_MS = 5 * 60 * 1000;

type PermissionKey = string;

export interface PermissionStatus {
  id: string;
  allowed: boolean;
  pending: boolean;
  reason?: string;
  error?: string | null;
  descriptor: NormalizedCapabilityDescriptor;
  entry: CapabilityEntry;
  feature?: string;
}

type PermissionMap = Map<PermissionKey, PermissionStatus>;

const listeners = new Set<() => void>();

let permissionMap: PermissionMap = new Map();
let storeSubscriptionRegistered = false;
let initialized = false;
let eventBusSubscribed = false;
let unsubscribeChanging: UnsubscribeFn | null = null;
let unsubscribeChanged: UnsubscribeFn | null = null;

const buildBootstrapDefinitions = (): CapabilityDefinition[] =>
  CLUSTER_CAPABILITIES.filter((capability) => capability.scope === 'cluster');

const dedupeDefinitions = (definitions: CapabilityDefinition[]) => {
  const descriptorMap = new Map<string, NormalizedCapabilityDescriptor>();
  const featureByKey = new Map<string, string | undefined>();
  const keys: string[] = [];
  const list: NormalizedCapabilityDescriptor[] = [];

  for (const definition of definitions) {
    const descriptor = definition.descriptor;
    const normalized = normalizeDescriptor(descriptor);
    const key = createCapabilityKey(normalized);
    if (descriptorMap.has(key)) {
      continue;
    }
    descriptorMap.set(key, normalized);
    keys.push(key);
    featureByKey.set(key, definition.feature);
    list.push(normalized);
  }

  return { descriptorMap, featureByKey, keys, list };
};

const BOOTSTRAP_DEFINITIONS = buildBootstrapDefinitions();
const {
  descriptorMap: BOOTSTRAP_DESCRIPTOR_MAP,
  featureByKey: BOOTSTRAP_FEATURES_BY_KEY,
  keys: BOOTSTRAP_KEYS,
  list: BOOTSTRAP_NORMALIZED_DESCRIPTORS,
} = dedupeDefinitions(BOOTSTRAP_DEFINITIONS);

type DescriptorBundle = {
  descriptorMap: ReadonlyMap<string, NormalizedCapabilityDescriptor>;
  featureByKey: ReadonlyMap<string, string | undefined>;
  keys: readonly string[];
  list: readonly NormalizedCapabilityDescriptor[];
};

type NamespaceCapabilityEntry = {
  bundle: DescriptorBundle;
  definitions: Map<string, CapabilityDefinition>;
};

const namespaceDescriptorRegistry = new Map<string, NamespaceCapabilityEntry>();
const trackedNamespaces = new Set<string>();
const adHocDescriptors = new Map<string, NormalizedCapabilityDescriptor>();
let adHocDescriptorBundle: DescriptorBundle = {
  descriptorMap: new Map(),
  featureByKey: new Map(),
  keys: [],
  list: [],
};

const dedupeNormalizedDescriptors = (
  descriptors: Iterable<NormalizedCapabilityDescriptor>
): DescriptorBundle => {
  const descriptorMap = new Map<string, NormalizedCapabilityDescriptor>();
  const featureByKey = new Map<string, string | undefined>();
  const keys: string[] = [];
  const list: NormalizedCapabilityDescriptor[] = [];

  for (const descriptor of descriptors) {
    const key = createCapabilityKey(descriptor);
    if (descriptorMap.has(key)) {
      continue;
    }
    descriptorMap.set(key, descriptor);
    keys.push(key);
    list.push(descriptor);
  }

  return {
    descriptorMap,
    featureByKey,
    keys,
    list,
  };
};

const createNamespaceCapabilityEntry = (): NamespaceCapabilityEntry => {
  const definitions = new Map<string, CapabilityDefinition>();

  return {
    definitions,
    bundle: dedupeDefinitions([]),
  };
};

const getNamespaceCapabilityEntry = (namespace: string): NamespaceCapabilityEntry => {
  const trimmed = namespace.trim();
  let entry = namespaceDescriptorRegistry.get(trimmed);
  if (entry) {
    return entry;
  }
  entry = createNamespaceCapabilityEntry();
  namespaceDescriptorRegistry.set(trimmed, entry);
  return entry;
};

const appendNamespaceDefinitions = (
  namespace: string,
  definitions: CapabilityDefinition[]
): { added: NormalizedCapabilityDescriptor[]; entry: NamespaceCapabilityEntry } => {
  const trimmed = namespace.trim();
  const entry = getNamespaceCapabilityEntry(trimmed);
  const added: NormalizedCapabilityDescriptor[] = [];

  for (const definition of definitions) {
    if (!definition) {
      continue;
    }

    const targetNamespace = definition.descriptor.namespace ?? trimmed;
    if (!targetNamespace) {
      continue;
    }

    const normalized = normalizeDescriptor({
      ...definition.descriptor,
      namespace: targetNamespace,
    });

    if (!normalized.id) {
      continue;
    }

    const key = createCapabilityKey(normalized);
    if (entry.definitions.has(key)) {
      continue;
    }

    entry.definitions.set(key, {
      ...definition,
      descriptor: {
        id: normalized.id,
        verb: normalized.verb,
        resourceKind: normalized.resourceKind,
        namespace: normalized.namespace,
        name: normalized.name,
        subresource: normalized.subresource,
      },
    });
    added.push(normalized);
  }

  if (added.length > 0) {
    entry.bundle = dedupeDefinitions(Array.from(entry.definitions.values()));
    namespaceDescriptorRegistry.set(trimmed, entry);
  }

  return { added, entry };
};

export const registerNamespaceCapabilityDefinitions = (
  namespace: string,
  definitions: CapabilityDefinition[],
  options: { force?: boolean; ttlMs?: number } = {}
): void => {
  const trimmed = namespace?.trim();
  if (!trimmed || definitions.length === 0) {
    return;
  }

  const { added, entry } = appendNamespaceDefinitions(trimmed, definitions);
  trackedNamespaces.add(trimmed);

  if (added.length === 0 && !options.force) {
    return;
  }

  if (options.force && added.length === 0) {
    requestCapabilities(Array.from(entry.bundle.list), { force: true, ttlMs: options.ttlMs });
    return;
  }

  ensureCapabilityEntries(added);
  requestCapabilities(added, { force: options.force ?? false, ttlMs: options.ttlMs });
};

const makePermissionKey = (
  descriptor: Pick<
    NormalizedCapabilityDescriptor,
    'resourceKind' | 'verb' | 'namespace' | 'subresource'
  >
): PermissionKey => {
  const resourceKind = descriptor.resourceKind.toLowerCase();
  const verb = descriptor.verb.toLowerCase();
  const namespace = descriptor.namespace ? descriptor.namespace.toLowerCase() : 'cluster';
  const subresource = descriptor.subresource ? descriptor.subresource.toLowerCase() : '';
  return `${resourceKind}|${verb}|${namespace}|${subresource}`;
};

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

const convertEntryToStatus = (entry: CapabilityEntry, feature?: string): PermissionStatus => {
  const pending = entry.status === 'idle' || entry.status === 'loading';
  const allowed = entry.status === 'ready' && Boolean(entry.result?.allowed);

  const reason =
    entry.status === 'error'
      ? entry.error || entry.result?.evaluationError || entry.result?.deniedReason || undefined
      : allowed
        ? undefined
        : entry.result?.deniedReason || entry.result?.evaluationError || undefined;

  return {
    id: entry.request.id,
    allowed,
    pending,
    reason,
    error: entry.error ?? null,
    descriptor: entry.request,
    entry,
    feature,
  };
};

const rebuildPermissionMap = () => {
  const nextMap: PermissionMap = new Map();

  const appendEntries = (
    entries: readonly CapabilityEntry[],
    features?: ReadonlyMap<string, string | undefined>
  ) => {
    entries.forEach((entry) => {
      const key = makePermissionKey(entry.request);
      nextMap.set(key, convertEntryToStatus(entry, features?.get(entry.key)));
    });
  };

  appendEntries(
    snapshotEntries(BOOTSTRAP_KEYS, BOOTSTRAP_DESCRIPTOR_MAP),
    BOOTSTRAP_FEATURES_BY_KEY
  );

  if (adHocDescriptorBundle.list.length > 0) {
    appendEntries(snapshotEntries(adHocDescriptorBundle.keys, adHocDescriptorBundle.descriptorMap));
  }

  trackedNamespaces.forEach((namespace) => {
    const entry = namespaceDescriptorRegistry.get(namespace);
    if (!entry) {
      return;
    }
    const { bundle } = entry;
    appendEntries(snapshotEntries(bundle.keys, bundle.descriptorMap), bundle.featureByKey);
  });

  permissionMap = nextMap;
  notifyListeners();
};

export const registerAdHocCapabilities = (
  descriptors: ReadonlyArray<NormalizedCapabilityDescriptor>
): void => {
  let changed = false;
  descriptors.forEach((descriptor) => {
    const normalized = normalizeDescriptor(descriptor);
    if (!normalized.id) {
      return;
    }
    const key = createCapabilityKey(normalized);
    const existing = adHocDescriptors.get(key);
    if (!existing) {
      adHocDescriptors.set(key, normalized);
      changed = true;
    }
  });

  if (!changed) {
    return;
  }

  adHocDescriptorBundle = dedupeNormalizedDescriptors(adHocDescriptors.values());
  ensureCapabilityEntries(adHocDescriptorBundle.list);
  rebuildPermissionMap();
};

const refreshClusterPermissions = (force: boolean) => {
  ensureCapabilityEntries(BOOTSTRAP_NORMALIZED_DESCRIPTORS);
  requestCapabilities(BOOTSTRAP_NORMALIZED_DESCRIPTORS, {
    force,
  });
};

export const evaluateNamespacePermissions = (
  namespace: string,
  options: { force?: boolean } = {}
): void => {
  const trimmed = namespace?.trim();
  if (!trimmed) {
    return;
  }

  const alreadyTracked = trackedNamespaces.has(trimmed);
  const entry = getNamespaceCapabilityEntry(trimmed);
  trackedNamespaces.add(trimmed);

  if (entry.bundle.list.length === 0) {
    return;
  }

  ensureCapabilityEntries(entry.bundle.list);
  requestCapabilities(entry.bundle.list, {
    force: options.force ?? !alreadyTracked,
    ttlMs: DEFAULT_CAPABILITY_TTL_MS,
  });
};

const clearTrackedPermissions = () => {
  namespaceDescriptorRegistry.clear();
  trackedNamespaces.clear();
  permissionMap = new Map();
  notifyListeners();
};

const registerEventBusListeners = () => {
  if (eventBusSubscribed) {
    return;
  }

  unsubscribeChanging = eventBus.on('kubeconfig:changing', () => {
    resetCapabilityStore();
    clearTrackedPermissions();
  });

  unsubscribeChanged = eventBus.on('kubeconfig:changed', () => {
    refreshClusterPermissions(true);
  });

  eventBusSubscribed = true;
};

export const initializeUserPermissionsBootstrap = (): void => {
  if (initialized) {
    refreshClusterPermissions(false);
    return;
  }

  if (!storeSubscriptionRegistered) {
    subscribeCapabilities(rebuildPermissionMap);
    storeSubscriptionRegistered = true;
  }
  rebuildPermissionMap();
  refreshClusterPermissions(true);
  registerEventBusListeners();

  initialized = true;
};

export const subscribeUserPermissions = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getUserPermissionMap = (): PermissionMap => permissionMap;

export const getUserPermission = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null
): PermissionStatus | undefined => {
  const key = makePermissionKey({
    resourceKind,
    verb,
    namespace: namespace ?? undefined,
    subresource: subresource ?? undefined,
  });
  return permissionMap.get(key);
};

export const useUserPermissions = (): PermissionMap =>
  useSyncExternalStore(subscribeUserPermissions, getUserPermissionMap, getUserPermissionMap);

export const useUserPermission = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null
): PermissionStatus | undefined => {
  const map = useUserPermissions();
  const key = getPermissionKey(resourceKind, verb, namespace, subresource);
  return map.get(key);
};

export const getPermissionKey = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null
): PermissionKey =>
  makePermissionKey({
    resourceKind,
    verb,
    namespace: namespace ?? undefined,
    subresource: subresource ?? undefined,
  });

/** @public Used in bootstrap.test.ts via dynamic import */
export const __resetCapabilitiesStateForTests = (): void => {
  listeners.clear();
  permissionMap = new Map();
  namespaceDescriptorRegistry.clear();
  trackedNamespaces.clear();
  adHocDescriptors.clear();
  adHocDescriptorBundle = {
    descriptorMap: new Map(),
    featureByKey: new Map(),
    keys: [],
    list: [],
  };
  storeSubscriptionRegistered = false;
  initialized = false;
  if (unsubscribeChanging) {
    unsubscribeChanging();
    unsubscribeChanging = null;
  }
  if (unsubscribeChanged) {
    unsubscribeChanged();
    unsubscribeChanged = null;
  }
  eventBusSubscribed = false;
};
