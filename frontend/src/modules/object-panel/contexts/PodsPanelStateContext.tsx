/**
 * frontend/src/modules/object-panel/contexts/PodsPanelStateContext.tsx
 *
 * Per-cluster state for the Pods dock tab: the workload or node whose pods it
 * shows and the table whose "Show Pods" toggle opened it. Each cluster has at
 * most one Pods tab; the main window mounts this provider, panel windows don't.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ShowPodsView } from '@/core/settings/appPreferences';

export interface PodsPanelTarget {
  /** The workload or node whose pods the tab shows. */
  object: ObjectPanelRef;
  /** The table whose "Show Pods" toggle opened the tab. */
  source: ShowPodsView;
  /** Increases with every request, so showing the same object again brings the tab forward. */
  request: number;
}

export interface PodsPanelStateValue {
  /** The selected cluster's Pods tab target, or null when that tab is closed. */
  target: PodsPanelTarget | null;
  /** Clusters whose Pods tab is open. */
  openClusterIds: readonly string[];
  show: (object: ObjectPanelRef, source: ShowPodsView) => void;
  close: (clusterId: string) => void;
  /** Closes the Pods tab of every cluster where this table opened it. */
  closeSource: (source: ShowPodsView) => void;
}

const PodsPanelStateContext = createContext<PodsPanelStateValue | null>(null);

/** Null outside the main window, which is the only place Pods tabs open. */
export const useOptionalPodsPanelState = (): PodsPanelStateValue | null =>
  useContext(PodsPanelStateContext);

type TargetsByCluster = Record<string, PodsPanelTarget>;

const withoutClusters = (
  targets: TargetsByCluster,
  drop: (clusterId: string, target: PodsPanelTarget) => boolean
): TargetsByCluster => {
  const kept = Object.entries(targets).filter(([clusterId, target]) => !drop(clusterId, target));
  return kept.length === Object.keys(targets).length ? targets : Object.fromEntries(kept);
};

export const PodsPanelStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { selectedClusterId, managedClusterIds } = useKubeconfig();
  const [targets, setTargets] = useState<TargetsByCluster>({});
  const lastRequestRef = useRef(0);

  // A closed cluster's Pods tab goes with it.
  useEffect(() => {
    const openClusterIds = new Set(managedClusterIds ?? []);
    setTargets((previous) =>
      withoutClusters(previous, (clusterId) => !openClusterIds.has(clusterId))
    );
  }, [managedClusterIds]);

  const show = useCallback((object: ObjectPanelRef, source: ShowPodsView) => {
    lastRequestRef.current += 1;
    const request = lastRequestRef.current;
    setTargets((previous) => ({ ...previous, [object.clusterId]: { object, source, request } }));
  }, []);

  const close = useCallback((clusterId: string) => {
    setTargets((previous) => withoutClusters(previous, (id) => id === clusterId));
  }, []);

  const closeSource = useCallback((source: ShowPodsView) => {
    setTargets((previous) => withoutClusters(previous, (_id, opened) => opened.source === source));
  }, []);

  const target = (selectedClusterId && targets[selectedClusterId]) || null;
  const openClusterIds = useMemo(() => Object.keys(targets), [targets]);
  const value = useMemo(
    () => ({ target, openClusterIds, show, close, closeSource }),
    [target, openClusterIds, show, close, closeSource]
  );

  return <PodsPanelStateContext.Provider value={value}>{children}</PodsPanelStateContext.Provider>;
};
