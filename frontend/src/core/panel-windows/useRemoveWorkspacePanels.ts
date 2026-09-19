import { useCallback } from 'react';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';

// Release layout ownership before evicting the renderer's object state and caches.
export function useRemoveWorkspacePanels() {
  const { detachPanelGroup, discardPanelLayouts } = useDockablePanelContext();
  const { removeOwnedPanel } = useObjectPanelState();
  return useCallback(
    (clusterId: string, panelIds: string[]) => {
      detachPanelGroup(clusterId, panelIds);
      discardPanelLayouts(clusterId, panelIds);
      for (const panelId of panelIds) {
        removeOwnedPanel(clusterId, panelId);
      }
    },
    [detachPanelGroup, discardPanelLayouts, removeOwnedPanel]
  );
}
