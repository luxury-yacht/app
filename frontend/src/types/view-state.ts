/**
 * View State Type Definitions
 *
 * Types for objects managed by ViewStateContext, including selected objects
 * and navigation history.
 */
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
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

const normalizeIdentityField = (value: string | null | undefined): string => value?.trim() ?? '';

/**
 * Validates that a KubernetesObjectReference carries enough object identity to
 * round-trip through the panel and the strict backend resolvers.
 *
 * This is the runtime defense for incomplete object refs, sitting at the
 * single chokepoint where every object reference flows into the panel system
 * (useObjectPanel.openWithObject). It catches construction shapes the
 * literal-walking audit can't see: helpers that build refs, mappers that
 * return refs, destructure-and-rebuild patterns, and any future programmatic
 * construction.
 *
 * @throws Error with stack trace pointing at the construction site if
 *   the ref is missing clusterId, kind, name, or complete GVK identity.
 */
export function assertObjectRefHasRequiredIdentity(ref: KubernetesObjectReference): void {
  const clusterId = normalizeIdentityField(ref.clusterId);
  const kind = normalizeIdentityField(ref.kind);
  const name = normalizeIdentityField(ref.name);

  if (!clusterId) {
    throw new Error(`KubernetesObjectReference is missing required field "clusterId"`);
  }
  if (!kind) {
    throw new Error(`KubernetesObjectReference is missing required field "kind"`);
  }
  if (!name) {
    throw new Error(`KubernetesObjectReference for kind=${kind} is missing required field "name"`);
  }
  const version = normalizeIdentityField(ref.version);
  if (!version) {
    throw new Error(
      `KubernetesObjectReference for kind=${kind} name=${ref.name ?? '?'} ` +
        `is missing version. This is the kind-only-objects bug — the ` +
        `panel and backend resolvers cannot disambiguate two CRDs sharing ` +
        `a Kind without group+version. Spread ` +
        `\`...resolveBuiltinGroupVersion(kind)\` for built-ins, or thread ` +
        `the parsed version from a wire-form apiVersion via \`parseApiVersion(...)\`.`
    );
  }

  const groupWasCarried = ref.group !== undefined && ref.group !== null;
  const group = normalizeIdentityField(ref.group);
  const builtinGVK = resolveBuiltinGroupVersion(kind);
  const isKnownBuiltin = Boolean(builtinGVK.version);
  if (!groupWasCarried || (!group && (!isKnownBuiltin || builtinGVK.group))) {
    throw new Error(
      `KubernetesObjectReference for kind=${kind} name=${ref.name ?? '?'} ` +
        `is missing group. Include \`group: ''\` for core/v1 built-ins, ` +
        `spread \`...resolveBuiltinGroupVersion(kind)\` for other built-ins, ` +
        `or thread group from the catalog/discovery source for custom resources.`
    );
  }
}
