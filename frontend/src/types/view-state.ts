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

  /**
   * API group for the object's kind (e.g. "apps", "rds.services.k8s.aws").
   * Empty string for core/v1 kinds. Callers that build refs from the
   * catalog should populate this so downstream code can disambiguate
   * colliding CRDs. See docs/plans/kind-only-objects.md.
   */
  group?: string | null;
  /** API version for the object's kind (e.g. "v1", "v1alpha1"). */
  version?: string | null;
  /** Plural resource name (e.g. "dbinstances"), propagated from the catalog. */
  resource?: string | null;

  // Raw Kubernetes API format (metadata object)
  metadata?: KubernetesMetadata;

  // Allow additional properties from various resource types.
  // Kept for backwards compatibility — new callers should prefer the typed
  // fields above.
  [key: string]: unknown;
}
