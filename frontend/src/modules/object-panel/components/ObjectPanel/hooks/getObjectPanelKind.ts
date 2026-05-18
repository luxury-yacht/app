/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.ts
 *
 * Pure utility that determines object kind and related scopes for the object panel.
 * Returns structured information about the object kind, namespace scope, detail scope, and helm scope.
 * Also indicates if the object is a Helm release or an event.
 */
import type { PanelObjectData } from '../types';
import { buildClusterScope, buildObjectScope } from '@/core/refresh/clusterScope';
import { hasCompleteObjectMapReference } from '../objectMapSupport';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';

export interface UseObjectPanelKindOptions {
  clusterScope?: string;
  clusterId?: string | null;
}

export interface ObjectPanelKindResult {
  objectKind: string | null;
  scopeNamespace: string | null;
  detailScope: string | null;
  // Scope string for the object-events refresh domain. Distinct from
  // detailScope because the events producer keeps the original-case
  // kind. ObjectPanelContent and EventsTab both consume this — the
  // string MUST come from one place so they cannot disagree (an old
  // bug had each computing its own and the two drifting apart).
  eventsScope: string | null;
  // Scope string for the container-logs refresh domain. Used by both
  // ObjectPanelContent (full-cleanup lifecycle on panel close) and
  // LogViewer (the actual streaming start/stop). Same drift hazard as
  // eventsScope: keep computation in one place. The log producer uses
  // the lowercased kind by historical convention.
  containerLogsScope: string | null;
  // Scope string for the object-map refresh domain. Backend
  // ParseObjectScope is case-sensitive on Kind, so we keep the original
  // case here (same convention as eventsScope, different from
  // detailScope/containerLogsScope which lowercase by historical
  // producer choice).
  mapScope: string | null;
  helmScope: string | null;
  isHelmRelease: boolean;
  isEvent: boolean;
}

const DEFAULT_CLUSTER_SCOPE = '__cluster__';
const HELM_RELEASE_GVK = { group: 'helm.sh', version: 'v3' };

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const resolveScopeGVK = (
  kind: string | null | undefined,
  group: string | null | undefined,
  version: string | null | undefined
): { group: string; version: string } | null => {
  const normalizedKind = kind?.trim() ?? '';
  if (!normalizedKind) {
    return null;
  }

  const suppliedVersion = normalizeOptional(version);
  const groupWasCarried = group !== undefined && group !== null;
  const suppliedGroup = groupWasCarried ? (group ?? '').trim() : undefined;
  const isHelmReleaseKind = normalizedKind.toLowerCase() === 'helmrelease';
  if (isHelmReleaseKind) {
    if (!suppliedVersion) {
      return HELM_RELEASE_GVK;
    }
    if (
      groupWasCarried &&
      suppliedGroup === HELM_RELEASE_GVK.group &&
      suppliedVersion === HELM_RELEASE_GVK.version
    ) {
      return HELM_RELEASE_GVK;
    }
    if (!groupWasCarried || !suppliedGroup) {
      return null;
    }
    return { group: suppliedGroup, version: suppliedVersion };
  }

  const builtin = resolveBuiltinGroupVersion(normalizedKind);
  const builtinGVK =
    builtin.version !== undefined && builtin.group !== undefined
      ? { group: builtin.group, version: builtin.version }
      : null;

  if (suppliedVersion) {
    if (builtinGVK) {
      const groupValue = groupWasCarried ? suppliedGroup! : builtinGVK.group;
      if (groupValue !== builtinGVK.group || suppliedVersion !== builtinGVK.version) {
        return null;
      }
      return builtinGVK;
    }
    if (!groupWasCarried || !suppliedGroup) {
      return null;
    }
    return { group: suppliedGroup, version: suppliedVersion };
  }

  if (builtinGVK) {
    return builtinGVK;
  }
  return null;
};

const isSyntheticHelmRelease = (
  kind: string | null | undefined,
  group: string | null | undefined,
  version: string | null | undefined
): boolean => {
  const normalizedKind = kind?.trim().toLowerCase() ?? '';
  if (normalizedKind !== 'helmrelease') {
    return false;
  }
  const suppliedVersion = normalizeOptional(version);
  if (!suppliedVersion) {
    return true;
  }
  const groupWasCarried = group !== undefined && group !== null;
  return (
    groupWasCarried &&
    (group ?? '').trim() === HELM_RELEASE_GVK.group &&
    suppliedVersion === HELM_RELEASE_GVK.version
  );
};

const buildRequiredObjectScope = (args: {
  namespace: string;
  kind: string;
  name: string;
  gvk: { group: string; version: string } | null;
}): string | null => {
  if (!args.gvk) {
    return null;
  }
  return buildObjectScope({
    namespace: args.namespace,
    group: args.gvk.group,
    version: args.gvk.version,
    kind: args.kind,
    name: args.name,
  });
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

export const getObjectPanelKind = (
  objectData: PanelObjectData | null,
  options: UseObjectPanelKindOptions = {}
): ObjectPanelKindResult => {
  const clusterScope = options.clusterScope ?? DEFAULT_CLUSTER_SCOPE;
  const clusterId = objectData?.clusterId ?? options.clusterId ?? undefined;

  const objectKind = objectData?.kind ? objectData.kind.toLowerCase() : null;
  const scopeGVK = resolveScopeGVK(objectData?.kind, objectData?.group, objectData?.version);
  const isHelmRelease = isSyntheticHelmRelease(
    objectData?.kind,
    objectData?.group,
    objectData?.version
  );

  const scopeNamespace =
    !objectData?.namespace || objectData.namespace.length === 0
      ? clusterScope
      : objectData.namespace;

  const detailScope =
    !objectData?.name || !objectKind
      ? null
      : buildClusterObjectScope(
          clusterId,
          buildRequiredObjectScope({
            namespace: scopeNamespace,
            gvk: scopeGVK,
            kind: objectKind,
            name: objectData.name,
          })
        );

  // eventsScope mirrors detailScope but keeps the kind in its original
  // case. The backend object-events provider does not lowercase the
  // kind when registering its dispatch, so the producer convention is
  // case-preserving. See ObjectPanelContent and EventsTab — both used
  // to compute this independently and the strings could drift apart.
  const eventsScope =
    !objectData?.name || !objectData?.kind
      ? null
      : buildClusterObjectScope(
          clusterId,
          buildRequiredObjectScope({
            namespace: scopeNamespace,
            gvk: scopeGVK,
            kind: objectData.kind,
            name: objectData.name,
          })
        );

  // containerLogsScope follows the same object-scope encoding as detailScope so
  // the live stream path and the fallback/manual fetch path can share a
  // single canonical object identity. The kind stays lowercased to
  // match the container-logs backend producer's workload dispatch.
  const containerLogsScope =
    !objectData?.name || !objectKind
      ? null
      : buildClusterObjectScope(
          clusterId,
          buildRequiredObjectScope({
            namespace: scopeNamespace,
            gvk: scopeGVK,
            kind: objectKind,
            name: objectData.name,
          })
        );

  // mapScope mirrors eventsScope (case-preserving Kind) — the backend
  // object-map provider uses the same parseObjectScope path that
  // object-events uses, which matches Kind verbatim against the catalog.
  const mapScope = !hasCompleteObjectMapReference(objectData)
    ? null
    : buildClusterObjectScope(
        clusterId,
        buildRequiredObjectScope({
          namespace: scopeNamespace,
          gvk: scopeGVK,
          kind: objectData.kind,
          name: objectData.name,
        })
      );

  const helmScope =
    !isHelmRelease || !objectData?.name
      ? null
      : buildClusterScope(clusterId, `${scopeNamespace}:${objectData.name}`);

  const isEvent = objectKind === 'event';

  return {
    objectKind,
    scopeNamespace,
    detailScope,
    eventsScope,
    containerLogsScope,
    mapScope,
    helmScope,
    isHelmRelease,
    isEvent,
  };
};
