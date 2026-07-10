/**
 * View State Type Definitions
 *
 * The LOOSE, pre-validation object-reference shapes: raw Kubernetes payloads
 * and heterogeneous link/row inputs before they reach a validation boundary.
 * Past that boundary, carry `ClusterObjectReference` (or a builder result)
 * from `@shared/utils/objectIdentity` instead — the compiler then enforces
 * full identity, and these nullable shapes must not leak further downstream.
 */
import type { ResourceRef } from '@core/refresh/types';

type NullableResourceRefFields = {
  [K in keyof ResourceRef]?: ResourceRef[K] | null;
};

/**
 * Standard Kubernetes object metadata structure.
 * Matches the metadata field in Kubernetes API objects.
 */
export interface KubernetesMetadata {
  kind?: string;
  name?: string;
  namespace?: string;
  uid?: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/**
 * A Kubernetes object that may have metadata in either format:
 * - Raw K8s API format with `metadata` object
 * - Flattened format with properties at top level
 *
 * ViewStateContext handles both formats by checking:
 * `obj?.metadata?.kind || obj?.kind`
 */
export interface KubernetesObjectReference extends NullableResourceRefFields {
  kindAlias?: string | null;
  clusterName?: string | null;

  // Raw Kubernetes API format (metadata object)
  metadata?: KubernetesMetadata;

  // Allow additional properties from various resource types.
  // Kept for backwards compatibility — new callers should prefer the typed
  // fields above.
  [key: string]: unknown;
}
