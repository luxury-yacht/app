import { useCallback } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';

// Every docked reconstruction installs the placement projection before making
// object content visible. Transfer owners still control staging and acknowledgement.
export function useRestoreWorkspacePanels() {
  const { restorePanelTabs } = useObjectPanelState();
  const { dockPanelGroup } = useDockablePanelContext();
  return useCallback(
    (
      group: Pick<panelwindow.GroupSnapshot, 'clusterId' | 'tabs' | 'activePanelId'>,
      edge: 'right' | 'bottom',
      insertIndex?: number
    ) => {
      dockPanelGroup(
        group.clusterId,
        (group.tabs ?? []).map((tab) => tab.panelId),
        group.activePanelId,
        edge,
        insertIndex
      );
      restorePanelTabs(group);
    },
    [dockPanelGroup, restorePanelTabs]
  );
}
