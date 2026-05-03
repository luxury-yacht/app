/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Map/MapTab.tsx
 *
 * Wraps the self-contained <ObjectMap /> with the orchestrator plumbing
 * the panel system expects: fetch on tab activation, manual refresh,
 * cleanup with preserveState on tab unmount (full cleanup is handled by
 * ObjectPanelContent when the whole panel closes — see evictPanelScopes
 * in ObjectPanelStateContext for the symmetric reset).
 *
 * The object-map scoped domain stays enabled while the tab is active,
 * so the shared refresh manager polls it on the configured cadence.
 */
import React, { useCallback, useEffect } from 'react';
import './MapTab.css';
import { errorHandler } from '@/utils/errorHandler';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { ObjectMapReference, ObjectMapSnapshotPayload } from '@/core/refresh/types';
import ObjectMap from '@modules/object-map/ObjectMap';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import { INACTIVE_SCOPE } from '../constants';
import type { PanelObjectData } from '../types';

const buildResolvedFromMapRef = (ref: ObjectMapReference): ResolvedObjectReference | null => {
  try {
    return buildRequiredObjectReference({
      kind: ref.kind,
      name: ref.name,
      namespace: ref.namespace ?? undefined,
      clusterId: ref.clusterId,
      clusterName: ref.clusterName ?? undefined,
      group: ref.group,
      version: ref.version,
      resource: ref.resource ?? undefined,
      uid: ref.uid ?? undefined,
    });
  } catch (error) {
    errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
      source: 'object-map-build-ref',
    });
    return null;
  }
};

interface MapTabProps {
  objectData: PanelObjectData | null;
  isActive?: boolean;
  // Scope owned by ObjectPanel via getObjectPanelKind so this tab and
  // ObjectPanelContent (which handles full cleanup on panel close)
  // cannot drift apart.
  mapScope: string | null;
}

const isLoadingState = (status: string): boolean =>
  status === 'loading' || status === 'initialising';

const MapTab: React.FC<MapTabProps> = ({ objectData, isActive, mapScope }) => {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const snapshot = useRefreshScopedDomain('object-map', mapScope ?? INACTIVE_SCOPE);

  // Enable the scoped domain while the tab is active. preserveState on
  // unmount keeps the store entry around so diagnostics still sees it
  // and a remount renders from cache; full eviction happens when the
  // owning panel closes (evictPanelScopes).
  useEffect(() => {
    if (!mapScope) {
      return;
    }
    const enabled = Boolean(isActive && objectData);
    refreshOrchestrator.setScopedDomainEnabled('object-map', mapScope, enabled);
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-map', mapScope, false, {
        preserveState: true,
      });
    };
  }, [mapScope, isActive, objectData]);

  const fetchMap = useCallback(
    (reason: 'startup' | 'user' = 'startup') => {
      if (!mapScope) return;
      void requestRefreshDomain({
        domain: 'object-map',
        scope: mapScope,
        reason,
      }).catch((error) => {
        errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
          source: 'object-map-fetch',
        });
      });
    },
    [mapScope]
  );

  // Fetch immediately on activation; the enabled scoped domain handles
  // subsequent polling, and the toolbar exposes an explicit refresh.
  useEffect(() => {
    if (isActive && objectData && mapScope) {
      fetchMap('startup');
    }
  }, [fetchMap, isActive, objectData, mapScope]);

  const payload = snapshot.data as ObjectMapSnapshotPayload | null;
  const loading = isLoadingState(snapshot.status) && !payload;
  const handleRefresh = useCallback(() => fetchMap('user'), [fetchMap]);
  // ObjectMap renders the Refresh button; only expose it when we
  // have a scope to fetch against.
  const onRefresh = mapScope ? handleRefresh : undefined;

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

  return (
    <div className="object-panel-tab-content map-tab" data-testid="map-tab">
      <div className="map-tab__body">
        {snapshot.error && !payload && (
          <div className="map-tab__message map-tab__message--error">{snapshot.error}</div>
        )}
        {loading && <div className="map-tab__message">Loading object map…</div>}
        {payload && (
          <ObjectMap
            payload={payload}
            onRefresh={onRefresh}
            isRefreshing={isLoadingState(snapshot.status)}
            onOpenPanel={handleOpenPanel}
            onNavigateView={handleNavigateView}
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
