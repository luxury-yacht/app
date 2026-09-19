/**
 * frontend/src/modules/namespace/components/NsViewMap.tsx
 *
 * Namespace-level relationship map. Uses the shared object-map renderer with
 * a namespace scope instead of an object seed scope.
 */
import type React from 'react';
import { useCallback, useMemo } from 'react';
import './NsViewMap.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { ALL_NAMESPACES_SCOPE, isAllNamespaces } from '@modules/namespace/constants';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { isMapSnapshotLoading } from '@modules/object-map/mapSnapshotStatus';
import ObjectMap from '@modules/object-map/ObjectMap';
import { useObjectMapNavigation } from '@modules/object-map/objectMapNavigation';
import {
  buildNamespaceObjectMapScope,
  OBJECT_MAP_MAX_NODES,
} from '@modules/object-map/objectMapScope';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useRefreshDomainHandle } from '@/core/data-access';
import type { ObjectMapSnapshotPayload } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';

interface NsViewMapProps {
  namespace: string;
}

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
  const handleFetchError = useCallback((error: unknown) => {
    errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
      source: 'namespace-map-fetch',
    });
  }, []);
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-map',
    scope: mapScope,
    enabled: Boolean(mapScope),
    preserveState: true,
    fetchOnEnable: 'startup',
    onFetchError: handleFetchError,
  });

  const { handleOpenPanel, handleNavigateView, handleOpenObjectMap } = useObjectMapNavigation(
    openWithObject,
    navigateToView
  );

  const payload = snapshot.data as ObjectMapSnapshotPayload | null;
  const loading = isMapSnapshotLoading(snapshot.status) && !payload;

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
            <ErrorSurface kind="reported" message={snapshot.error} />
          </div>
        )}
        {!!loading && <div className="namespace-map__message">Loading namespace map...</div>}
        {!!payload && (
          <ObjectMap
            payload={payload}
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
