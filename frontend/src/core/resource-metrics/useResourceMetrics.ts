import { useMemo } from 'react';

import { useScopedRefreshDomainLifecycle } from '@/core/data-access/useScopedRefreshDomainLifecycle';
import { useRefreshScopedDomain } from '@/core/refresh/store';
import type {
  ClusterNodeMetricsSnapshotPayload,
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadMetricsSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodMetricsSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from '@/core/refresh/types';
import type { KubernetesObjectReference } from '@/types/view-state';
import { buildResourceMetricsReference, resolveResourceMetricsScope } from './scope';
import { selectNodeMetrics, selectPodMetrics, selectWorkloadMetrics } from './selectors';
import type { ResourceMetricsResolution, ResourceMetricsResult } from './types';

const disabledDomain: RefreshDomain = 'pods-metrics';
const disabledScope = '__resource_metrics_disabled__';

const stateStatusToResult = (
  resolution: ResourceMetricsResolution,
  status: string,
  error?: string | null
): ResourceMetricsResult['status'] => {
  if (resolution.kind === 'invalid') {
    return 'invalid';
  }
  if (resolution.kind === 'unsupported') {
    return 'unsupported';
  }
  if (resolution.kind === 'detail-exception') {
    return 'detail-exception';
  }
  if (status === 'error' || error) {
    return 'error';
  }
  if (status === 'loading' || status === 'initialising') {
    return 'loading';
  }
  return 'missing';
};

export const useResourceMetrics = (
  objectData: KubernetesObjectReference | null | undefined,
  enabled = true
): ResourceMetricsResult => {
  const resolution = useMemo(() => resolveResourceMetricsScope(objectData), [objectData]);
  const ref = useMemo(() => {
    try {
      return buildResourceMetricsReference(objectData);
    } catch {
      return null;
    }
  }, [objectData]);

  const domain = resolution.kind === 'domain' ? resolution.domain : disabledDomain;
  const scope = resolution.kind === 'domain' ? resolution.scope : disabledScope;
  const baseDomain = resolution.kind === 'domain' ? resolution.baseDomain : disabledDomain;
  const baseScope = resolution.kind === 'domain' ? resolution.baseScope : disabledScope;

  const state = useRefreshScopedDomain(domain, scope);
  const baseState = useRefreshScopedDomain(baseDomain, baseScope);

  useScopedRefreshDomainLifecycle({
    domain: resolution.kind === 'domain' ? resolution.domain : null,
    scope: resolution.kind === 'domain' ? resolution.scope : null,
    enabled: enabled && resolution.kind === 'domain',
    preserveState: true,
    fetchOnEnable: 'startup',
  });

  useScopedRefreshDomainLifecycle({
    domain: resolution.kind === 'domain' ? resolution.baseDomain : null,
    scope: resolution.kind === 'domain' ? resolution.baseScope : null,
    enabled: enabled && resolution.kind === 'domain',
    preserveState: true,
    fetchOnEnable: 'startup',
  });

  return useMemo((): ResourceMetricsResult => {
    if (resolution.kind !== 'domain' || !ref) {
      return {
        status: stateStatusToResult(resolution, state.status, state.error),
        metrics: null,
        resolution,
        error: resolution.kind === 'invalid' ? resolution.error : null,
      };
    }

    let metrics = null;
    if (resolution.domain === 'pods-metrics') {
      metrics = selectPodMetrics(
        state.data as PodMetricsSnapshotPayload | null,
        baseState.data as PodSnapshotPayload | null,
        ref
      );
    } else if (resolution.domain === 'namespace-workloads-metrics') {
      metrics = selectWorkloadMetrics(
        state.data as NamespaceWorkloadMetricsSnapshotPayload | null,
        baseState.data as NamespaceWorkloadSnapshotPayload | null,
        ref
      );
    } else if (resolution.domain === 'nodes-metrics') {
      metrics = selectNodeMetrics(
        state.data as ClusterNodeMetricsSnapshotPayload | null,
        baseState.data as ClusterNodeSnapshotPayload | null,
        ref
      );
    }

    const metricStateLoading = state.status === 'loading' || state.status === 'initialising';
    const status = metricStateLoading ? state.status : baseState.status;
    return {
      status: metrics
        ? 'available'
        : stateStatusToResult(resolution, status, state.error ?? baseState.error),
      metrics,
      resolution,
      error: state.error ?? baseState.error ?? null,
    };
  }, [
    baseState.data,
    baseState.error,
    baseState.status,
    ref,
    resolution,
    state.data,
    state.error,
    state.status,
  ]);
};
