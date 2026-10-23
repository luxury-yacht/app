import type { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import type { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { buildObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import {
  canResolveEventObjectReference,
  resolveEventObjectReference,
} from '@shared/utils/eventObjectIdentity';
import { useCallback } from 'react';
import type { RecentEventEntry } from '@/core/refresh/types';

interface UseRecentClusterOverviewEventsInput {
  selectedClusterId: string | null;
  selectedClusterName: string | null;
  openWithObject: ReturnType<typeof useObjectPanel>['openWithObject'];
  hydrateClusterMeta: ReturnType<typeof useObjectPanelState>['hydrateClusterMeta'];
}

export const useRecentClusterOverviewEvents = ({
  selectedClusterId,
  selectedClusterName,
  openWithObject,
  hydrateClusterMeta,
}: UseRecentClusterOverviewEventsInput) => {
  const getObjectRefInput = useCallback(
    (event: RecentEventEntry) => ({
      involvedObject: event.involvedObject,
      objectUid: event.objectUid,
      clusterId: event.clusterId ?? selectedClusterId ?? undefined,
      clusterName: event.clusterName ?? selectedClusterName ?? undefined,
    }),
    [selectedClusterId, selectedClusterName]
  );

  const canOpen = useCallback(
    (event: RecentEventEntry) => canResolveEventObjectReference(getObjectRefInput(event)),
    [getObjectRefInput]
  );

  const onOpen = useCallback(
    async (event: RecentEventEntry) => {
      const ref = await resolveEventObjectReference(getObjectRefInput(event));
      if (!ref) {
        return;
      }
      // The fully hydrated ref keeps the panel within its cluster and object
      // identity. The open itself lands on Events: the shared open sets the
      // panel's tab when it resolves, so a tab set afterwards would be lost.
      openWithObject(buildObjectPanelRef(hydrateClusterMeta(ref)), { initialTab: 'events' });
    },
    [getObjectRefInput, hydrateClusterMeta, openWithObject]
  );

  return { canOpen, onOpen };
};
