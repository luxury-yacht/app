import { getScopedDomainState } from './store';
import type {
  CatalogSnapshotPayload,
  DomainPayloadMap,
  NamespaceSnapshotPayload,
  NamespaceWorkloadSummary,
  NodeMaintenanceSnapshotPayload,
  RefreshDomain,
} from './types';

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

export const mergeWorkloadMetricRows = (
  previous: NamespaceWorkloadSummary[],
  incoming: NamespaceWorkloadSummary[],
  fallbackClusterId: string
): NamespaceWorkloadSummary[] => {
  if (previous.length === 0 || incoming.length === 0) {
    return previous;
  }

  const incomingByKey = new Map(
    incoming.map((workload) => [
      `${workload.clusterId ?? fallbackClusterId}::${workload.namespace}::${workload.kind}::${workload.name}`,
      workload,
    ])
  );

  let changed = false;
  const next = previous.map((existing) => {
    const key = `${existing.clusterId ?? fallbackClusterId}::${existing.namespace}::${existing.kind}::${existing.name}`;
    const candidate = incomingByKey.get(key);
    if (!candidate) {
      return existing;
    }

    if (existing.cpuUsage === candidate.cpuUsage && existing.memUsage === candidate.memUsage) {
      return existing;
    }

    changed = true;
    return {
      ...existing,
      cpuUsage: candidate.cpuUsage,
      memUsage: candidate.memUsage,
    };
  });

  return changed ? next : previous;
};

// Incrementally reuse row objects for polling-only list payloads.
const mergeNamespacePayload = (
  payload: NamespaceSnapshotPayload,
  scope?: string
): NamespaceSnapshotPayload => {
  const previous = getScopedDomainState('namespaces', scope!)
    .data as NamespaceSnapshotPayload | null;
  if (!previous?.namespaces?.length) {
    return payload;
  }
  // payload.clusterId is required on ClusterMeta-derived payloads, so the
  // merge-key fallback does not need a blank-cluster guard.
  const fallbackClusterId = payload.clusterId;
  const merged = mergeListByKey(
    payload.namespaces ?? [],
    previous.namespaces ?? [],
    (entry) => `${entry.clusterId ?? fallbackClusterId}::${entry.name}`
  );
  return merged === payload.namespaces ? payload : { ...payload, namespaces: merged };
};

const mergeObjectMaintenancePayload = (
  payload: NodeMaintenanceSnapshotPayload,
  scope?: string
): NodeMaintenanceSnapshotPayload => {
  if (!scope) {
    return payload;
  }
  const previous = getScopedDomainState('object-maintenance', scope)
    .data as NodeMaintenanceSnapshotPayload | null;
  if (!previous?.drains?.length) {
    return payload;
  }
  const fallbackClusterId = payload.clusterId;
  const merged = mergeListByKey(
    payload.drains ?? [],
    previous.drains ?? [],
    (entry) => `${entry.clusterId ?? fallbackClusterId}::${entry.id}`
  );
  return merged === payload.drains ? payload : { ...payload, drains: merged };
};

const mergeCatalogDiffPayload = (
  payload: CatalogSnapshotPayload,
  scope?: string
): CatalogSnapshotPayload => {
  if (!scope) {
    return payload;
  }
  const previous = getScopedDomainState('catalog-diff', scope)
    .data as CatalogSnapshotPayload | null;
  if (!previous?.items?.length) {
    return payload;
  }
  const fallbackClusterId = payload.clusterId;
  const merged = mergeListByKey(payload.items ?? [], previous.items ?? [], (entry) => {
    const clusterId = entry.clusterId ?? fallbackClusterId;
    if (entry.uid) {
      return `${clusterId}::${entry.uid}`;
    }
    return `${clusterId}::${entry.group}::${entry.version}::${entry.resource}::${entry.namespace ?? ''}::${entry.name}`;
  });
  return merged === payload.items ? payload : { ...payload, items: merged };
};

const pollingListMergeHandlers = {
  namespaces: mergeNamespacePayload,
  'object-maintenance': mergeObjectMaintenancePayload,
  'catalog-diff': mergeCatalogDiffPayload,
};

export const mergePollingListPayload = <K extends RefreshDomain>(
  domain: K,
  payload: DomainPayloadMap[K],
  scope?: string
): DomainPayloadMap[K] => {
  const handler = pollingListMergeHandlers[
    domain as keyof typeof pollingListMergeHandlers
  ] as unknown as
    | ((payload: DomainPayloadMap[K], scope?: string) => DomainPayloadMap[K])
    | undefined;
  return handler ? handler(payload, scope) : payload;
};
