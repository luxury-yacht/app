/**
 * frontend/src/core/refresh/snapshotMerge.ts
 *
 * Reuses stable row objects while applying snapshot payloads. It keeps polling
 * refreshes from replacing unchanged rows and shares row identity helpers with
 * stream and table surfaces.
 */

import { getScopedDomainState } from './store';
import {
  buildCatalogResourceRowKey,
  buildClusterNameRowKey,
} from '@shared/utils/resourceRowIdentity';
import type {
  CatalogSnapshotPayload,
  DomainPayloadMap,
  NamespaceSnapshotPayload,
  NodeMaintenanceSnapshotPayload,
  RefreshDomain,
} from './types';

type NamespaceRow = NamespaceSnapshotPayload['namespaces'][number];
type CatalogRow = CatalogSnapshotPayload['items'][number];
type NodeMaintenanceRow = NodeMaintenanceSnapshotPayload['drains'][number];

const shallowEqualRecord = (left: Record<string, unknown>, right: Record<string, unknown>) => {
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

// Reuse cached row objects when incoming rows are unchanged to cut re-render churn.
const mergeListByKey = <T extends object>(
  incoming: T[],
  previous: T[],
  keyFor: (item: T) => string
): T[] => {
  if (incoming.length === 0 || previous.length === 0) {
    return incoming;
  }
  const previousByKey = new Map<string, T>();
  previous.forEach((item) => {
    const key = keyFor(item);
    if (key) {
      previousByKey.set(key, item);
    }
  });
  let reused = false;
  const merged = incoming.map((item) => {
    const key = keyFor(item);
    if (!key) {
      return item;
    }
    const cached = previousByKey.get(key);
    if (
      cached &&
      shallowEqualRecord(cached as Record<string, unknown>, item as Record<string, unknown>)
    ) {
      reused = true;
      return cached;
    }
    return item;
  });
  return reused ? merged : incoming;
};

// Incrementally reuse row objects for polling-only list payloads.
type PollingListMergeDescriptor<P extends object, R extends object> = {
  previous: (scope?: string) => P | null;
  rows: (payload: P) => R[];
  withRows: (payload: P, rows: R[]) => P;
  key: (row: R, payload: P) => string;
};

const mergePollingPayloadWithDescriptor = <P extends object, R extends object>(
  payload: P,
  scope: string | undefined,
  descriptor: PollingListMergeDescriptor<P, R>
): P => {
  const previous = descriptor.previous(scope);
  if (!previous) {
    return payload;
  }
  const previousRows = descriptor.rows(previous);
  if (previousRows.length === 0) {
    return payload;
  }
  const incomingRows = descriptor.rows(payload);
  const merged = mergeListByKey(incomingRows, previousRows, (entry) =>
    descriptor.key(entry, payload)
  );
  return merged === incomingRows ? payload : descriptor.withRows(payload, merged);
};

const pollingListMergeDescriptors = {
  namespaces: {
    previous: (scope?: string) =>
      getScopedDomainState('namespaces', scope!).data as NamespaceSnapshotPayload | null,
    rows: (payload: NamespaceSnapshotPayload) => payload.namespaces ?? [],
    withRows: (payload: NamespaceSnapshotPayload, rows: NamespaceRow[]) => ({
      ...payload,
      namespaces: rows,
    }),
    // payload.clusterId is required on ClusterMeta-derived payloads, so the
    // merge-key fallback does not need a blank-cluster guard.
    key: (entry: NamespaceRow, payload: NamespaceSnapshotPayload) =>
      buildClusterNameRowKey(entry.clusterId ?? payload.clusterId, entry.name),
  },
  'object-maintenance': {
    previous: (scope?: string) =>
      scope
        ? (getScopedDomainState('object-maintenance', scope)
            .data as NodeMaintenanceSnapshotPayload | null)
        : null,
    rows: (payload: NodeMaintenanceSnapshotPayload) => payload.drains ?? [],
    withRows: (payload: NodeMaintenanceSnapshotPayload, rows: NodeMaintenanceRow[]) => ({
      ...payload,
      drains: rows,
    }),
    key: (entry: NodeMaintenanceRow, payload: NodeMaintenanceSnapshotPayload) =>
      buildClusterNameRowKey(entry.clusterId ?? payload.clusterId, entry.id),
  },
  'catalog-diff': {
    previous: (scope?: string) =>
      scope
        ? (getScopedDomainState('catalog-diff', scope).data as CatalogSnapshotPayload | null)
        : null,
    rows: (payload: CatalogSnapshotPayload) => payload.items ?? [],
    withRows: (payload: CatalogSnapshotPayload, rows: CatalogRow[]) => ({
      ...payload,
      items: rows,
    }),
    key: (entry: CatalogRow, payload: CatalogSnapshotPayload) => {
      const clusterId = entry.clusterId ?? payload.clusterId;
      if (entry.uid) {
        return buildClusterNameRowKey(clusterId, entry.uid);
      }
      return buildCatalogResourceRowKey(
        clusterId,
        entry.group,
        entry.version,
        entry.resource,
        entry.namespace ?? '',
        entry.name
      );
    },
  },
};

type PollingListMergeDomain = keyof typeof pollingListMergeDescriptors;

export const mergePollingListPayload = <K extends RefreshDomain>(
  domain: K,
  payload: DomainPayloadMap[K],
  scope?: string
): DomainPayloadMap[K] => {
  const descriptor = pollingListMergeDescriptors[domain as PollingListMergeDomain] as unknown as
    PollingListMergeDescriptor<DomainPayloadMap[K] & object, object> | undefined;
  return descriptor ? mergePollingPayloadWithDescriptor(payload, scope, descriptor) : payload;
};
