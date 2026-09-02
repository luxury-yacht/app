import type { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { objectPanelId } from '@modules/object-panel/contexts/ObjectPanelStateContext';
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
  setObjectPanelActiveTab: ReturnType<typeof useObjectPanelState>['setObjectPanelActiveTab'];
}

export const useRecentClusterOverviewEvents = ({
  selectedClusterId,
  selectedClusterName,
  openWithObject,
  hydrateClusterMeta,
  setObjectPanelActiveTab,
}: UseRecentClusterOverviewEventsInput) => {
  const getObjectRefInput = useCallback(
    (event: RecentEventEntry) => ({
      object:
        event.objectKind && event.objectName
          ? `${event.objectKind}/${event.objectName}`
          : undefined,
      objectUid: event.objectUid,
      objectApiVersion: event.objectApiVersion,
      objectNamespace: event.objectNamespace || undefined,
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
      const panelRef = buildObjectPanelRef(hydrateClusterMeta(ref));
      openWithObject(panelRef);
      // The panel id comes from the fully hydrated ref so events never cross
      // cluster or object identity boundaries.
      const panelId = objectPanelId(panelRef);
      setObjectPanelActiveTab(panelRef.clusterId, panelId, 'events');
    },
    [getObjectRefInput, hydrateClusterMeta, openWithObject, setObjectPanelActiveTab]
  );

  return { canOpen, onOpen };
};
