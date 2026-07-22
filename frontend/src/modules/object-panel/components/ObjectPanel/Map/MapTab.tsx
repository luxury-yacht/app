/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Map/MapTab.tsx
 *
 * Wraps the self-contained <ObjectMap /> with the orchestrator plumbing
 * the panel system expects: fetch on tab activation, cleanup with
 * preserveState on tab unmount (full cleanup is handled by
 * ObjectPanelContent when the whole panel closes — see evictPanelScopes
 * in ObjectPanelStateContext for the symmetric reset).
 *
 * The object-map scoped domain stays enabled while the tab is active,
 * so the shared refresh manager polls it on the configured cadence.
 */
import type React from 'react';
import { useCallback } from 'react';
import './MapTab.css';
import { isMapSnapshotLoading } from '@modules/object-map/mapSnapshotStatus';
import ObjectMap from '@modules/object-map/ObjectMap';
import { buildResolvedFromMapRef } from '@modules/object-map/objectMapNavigation';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useRefreshDomainHandle } from '@/core/data-access';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import type { PanelObjectData } from '../types';

interface MapTabProps {
  objectData: PanelObjectData | null;
  isActive?: boolean;
  // Scope owned by ObjectPanel via getObjectPanelScopes so this tab and
  // ObjectPanelContent (which handles full cleanup on panel close)
  // cannot drift apart.
  mapScope: string | null;
}

const MapTab: React.FC<MapTabProps> = ({ objectData, isActive, mapScope }) => {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const handleFetchError = useCallback((error: unknown) => {
    errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
      source: 'object-map-fetch',
    });
  }, []);
  const { state: snapshot } = useRefreshDomainHandle({
    domain: 'object-map',
    scope: mapScope,
    enabled: Boolean(isActive && objectData && mapScope),
    preserveState: true,
    fetchOnEnable: isActive && objectData && mapScope ? 'startup' : false,
    onFetchError: handleFetchError,
  });

  const payload = snapshot.data as ObjectMapSnapshotPayload | null;
  const loading =
    Boolean(isActive && objectData && mapScope && isMapSnapshotLoading(snapshot.status)) &&
    !payload;

  const handleOpenPanel = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) {
        openWithObject(resolved);
      }
    },
    [openWithObject]
  );

  const handleNavigateView = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) {
        navigateToView(resolved);
      }
    },
    [navigateToView]
  );

  const handleOpenObjectMap = useCallback(
    (ref: ObjectMapReference) => {
      const resolved = buildResolvedFromMapRef(ref);
      if (resolved) {
        openWithObject(resolved, { initialTab: 'map' });
      }
    },
    [openWithObject]
  );

  return (
    <div className="object-panel-tab-content map-tab" data-testid="map-tab">
      <div className="map-tab__body">
        {snapshot.error && !payload && (
          <div className="map-tab__message map-tab__message--error">{snapshot.error}</div>
        )}
        {!!loading && <div className="map-tab__message">Loading object map…</div>}
        {!!payload && (
          <ObjectMap
            payload={payload}
            onOpenPanel={handleOpenPanel}
            onNavigateView={handleNavigateView}
            onOpenObjectMap={handleOpenObjectMap}
          />
        )}
        {!loading && !payload && !snapshot.error && (
          <div className="map-tab__message">No data yet.</div>
        )}
      </div>
    </div>
  );
};

export default MapTab;
