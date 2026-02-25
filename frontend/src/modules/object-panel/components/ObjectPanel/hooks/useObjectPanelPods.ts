/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts
 *
 * - Determines and manages pod data and metrics for the object panel.
 * - Handles refresh logic based on panel state and active tab.
 * - Returns structured pod data, loading states, and error information.
 */
import { useEffect, useMemo } from 'react';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type { PodSnapshotEntry, PodMetricsInfo } from '@/core/refresh/types';
import { INACTIVE_SCOPE, WORKLOAD_KIND_API_NAMES } from '../constants';
import type { PanelObjectData, ViewType } from '../types';

type PodsScope =
  | { scope: string; kind: 'node' }
  | { scope: string; kind: 'workload'; namespace: string }
  | null;

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
  const normalizedKind = objectKind?.toLowerCase() ?? null;

  const podsScope = useMemo<PodsScope>(() => {
    if (!objectData?.name || !normalizedKind) {
      return null;
    }
    if (normalizedKind === 'node') {
      return { scope: `node:${objectData.name}`, kind: 'node' };
    }
    const workloadNamespace = objectData.namespace?.trim();
    const workloadKindSegment =
      WORKLOAD_KIND_API_NAMES[normalizedKind] ?? objectData.kind ?? normalizedKind;
    const workloadKinds = ['deployment', 'daemonset', 'statefulset', 'job', 'replicaset'];
    if (workloadNamespace && workloadKinds.includes(normalizedKind)) {
      return {
        scope: `workload:${workloadNamespace}:${workloadKindSegment}:${objectData.name}`,
        kind: 'workload',
        namespace: workloadNamespace,
      };
    }
    return null;
  }, [normalizedKind, objectData?.name, objectData?.namespace, objectData?.kind]);

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

    refreshOrchestrator.setScopedDomainEnabled('pods', refreshScope, shouldEnable);
    if (shouldEnable) {
      void refreshOrchestrator.fetchScopedDomain('pods', refreshScope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('pods', refreshScope, false);
      refreshOrchestrator.resetScopedDomain('pods', refreshScope);
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
  const loading = initialising || (shouldEnable && snapshot.status === 'loading' && !payload);

  const error = shouldEnable ? (snapshot.error ?? null) : null;

  return {
    pods,
    metrics,
    loading,
    error,
    scope: refreshScope === INACTIVE_SCOPE ? null : refreshScope,
  };
}
