/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods.ts
 *
 * Hook for useObjectPanelPods.
 */
import { useEffect, useMemo } from 'react';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
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
    const workloadKinds = [
      'deployment',
      'daemonset',
      'statefulset',
      'job',
      'cronjob',
      'replicaset',
    ];
    if (workloadNamespace && workloadKinds.includes(normalizedKind)) {
      return {
        scope: `workload:${workloadNamespace}:${workloadKindSegment}:${objectData.name}`,
        kind: 'workload',
        namespace: workloadNamespace,
      };
    }
    return null;
  }, [normalizedKind, objectData?.name, objectData?.namespace, objectData?.kind]);

  const refreshScope = podsScope?.scope ?? INACTIVE_SCOPE;
  const snapshot = useRefreshScopedDomain('pods', refreshScope);

  const shouldEnable = isOpen && activeTab === 'pods' && Boolean(podsScope?.scope);

  useEffect(() => {
    if (!podsScope?.scope) {
      return;
    }

    refreshOrchestrator.setScopedDomainEnabled('pods', podsScope.scope, shouldEnable);
    if (shouldEnable) {
      void refreshOrchestrator.fetchScopedDomain('pods', podsScope.scope, { isManual: true });
    }

    return () => {
      refreshOrchestrator.setScopedDomainEnabled('pods', podsScope.scope, false);
      refreshOrchestrator.resetScopedDomain('pods', podsScope.scope);
    };
  }, [podsScope?.scope, shouldEnable]);

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
    scope: podsScope?.scope ?? null,
  };
}
