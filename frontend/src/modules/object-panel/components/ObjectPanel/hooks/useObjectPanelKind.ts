import type { PanelObjectData } from '../types';

export interface UseObjectPanelKindOptions {
  clusterScope?: string;
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

  const objectKind = objectData?.kind ? objectData.kind.toLowerCase() : null;

  const scopeNamespace =
    !objectData?.namespace || objectData.namespace.length === 0
      ? clusterScope
      : objectData.namespace;

  const detailScope =
    !objectData?.name || !objectKind ? null : `${scopeNamespace}:${objectKind}:${objectData.name}`;

  const helmScope =
    objectKind !== 'helmrelease' || !objectData?.name
      ? null
      : `${scopeNamespace}:${objectData.name}`;

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
