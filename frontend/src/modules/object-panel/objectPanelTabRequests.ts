/**
 * frontend/src/modules/object-panel/objectPanelTabRequests.ts
 *
 * Coordinates cross-feature tab selection requests for object panels.
 */

import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';

type TabRequestListener = (panelId: string, tab: ViewType) => void;

const pendingTabByPanel = new Map<string, ViewType>();
const listeners = new Set<TabRequestListener>();

/**
 * Queues a tab for a panel and notifies mounted panels, which may apply and
 * clear it before this returns; callers must not re-read the pending state to
 * confirm delivery.
 */
export function requestObjectPanelTab(panelId: string, tab: ViewType): void {
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

/** Test-only: drops pending requests so a reused panel id starts with none. */
export function resetObjectPanelTabRequestsForTesting(): void {
  pendingTabByPanel.clear();
}

export function subscribeObjectPanelTabRequests(listener: TabRequestListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
