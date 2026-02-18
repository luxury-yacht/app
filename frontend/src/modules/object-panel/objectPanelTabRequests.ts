/**
 * frontend/src/modules/object-panel/objectPanelTabRequests.ts
 *
 * Coordinates cross-feature tab selection requests for object panels.
 */

import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';

type TabRequestListener = (panelId: string, tab: ViewType) => void;

const pendingTabByPanel = new Map<string, ViewType>();
const listeners = new Set<TabRequestListener>();

export function requestObjectPanelTab(panelId: string, tab: ViewType): void {
  if (!panelId) {
    return;
  }
  pendingTabByPanel.set(panelId, tab);
  listeners.forEach((listener) => {
    listener(panelId, tab);
  });
}

export function getRequestedObjectPanelTab(panelId: string): ViewType | undefined {
  return pendingTabByPanel.get(panelId);
}

export function clearRequestedObjectPanelTab(panelId: string): void {
  pendingTabByPanel.delete(panelId);
}

export function subscribeObjectPanelTabRequests(listener: TabRequestListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
