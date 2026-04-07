/**
 * frontend/src/shared/constants/builtinGroupVersions.ts
 *
 * Lookup table from built-in Kubernetes Kind → GroupVersion.
 *
 * Built-in kinds (Pod, Deployment, etc.) are unambiguous: a given Kind
 * string uniquely identifies its API group and version. Custom resources,
 * in contrast, can share a Kind across multiple groups (the
 * kind-only-objects bug) and must carry their apiGroup/apiVersion from the
 * data source. Use this lookup at `openWithObject` call sites that
 * construct a reference from a built-in resource type, so the resulting
 * `KubernetesObjectReference` carries `group`/`version` consistently with
 * BrowseView (which reads them off `CatalogItem`) and CommandPalette.
 *
 * Why this matters even though built-ins can't collide:
 *
 *  1. Panel identity: `objectPanelId` includes group/version in the id
 *     when present. If two call sites disagree about whether to emit
 *     group/version for the same Pod, the user can end up with two
 *     distinct panel tabs for the same object.
 *  2. Downstream scope/capabilities consistency: all the backend paths
 *     now accept the GVK form. Feeding them consistent data from every
 *     entry point means we never hit the legacy kind-only fallback for
 *     built-ins and the behavior is uniform.
 */

export interface BuiltinGroupVersion {
  group: string;
  version: string;
}

/**
 * Map of built-in Kubernetes Kind → GroupVersion. Keys are the canonical
 * PascalCase kind name (matching `metav1.TypeMeta.Kind`). Lookups are
 * case-insensitive — see `resolveBuiltinGroupVersion`.
 *
 * Only includes kinds that the app actually handles via a built-in view
 * component. Extensible — add new entries alongside new views.
 */
const BUILTIN_KIND_GROUP_VERSIONS: Record<string, BuiltinGroupVersion> = {
  // core/v1
  Pod: { group: '', version: 'v1' },
  Service: { group: '', version: 'v1' },
  ConfigMap: { group: '', version: 'v1' },
  Secret: { group: '', version: 'v1' },
  Namespace: { group: '', version: 'v1' },
  Node: { group: '', version: 'v1' },
  PersistentVolume: { group: '', version: 'v1' },
  PersistentVolumeClaim: { group: '', version: 'v1' },
  ServiceAccount: { group: '', version: 'v1' },
  Event: { group: '', version: 'v1' },
  LimitRange: { group: '', version: 'v1' },
  ResourceQuota: { group: '', version: 'v1' },
  Endpoints: { group: '', version: 'v1' },

  // apps/v1
  Deployment: { group: 'apps', version: 'v1' },
  StatefulSet: { group: 'apps', version: 'v1' },
  DaemonSet: { group: 'apps', version: 'v1' },
  ReplicaSet: { group: 'apps', version: 'v1' },

  // batch/v1
  Job: { group: 'batch', version: 'v1' },
  CronJob: { group: 'batch', version: 'v1' },

  // autoscaling/v2
  HorizontalPodAutoscaler: { group: 'autoscaling', version: 'v2' },

  // networking.k8s.io/v1
  Ingress: { group: 'networking.k8s.io', version: 'v1' },
  IngressClass: { group: 'networking.k8s.io', version: 'v1' },
  NetworkPolicy: { group: 'networking.k8s.io', version: 'v1' },

  // rbac.authorization.k8s.io/v1
  Role: { group: 'rbac.authorization.k8s.io', version: 'v1' },
  RoleBinding: { group: 'rbac.authorization.k8s.io', version: 'v1' },
  ClusterRole: { group: 'rbac.authorization.k8s.io', version: 'v1' },
  ClusterRoleBinding: { group: 'rbac.authorization.k8s.io', version: 'v1' },

  // policy/v1
  PodDisruptionBudget: { group: 'policy', version: 'v1' },

  // storage.k8s.io/v1
  StorageClass: { group: 'storage.k8s.io', version: 'v1' },
  CSIDriver: { group: 'storage.k8s.io', version: 'v1' },
  CSINode: { group: 'storage.k8s.io', version: 'v1' },
  VolumeAttachment: { group: 'storage.k8s.io', version: 'v1' },

  // admissionregistration.k8s.io/v1
  MutatingWebhookConfiguration: { group: 'admissionregistration.k8s.io', version: 'v1' },
  ValidatingWebhookConfiguration: { group: 'admissionregistration.k8s.io', version: 'v1' },

  // apiextensions.k8s.io/v1
  CustomResourceDefinition: { group: 'apiextensions.k8s.io', version: 'v1' },

  // discovery.k8s.io/v1
  EndpointSlice: { group: 'discovery.k8s.io', version: 'v1' },

  // coordination.k8s.io/v1
  Lease: { group: 'coordination.k8s.io', version: 'v1' },
};

/**
 * Case-insensitive lookup of the built-in GroupVersion for a kind. Returns
 * an empty object when the kind is not a known built-in, which callers
 * should treat as "custom resource — get group/version from the data
 * source instead".
 *
 * Accepts a null/undefined kind for ergonomics at call sites that may
 * not always have one.
 */
export function resolveBuiltinGroupVersion(
  kind: string | null | undefined
): Partial<BuiltinGroupVersion> {
  if (!kind) {
    return {};
  }
  const trimmed = kind.trim();
  if (!trimmed) {
    return {};
  }
  // Canonical PascalCase match first (fast path).
  const direct = BUILTIN_KIND_GROUP_VERSIONS[trimmed];
  if (direct) {
    return direct;
  }
  // Fall back to a case-insensitive walk for lowercased kinds such as
  // "pod" or "deployment" (frontend state sometimes stores them that way).
  const needle = trimmed.toLowerCase();
  for (const [canonicalKind, gv] of Object.entries(BUILTIN_KIND_GROUP_VERSIONS)) {
    if (canonicalKind.toLowerCase() === needle) {
      return gv;
    }
  }
  return {};
}

/**
 * Format a built-in kind's GroupVersion as the standard Kubernetes
 * "group/version" apiVersion string (or just "version" for core resources
 * with an empty group). Returns `null` when the kind is not a known
 * built-in — call sites should fall back to the legacy kind-only path
 * in that case.
 */
export function formatBuiltinApiVersion(kind: string | null | undefined): string | null {
  const gv = resolveBuiltinGroupVersion(kind);
  if (!gv.version) {
    return null;
  }
  return gv.group ? `${gv.group}/${gv.version}` : gv.version;
}

/**
 * Inverse of `formatBuiltinApiVersion`: parse a Kubernetes apiVersion
 * string into its `{group, version}` parts. Core resources use the
 * version-only form ("v1"), grouped resources use "group/version"
 * (e.g. "apps/v1", "documentdb.services.k8s.aws/v1alpha1").
 *
 * Returns `{}` for null/empty input. Use this when threading an
 * apiVersion field from the backend (e.g. an Event's
 * `involvedObjectApiVersion`) into a `KubernetesObjectReference`
 * that needs split `group`/`version` keys.
 */
export function parseApiVersion(
  apiVersion: string | null | undefined
): Partial<BuiltinGroupVersion> {
  if (!apiVersion) {
    return {};
  }
  const trimmed = apiVersion.trim();
  if (!trimmed) {
    return {};
  }
  const slash = trimmed.indexOf('/');
  if (slash === -1) {
    // Core resource: just the version, group is empty.
    return { group: '', version: trimmed };
  }
  return {
    group: trimmed.slice(0, slash),
    version: trimmed.slice(slash + 1),
  };
}
