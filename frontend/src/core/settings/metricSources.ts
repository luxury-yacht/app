/**
 * frontend/src/core/settings/metricSources.ts
 *
 * Typed access to the Metrics tab's sources and per-cluster source choices
 * (docs/plans/metrics-history.md). Validation, persistence, and the consistency rules are
 * backend-owned (MetricHistoryService); these wrappers add the broker reads, types, and
 * null-safety.
 */

import type { backend } from '@core/backend-api/models';
import {
  type MetricSourceState,
  normalizeMetricSourceSettings,
} from '@core/settings/metricSourceModel';
import { readMetricSourceSettings, requestAppState } from '@/core/app-state-access';
import {
  DeleteMetricSource,
  SaveMetricSource,
  SetClusterMetricAssignment,
} from '@/core/backend-api';
import {
  readMetricServiceCandidates,
  readMetricSourceTest,
  readTargetPortsForRef,
  requestData,
} from '@/core/data-access';

export const loadMetricSourceSettings = async (): Promise<MetricSourceState> =>
  normalizeMetricSourceSettings(
    await requestAppState({ resource: 'metric-source-settings', read: readMetricSourceSettings })
  );

export async function saveMetricSource(
  source: backend.MetricSource
): Promise<backend.MetricSource> {
  const saved = await SaveMetricSource(source);
  if (!saved) {
    throw new Error('Saving the metrics source returned no source');
  }
  return saved;
}

export const deleteMetricSource = (sourceId: string): Promise<void> => DeleteMetricSource(sourceId);

export async function setClusterMetricAssignment(
  clusterId: string,
  assignment: backend.MetricClusterAssignment
): Promise<void> {
  if (!clusterId) {
    throw new Error('clusterId is required');
  }
  await SetClusterMetricAssignment(clusterId, assignment);
}

// Settings reads happen because the user is editing a source, so they use the 'user' reason and
// are never blocked while automatic refresh is paused.
export async function loadMetricServiceCandidates(
  clusterId: string
): Promise<backend.MetricServiceCandidate[]> {
  const result = await requestData({
    resource: 'metric-service-candidates',
    reason: 'user',
    scope: clusterId,
    read: () => readMetricServiceCandidates(clusterId),
  });
  return result.status === 'executed' ? (result.data ?? []) : [];
}

export async function loadServicePorts(
  clusterId: string,
  namespace: string,
  name: string
): Promise<backend.ContainerPortInfo[]> {
  const result = await requestData({
    resource: 'service-ports',
    reason: 'user',
    scope: clusterId,
    read: () =>
      readTargetPortsForRef({
        clusterId,
        namespace,
        group: '',
        version: 'v1',
        kind: 'Service',
        name,
      }),
  });
  return result.status === 'executed' ? (result.data ?? []) : [];
}

/** Checks that a source, saved or not, answers as Prometheus. A failure is a result, not a throw. */
export async function testMetricSource(
  source: backend.MetricSource
): Promise<backend.MetricSourceTestResult> {
  const result = await requestData({
    resource: 'metric-source-test',
    reason: 'user',
    scope: source.inCluster?.clusterId,
    read: () => readMetricSourceTest(source),
  });
  if (result.status !== 'executed' || !result.data) {
    throw new Error('The connection test did not run');
  }
  return result.data;
}
