/**
 * frontend/src/core/capabilities/utils.ts
 *
 * Utility helpers for utils.
 * Provides shared helper functions for the core layer.
 */

import type {
  CapabilityDescriptor,
  CapabilityEntry,
  CapabilityState,
  CapabilityResult,
  NormalizedCapabilityDescriptor,
} from './types';

const lowerOrEmpty = (value?: string) => (value ? value.toLowerCase() : '');
const trimmedOrUndefined = (value?: string) => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Normalises a descriptor so casing/whitespace are consistent across cache keys.
 *
 * Note on group normalization: group identifiers (e.g.
 * "rds.services.k8s.aws") are case-sensitive in Kubernetes, so we preserve
 * the caller's casing and only trim whitespace. Version is likewise trimmed
 * but not case-folded. Only kind/verb/namespace/name/subresource are lowercased
 * because those are the fields that already used case-insensitive matching
 * before step 4.
 */
export const normalizeDescriptor = (
  descriptor: CapabilityDescriptor
): NormalizedCapabilityDescriptor => ({
  id: descriptor.id.trim(),
  clusterId: trimmedOrUndefined(descriptor.clusterId),
  verb: descriptor.verb.trim().toLowerCase(),
  group: trimmedOrUndefined(descriptor.group),
  version: trimmedOrUndefined(descriptor.version),
  resourceKind: descriptor.resourceKind.trim(),
  namespace: trimmedOrUndefined(descriptor.namespace),
  name: trimmedOrUndefined(descriptor.name),
  subresource: trimmedOrUndefined(descriptor.subresource),
});

/**
 * Builds the cache key used to deduplicate capability lookups.
 *
 * Group and version are included so two descriptors that differ only by
 * their API group (e.g. DBInstance.rds.services.k8s.aws vs
 * DBInstance.kinda.rocks) produce distinct keys and don't silently
 * clobber each other in the cache.
 */
export const createCapabilityKey = (
  descriptor: NormalizedCapabilityDescriptor | CapabilityResult
): string => {
  const clusterId = lowerOrEmpty(descriptor.clusterId);
  const group = (descriptor.group ?? '').trim();
  const version = (descriptor.version ?? '').trim();
  const resourceKind = lowerOrEmpty(descriptor.resourceKind);
  const verb = lowerOrEmpty(descriptor.verb);
  const namespace = lowerOrEmpty(descriptor.namespace);
  const name = lowerOrEmpty(descriptor.name);
  const subresource = lowerOrEmpty(descriptor.subresource);
  return `${clusterId}|${group}/${version}|${resourceKind}|${verb}|${namespace}|${name}|${subresource}|${descriptor.id}`;
};

/**
 * Creates an immutable placeholder entry for descriptors that have not yet been resolved.
 */
export const createPlaceholderEntry = (
  key: string,
  descriptor: NormalizedCapabilityDescriptor
): CapabilityEntry => ({
  key,
  request: descriptor,
  status: 'idle',
  error: null,
  result: undefined,
  lastFetched: undefined,
});

/**
 * Determines whether two descriptors refer to the same capability scope.
 */
export const descriptorsMatch = (
  a: NormalizedCapabilityDescriptor,
  b: NormalizedCapabilityDescriptor
): boolean =>
  a.id === b.id &&
  (a.clusterId ?? '') === (b.clusterId ?? '') &&
  a.verb === b.verb &&
  (a.group ?? '') === (b.group ?? '') &&
  (a.version ?? '') === (b.version ?? '') &&
  a.resourceKind === b.resourceKind &&
  (a.namespace ?? '') === (b.namespace ?? '') &&
  (a.name ?? '') === (b.name ?? '') &&
  (a.subresource ?? '') === (b.subresource ?? '');

const extractReason = (entry: CapabilityEntry | undefined): string | undefined => {
  if (!entry) {
    return undefined;
  }
  if (entry.error) {
    return entry.error;
  }
  const result = entry.result;
  if (!result) {
    return undefined;
  }
  return result.deniedReason || result.evaluationError || result.error || undefined;
};

/**
 * Normalises capability entry state so consumers can treat pending/denied/error uniformly.
 */
export const computeCapabilityState = (entry?: CapabilityEntry): CapabilityState => {
  if (!entry) {
    return {
      allowed: false,
      pending: true,
      status: 'idle',
    };
  }

  if (entry.status === 'idle' || entry.status === 'loading') {
    return {
      allowed: false,
      pending: true,
      status: entry.status,
    };
  }

  if (entry.status === 'error') {
    return {
      allowed: false,
      pending: false,
      status: entry.status,
      reason: extractReason(entry),
    };
  }

  const allowed = Boolean(entry.result?.allowed);
  return {
    allowed,
    pending: false,
    status: entry.status,
    reason: allowed ? undefined : extractReason(entry),
  };
};
