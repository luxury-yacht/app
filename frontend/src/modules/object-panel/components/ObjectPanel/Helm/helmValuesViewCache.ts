/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Helm/helmValuesViewCache.ts
 *
 * Remembers each object panel's selected Helm Values view. The Values tab
 * unmounts whenever another panel tab is shown, so the choice lives outside
 * it, keyed by the cluster-prefixed panelId like logViewerPrefsCache.
 * ObjectPanelStateContext evicts the entry with the panel's other caches.
 */

import type { ObjectHelmValuesSnapshotPayload } from '@/core/refresh/types.generated';

/** A Values view, named by the payload field it shows. */
export type HelmValuesView = keyof Pick<
  ObjectHelmValuesSnapshotPayload,
  'defaults' | 'overrides' | 'merged'
>;

const views = new Map<string, HelmValuesView>();

export const getHelmValuesView = (panelId: string): HelmValuesView | undefined =>
  views.get(panelId);

export const setHelmValuesView = (panelId: string, view: HelmValuesView): void => {
  views.set(panelId, view);
};

export const clearHelmValuesView = (panelId: string): void => {
  views.delete(panelId);
};

/** Test helper to clear cached views between runs. */
export const resetHelmValuesViewCacheForTesting = (): void => {
  views.clear();
};
