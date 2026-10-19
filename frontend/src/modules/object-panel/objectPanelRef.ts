/**
 * frontend/src/modules/object-panel/objectPanelRef.ts
 *
 * Canonical object-panel identity module. It builds full-GVK panel refs, stable
 * panel IDs, refresh scopes, cache-eviction targets, and object-map support
 * checks from one shared object reference contract.
 */

import builtinResourceIdentityContract from '@builtin-resource-identities';
import { buildObjectPanelPodsSelector } from '@modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import {
  buildObjectReference,
  buildRequiredObjectReference,
  type ClusterObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import { buildRefreshScope, type ScopeSelector } from '@/core/refresh/scopeSelector';
import type { KubernetesObjectReference } from '@/types/view-state';

/**
 * The panel system's reference currency: a cluster-complete object reference.
 * Everything past useObjectPanel.openWithObject's validation boundary carries
 * this shape, so a panel ref without full identity does not compile.
 */
export type ObjectPanelRef = ClusterObjectReference;

export interface ObjectPanelRefOptions {
  fallbackClusterId?: string | null;
}

export interface ObjectPanelScopes {
  objectKind: string | null;
  detailScope: string | null;
  eventsScope: string | null;
  containerLogsScope: string | null;
  mapScope: string | null;
  helmScope: string | null;
  /** The PodsTab's leased pods window scope; null for kinds without a pods tab. */
  podsScope: string | null;
  isHelmRelease: boolean;
  isEvent: boolean;
}

export interface ObjectPanelScopeEviction {
  domain:
    | 'object-details'
    | 'object-events'
    | 'object-yaml'
    | 'object-map'
    | 'object-helm-manifest'
    | 'object-helm-values'
    | 'container-logs'
    | 'pods';
  scope: string;
}

const HELM_RELEASE_GVK = { group: 'helm.sh', version: 'v3' };

const objectMapGvkKey = (group: string, version: string, kind: string): string =>
  `${group.trim()}/${version.trim()}/${kind.trim().toLowerCase()}`;

// Identities an object map can be opened for: the built-ins from the backend
// kind registry via the identity contract, plus the synthetic Helm release,
// whose map holds the objects in its manifest. Matching uses the complete
// identity, so a custom resource that shares a kind name (an Istio Gateway, a
// Flux HelmRelease) is not mistaken for the supported one.
const MAP_SUPPORTED_GVKS = new Set([
  ...builtinResourceIdentityContract.resources
    .filter((resource) => 'objectMap' in resource && resource.objectMap)
    .map((resource) => objectMapGvkKey(resource.group, resource.version, resource.kind)),
  objectMapGvkKey(HELM_RELEASE_GVK.group, HELM_RELEASE_GVK.version, 'HelmRelease'),
]);

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const isHelmReleaseKind = (kind: string | null | undefined): boolean =>
  kind?.trim().toLowerCase() === 'helmrelease';

const normalizePanelInput = (input: KubernetesObjectReference): KubernetesObjectReference => {
  if (!isHelmReleaseKind(input.kind) || normalizeOptional(input.version)) {
    return input;
  }
  return {
    ...input,
    group: HELM_RELEASE_GVK.group,
    version: HELM_RELEASE_GVK.version,
  };
};

const hasExplicitScopeGVK = (input: KubernetesObjectReference): boolean => {
  const version = normalizeOptional(input.version);
  if (input.group === null || input.group === undefined || !version) {
    return false;
  }
  const group = input.group.trim();
  const kind = normalizeOptional(input.kind);
  const builtinGVK = kind ? resolveBuiltinGroupVersion(kind) : undefined;
  if (!group && builtinGVK?.group) {
    return false;
  }
  if (!group && !builtinGVK) {
    return false;
  }
  return true;
};

export const buildObjectPanelRef = (
  input: KubernetesObjectReference,
  options: ObjectPanelRefOptions = {}
): ObjectPanelRef => {
  const clusterId =
    normalizeOptional(input.clusterId) ?? normalizeOptional(options.fallbackClusterId);
  if (!clusterId) {
    throw new Error('Object panel reference is missing clusterId');
  }
  return buildRequiredObjectReference(normalizePanelInput(input), {
    fallbackClusterId: clusterId,
  });
};

export const objectPanelId = (ref: KubernetesObjectReference): string => {
  const panelRef = buildObjectPanelRef(ref);
  const ns = panelRef.namespace?.trim() || '_';
  return `obj:${panelRef.clusterId}:${panelRef.group}/${panelRef.version}/${panelRef.kind.toLowerCase()}:${ns}:${panelRef.name}`;
};

export const isObjectMapSupportedRef = (
  ref:
    | {
        group?: string | null;
        version?: string | null;
        kind?: string | null;
      }
    | null
    | undefined
): boolean =>
  Boolean(
    ref?.kind &&
      ref.version &&
      ref.group !== null &&
      ref.group !== undefined &&
      MAP_SUPPORTED_GVKS.has(objectMapGvkKey(ref.group, ref.version, ref.kind))
  );

export const hasCompleteObjectMapReference = (
  objectData: KubernetesObjectReference | null | undefined
): objectData is KubernetesObjectReference & {
  clusterId: string;
  group: string;
  kind: string;
  name: string;
  version: string;
} => {
  if (!objectData || !isObjectMapSupportedRef(objectData)) {
    return false;
  }

  return (
    Boolean(objectData.clusterId?.trim()) &&
    Boolean(objectData.kind?.trim()) &&
    Boolean(objectData.name?.trim()) &&
    objectData.group !== null &&
    objectData.group !== undefined &&
    Boolean(objectData.version?.trim())
  );
};

const emptyObjectPanelScopes = (
  objectData: KubernetesObjectReference | null
): ObjectPanelScopes => ({
  objectKind: objectData?.kind ? objectData.kind.toLowerCase() : null,
  detailScope: null,
  eventsScope: null,
  containerLogsScope: null,
  mapScope: null,
  helmScope: null,
  podsScope: null,
  isHelmRelease: false,
  isEvent: objectData?.kind?.trim().toLowerCase() === 'event',
});

const isSyntheticHelmRelease = (ref: ResolvedObjectReference): boolean =>
  ref.kind.trim().toLowerCase() === 'helmrelease' &&
  ref.group === HELM_RELEASE_GVK.group &&
  ref.version === HELM_RELEASE_GVK.version;

export const getObjectPanelScopes = (
  objectData: KubernetesObjectReference | null,
  options: ObjectPanelRefOptions = {}
): ObjectPanelScopes => {
  if (!objectData?.kind || !objectData.name) {
    return emptyObjectPanelScopes(objectData);
  }

  const normalizedObjectData = normalizePanelInput(objectData);
  const clusterId =
    normalizeOptional(normalizedObjectData.clusterId) ??
    normalizeOptional(options.fallbackClusterId);
  if (!clusterId || !hasExplicitScopeGVK(normalizedObjectData)) {
    return emptyObjectPanelScopes(objectData);
  }

  let ref: ResolvedObjectReference;
  try {
    ref = buildObjectReference(normalizedObjectData);
  } catch {
    return emptyObjectPanelScopes(objectData);
  }

  const objectKind = ref.kind.toLowerCase();
  // Every object-scoped domain decodes the same object selector, so the panel's
  // detail, YAML, events, log, and map consumers share one canonical scope.
  const objectSelector: ScopeSelector = {
    kind: 'object',
    object: {
      namespace: ref.namespace ?? '',
      group: ref.group,
      version: ref.version,
      kind: ref.kind,
      name: ref.name,
    },
  };
  const detailScope = buildRefreshScope('object-details', { clusterId, selector: objectSelector });
  const syntheticHelmRelease = isSyntheticHelmRelease(ref);
  const helmScope = syntheticHelmRelease
    ? buildRefreshScope('object-helm-manifest', {
        clusterId,
        selector: { kind: 'helm-release', namespace: ref.namespace ?? '', name: ref.name },
      })
    : null;
  // The PodsTab leases a pods window under this exact scope (same selector the
  // query-backed wrapper uses); null for kinds without a pods tab.
  const podsSelector = buildObjectPanelPodsSelector(
    {
      kind: ref.kind,
      group: ref.group,
      version: ref.version,
      namespace: ref.namespace,
      name: ref.name,
    },
    ref.kind
  );

  return {
    objectKind,
    detailScope,
    eventsScope: buildRefreshScope('object-events', { clusterId, selector: objectSelector }),
    containerLogsScope: buildRefreshScope('container-logs', {
      clusterId,
      selector: objectSelector,
    }),
    mapScope: hasCompleteObjectMapReference(normalizedObjectData)
      ? buildRefreshScope('object-map', { clusterId, selector: objectSelector })
      : null,
    helmScope,
    podsScope: podsSelector
      ? buildRefreshScope('pods', { clusterId, selector: podsSelector })
      : null,
    isHelmRelease: syntheticHelmRelease,
    isEvent: objectKind === 'event',
  };
};

export const getObjectPanelScopeEvictions = (
  ref: KubernetesObjectReference
): ObjectPanelScopeEviction[] => {
  const scopes = getObjectPanelScopes(ref);
  const evictions: ObjectPanelScopeEviction[] = [];
  if (scopes.detailScope) {
    evictions.push(
      { domain: 'object-details', scope: scopes.detailScope },
      { domain: 'object-yaml', scope: scopes.detailScope }
    );
  }
  if (scopes.eventsScope) {
    evictions.push({ domain: 'object-events', scope: scopes.eventsScope });
  }
  if (scopes.containerLogsScope) {
    evictions.push({ domain: 'container-logs', scope: scopes.containerLogsScope });
  }
  if (scopes.mapScope) {
    evictions.push({ domain: 'object-map', scope: scopes.mapScope });
  }
  if (scopes.helmScope) {
    evictions.push(
      { domain: 'object-helm-manifest', scope: scopes.helmScope },
      { domain: 'object-helm-values', scope: scopes.helmScope }
    );
  }
  if (scopes.podsScope) {
    evictions.push({ domain: 'pods', scope: scopes.podsScope });
  }
  return evictions;
};
