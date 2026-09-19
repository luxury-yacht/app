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
 * Trims descriptor identity and normalizes the verb. An explicit empty group
 * identifies core resources and must survive normalization.
 */
export const normalizeDescriptor = (
  descriptor: CapabilityDescriptor
): NormalizedCapabilityDescriptor => ({
  id: descriptor.id.trim(),
  clusterId: trimmedOrUndefined(descriptor.clusterId),
  verb: descriptor.verb.trim().toLowerCase(),
  group: descriptor.group?.trim(),
  version: trimmedOrUndefined(descriptor.version),
  resourceKind: descriptor.resourceKind.trim(),
  namespace: trimmedOrUndefined(descriptor.namespace),
  name: trimmedOrUndefined(descriptor.name),
  subresource: trimmedOrUndefined(descriptor.subresource),
});
