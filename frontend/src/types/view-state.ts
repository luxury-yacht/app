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
