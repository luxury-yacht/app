/**
 * frontend/src/core/capabilities/types.ts
 *
 * Type definitions for types.
 * Defines shared interfaces and payload shapes for the core layer.
 */

export type CapabilityStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Descriptor for an individual capability check the UI wants to evaluate.
 *
 * `group` and `version` together form a fully-qualified GroupVersionKind
 * so the backend can disambiguate between two CRDs that share a Kind.
 */
export interface CapabilityDescriptor {
  id: string;
  clusterId?: string;
  verb: string;
  group?: string;
  version?: string;
  resourceKind: string;
  namespace?: string;
  name?: string;
  subresource?: string;
}

/**
 * Normalised descriptor with canonical casing/whitespace trimming applied.
 */
export interface NormalizedCapabilityDescriptor {
  id: string;
  clusterId?: string;
  verb: string;
  group?: string;
  version?: string;
  resourceKind: string;
  namespace?: string;
  name?: string;
  subresource?: string;
}

export interface CapabilityState {
  allowed: boolean;
  pending: boolean;
  status: CapabilityStatus;
  reason?: string;
}
