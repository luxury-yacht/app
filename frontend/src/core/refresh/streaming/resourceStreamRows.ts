/**
 * frontend/src/core/refresh/streaming/resourceStreamRows.ts
 *
 * Pure row merge helpers for resource stream updates and snapshot resyncs.
 */

import type {
  ClusterNodeSnapshotEntry,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
} from '../types';

export type ResourceStreamRowUpdate = {
  type?: string;
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
  row?: unknown;
};

export type ResourceStreamRowCollection<Row extends object, Payload extends object> = {
  getRows: (payload: Payload) => Row[];
  withRows: (payload: Payload, rows: Row[]) => Payload;
  emptyPayload: (clusterId: string) => Payload;
  buildRowKey: (row: Row, fallbackClusterId: string) => string;
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => string;
  sortRows: (rows: Row[]) => void;
  mergeRow?: (existing: Row | undefined, incoming: Row, preserveMetrics: boolean) => Row;
};

const shallowEqualRecord = (
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean => {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
};

const hasSameArrayItems = <T>(previous: T[], next: T[]): boolean =>
  previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));

const preferMetric = (existing: string | undefined, incoming: string): string =>
  existing === undefined || existing === '' ? incoming : existing;

export const mergePodMetricsRow = (
  existing: PodSnapshotEntry | undefined,
  incoming: PodSnapshotEntry,
  preserveMetrics: boolean
): PodSnapshotEntry => {
  if (!existing || !preserveMetrics) {
    return incoming;
  }
  return {
    ...incoming,
    cpuUsage: preferMetric(existing.cpuUsage, incoming.cpuUsage),
    memUsage: preferMetric(existing.memUsage, incoming.memUsage),
  };
};

export const mergeWorkloadMetricsRow = (
  existing: NamespaceWorkloadSummary | undefined,
  incoming: NamespaceWorkloadSummary,
  preserveMetrics: boolean
): NamespaceWorkloadSummary => {
  if (!existing) {
    return incoming;
  }
  if (!preserveMetrics) {
    return shallowEqualRecord(
      existing as unknown as Record<string, unknown>,
      incoming as unknown as Record<string, unknown>
    )
      ? existing
      : incoming;
  }
  const merged = {
    ...incoming,
    cpuUsage: existing.cpuUsage ?? incoming.cpuUsage,
    memUsage: existing.memUsage ?? incoming.memUsage,
  };
  return shallowEqualRecord(
    existing as unknown as Record<string, unknown>,
    merged as unknown as Record<string, unknown>
  )
    ? existing
    : merged;
};

export const mergeNodeMetricsRow = (
  existing: ClusterNodeSnapshotEntry | undefined,
  incoming: ClusterNodeSnapshotEntry,
  preserveMetrics: boolean
): ClusterNodeSnapshotEntry => {
  if (!existing || !preserveMetrics) {
    return incoming;
  }
  return {
    ...incoming,
    cpuUsage: preferMetric(existing.cpuUsage, incoming.cpuUsage),
    memoryUsage: preferMetric(existing.memoryUsage, incoming.memoryUsage),
    podMetrics: existing.podMetrics ?? incoming.podMetrics,
  };
};

const defaultMergeRow = <Row extends object>(existing: Row | undefined, incoming: Row): Row => {
  if (
    existing &&
    shallowEqualRecord(
      existing as unknown as Record<string, unknown>,
      incoming as unknown as Record<string, unknown>
    )
  ) {
    return existing;
  }
  return incoming;
};

export const applyResourceRowUpdates = <Row extends object, Payload extends object>(
  existingRows: Row[],
  updates: ResourceStreamRowUpdate[],
  fallbackClusterId: string,
  collection: ResourceStreamRowCollection<Row, Payload>,
  preserveMetrics: boolean
): Row[] => {
  const byKey = new Map<string, Row>();
  existingRows.forEach((row) => {
    const key = collection.buildRowKey(row, fallbackClusterId);
    if (key) {
      byKey.set(key, row);
    }
  });

  let changed = false;
  updates.forEach((update) => {
    const key = collection.buildUpdateKey(update, fallbackClusterId);
    if (!key) {
      return;
    }
    if (update.type === 'DELETED') {
      changed = byKey.delete(key) || changed;
      return;
    }
    if (!update.row) {
      return;
    }
    const incoming = update.row as Row;
    const existing = byKey.get(key);
    const next = collection.mergeRow
      ? collection.mergeRow(existing, incoming, preserveMetrics)
      : defaultMergeRow(existing, incoming);
    if (next !== existing) {
      changed = true;
    }
    byKey.set(key, next);
  });

  if (!changed) {
    return existingRows;
  }

  const nextRows = Array.from(byKey.values());
  collection.sortRows(nextRows);
  return hasSameArrayItems(existingRows, nextRows) ? existingRows : nextRows;
};

const replaceClusterRowsByKey = <Row extends { clusterId?: string | null }>(
  existing: Row[] | null | undefined,
  incoming: Row[] | null | undefined,
  clusterId: string,
  keyFor: (item: Row, fallbackClusterId: string) => string
): Row[] => {
  const targetCluster = clusterId.trim();
  const previousRows = existing ?? [];
  const incomingRows = incoming ?? [];

  const previousClusterRows = previousRows.filter((row) => {
    const rowCluster = row.clusterId?.trim() ?? '';
    return rowCluster === targetCluster;
  });
  const previousByKey = new Map<string, Row>();
  previousClusterRows.forEach((row) => {
    previousByKey.set(keyFor(row, targetCluster), row);
  });

  const mergedClusterRows = incomingRows.map((row) => {
    const cached = previousByKey.get(keyFor(row, targetCluster));
    return cached &&
      shallowEqualRecord(
        cached as unknown as Record<string, unknown>,
        row as unknown as Record<string, unknown>
      )
      ? cached
      : row;
  });

  const next = previousRows.filter((row) => {
    const rowCluster = row.clusterId?.trim() ?? '';
    return rowCluster !== targetCluster;
  });
  if (mergedClusterRows.length > 0) {
    next.push(...mergedClusterRows);
  }

  return hasSameArrayItems(previousRows, next) ? previousRows : next;
};

export const mergeSnapshotRows = <
  Row extends { clusterId?: string | null },
  Payload extends object,
>(
  previousRows: Row[] | null | undefined,
  incomingRows: Row[] | null | undefined,
  clusterId: string,
  collection: ResourceStreamRowCollection<Row, Payload>
): Row[] =>
  replaceClusterRowsByKey(previousRows, incomingRows, clusterId, (row, fallbackClusterId) =>
    collection.buildRowKey(row, fallbackClusterId)
  );
