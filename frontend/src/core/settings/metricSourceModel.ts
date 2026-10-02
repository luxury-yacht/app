/**
 * frontend/src/core/settings/metricSourceModel.ts
 *
 * Pure helpers for Metrics-tab source settings: the cluster list Settings shows and the
 * assignment values the backend accepts. Kept apart from the broker wrappers in metricSources.ts.
 */

import type { backend, types } from '@core/backend-api/models';

export interface MetricCluster {
  id: string;
  name: string;
  /** An assignment whose clusterId matches no kubeconfig context (file or context renamed). */
  orphan: boolean;
}

/** Source settings with Go's nullable slices and maps normalized away. */
export interface MetricSourceState {
  sources: backend.MetricSource[];
  assignments: Record<string, backend.MetricClusterAssignment>;
}

export function normalizeMetricSourceSettings(
  settings: backend.MetricSourceSettings | null
): MetricSourceState {
  const assignments: Record<string, backend.MetricClusterAssignment> = {};
  for (const [clusterId, assignment] of Object.entries(settings?.assignments ?? {})) {
    if (assignment) {
      assignments[clusterId] = assignment;
    }
  }
  return { sources: settings?.sources ?? [], assignments };
}

export const IN_CLUSTER_MODE = 'in-cluster' as backend.MetricSourceMode;

export const metricAssignments = {
  inheritDefault: (): backend.MetricClusterAssignment => ({
    kind: 'default' as backend.MetricAssignmentKind,
  }),
  none: (): backend.MetricClusterAssignment => ({ kind: 'none' as backend.MetricAssignmentKind }),
  source: (sourceId: string): backend.MetricClusterAssignment => ({
    kind: 'source' as backend.MetricAssignmentKind,
    sourceId,
  }),
};

/**
 * Every kubeconfig context (clusterId = `<kubeconfig name>:<context>`, as the backend forms it)
 * plus assignments for clusters that no longer exist, sorted by name.
 */
export function metricClusters(
  kubeconfigs: Pick<types.KubeconfigInfo, 'name' | 'context'>[],
  assignments: Record<string, backend.MetricClusterAssignment>
): MetricCluster[] {
  const clusters = new Map<string, MetricCluster>();
  for (const kubeconfig of kubeconfigs) {
    const id = `${kubeconfig.name}:${kubeconfig.context}`;
    clusters.set(id, { id, name: kubeconfig.context, orphan: false });
  }
  for (const id of Object.keys(assignments)) {
    if (!clusters.has(id)) {
      clusters.set(id, { id, name: id, orphan: true });
    }
  }
  return [...clusters.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
}
