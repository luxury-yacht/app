import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import type { KubernetesObjectReference } from '@/types/view-state';

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

export interface ResolvedSyntheticObjectReference {
  kind: string;
  name: string;
  kindAlias?: string;
  namespace?: string;
  clusterId?: string;
  clusterName?: string;
  resource?: string;
  uid?: string;
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

export const buildObjectReference = <TExtras extends object = {}>(
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
      `Object identity for ${kind}/${name} is missing apiVersion. ` +
        `Built-ins must resolve through resolveBuiltinGroupVersion(); custom resources ` +
        `must thread apiGroup/apiVersion from the data source.`
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

export const buildRequiredObjectReference = <TExtras extends object = {}>(
  input: ObjectIdentityInput,
  options?: RequiredObjectIdentityOptions,
  extras?: TExtras
): ResolvedObjectReference & TExtras => {
  const clusterId =
    normalizeOptional(input.clusterId) ?? normalizeOptional(options?.fallbackClusterId);
  const kind = normalizeRequired(input.kind, 'kind');
  const name = normalizeRequired(input.name, 'name');

  if (!clusterId) {
    throw new Error(`Object identity for ${kind}/${name} is missing required field "clusterId"`);
  }

  return buildObjectReference(
    {
      ...input,
      kind,
      name,
      clusterId,
    },
    extras
  );
};

export const buildRelatedObjectReference = <TExtras extends object = {}>(
  input: RelatedObjectReferenceInput,
  extras?: TExtras
): ResolvedObjectReference & TExtras => {
  const parsedApiVersion = normalizeOptional(input.apiVersion)
    ? parseApiVersion(input.apiVersion!)
    : undefined;

  return buildObjectReference(
    {
      ...input,
      group: normalizeOptional(input.group) ?? parsedApiVersion?.group,
      version: normalizeOptional(input.version) ?? parsedApiVersion?.version,
    },
    extras
  );
};

export const buildSyntheticObjectReference = <TExtras extends object = {}>(
  input: ObjectIdentityInput,
  extras?: TExtras
): ResolvedSyntheticObjectReference & TExtras => {
  return {
    kind: normalizeRequired(input.kind, 'kind'),
    kindAlias: normalizeOptional(input.kindAlias),
    name: normalizeRequired(input.name, 'name'),
    namespace: normalizeOptional(input.namespace),
    clusterId: normalizeOptional(input.clusterId),
    clusterName: normalizeOptional(input.clusterName),
    resource: normalizeOptional(input.resource),
    uid: normalizeOptional(input.uid),
    ...extras,
  } as ResolvedSyntheticObjectReference & TExtras;
};

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
