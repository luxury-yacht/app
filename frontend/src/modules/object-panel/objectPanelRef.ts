/**
 * frontend/src/modules/object-panel/objectPanelRef.ts
 *
 * Canonical object-panel identity module. It builds full-GVK panel refs, stable
 * panel IDs, refresh scopes, cache-eviction targets, and object-map support
 * checks from one shared object reference contract.
 */

import { buildClusterScope, buildObjectScope } from '@/core/refresh/clusterScope';
import { buildObjectPanelPodsScope } from '@modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope';
import type { KubernetesObjectReference } from '@/types/view-state';
import {
  buildObjectReference,
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';

export interface ObjectPanelRef extends ResolvedObjectReference {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  name: string;
}

export interface ObjectPanelRefOptions {
  clusterScope?: string;
  fallbackClusterId?: string | null;
}

export interface ObjectPanelScopes {
  objectKind: string | null;
  scopeNamespace: string | null;
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

const DEFAULT_CLUSTER_SCOPE = '__cluster__';
const HELM_RELEASE_GVK = { group: 'helm.sh', version: 'v3' };

const MAP_SUPPORTED_KINDS = new Set([
  'pod',
  'service',
  'endpointslice',
  'persistentvolumeclaim',
  'persistentvolume',
  'storageclass',
  'configmap',
  'secret',
  'serviceaccount',
  'node',
  'clusterrole',
  'clusterrolebinding',
  'deployment',
  'replicaset',
  'statefulset',
  'daemonset',
  'job',
  'cronjob',
  'horizontalpodautoscaler',
  'poddisruptionbudget',
  'networkpolicy',
  'ingress',
  'ingressclass',
  'gatewayclass',
  'gateway',
  'httproute',
  'grpcroute',
  'tlsroute',
  'listenerset',
  'referencegrant',
  'backendtlspolicy',
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
  if (input.group == null || !version) {
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
  const ref = buildRequiredObjectReference(normalizePanelInput(input), {
    fallbackClusterId: clusterId,
  });
  return ref as ObjectPanelRef;
};

export const objectPanelId = (ref: KubernetesObjectReference): string => {
  const panelRef = buildObjectPanelRef(ref);
  const ns = panelRef.namespace?.trim() || '_';
  return `obj:${panelRef.clusterId}:${panelRef.group}/${panelRef.version}/${panelRef.kind.toLowerCase()}:${ns}:${panelRef.name}`;
};

export const isObjectMapSupportedKind = (kind: string | null | undefined): boolean =>
  Boolean(kind && MAP_SUPPORTED_KINDS.has(kind.trim().toLowerCase()));

export const hasCompleteObjectMapReference = (
  objectData: KubernetesObjectReference | null | undefined
): objectData is KubernetesObjectReference & {
  clusterId: string;
  group: string;
  kind: string;
  name: string;
  version: string;
} => {
  if (!objectData || !isObjectMapSupportedKind(objectData.kind)) {
    return false;
  }

  return (
    Boolean(objectData.clusterId?.trim()) &&
    Boolean(objectData.kind?.trim()) &&
    Boolean(objectData.name?.trim()) &&
    objectData.group != null &&
    Boolean(objectData.version?.trim())
  );
};

const buildClusterObjectScope = (
  clusterId: string | undefined,
  objectScope: string | null
): string | null => {
  if (!objectScope) {
    return null;
  }
  return buildClusterScope(clusterId, objectScope);
};

const buildRequiredObjectScope = (args: {
  namespace: string;
  kind: string;
  name: string;
  group: string;
  version: string;
}): string =>
  buildObjectScope({
    namespace: args.namespace,
    group: args.group,
    version: args.version,
    kind: args.kind,
    name: args.name,
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
    return {
      objectKind: objectData?.kind ? objectData.kind.toLowerCase() : null,
      scopeNamespace: null,
      detailScope: null,
      eventsScope: null,
      containerLogsScope: null,
      mapScope: null,
      helmScope: null,
      podsScope: null,
      isHelmRelease: false,
      isEvent: objectData?.kind?.trim().toLowerCase() === 'event',
    };
  }

  const normalizedObjectData = normalizePanelInput(objectData);
  const scopeClusterId =
    normalizeOptional(normalizedObjectData.clusterId) ??
    normalizeOptional(options.fallbackClusterId);
  if (!scopeClusterId || !hasExplicitScopeGVK(normalizedObjectData)) {
    return {
      objectKind: objectData.kind.toLowerCase(),
      scopeNamespace: null,
      detailScope: null,
      eventsScope: null,
      containerLogsScope: null,
      mapScope: null,
      helmScope: null,
      podsScope: null,
      isHelmRelease: false,
      isEvent: objectData.kind.trim().toLowerCase() === 'event',
    };
  }

  let ref: ResolvedObjectReference;
  try {
    ref = buildObjectReference(normalizedObjectData);
  } catch {
    return {
      objectKind: objectData.kind.toLowerCase(),
      scopeNamespace: null,
      detailScope: null,
      eventsScope: null,
      containerLogsScope: null,
      mapScope: null,
      helmScope: null,
      podsScope: null,
      isHelmRelease: false,
      isEvent: objectData.kind.trim().toLowerCase() === 'event',
    };
  }

  const objectKind = ref.kind.toLowerCase();
  const clusterScope = options.clusterScope ?? DEFAULT_CLUSTER_SCOPE;
  const scopeNamespace = ref.namespace || clusterScope;
  const clusterId = ref.clusterId ?? scopeClusterId;
  const detailScope = buildClusterObjectScope(
    clusterId,
    buildRequiredObjectScope({
      namespace: scopeNamespace,
      group: ref.group,
      version: ref.version,
      kind: objectKind,
      name: ref.name,
    })
  );
  const eventsScope = buildClusterObjectScope(
    clusterId,
    buildRequiredObjectScope({
      namespace: scopeNamespace,
      group: ref.group,
      version: ref.version,
      kind: ref.kind,
      name: ref.name,
    })
  );
  const containerLogsScope = detailScope;
  const mapScope = !hasCompleteObjectMapReference(objectData)
    ? null
    : buildClusterObjectScope(
        clusterId,
        buildRequiredObjectScope({
          namespace: scopeNamespace,
          group: ref.group,
          version: ref.version,
          kind: ref.kind,
          name: ref.name,
        })
      );
  const syntheticHelmRelease = isSyntheticHelmRelease(ref);
  const helmScope = syntheticHelmRelease
    ? buildClusterScope(clusterId, `${scopeNamespace}:${ref.name}`)
    : null;
  // The PodsTab leases a pods window under this exact scope (same builder the
  // query-backed wrapper uses); null for kinds without a pods tab.
  const podsBaseScope = buildObjectPanelPodsScope(
    {
      kind: ref.kind,
      group: ref.group,
      version: ref.version,
      namespace: ref.namespace,
      name: ref.name,
    },
    ref.kind
  );
  const podsScope = podsBaseScope && clusterId ? buildClusterScope(clusterId, podsBaseScope) : null;

  return {
    objectKind,
    scopeNamespace,
    detailScope,
    eventsScope,
    containerLogsScope,
    mapScope,
    helmScope,
    podsScope,
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
    evictions.push({ domain: 'object-details', scope: scopes.detailScope });
    evictions.push({ domain: 'object-yaml', scope: scopes.detailScope });
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
    evictions.push({ domain: 'object-helm-manifest', scope: scopes.helmScope });
    evictions.push({ domain: 'object-helm-values', scope: scopes.helmScope });
  }
  if (scopes.podsScope) {
    evictions.push({ domain: 'pods', scope: scopes.podsScope });
  }
  return evictions;
};
