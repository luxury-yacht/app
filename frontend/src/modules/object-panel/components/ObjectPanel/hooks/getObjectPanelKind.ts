/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.ts
 *
 * Pure utility that determines object kind and related scopes for the object panel.
 * Returns structured information about the object kind, namespace scope, detail scope, and helm scope.
 * Also indicates if the object is a Helm release or an event.
 */
import type { PanelObjectData } from '../types';
import { buildClusterScope, buildObjectScope } from '@/core/refresh/clusterScope';

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
  // Scope string for the object-logs refresh domain. Used by both
  // ObjectPanelContent (full-cleanup lifecycle on panel close) and
  // LogViewer (the actual streaming start/stop). Same drift hazard as
  // eventsScope: keep computation in one place. The log producer uses
  // the lowercased kind by historical convention.
  logScope: string | null;
  helmScope: string | null;
  isHelmRelease: boolean;
  isEvent: boolean;
}

const DEFAULT_CLUSTER_SCOPE = '__cluster__';

export const getObjectPanelKind = (
  objectData: PanelObjectData | null,
  options: UseObjectPanelKindOptions = {}
): ObjectPanelKindResult => {
  const clusterScope = options.clusterScope ?? DEFAULT_CLUSTER_SCOPE;
  const clusterId = objectData?.clusterId ?? options.clusterId ?? undefined;

  const objectKind = objectData?.kind ? objectData.kind.toLowerCase() : null;

  const scopeNamespace =
    !objectData?.namespace || objectData.namespace.length === 0
      ? clusterScope
      : objectData.namespace;

  const detailScope =
    !objectData?.name || !objectKind
      ? null
      : buildClusterScope(
          clusterId,
          buildObjectScope({
            namespace: scopeNamespace,
            group: objectData?.group,
            version: objectData?.version,
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
      : buildClusterScope(
          clusterId,
          buildObjectScope({
            namespace: scopeNamespace,
            group: objectData?.group,
            version: objectData?.version,
            kind: objectData.kind,
            name: objectData.name,
          })
        );

  // logScope uses the lowercased kind in its legacy "ns:kind:name"
  // form. No GVK threading: the log producer is keyed off Pod logs
  // and never had to disambiguate colliding CRD kinds. Both
  // ObjectPanelContent and LogViewer consume this — keep one builder.
  const logScope =
    !objectData?.name || !objectKind
      ? null
      : buildClusterScope(clusterId, `${scopeNamespace}:${objectKind}:${objectData.name}`);

  const helmScope =
    objectKind !== 'helmrelease' || !objectData?.name
      ? null
      : buildClusterScope(clusterId, `${scopeNamespace}:${objectData.name}`);

  const isHelmRelease = objectKind === 'helmrelease';
  const isEvent = objectKind === 'event';

  return {
    objectKind,
    scopeNamespace,
    detailScope,
    eventsScope,
    logScope,
    helmScope,
    isHelmRelease,
    isEvent,
  };
};
