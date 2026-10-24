/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.ts
 *
 * - Manages refresh logic for the object panel's resource details.
 * - Handles loading states, error handling, and provides a method to fetch resource details.
 * - Returns structured information about detail payload, loading state, error state, and a fetch function.
 */
import { useCallback } from 'react';

import {
  type DataRequestReason,
  requestRefreshDomain,
  useScopedRefreshDomainLifecycle,
} from '@/core/data-access';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { RefreshFailure } from '@/core/refresh/refreshFailure';
import { type DomainSnapshotState, useRefreshScopedDomain } from '@/core/refresh/store';
import type { DomainPayloadMap } from '@/core/refresh/types';
import type { ObjectDeletionMetadata, ObjectDetail } from '@/core/refresh/types.generated';

import { INACTIVE_SCOPE } from '../constants';

interface UseObjectPanelRefreshArgs {
  detailScope: string | null;
  // False while another tab of the panel's dock group is showing.
  isOpen: boolean;
  resourceDeleted: boolean;
}

interface ObjectPanelRefreshResult {
  /** The object's detail DTO tagged with its type; null until the first snapshot. */
  detail: ObjectDetail | null;
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
      detail: null,
      creationTimestamp: null,
      lastModified: null,
      deletion: null,
      detailStatus: 'idle' as const,
      detailsError: null,
    };
  }
  const data = snapshot.data;
  return {
    detail: data ?? null,
    creationTimestamp: data?.creationTimestamp ?? null,
    lastModified: data?.lastModified ?? null,
    deletion: data?.deletion ?? null,
    detailStatus: snapshot.status,
    detailsError: snapshot.error ?? null,
  };
};

// The panel's details lease polls at the contract's 10 s backstop and its
// doorbell refetches on change; the lease follows the panel's visibility.
export const useObjectPanelRefresh = ({
  detailScope,
  isOpen,
  resourceDeleted,
}: UseObjectPanelRefreshArgs): ObjectPanelRefreshResult => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  // Refresh context sync lives in RefreshSyncProvider; this hook only manages object-detail refreshes.
  const detailSnapshot = useRefreshScopedDomain('object-details', detailScope ?? INACTIVE_SCOPE);

  const { detail, creationTimestamp, lastModified, deletion, detailStatus, detailsError } =
    selectDetailSnapshot(detailScope, detailSnapshot);

  const detailsLoadingState = applyPassiveLoadingPolicy({
    loading: !detail && (detailStatus === 'loading' || detailStatus === 'updating'),
    hasLoaded: Boolean(detail),
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

  const leased = Boolean(detailScope && isOpen && !resourceDeleted);
  useScopedRefreshDomainLifecycle({
    domain: 'object-details',
    scope: detailScope,
    enabled: leased,
    preserveState: true,
    fetchOnEnable: 'startup',
  });

  return {
    detail,
    creationTimestamp,
    lastModified,
    deletion,
    detailsLoading,
    detailsError,
    fetchResourceDetails,
  };
};
