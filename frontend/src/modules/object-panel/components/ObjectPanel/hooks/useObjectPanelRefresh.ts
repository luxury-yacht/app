/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts
 *
 * - Manages refresh logic for the object panel's resource details.
 * - Handles loading states, error handling, and provides a method to fetch resource details.
 * - Returns structured information about detail payload, loading state, error state, and a fetch function.
 */
import { useCallback, useEffect, useMemo } from 'react';

import { type DataRequestReason, requestRefreshDomain } from '@/core/data-access';
import { refreshManager } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { RefreshFailure } from '@/core/refresh/refreshFailure';
import { type DomainSnapshotState, useRefreshScopedDomain } from '@/core/refresh/store';
import type { DomainPayloadMap } from '@/core/refresh/types';
import type { ObjectDeletionMetadata } from '@/core/refresh/types.generated';

import { getObjectDetailsRefresherName, INACTIVE_SCOPE } from '../constants';
import type { PanelObjectData } from '../types';
import { useObjectPanelScopedDomainLifecycle } from './useObjectPanelScopedDomainLifecycle';

interface UseObjectPanelRefreshArgs {
  detailScope: string | null;
  objectKind: string | null;
  objectData: PanelObjectData | null;
  /**
   * The panel's canonical identity (objectPanelId). Scopes the refresher name
   * to THIS panel so simultaneously-open same-kind panels register distinct
   * refreshers instead of clobbering each other's registration/subscribers.
   */
  panelId: string | null;
  isOpen: boolean;
  resourceDeleted: boolean;
}

interface ObjectPanelRefreshResult {
  detailPayload: unknown;
  // Object creation time (RFC3339 UTC) from the details envelope; null when the
  // backend can't determine it. The header formats it into Age for every kind.
  creationTimestamp: string | null;
  // Relative "last modified" time from the details envelope (same format as
  // Age); null when the backend can't determine it.
  lastModified: string | null;
  deletion: ObjectDeletionMetadata | null;
  detailsLoading: boolean;
  detailsError: RefreshFailure | null;
  fetchResourceDetails: (reason?: DataRequestReason) => Promise<void>;
}

// The panel's view of its object-details snapshot: empty while the panel has
// no detail scope (unsupported kinds), so a stale scope never leaks through.
const selectDetailSnapshot = (
  detailScope: string | null,
  snapshot: DomainSnapshotState<DomainPayloadMap['object-details']>
) => {
  if (!detailScope) {
    return {
      detailPayload: null,
      creationTimestamp: null,
      lastModified: null,
      deletion: null,
      detailStatus: 'idle' as const,
      detailsError: null,
    };
  }
  const data = snapshot.data;
  return {
    detailPayload: data?.details ?? null,
    creationTimestamp: data?.creationTimestamp ?? null,
    lastModified: data?.lastModified ?? null,
    deletion: data?.deletion ?? null,
    detailStatus: snapshot.status,
    detailsError: snapshot.error ?? null,
  };
};

export const useObjectPanelRefresh = ({
  detailScope,
  objectKind,
  objectData,
  panelId,
  isOpen,
  resourceDeleted,
}: UseObjectPanelRefreshArgs): ObjectPanelRefreshResult => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  // Refresh context sync lives in RefreshSyncProvider; this hook only manages object-detail refreshes.
  const detailSnapshot = useRefreshScopedDomain('object-details', detailScope ?? INACTIVE_SCOPE);

  const { detailPayload, creationTimestamp, lastModified, deletion, detailStatus, detailsError } =
    selectDetailSnapshot(detailScope, detailSnapshot);

  const detailsLoadingState = applyPassiveLoadingPolicy({
    loading: !detailPayload && (detailStatus === 'loading' || detailStatus === 'updating'),
    hasLoaded: Boolean(detailPayload),
    isPaused,
    isManualRefreshActive,
  });
  const detailsLoading = detailsLoadingState.loading;

  const fetchResourceDetails = useCallback(
    async (reason: DataRequestReason = 'startup') => {
      if (!detailScope) {
        return;
      }
      await requestRefreshDomain({
        domain: 'object-details',
        scope: detailScope,
        reason,
      });
    },
    [detailScope]
  );

  useObjectPanelScopedDomainLifecycle({
    domain: 'object-details',
    scope: detailScope,
    enabled: isOpen && !resourceDeleted,
    fetchOnEnable: 'startup',
    preserveStateOnEnable: true,
  });

  const detailRefresherName = useMemo(
    () => getObjectDetailsRefresherName(objectKind, panelId),
    [objectKind, panelId]
  );

  useEffect(() => {
    if (!objectData || !objectKind || !detailRefresherName) {
      return;
    }

    const resourceKind = objectKind.toLowerCase();

    refreshManager.register({
      name: detailRefresherName,
      interval: resourceKind === 'pod' ? 2000 : 5000,
      cooldown: 1000,
      timeout: 10,
    });

    return () => {
      refreshManager.unregister(detailRefresherName);
    };
  }, [objectData, objectKind, detailRefresherName]);

  const refreshEnabled = Boolean(detailScope && isOpen && !resourceDeleted);

  useRefreshWatcher({
    refresherName: detailRefresherName,
    onRefresh: async (isManual, signal) => {
      if (refreshEnabled && objectData) {
        if (signal.aborted) {
          return;
        }
        await fetchResourceDetails(isManual ? 'user' : 'background');
      }
    },
    enabled: refreshEnabled && !!objectData && !!detailRefresherName,
  });

  return {
    detailPayload,
    creationTimestamp,
    lastModified,
    deletion,
    detailsLoading,
    detailsError,
    fetchResourceDetails,
  };
};
