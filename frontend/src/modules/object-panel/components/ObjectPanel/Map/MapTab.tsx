/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Map/MapTab.tsx
 *
 * Wraps the self-contained <ObjectMap /> with the orchestrator plumbing
 * the panel system expects: fetch on tab activation, manual refresh,
 * cleanup with preserveState on tab unmount (full cleanup is handled by
 * ObjectPanelContent when the whole panel closes — see evictPanelScopes
 * in ObjectPanelStateContext for the symmetric reset).
 *
 * Auto-refresh is intentionally NOT wired here. The timing entry exists
 * in refresherConfig so adding a per-kind refresher later mirrors the
 * EventsTab pattern (refreshManager.register + useRefreshWatcher) and
 * is purely additive.
 */
import React, { useCallback, useEffect } from 'react';
import './MapTab.css';
import { errorHandler } from '@/utils/errorHandler';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator } from '@/core/refresh';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { ObjectMapSnapshotPayload } from '@/core/refresh/types';
import ObjectMap from '@modules/object-map/ObjectMap';
import { INACTIVE_SCOPE } from '../constants';
import type { PanelObjectData } from '../types';

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

  // Fetch-on-activation. Map snapshots are heavier than events so we
  // intentionally don't auto-tick; users get a Refresh button below.
  useEffect(() => {
    if (isActive && objectData && mapScope) {
      fetchMap('startup');
    }
  }, [fetchMap, isActive, objectData, mapScope]);

  const payload = snapshot.data as ObjectMapSnapshotPayload | null;
  const loading = isLoadingState(snapshot.status) && !payload;

  return (
    <div className="object-panel-tab-content map-tab" data-testid="map-tab">
      <div className="map-tab__toolbar">
        <button
          type="button"
          className="button generic"
          onClick={() => fetchMap('user')}
          disabled={!mapScope || isLoadingState(snapshot.status)}
        >
          Refresh
        </button>
        {payload && (
          <span className="map-tab__meta">
            {payload.nodes.length} nodes · {payload.edges.length} edges
          </span>
        )}
      </div>
      <div className="map-tab__body">
        {snapshot.error && !payload && (
          <div className="map-tab__message map-tab__message--error">{snapshot.error}</div>
        )}
        {loading && <div className="map-tab__message">Loading object map…</div>}
        {payload && <ObjectMap payload={payload} />}
        {!loading && !payload && !snapshot.error && (
          <div className="map-tab__message">No data yet.</div>
        )}
      </div>
    </div>
  );
};

export default MapTab;
