/**
 * frontend/src/modules/object-panel/pods-panel/PodsPanelHost.tsx
 *
 * Mounts the selected cluster's Pods dock tab while it has a target, and
 * forgets a cluster's tab dock state once that tab closes. The tab's module
 * loads on first use.
 */

import { withLazyBoundary } from '@shared/utils/react/withLazyBoundary';
import { useDockablePanelContext } from '@ui/dockable';
import { PanelErrorBoundary } from '@ui/errors';
import { useEffect, useRef } from 'react';
import { useOptionalPodsPanelState } from '../contexts/PodsPanelStateContext';
import { podsPanelId } from './podsPanelId';

// Rendered in a dock portal; an inline fallback would add a row to the app grid.
const PodsPanel = withLazyBoundary(() => import('./PodsPanel'), null);

const NO_CLUSTERS: readonly string[] = [];

// The tab reuses one panel id per cluster. Like object panels
// (PanelLayoutLifecycle), a closed tab's dock state is discarded, whichever way
// it closed, so the next row click opens a fresh tab instead of a closed one.
function useDiscardClosedPodsTabs(openClusterIds: readonly string[]) {
  const { discardPanelLayouts } = useDockablePanelContext();
  const previousRef = useRef(openClusterIds);
  useEffect(() => {
    const open = new Set(openClusterIds);
    for (const clusterId of previousRef.current) {
      if (!open.has(clusterId)) {
        discardPanelLayouts(clusterId, [podsPanelId(clusterId)]);
      }
    }
    previousRef.current = openClusterIds;
  }, [discardPanelLayouts, openClusterIds]);
}

export function PodsPanelHost() {
  const podsPanel = useOptionalPodsPanelState();
  useDiscardClosedPodsTabs(podsPanel?.openClusterIds ?? NO_CLUSTERS);
  const target = podsPanel?.target;
  if (!podsPanel || !target) {
    return null;
  }
  const close = () => podsPanel.close(target.object.clusterId);
  return (
    <PanelErrorBoundary onClose={close} panelName="pods">
      <PodsPanel target={target} onClose={close} />
    </PanelErrorBoundary>
  );
}
