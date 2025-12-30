/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelKind.ts
 *
 * Hook for useObjectPanelKind.
 * Determines object kind and related scopes for the object panel.
 * Returns structured information about the object kind, namespace scope, detail scope, and helm scope.
 * Also indicates if the object is a Helm release or an event.
 */
import type { PanelObjectData } from '../types';
import { buildClusterScope } from '@/core/refresh/clusterScope';

export interface UseObjectPanelKindOptions {
  clusterScope?: string;
  clusterId?: string | null;
}

export interface ObjectPanelKindResult {
  objectKind: string | null;
  scopeNamespace: string | null;
  detailScope: string | null;
  helmScope: string | null;
  isHelmRelease: boolean;
  isEvent: boolean;
}

const DEFAULT_CLUSTER_SCOPE = '__cluster__';

export const useObjectPanelKind = (
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
    helmScope,
    isHelmRelease,
    isEvent,
  };
};
