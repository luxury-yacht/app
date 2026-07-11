import type { ResourceRef } from '@core/refresh/types';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import type { KubernetesObjectReference } from '@/types/view-state';

// NOTE: `ResourceRef` (the backend wire contract) requires clusterId + GVK; the
// reference types below re-establish those guarantees on the frontend side,
// from the loose boundary shape up to the cluster-complete shape.

export interface ObjectIdentityInput {
  kind?: string | null;
  kindAlias?: string | null;
  name?: string | null;
  namespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
  group?: string | null;
  version?: string | null;
  resource?: string | null;
  uid?: string | null;
}

export interface ResolvedObjectReference extends KubernetesObjectReference {
  kind: string;
  name: string;
  group: string;
  version: string;
  kindAlias?: string;
  namespace?: string;
  clusterId?: string;
  clusterName?: string;
  resource?: string;
  uid?: string;
}

/**
 * An object reference whose cluster identity is required by the type — the
 * shape the multi-cluster identity rule (AGENTS.md) demands past a validation
 * boundary. Carrying this type means the compiler, not a scattered runtime
 * guard, enforces clusterId. Construct via {@link buildRequiredObjectReference}
 * or narrow in place via {@link assertObjectRefHasRequiredIdentity}.
 *
 * Nullability caveat: when narrowed in place by the assert (rather than built
 * by a builder, which normalizes), the OPTIONAL fields may still hold null at
 * runtime; the verified required fields are genuine non-empty strings.
 */
export interface ClusterObjectReference extends ResolvedObjectReference {
  clusterId: string;
}

export interface ResolvedSyntheticObjectReference extends Omit<ResourceRef, 'name'> {
  name: string;
  clusterName?: string;
}

export interface RelatedObjectReferenceInput extends ObjectIdentityInput {
  apiVersion?: string | null;
}

export interface RequiredObjectIdentityOptions {
  fallbackClusterId?: string | null;
}

const normalizeRequired = (value: string | null | undefined, field: string): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    throw new Error(`Object identity is missing required field "${field}"`);
  }
  return trimmed;
};

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

export const buildObjectReference = <TExtras extends object = Record<never, never>>(
  input: ObjectIdentityInput,
  extras?: TExtras
): ResolvedObjectReference & TExtras => {
  const kind = normalizeRequired(input.kind, 'kind');
  const name = normalizeRequired(input.name, 'name');
  const builtinGVK = resolveBuiltinGroupVersion(kind);
  const group = normalizeOptional(input.group) ?? builtinGVK.group ?? '';
  const version = normalizeOptional(input.version) ?? builtinGVK.version;

  if (!version) {
    throw new Error(
      `Object identity for ${kind}/${name} is missing version. ` +
        'Built-ins must resolve through resolveBuiltinGroupVersion(); custom resources ' +
        'must thread group/version from the data source.'
    );
  }

  if (!group && !builtinGVK.version) {
    throw new Error(
      `Object identity for ${kind}/${name} is missing group. ` +
        'Custom resources must thread group/version from discovery, catalog, events, ' +
        'owner refs, HPA targets, or manifests.'
    );
  }

  return {
    kind,
    kindAlias: normalizeOptional(input.kindAlias),
    name,
    namespace: normalizeOptional(input.namespace),
    clusterId: normalizeOptional(input.clusterId),
    clusterName: normalizeOptional(input.clusterName),
    group,
    version,
    resource: normalizeOptional(input.resource),
    uid: normalizeOptional(input.uid),
    ...extras,
  } as ResolvedObjectReference & TExtras;
};

export const buildRequiredObjectReference = <TExtras extends object = Record<never, never>>(
  input: ObjectIdentityInput,
  options?: RequiredObjectIdentityOptions,
  extras?: TExtras
): ClusterObjectReference & TExtras => {
  const clusterId =
    normalizeOptional(input.clusterId) ?? normalizeOptional(options?.fallbackClusterId);
  const kind = normalizeRequired(input.kind, 'kind');
  const name = normalizeRequired(input.name, 'name');

  if (!clusterId) {
    throw new Error(`Object identity for ${kind}/${name} is missing required field "clusterId"`);
  }

  // The verified clusterId is threaded into the build, so the result satisfies
  // the cluster-required shape.
  return buildObjectReference(
    {
      ...input,
      kind,
      name,
      clusterId,
    },
    extras
  ) as ClusterObjectReference & TExtras;
};

export const buildRelatedObjectReference = <TExtras extends object = Record<never, never>>(
  input: RelatedObjectReferenceInput,
  extras?: TExtras
): ResolvedObjectReference & TExtras => {
  const apiVersion = normalizeOptional(input.apiVersion);
  const parsedApiVersion = apiVersion ? parseApiVersion(apiVersion) : undefined;

  return buildObjectReference(
    {
      ...input,
      group: normalizeOptional(input.group) ?? parsedApiVersion?.group,
      version: normalizeOptional(input.version) ?? parsedApiVersion?.version,
    },
    extras
  );
};

export const buildRequiredRelatedObjectReference = <TExtras extends object = Record<never, never>>(
  input: RelatedObjectReferenceInput,
  options?: RequiredObjectIdentityOptions,
  extras?: TExtras
): ClusterObjectReference & TExtras => {
  const apiVersion = normalizeOptional(input.apiVersion);
  const parsedApiVersion = apiVersion ? parseApiVersion(apiVersion) : undefined;

  return buildRequiredObjectReference(
    {
      ...input,
      group: normalizeOptional(input.group) ?? parsedApiVersion?.group,
      version: normalizeOptional(input.version) ?? parsedApiVersion?.version,
    },
    options,
    extras
  );
};

export const buildSyntheticObjectReference = <TExtras extends object = Record<never, never>>(
  input: ObjectIdentityInput,
  extras?: TExtras
): ResolvedSyntheticObjectReference & TExtras => {
  const kind = normalizeRequired(input.kind, 'kind');
  const name = normalizeRequired(input.name, 'name');
  const normalizedKind = kind.toLowerCase();
  const syntheticGVK =
    normalizedKind === 'helmrelease'
      ? { group: 'helm.sh', version: 'v3', kind: 'HelmRelease' }
      : {
          group: normalizeRequired(input.group, 'group'),
          version: normalizeRequired(input.version, 'version'),
          kind,
        };

  return {
    group: syntheticGVK.group,
    version: syntheticGVK.version,
    kind: syntheticGVK.kind,
    resource: normalizeOptional(input.resource),
    namespace: normalizeOptional(input.namespace),
    name,
    uid: normalizeOptional(input.uid),
    clusterId: normalizeRequired(input.clusterId, 'clusterId'),
    clusterName: normalizeOptional(input.clusterName),
    ...extras,
  } as ResolvedSyntheticObjectReference & TExtras;
};

const normalizeIdentityField = (value: string | null | undefined): string => value?.trim() ?? '';

/**
 * Validates that a KubernetesObjectReference carries enough object identity to
 * round-trip through the panel and the strict backend resolvers, narrowing it
 * to {@link ClusterObjectReference} in place (the original object — including
 * raw K8s payload fields — is preserved, unlike the builders).
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
export function assertObjectRefHasRequiredIdentity(
  ref: KubernetesObjectReference
): asserts ref is ClusterObjectReference {
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
        'is missing version. This is the kind-only-objects bug — the ' +
        'panel and backend resolvers cannot disambiguate two CRDs sharing ' +
        'a Kind without group+version. Spread ' +
        '`...resolveBuiltinGroupVersion(kind)` for built-ins, or thread ' +
        'the parsed version from a wire-form apiVersion via `parseApiVersion(...)`.'
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
        'spread `...resolveBuiltinGroupVersion(kind)` for other built-ins, ' +
        'or thread group from the catalog/discovery source for custom resources.'
    );
  }
}

export const buildCanonicalObjectRowKey = (input: ObjectIdentityInput): string => {
  const ref = buildObjectReference(input);
  return buildClusterScopedKey(
    ref,
    [ref.group ?? '', ref.version ?? '', ref.kind ?? '', ref.namespace ?? '', ref.name ?? ''].join(
      '/'
    )
  );
};

export const buildRequiredCanonicalObjectRowKey = (
  input: ObjectIdentityInput,
  options?: RequiredObjectIdentityOptions
): string => {
  const ref = buildRequiredObjectReference(input, options);
  return buildClusterScopedKey(
    ref,
    [ref.group ?? '', ref.version ?? '', ref.kind ?? '', ref.namespace ?? '', ref.name ?? ''].join(
      '/'
    )
  );
};
