import { useEffect } from 'react';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { reportOperationalError } from '@/utils/errorHandler';
import { closePanelWorkspaceObject } from './index';
import type { PanelPublicationQueue } from './publicationQueue';

// Publications only arrange a renderer's panels, so a close must reach the
// directory as its own intent. It joins the renderer's outbound queue, so a
// flush (before a close or a cluster-view move) also drains pending closes.
export function useClosedPanelIntents(queue: PanelPublicationQueue, windowName: string): void {
  const { subscribeClosedPanels } = useObjectPanelState();
  useEffect(
    () =>
      subscribeClosedPanels((clusterId, panelIds) => {
        for (const panelId of panelIds) {
          queue.publish(
            () => closePanelWorkspaceObject(windowName, clusterId, panelId),
            (error) =>
              reportOperationalError(error, {
                source: 'useClosedPanelIntents',
                action: 'close-panel',
                clusterId,
              })
          );
        }
      }),
    [subscribeClosedPanels, queue, windowName]
  );
}
