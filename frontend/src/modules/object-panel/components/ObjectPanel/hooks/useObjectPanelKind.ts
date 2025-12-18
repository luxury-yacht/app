import { useMemo } from 'react';

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

  const objectKind = useMemo(() => {
    if (!objectData?.kind) {
      return null;
    }
    return objectData.kind.toLowerCase();
  }, [objectData?.kind]);

  const scopeNamespace = useMemo(() => {
    if (!objectData?.namespace || objectData.namespace.length === 0) {
      return clusterScope;
    }
    return objectData.namespace;
  }, [clusterScope, objectData?.namespace]);

  const detailScope = useMemo(() => {
    if (!objectData?.name || !objectKind) {
      return null;
    }
    return `${scopeNamespace}:${objectKind}:${objectData.name}`;
  }, [scopeNamespace, objectData?.name, objectKind]);

  const helmScope = useMemo(() => {
    if (objectKind !== 'helmrelease' || !objectData?.name) {
      return null;
    }
    return `${scopeNamespace}:${objectData.name}`;
  }, [scopeNamespace, objectData?.name, objectKind]);

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
