/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricHistoryApi.ts
 *
 * Brokered reads of an object's metrics history (MetricHistoryService). Request reasons follow
 * the Metrics tab contract: activation is foreground, a range change or manual refresh is user,
 * and scheduled re-queries are background, which auto-refresh pause blocks.
 */

import type { backend } from '@core/backend-api/models';
import type { PanelObjectData } from '@modules/object-panel/components/ObjectPanel/types';
import {
  type DataRequestReason,
  type ObjectReadTarget,
  readObjectMetricHistory,
  requestData,
} from '@/core/data-access';

export type MetricHistoryLoad =
  | { status: 'executed'; data: backend.MetricHistoryResponse }
  | { status: 'blocked' };

const present = (value: string | null | undefined): value is string => Boolean(value?.trim());

/** The complete identity a history request needs, or null while the panel's object is partial. */
export const metricHistoryTarget = (
  objectData: PanelObjectData | null
): ObjectReadTarget | null => {
  if (
    !objectData ||
    !present(objectData.clusterId) ||
    !present(objectData.version) ||
    !present(objectData.kind) ||
    !present(objectData.namespace) ||
    !present(objectData.name) ||
    objectData.group === null ||
    objectData.group === undefined
  ) {
    return null;
  }
  return {
    clusterId: objectData.clusterId,
    group: objectData.group,
    version: objectData.version,
    kind: objectData.kind,
    namespace: objectData.namespace,
    name: objectData.name,
  };
};

// Go sends null for empty slices; the tab reads arrays.
const normalize = (response: backend.MetricHistoryResponse): backend.MetricHistoryResponse => ({
  ...response,
  graphs: (response.graphs ?? []).map((graph) => ({
    ...graph,
    series: (graph.series ?? []).map((series) => ({ ...series, values: series.values ?? [] })),
  })),
});

export async function loadObjectMetricHistory(
  target: ObjectReadTarget,
  spanMs: number,
  reason: DataRequestReason
): Promise<MetricHistoryLoad> {
  const result = await requestData({
    resource: 'object-metric-history',
    reason,
    label: 'Metrics History',
    scope: `${target.clusterId}:${target.kind}:${target.namespace}/${target.name}`,
    read: () => readObjectMetricHistory(target, spanMs),
  });
  if (result.status !== 'executed' || !result.data) {
    return { status: 'blocked' };
  }
  return { status: 'executed', data: normalize(result.data) };
}
