/**
 * View State Type Definitions
 *
 * Types for objects managed by ViewStateContext, including selected objects
 * and navigation history.
 */

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
export interface KubernetesObjectReference {
  // Flattened properties (may be present at top level)
  kind?: string | null;
  kindAlias?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;

  // Raw Kubernetes API format (metadata object)
  metadata?: KubernetesMetadata;

  // Allow additional properties from various resource types
  [key: string]: unknown;
}

/**
 * Entry in the navigation history stack.
 * Stores the object data needed to restore a previous selection.
 */
export type NavigationHistoryEntry = KubernetesObjectReference;

/**
 * Helper to extract the kind from a Kubernetes object reference.
 * Handles both raw and flattened formats.
 */
export function getObjectKind(
  obj: KubernetesObjectReference | null | undefined
): string | undefined {
  return obj?.metadata?.kind ?? obj?.kind ?? undefined;
}

/**
 * Helper to extract the name from a Kubernetes object reference.
 * Handles both raw and flattened formats.
 */
export function getObjectName(
  obj: KubernetesObjectReference | null | undefined
): string | undefined {
  return obj?.metadata?.name ?? obj?.name ?? undefined;
}

/**
 * Helper to extract the namespace from a Kubernetes object reference.
 * Handles both raw and flattened formats.
 */
export function getObjectNamespace(
  obj: KubernetesObjectReference | null | undefined
): string | undefined {
  return obj?.metadata?.namespace ?? obj?.namespace ?? undefined;
}

/**
 * Helper to extract the cluster ID from a Kubernetes object reference.
 */
export function getObjectClusterId(
  obj: KubernetesObjectReference | null | undefined
): string | undefined {
  return obj?.clusterId ?? undefined;
}

/**
 * Helper to extract the cluster name from a Kubernetes object reference.
 */
export function getObjectClusterName(
  obj: KubernetesObjectReference | null | undefined
): string | undefined {
  return obj?.clusterName ?? undefined;
}
