import { useEffect, useRef } from 'react';
import { useLocalPanelSnapshots } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';

// Both app and native renderers release geometry only after their local object
// collection removes a panel. Switching the active cluster does not remove it.
export function PanelLayoutLifecycle() {
  const local = useLocalPanelSnapshots();
  const previous = useRef(local);
  const { discardPanelLayouts } = useDockablePanelContext();
  useEffect(() => {
    const removed = previous.current;
    previous.current = local;
    for (const [clusterId, tabs] of Object.entries(removed)) {
      const current = new Set((local[clusterId] ?? []).map((tab) => tab.panelId));
      const ids = tabs.filter((tab) => !current.has(tab.panelId)).map((tab) => tab.panelId);
      if (ids.length) {
        discardPanelLayouts(clusterId, ids);
      }
    }
  }, [local, discardPanelLayouts]);
  return null;
}
