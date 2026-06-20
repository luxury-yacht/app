/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.ts
 *
 * Domain descriptors for resource WebSocket streams.
 */

import type { AppEvents } from '@/core/events';
import {
  buildClusterNameRowKey,
  buildHelmReleaseRowKey,
  buildKindedClusterRowKey,
  buildKindedNamespacedRowKey,
  buildPodRowKey,
  buildVersionedClusterRowKey,
  buildVersionedNamespacedRowKey,
} from '@shared/utils/resourceRowIdentity';
import { refreshDomainContract } from '../domainRegistry';
import type {
  ClusterConfigEntry,
  ClusterConfigSnapshotPayload,
  ClusterCRDEntry,
  ClusterCRDSnapshotPayload,
  ClusterCustomEntry,
  ClusterCustomSnapshotPayload,
  ClusterNodeSnapshotEntry,
  ClusterNodeSnapshotPayload,
  ClusterRBACEntry,
  ClusterRBACSnapshotPayload,
  ClusterStorageEntry,
  ClusterStorageSnapshotPayload,
  NamespaceAutoscalingSnapshotPayload,
  NamespaceAutoscalingSummary,
  NamespaceConfigSnapshotPayload,
  NamespaceConfigSummary,
  NamespaceCustomSnapshotPayload,
  NamespaceCustomSummary,
  NamespaceHelmSnapshotPayload,
  NamespaceHelmSummary,
  NamespaceNetworkSnapshotPayload,
  NamespaceNetworkSummary,
  NamespaceQuotaSummary,
  NamespaceQuotasSnapshotPayload,
  NamespaceRBACSnapshotPayload,
  NamespaceRBACSummary,
  NamespaceStorageSnapshotPayload,
  NamespaceStorageSummary,
  NamespaceWorkloadSnapshotPayload,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
  PodSnapshotPayload,
} from '../types';
import {
  mergeNodeMetricsRow,
  mergePodMetricsRow,
  mergeWorkloadMetricsRow,
  type ResourceRef,
  type ResourceStreamRowCollection,
  type ResourceStreamRowUpdate,
} from './resourceStreamRows';

export type ResourceDomain = AppEvents['refresh:resource-stream-drift']['domain'];

export type ResourceStreamScopeKind = 'pod' | 'namespace' | 'cluster';

export type ResourceStreamDomainDescriptor = {
  domain: ResourceDomain;
  scopeKind: ResourceStreamScopeKind;
  isClusterScoped: boolean;
  preserveMetrics: boolean;
  sortRows: (rows: unknown[]) => void;
  buildSnapshotKeys: (payload: unknown, fallbackClusterId: string) => Set<string>;
  collection: ResourceStreamRowCollection<any, any>;
};

const normalizeNamespaceToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === '*' || lowered === 'all') {
    return 'all';
  }
  return trimmed;
};

const normalizeNamespaceScope = (scope: string, label: string): string => {
  const value = scope.trim();
  if (!value) {
    throw new Error(`${label} scope is required`);
  }
  if (value.startsWith('namespace:')) {
    const trimmed = value
      .replace(/^namespace:/, '')
      .replace(/^:/, '')
      .trim();
    const token = normalizeNamespaceToken(trimmed);
    if (!token) {
      throw new Error(`${label} scope is required`);
    }
    return `namespace:${token}`;
  }
  const token = normalizeNamespaceToken(value);
  if (!token) {
    throw new Error(`${label} scope is required`);
  }
  return `namespace:${token}`;
};

const normalizePodScope = (scope: string): string => {
  const trimmed = scope.trim();
  if (!trimmed) {
    throw new Error('pods scope is required');
  }
  if (trimmed.startsWith('namespace:')) {
    return normalizeNamespaceScope(trimmed, 'pods');
  }
  if (trimmed.startsWith('node:')) {
    const value = trimmed
      .replace(/^node:/, '')
      .replace(/^:/, '')
      .trim();
    if (!value) {
      throw new Error('pods node scope is required');
    }
    return `node:${value}`;
  }
  if (trimmed.startsWith('workload:')) {
    const value = trimmed
      .replace(/^workload:/, '')
      .replace(/^:/, '')
      .trim();
    const parts = value.split(':').map((part) => part.trim());
    if (parts.length !== 5) {
      throw new Error('pods workload scope requires namespace:group:version:kind:name');
    }
    const [namespace, group, version, kind, name] = parts;
    if (!namespace || !version || !kind || !name) {
      throw new Error('pods workload scope requires namespace:group:version:kind:name');
    }
    return `workload:${namespace}:${group}:${version}:${kind}:${name}`;
  }
  throw new Error(`unsupported pods scope ${scope}`);
};

const normalizeSortKey = (value: string | undefined): string => (value ?? '').toLowerCase();

export const sortPodRows = (rows: PodSnapshotEntry[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortWorkloadRows = (rows: NamespaceWorkloadSummary[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    const name = normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
    if (name !== 0) {
      return name;
    }
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.status).localeCompare(normalizeSortKey(b.status));
  });
};

const sortConfigRows = (rows: NamespaceConfigSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    const name = normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
    if (name !== 0) {
      return name;
    }
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.typeAlias).localeCompare(normalizeSortKey(b.typeAlias));
  });
};

const sortRBACRows = (rows: NamespaceRBACSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortNetworkRows = (rows: NamespaceNetworkSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    const name = normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
    if (name !== 0) {
      return name;
    }
    return normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
  });
};

const sortCustomRows = (rows: NamespaceCustomSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    const group = normalizeSortKey(a.apiGroup).localeCompare(normalizeSortKey(b.apiGroup));
    if (group !== 0) {
      return group;
    }
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortHelmRows = (rows: NamespaceHelmSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortAutoscalingRows = (rows: NamespaceAutoscalingSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortQuotaRows = (rows: NamespaceQuotaSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    const name = normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
    if (name !== 0) {
      return name;
    }
    return normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
  });
};

const sortStorageRows = (rows: NamespaceStorageSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortClusterRBACRows = (rows: ClusterRBACEntry[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortClusterStorageRows = (rows: ClusterStorageEntry[]): void => {
  rows.sort((a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name)));
};

const sortClusterConfigRows = (rows: ClusterConfigEntry[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

const sortClusterCRDRows = (rows: ClusterCRDEntry[]): void => {
  rows.sort((a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name)));
};

const sortClusterCustomRows = (rows: ClusterCustomEntry[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortNodeRows = (rows: ClusterNodeSnapshotEntry[]): void => {
  rows.sort((a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name)));
};

const buildPodKey = (clusterId: string, namespace: string, name: string): string =>
  buildPodRowKey(clusterId, namespace, name);

const buildWorkloadKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildConfigKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildRBACKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildNetworkKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildCustomKey = (
  clusterId: string,
  namespace: string,
  apiGroup: string,
  apiVersion: string,
  kind: string,
  name: string
): string => buildVersionedNamespacedRowKey(clusterId, namespace, apiGroup, apiVersion, kind, name);

const buildHelmKey = (clusterId: string, namespace: string, name: string): string =>
  buildHelmReleaseRowKey(clusterId, namespace, name);

const buildAutoscalingKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildQuotaKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildStorageKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => buildKindedNamespacedRowKey(clusterId, namespace, kind, name);

const buildClusterRBACKey = (clusterId: string, kind: string, name: string): string =>
  buildKindedClusterRowKey(clusterId, kind, name);

const buildClusterStorageKey = (clusterId: string, name: string): string =>
  buildClusterNameRowKey(clusterId, name);

const buildClusterConfigKey = (clusterId: string, kind: string, name: string): string =>
  buildKindedClusterRowKey(clusterId, kind, name);

const buildClusterCRDKey = (clusterId: string, name: string): string =>
  buildClusterNameRowKey(clusterId, name);

const buildClusterCustomKey = (
  clusterId: string,
  apiGroup: string,
  apiVersion: string,
  kind: string,
  name: string
): string => buildVersionedClusterRowKey(clusterId, apiGroup, apiVersion, kind, name);

const buildNodeKey = (clusterId: string, name: string): string =>
  buildClusterNameRowKey(clusterId, name);

// Stream update/delete identity is only accepted through update.ref. Snapshot
// rows still derive keys from row fields because rows are the snapshot payload.
const updateRef = (update: ResourceStreamRowUpdate): ResourceRef | undefined => {
  const ref = update.ref;
  if (!ref?.clusterId || !ref.version || !ref.kind || !ref.name) {
    return undefined;
  }
  return ref;
};

const updateClusterId = (ref: ResourceRef): string => ref.clusterId;

const updateNamespace = (ref: ResourceRef): string => ref.namespace ?? '';

const updateName = (ref: ResourceRef): string => ref.name ?? '';

const updateKind = (ref: ResourceRef): string => ref.kind;

const updateAPIGroup = (ref: ResourceRef): string => ref.group;

const updateAPIVersion = (ref: ResourceRef): string => ref.version;

const rowSorter =
  <T>(sortRows: (rows: T[]) => void) =>
  (rows: unknown[]): void =>
    sortRows(rows as T[]);

const podCollection = {
  getRows: (payload: PodSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: PodSnapshotPayload, rows: PodSnapshotEntry[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): PodSnapshotPayload => ({ rows: [], clusterId }),
  buildRowKey: (row: PodSnapshotEntry, fallbackClusterId: string) =>
    buildPodKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildPodKey(updateClusterId(ref), updateNamespace(ref), updateName(ref))
      : '';
  },
  sortRows: sortPodRows,
  mergeRow: mergePodMetricsRow,
} satisfies ResourceStreamRowCollection<PodSnapshotEntry, PodSnapshotPayload>;

const workloadCollection = {
  getRows: (payload: NamespaceWorkloadSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceWorkloadSnapshotPayload, rows: NamespaceWorkloadSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceWorkloadSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceWorkloadSummary, fallbackClusterId: string) =>
    buildWorkloadKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildWorkloadKey(
          updateClusterId(ref),
          updateNamespace(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortWorkloadRows,
  mergeRow: mergeWorkloadMetricsRow,
} satisfies ResourceStreamRowCollection<NamespaceWorkloadSummary, NamespaceWorkloadSnapshotPayload>;

const namespaceConfigCollection = {
  getRows: (payload: NamespaceConfigSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceConfigSnapshotPayload, rows: NamespaceConfigSummary[]) => ({
    ...payload,
    rows,
  }),
  emptyPayload: (clusterId: string): NamespaceConfigSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceConfigSummary, fallbackClusterId: string) =>
    buildConfigKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildConfigKey(updateClusterId(ref), updateNamespace(ref), updateKind(ref), updateName(ref))
      : '';
  },
  sortRows: sortConfigRows,
} satisfies ResourceStreamRowCollection<NamespaceConfigSummary, NamespaceConfigSnapshotPayload>;

const namespaceNetworkCollection = {
  getRows: (payload: NamespaceNetworkSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceNetworkSnapshotPayload, rows: NamespaceNetworkSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceNetworkSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceNetworkSummary, fallbackClusterId: string) =>
    buildNetworkKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildNetworkKey(
          updateClusterId(ref),
          updateNamespace(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortNetworkRows,
} satisfies ResourceStreamRowCollection<NamespaceNetworkSummary, NamespaceNetworkSnapshotPayload>;

const namespaceRBACCollection = {
  getRows: (payload: NamespaceRBACSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceRBACSnapshotPayload, rows: NamespaceRBACSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceRBACSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceRBACSummary, fallbackClusterId: string) =>
    buildRBACKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildRBACKey(updateClusterId(ref), updateNamespace(ref), updateKind(ref), updateName(ref))
      : '';
  },
  sortRows: sortRBACRows,
} satisfies ResourceStreamRowCollection<NamespaceRBACSummary, NamespaceRBACSnapshotPayload>;

const namespaceCustomCollection = {
  getRows: (payload: NamespaceCustomSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceCustomSnapshotPayload, rows: NamespaceCustomSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceCustomSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceCustomSummary, fallbackClusterId: string) =>
    buildCustomKey(
      row.clusterId ?? fallbackClusterId,
      row.namespace,
      row.apiGroup,
      row.apiVersion,
      row.kind,
      row.name
    ),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildCustomKey(
          updateClusterId(ref),
          updateNamespace(ref),
          updateAPIGroup(ref),
          updateAPIVersion(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortCustomRows,
} satisfies ResourceStreamRowCollection<NamespaceCustomSummary, NamespaceCustomSnapshotPayload>;

const namespaceHelmCollection = {
  getRows: (payload: NamespaceHelmSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceHelmSnapshotPayload, rows: NamespaceHelmSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceHelmSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceHelmSummary, fallbackClusterId: string) =>
    buildHelmKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildHelmKey(updateClusterId(ref), updateNamespace(ref), updateName(ref))
      : '';
  },
  sortRows: sortHelmRows,
} satisfies ResourceStreamRowCollection<NamespaceHelmSummary, NamespaceHelmSnapshotPayload>;

const namespaceAutoscalingCollection = {
  getRows: (payload: NamespaceAutoscalingSnapshotPayload) => payload.rows ?? [],
  withRows: (
    payload: NamespaceAutoscalingSnapshotPayload,
    rows: NamespaceAutoscalingSummary[]
  ) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceAutoscalingSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceAutoscalingSummary, fallbackClusterId: string) =>
    buildAutoscalingKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildAutoscalingKey(
          updateClusterId(ref),
          updateNamespace(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortAutoscalingRows,
} satisfies ResourceStreamRowCollection<
  NamespaceAutoscalingSummary,
  NamespaceAutoscalingSnapshotPayload
>;

const namespaceQuotaCollection = {
  getRows: (payload: NamespaceQuotasSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceQuotasSnapshotPayload, rows: NamespaceQuotaSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceQuotasSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceQuotaSummary, fallbackClusterId: string) =>
    buildQuotaKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildQuotaKey(updateClusterId(ref), updateNamespace(ref), updateKind(ref), updateName(ref))
      : '';
  },
  sortRows: sortQuotaRows,
} satisfies ResourceStreamRowCollection<NamespaceQuotaSummary, NamespaceQuotasSnapshotPayload>;

const namespaceStorageCollection = {
  getRows: (payload: NamespaceStorageSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: NamespaceStorageSnapshotPayload, rows: NamespaceStorageSummary[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceStorageSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceStorageSummary, fallbackClusterId: string) =>
    buildStorageKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref?.namespace
      ? buildStorageKey(
          updateClusterId(ref),
          updateNamespace(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortStorageRows,
} satisfies ResourceStreamRowCollection<NamespaceStorageSummary, NamespaceStorageSnapshotPayload>;

const clusterRBACCollection = {
  getRows: (payload: ClusterRBACSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: ClusterRBACSnapshotPayload, rows: ClusterRBACEntry[]) => ({
    ...payload,
    rows,
  }),
  emptyPayload: (clusterId: string): ClusterRBACSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterRBACEntry, fallbackClusterId: string) =>
    buildClusterRBACKey(row.clusterId ?? fallbackClusterId, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref ? buildClusterRBACKey(updateClusterId(ref), updateKind(ref), updateName(ref)) : '';
  },
  sortRows: sortClusterRBACRows,
} satisfies ResourceStreamRowCollection<ClusterRBACEntry, ClusterRBACSnapshotPayload>;

const clusterStorageCollection = {
  getRows: (payload: ClusterStorageSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: ClusterStorageSnapshotPayload, rows: ClusterStorageEntry[]) => ({
    ...payload,
    rows,
  }),
  emptyPayload: (clusterId: string): ClusterStorageSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterStorageEntry, fallbackClusterId: string) =>
    buildClusterStorageKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref ? buildClusterStorageKey(updateClusterId(ref), updateName(ref)) : '';
  },
  sortRows: sortClusterStorageRows,
} satisfies ResourceStreamRowCollection<ClusterStorageEntry, ClusterStorageSnapshotPayload>;

const clusterConfigCollection = {
  getRows: (payload: ClusterConfigSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: ClusterConfigSnapshotPayload, rows: ClusterConfigEntry[]) => ({
    ...payload,
    rows,
  }),
  emptyPayload: (clusterId: string): ClusterConfigSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterConfigEntry, fallbackClusterId: string) =>
    buildClusterConfigKey(row.clusterId ?? fallbackClusterId, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref ? buildClusterConfigKey(updateClusterId(ref), updateKind(ref), updateName(ref)) : '';
  },
  sortRows: sortClusterConfigRows,
} satisfies ResourceStreamRowCollection<ClusterConfigEntry, ClusterConfigSnapshotPayload>;

const clusterCRDCollection = {
  getRows: (payload: ClusterCRDSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: ClusterCRDSnapshotPayload, rows: ClusterCRDEntry[]) => ({
    ...payload,
    rows,
  }),
  emptyPayload: (clusterId: string): ClusterCRDSnapshotPayload => ({
    rows: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterCRDEntry, fallbackClusterId: string) =>
    buildClusterCRDKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref ? buildClusterCRDKey(updateClusterId(ref), updateName(ref)) : '';
  },
  sortRows: sortClusterCRDRows,
} satisfies ResourceStreamRowCollection<ClusterCRDEntry, ClusterCRDSnapshotPayload>;

const clusterCustomCollection = {
  getRows: (payload: ClusterCustomSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: ClusterCustomSnapshotPayload, rows: ClusterCustomEntry[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): ClusterCustomSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterCustomEntry, fallbackClusterId: string) =>
    buildClusterCustomKey(
      row.clusterId ?? fallbackClusterId,
      row.apiGroup,
      row.apiVersion,
      row.kind,
      row.name
    ),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref
      ? buildClusterCustomKey(
          updateClusterId(ref),
          updateAPIGroup(ref),
          updateAPIVersion(ref),
          updateKind(ref),
          updateName(ref)
        )
      : '';
  },
  sortRows: sortClusterCustomRows,
} satisfies ResourceStreamRowCollection<ClusterCustomEntry, ClusterCustomSnapshotPayload>;

const nodeCollection = {
  getRows: (payload: ClusterNodeSnapshotPayload) => payload.rows ?? [],
  withRows: (payload: ClusterNodeSnapshotPayload, rows: ClusterNodeSnapshotEntry[]) => ({
    ...payload,
    rows: rows,
  }),
  emptyPayload: (clusterId: string): ClusterNodeSnapshotPayload => ({ rows: [], clusterId }),
  buildRowKey: (row: ClusterNodeSnapshotEntry, fallbackClusterId: string) =>
    buildNodeKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, _fallbackClusterId: string) => {
    const ref = updateRef(update);
    return ref ? buildNodeKey(updateClusterId(ref), updateName(ref)) : '';
  },
  sortRows: sortNodeRows,
  mergeRow: mergeNodeMetricsRow,
} satisfies ResourceStreamRowCollection<ClusterNodeSnapshotEntry, ClusterNodeSnapshotPayload>;

const collectionSnapshotKeys =
  <TRow extends object, TPayload extends object>(
    collection: ResourceStreamRowCollection<TRow, TPayload>
  ) =>
  (payload: unknown, fallbackClusterId: string): Set<string> => {
    const typedPayload = payload as TPayload | null | undefined;
    const keys = new Set<string>();
    if (!typedPayload) {
      return keys;
    }
    collection.getRows(typedPayload).forEach((row) => {
      keys.add(collection.buildRowKey(row, fallbackClusterId));
    });
    return keys;
  };

export const resourceStreamDomainDescriptors = [
  {
    domain: 'pods',
    scopeKind: 'pod',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortPodRows),
    buildSnapshotKeys: collectionSnapshotKeys(podCollection),
    collection: podCollection,
  },
  {
    domain: 'namespace-workloads',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortWorkloadRows),
    buildSnapshotKeys: collectionSnapshotKeys(workloadCollection),
    collection: workloadCollection,
  },
  {
    domain: 'namespace-config',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortConfigRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceConfigCollection),
    collection: namespaceConfigCollection,
  },
  {
    domain: 'namespace-network',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortNetworkRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceNetworkCollection),
    collection: namespaceNetworkCollection,
  },
  {
    domain: 'namespace-rbac',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortRBACRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceRBACCollection),
    collection: namespaceRBACCollection,
  },
  {
    domain: 'namespace-custom',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortCustomRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceCustomCollection),
    collection: namespaceCustomCollection,
  },
  {
    domain: 'namespace-helm',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortHelmRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceHelmCollection),
    collection: namespaceHelmCollection,
  },
  {
    domain: 'namespace-autoscaling',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortAutoscalingRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceAutoscalingCollection),
    collection: namespaceAutoscalingCollection,
  },
  {
    domain: 'namespace-quotas',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortQuotaRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceQuotaCollection),
    collection: namespaceQuotaCollection,
  },
  {
    domain: 'namespace-storage',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortStorageRows),
    buildSnapshotKeys: collectionSnapshotKeys(namespaceStorageCollection),
    collection: namespaceStorageCollection,
  },
  {
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterRBACRows),
    buildSnapshotKeys: collectionSnapshotKeys(clusterRBACCollection),
    collection: clusterRBACCollection,
  },
  {
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterStorageRows),
    buildSnapshotKeys: collectionSnapshotKeys(clusterStorageCollection),
    collection: clusterStorageCollection,
  },
  {
    domain: 'cluster-config',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterConfigRows),
    buildSnapshotKeys: collectionSnapshotKeys(clusterConfigCollection),
    collection: clusterConfigCollection,
  },
  {
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCRDRows),
    buildSnapshotKeys: collectionSnapshotKeys(clusterCRDCollection),
    collection: clusterCRDCollection,
  },
  {
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCustomRows),
    buildSnapshotKeys: collectionSnapshotKeys(clusterCustomCollection),
    collection: clusterCustomCollection,
  },
  {
    domain: 'nodes',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: true,
    sortRows: rowSorter(sortNodeRows),
    buildSnapshotKeys: collectionSnapshotKeys(nodeCollection),
    collection: nodeCollection,
  },
] satisfies ResourceStreamDomainDescriptor[];

export const RESOURCE_STREAM_DOMAINS = resourceStreamDomainDescriptors.map(
  (descriptor) => descriptor.domain
);

const resourceStreamDescriptorByDomain = new Map<ResourceDomain, ResourceStreamDomainDescriptor>(
  resourceStreamDomainDescriptors.map((descriptor) => [descriptor.domain, descriptor])
);

export const isSupportedDomain = (value: string | undefined): value is ResourceDomain =>
  Boolean(value && resourceStreamDescriptorByDomain.has(value as ResourceDomain));

export const getResourceStreamDomainDescriptor = (
  domain: ResourceDomain
): ResourceStreamDomainDescriptor => resourceStreamDescriptorByDomain.get(domain)!;

export const isClusterScopedDomain = (domain: ResourceDomain): boolean =>
  getResourceStreamDomainDescriptor(domain).isClusterScoped;

export const COMPLETE_RESYNC_STREAM_DOMAINS = new Set<ResourceDomain>(
  Object.entries(refreshDomainContract.domainInventory)
    .filter(
      ([domain, inventory]) =>
        inventory.behaviorClass === 'complete-resync-stream' && isSupportedDomain(domain)
    )
    .map(([domain]) => domain as ResourceDomain)
);

export const isCompleteResyncStreamDomain = (domain: ResourceDomain): boolean =>
  COMPLETE_RESYNC_STREAM_DOMAINS.has(domain);

// Notify-only domains stream change signals without row payloads (the table is
// query-backed). Their flushed deltas bump streamRevision to trigger a refetch
// and never retain/sort rows. Backend parity: resourcestream.notifyOnlyStreamDomains.
export const NOTIFY_ONLY_STREAM_DOMAINS = new Set<ResourceDomain>(
  Object.entries(refreshDomainContract.domainInventory)
    .filter(([domain, inventory]) => inventory.notifyOnly === true && isSupportedDomain(domain))
    .map(([domain]) => domain as ResourceDomain)
);

export const isNotifyOnlyStreamDomain = (domain: ResourceDomain): boolean =>
  NOTIFY_ONLY_STREAM_DOMAINS.has(domain);

export const normalizeResourceScope = (domain: ResourceDomain, scope: string): string => {
  const descriptor = getResourceStreamDomainDescriptor(domain);
  switch (descriptor.scopeKind) {
    case 'pod':
      return normalizePodScope(scope);
    case 'namespace':
      return normalizeNamespaceScope(scope, domain);
    case 'cluster':
      if (!scope || scope.trim() === '' || scope.trim().toLowerCase() === 'cluster') {
        return '';
      }
      throw new Error(`${domain} stream does not accept scope ${scope}`);
    default:
      throw new Error(`unsupported resource stream domain ${domain}`);
  }
};
