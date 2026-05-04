/**
 * frontend/src/modules/namespace/components/NsViewMap.tsx
 *
 * Namespace-level relationship map. Uses the shared object-map renderer with
 * a namespace scope instead of an object seed scope.
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import './NsViewMap.css';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@/core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { ALL_NAMESPACES_SCOPE, isAllNamespaces } from '@modules/namespace/constants';
import ObjectMap from '@modules/object-map/ObjectMap';
import {
  buildNamespaceObjectMapScope,
  OBJECT_MAP_MAX_NODES,
} from '@modules/object-map/objectMapScope';
import { buildResolvedFromMapRef } from '@modules/object-map/objectMapNavigation';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { errorHandler } from '@/utils/errorHandler';

interface NsViewMapProps {
  namespace: string;
}

const isLoadingState = (status: string): boolean =>
  status === 'loading' || status === 'initialising';

const NsViewMap: React.FC<NsViewMapProps> = ({ namespace }) => {
  const { selectedClusterId } = useKubeconfig();
  const { selectedNamespaceClusterId } = useNamespace();
  const clusterId = selectedNamespaceClusterId ?? selectedClusterId;
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();

  const mapScope = useMemo(() => {
    if (isAllNamespaces(namespace)) {
      return null;
    }
    return buildNamespaceObjectMapScope(clusterId, namespace, { maxNodes: OBJECT_MAP_MAX_NODES });
  }, [clusterId, namespace]);
  const snapshot = useRefreshScopedDomain('object-map', mapScope ?? '__inactive__');

  useEffect(() => {
    if (!mapScope) {
      return;
    }
    refreshOrchestrator.setScopedDomainEnabled('object-map', mapScope, true);
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-map', mapScope, false, {
        preserveState: true,
      });
    };
  }, [mapScope]);

  const fetchMap = useCallback(
    (reason: 'startup' | 'user' = 'startup') => {
      if (!mapScope) return;
      void requestRefreshDomain({
        domain: 'object-map',
        scope: mapScope,
        reason,
      }).catch((error) => {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: 'namespace-map-fetch',
        });
      });
    },
    [mapScope]
  );

  useEffect(() => {
    if (mapScope) {
      fetchMap('startup');
    }
  }, [fetchMap, mapScope]);

  const handleOpenPanel = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) openWithObject(resolved);
    },
    [openWithObject]
  );

  const handleNavigateView = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) navigateToView(resolved);
    },
    [navigateToView]
  );

  const handleOpenObjectMap = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) openWithObject(resolved, { initialTab: 'map' });
    },
    [openWithObject]
  );

  const payload = snapshot.data as ObjectMapSnapshotPayload | null;
  const loading = isLoadingState(snapshot.status) && !payload;

  if (namespace === ALL_NAMESPACES_SCOPE) {
    return (
      <div className="namespace-map">
        <div className="namespace-map__message">Map is available for individual namespaces.</div>
      </div>
    );
  }

  return (
    <div className="namespace-map" data-testid="namespace-map">
      <div className="namespace-map__body">
        {snapshot.error && !payload && (
          <div className="namespace-map__message namespace-map__message--error">
            {snapshot.error}
          </div>
        )}
        {loading && <div className="namespace-map__message">Loading namespace map...</div>}
        {payload && (
          <ObjectMap
            payload={payload}
            onRefresh={() => fetchMap('user')}
            isRefreshing={isLoadingState(snapshot.status)}
            onOpenPanel={handleOpenPanel}
            onNavigateView={handleNavigateView}
            onOpenObjectMap={handleOpenObjectMap}
          />
        )}
        {!loading && !payload && !snapshot.error && (
          <div className="namespace-map__message">No data yet.</div>
        )}
      </div>
    </div>
  );
};

export default NsViewMap;
