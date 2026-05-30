/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts
 *
 * - Determines and manages pod data and metrics for the object panel.
 * - Handles refresh logic based on panel state and active tab.
 * - Returns structured pod data, loading states, and error information.
 */
import { useEffect, useMemo } from 'react';
import {
  requestRefreshDomain,
  resetRefreshDomain,
  setRefreshDomainEnabled,
} from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { INACTIVE_SCOPE } from '../constants';
import type { PanelObjectData, ViewType } from '../types';

type PodsScope =
  | { scope: string; kind: 'node' }
  | { scope: string; kind: 'workload'; namespace: string }
  | null;

const WORKLOAD_SCOPE_GVK: Record<string, { group: string; version: string; kind: string }> = {
  deployment: { group: 'apps', version: 'v1', kind: 'Deployment' },
  daemonset: { group: 'apps', version: 'v1', kind: 'DaemonSet' },
  statefulset: { group: 'apps', version: 'v1', kind: 'StatefulSet' },
  job: { group: 'batch', version: 'v1', kind: 'Job' },
  replicaset: { group: 'apps', version: 'v1', kind: 'ReplicaSet' },
};

export interface ObjectPanelPodsState {
  pods: PodSnapshotEntry[];
  metrics: PodMetricsInfo | null;
  loading: boolean;
  error: string | null;
  scope: string | null;
}

interface UseObjectPanelPodsArgs {
  objectData: PanelObjectData | null;
  objectKind: string | null;
  isOpen: boolean;
  activeTab: ViewType;
}

export function useObjectPanelPods({
  objectData,
  objectKind,
  isOpen,
  activeTab,
}: UseObjectPanelPodsArgs): ObjectPanelPodsState {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const normalizedKind = objectKind?.toLowerCase() ?? null;

  const podsScope = useMemo<PodsScope>(() => {
    if (!objectData?.name || !normalizedKind) {
      return null;
    }
    if (normalizedKind === 'node') {
      return { scope: `node:${objectData.name}`, kind: 'node' };
    }
    const workloadNamespace = objectData.namespace?.trim();
    // Prefer the original-case Kind from PanelObjectData; fall back to the
    // lowercased objectKind only if the data source didn't provide one.
    // Previously routed through WORKLOAD_KIND_API_NAMES as a casing safety
    // net; that map is retired.
    const fallbackGVK = WORKLOAD_SCOPE_GVK[normalizedKind];
    if (workloadNamespace && fallbackGVK) {
      const workloadKindSegment = objectData.kind ?? fallbackGVK.kind;
      const workloadGroup = objectData.group ?? fallbackGVK.group;
      const workloadVersion = objectData.version ?? fallbackGVK.version;
      if (!workloadVersion || !workloadKindSegment) {
        return null;
      }
      return {
        scope: `workload:${workloadNamespace}:${workloadGroup}:${workloadVersion}:${workloadKindSegment}:${objectData.name}`,
        kind: 'workload',
        namespace: workloadNamespace,
      };
    }
    return null;
  }, [
    normalizedKind,
    objectData?.name,
    objectData?.namespace,
    objectData?.kind,
    objectData?.group,
    objectData?.version,
  ]);

  const refreshScope = useMemo(() => {
    if (!podsScope?.scope) {
      return INACTIVE_SCOPE;
    }
    return buildClusterScope(objectData?.clusterId ?? undefined, podsScope.scope);
  }, [objectData?.clusterId, podsScope?.scope]);
  const snapshot = useRefreshScopedDomain('pods', refreshScope);

  const shouldEnable = isOpen && activeTab === 'pods' && Boolean(podsScope?.scope);

  useEffect(() => {
    if (!podsScope?.scope || refreshScope === INACTIVE_SCOPE) {
      return;
    }

    setRefreshDomainEnabled({ domain: 'pods', scope: refreshScope, enabled: shouldEnable });
    if (shouldEnable) {
      void requestRefreshDomain({
        domain: 'pods',
        scope: refreshScope,
        reason: 'startup',
      });
    }

    return () => {
      setRefreshDomainEnabled({ domain: 'pods', scope: refreshScope, enabled: false });
      resetRefreshDomain('pods', refreshScope);
    };
  }, [podsScope?.scope, refreshScope, shouldEnable]);

  const payload = snapshot.data;
  const pods = (payload?.pods ?? []) as PodSnapshotEntry[];
  const metrics = payload?.metrics ?? null;

  const initialising =
    shouldEnable &&
    !payload &&
    (snapshot.status === 'idle' ||
      snapshot.status === 'initialising' ||
      snapshot.status === 'loading');
  const passiveLoading = applyPassiveLoadingPolicy({
    loading: initialising || (shouldEnable && snapshot.status === 'loading' && !payload),
    hasLoaded: Boolean(payload),
    isPaused,
    isManualRefreshActive,
  });

  const error = shouldEnable ? (snapshot.error ?? null) : null;

  return {
    pods,
    metrics,
    loading: passiveLoading.loading,
    error,
    scope: refreshScope === INACTIVE_SCOPE ? null : refreshScope,
  };
}
