/**
 * frontend/src/core/capabilities/utils.ts
 *
 * Utility helpers for capability descriptors.
 */

import type { CapabilityDescriptor, NormalizedCapabilityDescriptor } from './types';

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
 * before strict GVK routing.
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
