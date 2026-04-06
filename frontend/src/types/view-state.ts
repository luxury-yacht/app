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

/**
 * Synthetic kinds that don't correspond to a real Kubernetes GVK and
 * therefore have no apiVersion. The runtime ref validator
 * (assertObjectRefHasGVK) skips the group/version requirement for these.
 *
 * Kept in lockstep with the openWithObjectAudit.test.ts ALLOWED_LEGACY_FILES
 * exemption set: any kind here implies the file using it is also exempted
 * in the audit, and vice versa.
 *
 * Add an entry ONLY if the kind genuinely never resolves through
 * Kubernetes discovery (e.g. Helm releases, which are managed by the
 * Helm CLI, not the Kubernetes API). See docs/plans/kind-only-objects.md.
 */
const SYNTHETIC_OBJECT_KINDS = new Set<string>(['helmrelease']);

/**
 * Validates that a KubernetesObjectReference carries enough GVK
 * information to round-trip through the panel and the strict backend
 * resolvers. Throws if a real-Kubernetes-kind ref is missing version.
 *
 * This is the **runtime defense** for the kind-only-objects bug, sitting
 * at the single chokepoint where every object reference flows into the
 * panel system (useObjectPanel.openWithObject). It catches construction
 * shapes the literal-walking audit can't see: helpers that build refs,
 * mappers that return refs, destructure-and-rebuild patterns, and any
 * future programmatic construction. Together with the openWithObjectAudit
 * test (test-time defense for literal call sites) and the backend
 * hard-errors at object_detail_provider.go / app_capabilities.go /
 * app_permissions.go (boundary defense), it forms a defense-in-depth
 * stack: literal → programmatic → boundary.
 *
 * @throws Error with stack trace pointing at the construction site if
 *   the ref carries a real Kubernetes kind without an apiVersion.
 */
export function assertObjectRefHasGVK(ref: KubernetesObjectReference): void {
  const kind = (ref.kind ?? '').trim();
  if (!kind) {
    // No kind = nothing to open. The missing-kind case is a different
    // bug shape that surfaces elsewhere; this validator is specifically
    // for the kind-only-objects pattern (kind set, version missing).
    return;
  }
  if (SYNTHETIC_OBJECT_KINDS.has(kind.toLowerCase())) {
    return;
  }
  const version = (ref.version ?? '').trim();
  if (!version) {
    throw new Error(
      `KubernetesObjectReference for kind=${kind} name=${ref.name ?? '?'} ` +
        `is missing apiVersion. This is the kind-only-objects bug — the ` +
        `panel and backend resolvers cannot disambiguate two CRDs sharing ` +
        `a Kind without group+version. Spread ` +
        `\`...resolveBuiltinGroupVersion(kind)\` for built-ins, or thread ` +
        `the actual apiVersion via \`parseApiVersion(...)\`. See ` +
        `docs/plans/kind-only-objects.md.`
    );
  }
}
