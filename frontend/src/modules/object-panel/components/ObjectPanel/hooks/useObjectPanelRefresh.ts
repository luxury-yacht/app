/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts
 *
 * - Manages refresh logic for the object panel's resource details.
 * - Handles loading states, error handling, and provides a method to fetch resource details.
 * - Returns structured information about detail payload, loading state, error state, and a fetch function.
 */
import { useCallback, useEffect, useMemo } from 'react';

import { requestRefreshDomain, type DataRequestReason } from '@/core/data-access';
import { refreshManager, refreshOrchestrator } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';

import { INACTIVE_SCOPE, getObjectDetailsRefresherName } from '../constants';
import type { PanelObjectData } from '../types';

interface UseObjectPanelRefreshArgs {
  detailScope: string | null;
  objectKind: string | null;
  objectData: PanelObjectData | null;
  isOpen: boolean;
  resourceDeleted: boolean;
}

interface ObjectPanelRefreshResult {
  detailPayload: unknown;
  detailsLoading: boolean;
  detailsError: string | null;
  fetchResourceDetails: (reason?: DataRequestReason) => Promise<void>;
}

export const useObjectPanelRefresh = ({
  detailScope,
  objectKind,
  objectData,
  isOpen,
  resourceDeleted,
}: UseObjectPanelRefreshArgs): ObjectPanelRefreshResult => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  // Refresh context sync lives in RefreshSyncProvider; this hook only manages object-detail refreshes.
  const detailSnapshot = useRefreshScopedDomain('object-details', detailScope ?? INACTIVE_SCOPE);

  const detailPayload = detailScope ? (detailSnapshot.data?.details ?? null) : null;
  const detailStatus = detailScope ? detailSnapshot.status : 'idle';

  const detailsLoadingState = applyPassiveLoadingPolicy({
    loading: detailScope
      ? !detailPayload && (detailStatus === 'loading' || detailStatus === 'updating')
      : false,
    hasLoaded: Boolean(detailPayload),
    isPaused,
    isManualRefreshActive,
  });
  const detailsLoading = detailsLoadingState.loading;

  const detailsError = detailScope
    ? (() => {
        const message = detailSnapshot.error ?? null;
        if (!message) {
          return null;
        }
        const normalized = message.toLowerCase();
        if (
          normalized.includes('object detail provider not implemented') ||
          normalized.includes('object details fetcher not implemented')
        ) {
          return null;
        }
        return message;
      })()
    : null;

  const fetchResourceDetails = useCallback(
    async (reason: DataRequestReason = 'startup') => {
      if (!detailScope) return;
      await requestRefreshDomain({
        domain: 'object-details',
        scope: detailScope,
        reason,
      });
    },
    [detailScope]
  );

  useEffect(() => {
    if (!detailScope) {
      return;
    }

    const enabled = isOpen && !resourceDeleted;
    refreshOrchestrator.setScopedDomainEnabled('object-details', detailScope, enabled);
    return () => {
      // Stop refreshing this scope but preserve the cached snapshot so a
      // remount (e.g. cluster switch round-trip) renders instantly from
      // cache while the next fetch catches up. Eviction happens in
      // ObjectPanelStateContext.closePanel when the user actually closes
      // the panel — see Tier 1 of the responsiveness fix.
      refreshOrchestrator.setScopedDomainEnabled('object-details', detailScope, false, {
        preserveState: true,
      });
    };
  }, [detailScope, isOpen, resourceDeleted]);

  const detailRefresherName = useMemo(
    () => getObjectDetailsRefresherName(objectKind),
    [objectKind]
  );

  useEffect(() => {
    if (!objectData || !objectKind || !detailRefresherName) return;

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
        if (signal.aborted) return;
        await fetchResourceDetails(isManual ? 'user' : 'background');
      }
    },
    enabled: refreshEnabled && !!objectData && !!detailRefresherName,
  });

  useEffect(() => {
    if (isOpen && detailScope && !resourceDeleted) {
      void fetchResourceDetails('startup');
    }
  }, [detailScope, fetchResourceDetails, isOpen, resourceDeleted]);

  return {
    detailPayload,
    detailsLoading,
    detailsError,
    fetchResourceDetails,
  };
};
