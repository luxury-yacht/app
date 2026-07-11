import { useMemo } from 'react';

import { useScopedRefreshDomainLifecycle } from '@/core/data-access/useScopedRefreshDomainLifecycle';
import { useStreamSignalRefetch } from '@/core/refresh/hooks/useStreamSignalRefetch';
import { type DomainStatus, useRefreshScopedDomain } from '@/core/refresh/store';
import type {
  ClusterNodeSnapshotPayload,
  NamespaceWorkloadSnapshotPayload,
  PodSnapshotPayload,
  RefreshDomain,
} from '@/core/refresh/types';
import type { KubernetesObjectReference } from '@/types/view-state';
import { buildResourceMetricsReference, resolveResourceMetricsScope } from './scope';
import { selectNodeMetrics, selectPodMetrics, selectWorkloadMetrics } from './selectors';
import type {
  ResourceMetricsData,
  ResourceMetricsResolution,
  ResourceMetricsResult,
} from './types';

const disabledDomain: RefreshDomain = 'pods';
const disabledScope = '__resource_metrics_disabled__';

const stateStatusToResult = (
  resolution: ResourceMetricsResolution,
  status: DomainStatus,
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

  // One lease on the base table domain: its scoped payload carries object state,
  // the live usage joined at serve, and the poller freshness block.
  const domain = resolution.kind === 'domain' ? resolution.domain : disabledDomain;
  const scope = resolution.kind === 'domain' ? resolution.scope : disabledScope;

  const state = useRefreshScopedDomain(domain, scope);

  useScopedRefreshDomainLifecycle({
    domain: resolution.kind === 'domain' ? resolution.domain : null,
    scope: resolution.kind === 'domain' ? resolution.scope : null,
    enabled: enabled && resolution.kind === 'domain',
    preserveState: true,
    fetchOnEnable: 'startup',
  });

  // Doorbells (object changes, metric collections) only advance the scoped
  // sourceVersion; the poll that used to refresh this scope's data skips while
  // the stream is healthy. Without this, panel usage freezes at its first load.
  const signalScopes = useMemo(
    () => (enabled && resolution.kind === 'domain' ? [resolution.scope] : []),
    [enabled, resolution]
  );
  useStreamSignalRefetch(domain, signalScopes);

  return useMemo((): ResourceMetricsResult => {
    if (resolution.kind !== 'domain' || !ref) {
      return {
        status: stateStatusToResult(resolution, state.status, state.error),
        metrics: null,
        resolution,
        error: resolution.kind === 'invalid' ? resolution.error : null,
      };
    }

    let metrics: ResourceMetricsData | null = null;
    if (resolution.domain === 'pods') {
      metrics = selectPodMetrics(state.data as PodSnapshotPayload | null, ref);
    } else if (resolution.domain === 'namespace-workloads') {
      metrics = selectWorkloadMetrics(state.data as NamespaceWorkloadSnapshotPayload | null, ref);
    } else if (resolution.domain === 'nodes') {
      metrics = selectNodeMetrics(state.data as ClusterNodeSnapshotPayload | null, ref);
    }

    return {
      status: metrics ? 'available' : stateStatusToResult(resolution, state.status, state.error),
      metrics,
      resolution,
      error: state.error ?? null,
    };
  }, [ref, resolution, state.data, state.error, state.status]);
};
