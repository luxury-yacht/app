import { useEffect } from 'react';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { reportOperationalError } from '@/utils/errorHandler';
import { closePanelWorkspaceObject } from './index';
import type { PanelPublicationQueue } from './publicationQueue';

const closeKey = (clusterId: string, panelId: string) => `${clusterId}\u0000${panelId}`;

// An open of a panel this renderer closed waits for that close to land, and
// fails while it cannot: the directory would otherwise still answer with the
// closed panel, or a late retry could delete the reopened one. Panel IDs are
// stable per object, so a reopen reuses the closed panel's ID.
export const settlePanelClose = (
  queue: PanelPublicationQueue,
  clusterId: string,
  panelId: string
): Promise<void> => queue.settleCommands(closeKey(clusterId, panelId));

// Publications only arrange a renderer's panels, so a close must reach the
// directory as its own intent. It joins the renderer's outbound queue as a
// command: a failed close stays pending until a retry lands, and a flush (before
// a close or a cluster-view move) or an open of that panel retries it first.
export function useClosedPanelIntents(queue: PanelPublicationQueue, windowName: string): void {
  const { subscribeClosedPanels } = useObjectPanelState();
  useEffect(
    () =>
      subscribeClosedPanels((clusterId, panelIds) => {
        for (const panelId of panelIds) {
          queue.command(
            () => closePanelWorkspaceObject(windowName, clusterId, panelId),
            (error) =>
              reportOperationalError(error, {
                source: 'useClosedPanelIntents',
                action: 'close-panel',
                clusterId,
              }),
            closeKey(clusterId, panelId)
          );
        }
      }),
    [subscribeClosedPanels, queue, windowName]
  );
}
