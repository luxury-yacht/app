import { useCallback, useEffect, useMemo } from 'react';

import { refreshManager, refreshOrchestrator } from '@/core/refresh';
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
  fetchResourceDetails: (isManualRefresh?: boolean) => Promise<void>;
}

export const useObjectPanelRefresh = ({
  detailScope,
  objectKind,
  objectData,
  isOpen,
  resourceDeleted,
}: UseObjectPanelRefreshArgs): ObjectPanelRefreshResult => {
  const detailSnapshot = useRefreshScopedDomain('object-details', detailScope ?? INACTIVE_SCOPE);

  const detailPayload = detailScope ? (detailSnapshot.data?.details ?? null) : null;
  const detailStatus = detailScope ? detailSnapshot.status : 'idle';

  const detailsLoading = detailScope
    ? !detailPayload && (detailStatus === 'loading' || detailStatus === 'updating')
    : false;

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
    async (isManualRefresh = false) => {
      if (!detailScope) return;
      await refreshOrchestrator.fetchScopedDomain('object-details', detailScope, {
        isManual: isManualRefresh,
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
      refreshOrchestrator.setScopedDomainEnabled('object-details', detailScope, false);
      refreshOrchestrator.resetScopedDomain('object-details', detailScope);
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
        await fetchResourceDetails(isManual);
      }
    },
    enabled: refreshEnabled && !!objectData && !!detailRefresherName,
  });

  useEffect(() => {
    if (isOpen && objectData) {
      refreshOrchestrator.updateContext({
        objectPanel: {
          isOpen: true,
          objectKind: objectData.kind ? objectData.kind.toLowerCase() : undefined,
          objectName: objectData.name ?? undefined,
          objectNamespace: objectData.namespace ?? undefined,
        },
      });
    } else {
      refreshOrchestrator.updateContext({
        objectPanel: {
          isOpen: false,
        },
      });
    }
  }, [isOpen, objectData]);

  useEffect(() => {
    if (isOpen && detailScope && !resourceDeleted) {
      void fetchResourceDetails(true);
    }
  }, [fetchResourceDetails, isOpen, detailScope, resourceDeleted]);

  return {
    detailPayload,
    detailsLoading,
    detailsError,
    fetchResourceDetails,
  };
};
