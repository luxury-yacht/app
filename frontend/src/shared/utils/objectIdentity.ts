import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
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

export const buildObjectReference = (
  input: ObjectIdentityInput,
  extras?: Omit<KubernetesObjectReference, keyof ObjectIdentityInput>
): ResolvedObjectReference => {
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
  };
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
