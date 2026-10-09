/**
 * frontend/src/modules/object-panel/pods-panel/podsPanelId.ts
 *
 * The Pods dock tab's panel id: one tab per cluster.
 */

export const podsPanelId = (clusterId: string): string => `pods:${clusterId}`;
