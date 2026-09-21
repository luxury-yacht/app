import { useCallback } from 'react';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';

// Detach membership before removing content; committed removal releases geometry and caches.
export function useRemoveWorkspacePanels() {
  const { detachPanelGroup } = useDockablePanelContext();
  const { removeOwnedPanel } = useObjectPanelState();
  return useCallback(
    (clusterId: string, panelIds: string[]) => {
      detachPanelGroup(clusterId, panelIds);
      for (const panelId of panelIds) {
        removeOwnedPanel(clusterId, panelId);
      }
    },
    [detachPanelGroup, removeOwnedPanel]
  );
}
