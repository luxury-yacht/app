/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.ts
 *
 * Domain descriptors for resource WebSocket streams.
 */

import type { AppEvents } from '@/core/events';
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
    const parts = value
      .split(':')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length !== 3) {
      throw new Error('pods workload scope requires namespace:kind:name');
    }
    return `workload:${parts[0]}:${parts[1]}:${parts[2]}`;
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
  `${clusterId}::${namespace}::${name}`;

const buildWorkloadKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

const buildConfigKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  `${clusterId}::${namespace}::${kind}::${name}`;

const buildRBACKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  `${clusterId}::${namespace}::${kind}::${name}`;

const buildNetworkKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

const buildCustomKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  `${clusterId}::${namespace}::${kind}::${name}`;

const buildHelmKey = (clusterId: string, namespace: string, name: string): string =>
  `${clusterId}::${namespace}::${name}`;

const buildAutoscalingKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

const buildQuotaKey = (clusterId: string, namespace: string, kind: string, name: string): string =>
  `${clusterId}::${namespace}::${kind}::${name}`;

const buildStorageKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

const buildClusterRBACKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

const buildClusterStorageKey = (clusterId: string, name: string): string => `${clusterId}::${name}`;

const buildClusterConfigKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

const buildClusterCRDKey = (clusterId: string, name: string): string => `${clusterId}::${name}`;

const buildClusterCustomKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

const buildNodeKey = (clusterId: string, name: string): string => `${clusterId}::${name}`;

const updateClusterId = (update: ResourceStreamRowUpdate, fallbackClusterId: string): string =>
  update.clusterId ?? fallbackClusterId;

const updateRow = <T>(update: ResourceStreamRowUpdate): T | undefined =>
  update.row as T | undefined;

const buildPodKeySet = (
  payload: PodSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.pods ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildPodKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name));
  });
  return keys;
};

const buildWorkloadKeySet = (
  payload: NamespaceWorkloadSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.workloads ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(
      buildWorkloadKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name)
    );
  });
  return keys;
};

const buildConfigKeySet = (
  payload: NamespaceConfigSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildConfigKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name));
  });
  return keys;
};

const buildRBACKeySet = (
  payload: NamespaceRBACSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildRBACKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name));
  });
  return keys;
};

const buildNetworkKeySet = (
  payload: NamespaceNetworkSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(
      buildNetworkKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name)
    );
  });
  return keys;
};

const buildCustomKeySet = (
  payload: NamespaceCustomSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildCustomKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name));
  });
  return keys;
};

const buildHelmKeySet = (
  payload: NamespaceHelmSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.releases ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildHelmKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name));
  });
  return keys;
};

const buildAutoscalingKeySet = (
  payload: NamespaceAutoscalingSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(
      buildAutoscalingKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name)
    );
  });
  return keys;
};

const buildQuotaKeySet = (
  payload: NamespaceQuotasSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildQuotaKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name));
  });
  return keys;
};

const buildStorageKeySet = (
  payload: NamespaceStorageSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(
      buildStorageKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name)
    );
  });
  return keys;
};

const buildClusterRBACKeySet = (
  payload: ClusterRBACSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildClusterRBACKey(row.clusterId ?? fallbackClusterId, row.kind, row.name));
  });
  return keys;
};

const buildClusterStorageKeySet = (
  payload: ClusterStorageSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.volumes ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildClusterStorageKey(row.clusterId ?? fallbackClusterId, row.name));
  });
  return keys;
};

const buildClusterConfigKeySet = (
  payload: ClusterConfigSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildClusterConfigKey(row.clusterId ?? fallbackClusterId, row.kind, row.name));
  });
  return keys;
};

const buildClusterCRDKeySet = (
  payload: ClusterCRDSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.definitions ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildClusterCRDKey(row.clusterId ?? fallbackClusterId, row.name));
  });
  return keys;
};

const buildClusterCustomKeySet = (
  payload: ClusterCustomSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.resources ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildClusterCustomKey(row.clusterId ?? fallbackClusterId, row.kind, row.name));
  });
  return keys;
};

const buildNodeKeySet = (
  payload: ClusterNodeSnapshotPayload | null | undefined,
  fallbackClusterId: string
): Set<string> => {
  const rows = payload?.nodes ?? [];
  const keys = new Set<string>();
  rows.forEach((row) => {
    keys.add(buildNodeKey(row.clusterId ?? fallbackClusterId, row.name));
  });
  return keys;
};

const rowSorter =
  <T>(sortRows: (rows: T[]) => void) =>
  (rows: unknown[]): void =>
    sortRows(rows as T[]);

const snapshotKeys =
  <T>(buildKeys: (payload: T | null | undefined, fallbackClusterId: string) => Set<string>) =>
  (payload: unknown, fallbackClusterId: string): Set<string> =>
    buildKeys(payload as T | null | undefined, fallbackClusterId);

const podCollection = {
  getRows: (payload: PodSnapshotPayload) => payload.pods ?? [],
  withRows: (payload: PodSnapshotPayload, rows: PodSnapshotEntry[]) => ({
    ...payload,
    pods: rows,
  }),
  emptyPayload: (clusterId: string): PodSnapshotPayload => ({ pods: [], clusterId }),
  buildRowKey: (row: PodSnapshotEntry, fallbackClusterId: string) =>
    buildPodKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<PodSnapshotEntry>(update);
    return buildPodKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortPodRows,
  mergeRow: mergePodMetricsRow,
} satisfies ResourceStreamRowCollection<PodSnapshotEntry, PodSnapshotPayload>;

const workloadCollection = {
  getRows: (payload: NamespaceWorkloadSnapshotPayload) => payload.workloads ?? [],
  withRows: (payload: NamespaceWorkloadSnapshotPayload, rows: NamespaceWorkloadSummary[]) => ({
    ...payload,
    workloads: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceWorkloadSnapshotPayload => ({
    workloads: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceWorkloadSummary, fallbackClusterId: string) =>
    buildWorkloadKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceWorkloadSummary>(update);
    return buildWorkloadKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortWorkloadRows,
  mergeRow: mergeWorkloadMetricsRow,
} satisfies ResourceStreamRowCollection<NamespaceWorkloadSummary, NamespaceWorkloadSnapshotPayload>;

const namespaceConfigCollection = {
  getRows: (payload: NamespaceConfigSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceConfigSnapshotPayload, rows: NamespaceConfigSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceConfigSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceConfigSummary, fallbackClusterId: string) =>
    buildConfigKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceConfigSummary>(update);
    return buildConfigKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortConfigRows,
} satisfies ResourceStreamRowCollection<NamespaceConfigSummary, NamespaceConfigSnapshotPayload>;

const namespaceNetworkCollection = {
  getRows: (payload: NamespaceNetworkSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceNetworkSnapshotPayload, rows: NamespaceNetworkSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceNetworkSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceNetworkSummary, fallbackClusterId: string) =>
    buildNetworkKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceNetworkSummary>(update);
    return buildNetworkKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortNetworkRows,
} satisfies ResourceStreamRowCollection<NamespaceNetworkSummary, NamespaceNetworkSnapshotPayload>;

const namespaceRBACCollection = {
  getRows: (payload: NamespaceRBACSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceRBACSnapshotPayload, rows: NamespaceRBACSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceRBACSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceRBACSummary, fallbackClusterId: string) =>
    buildRBACKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceRBACSummary>(update);
    return buildRBACKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
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
    buildCustomKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceCustomSummary>(update);
    return buildCustomKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortCustomRows,
} satisfies ResourceStreamRowCollection<NamespaceCustomSummary, NamespaceCustomSnapshotPayload>;

const namespaceHelmCollection = {
  getRows: (payload: NamespaceHelmSnapshotPayload) => payload.releases ?? [],
  withRows: (payload: NamespaceHelmSnapshotPayload, rows: NamespaceHelmSummary[]) => ({
    ...payload,
    releases: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceHelmSnapshotPayload => ({
    releases: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceHelmSummary, fallbackClusterId: string) =>
    buildHelmKey(row.clusterId ?? fallbackClusterId, row.namespace, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceHelmSummary>(update);
    return buildHelmKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortHelmRows,
} satisfies ResourceStreamRowCollection<NamespaceHelmSummary, NamespaceHelmSnapshotPayload>;

const namespaceAutoscalingCollection = {
  getRows: (payload: NamespaceAutoscalingSnapshotPayload) => payload.resources ?? [],
  withRows: (
    payload: NamespaceAutoscalingSnapshotPayload,
    rows: NamespaceAutoscalingSummary[]
  ) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceAutoscalingSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceAutoscalingSummary, fallbackClusterId: string) =>
    buildAutoscalingKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceAutoscalingSummary>(update);
    return buildAutoscalingKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortAutoscalingRows,
} satisfies ResourceStreamRowCollection<
  NamespaceAutoscalingSummary,
  NamespaceAutoscalingSnapshotPayload
>;

const namespaceQuotaCollection = {
  getRows: (payload: NamespaceQuotasSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceQuotasSnapshotPayload, rows: NamespaceQuotaSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceQuotasSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceQuotaSummary, fallbackClusterId: string) =>
    buildQuotaKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceQuotaSummary>(update);
    return buildQuotaKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortQuotaRows,
} satisfies ResourceStreamRowCollection<NamespaceQuotaSummary, NamespaceQuotasSnapshotPayload>;

const namespaceStorageCollection = {
  getRows: (payload: NamespaceStorageSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: NamespaceStorageSnapshotPayload, rows: NamespaceStorageSummary[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): NamespaceStorageSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: NamespaceStorageSummary, fallbackClusterId: string) =>
    buildStorageKey(row.clusterId ?? fallbackClusterId, row.namespace, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<NamespaceStorageSummary>(update);
    return buildStorageKey(
      updateClusterId(update, fallbackClusterId),
      update.namespace ?? row?.namespace ?? '',
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortStorageRows,
} satisfies ResourceStreamRowCollection<NamespaceStorageSummary, NamespaceStorageSnapshotPayload>;

const clusterRBACCollection = {
  getRows: (payload: ClusterRBACSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: ClusterRBACSnapshotPayload, rows: ClusterRBACEntry[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): ClusterRBACSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterRBACEntry, fallbackClusterId: string) =>
    buildClusterRBACKey(row.clusterId ?? fallbackClusterId, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterRBACEntry>(update);
    return buildClusterRBACKey(
      updateClusterId(update, fallbackClusterId),
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortClusterRBACRows,
} satisfies ResourceStreamRowCollection<ClusterRBACEntry, ClusterRBACSnapshotPayload>;

const clusterStorageCollection = {
  getRows: (payload: ClusterStorageSnapshotPayload) => payload.volumes ?? [],
  withRows: (payload: ClusterStorageSnapshotPayload, rows: ClusterStorageEntry[]) => ({
    ...payload,
    volumes: rows,
  }),
  emptyPayload: (clusterId: string): ClusterStorageSnapshotPayload => ({
    volumes: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterStorageEntry, fallbackClusterId: string) =>
    buildClusterStorageKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterStorageEntry>(update);
    return buildClusterStorageKey(
      updateClusterId(update, fallbackClusterId),
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortClusterStorageRows,
} satisfies ResourceStreamRowCollection<ClusterStorageEntry, ClusterStorageSnapshotPayload>;

const clusterConfigCollection = {
  getRows: (payload: ClusterConfigSnapshotPayload) => payload.resources ?? [],
  withRows: (payload: ClusterConfigSnapshotPayload, rows: ClusterConfigEntry[]) => ({
    ...payload,
    resources: rows,
  }),
  emptyPayload: (clusterId: string): ClusterConfigSnapshotPayload => ({
    resources: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterConfigEntry, fallbackClusterId: string) =>
    buildClusterConfigKey(row.clusterId ?? fallbackClusterId, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterConfigEntry>(update);
    return buildClusterConfigKey(
      updateClusterId(update, fallbackClusterId),
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortClusterConfigRows,
} satisfies ResourceStreamRowCollection<ClusterConfigEntry, ClusterConfigSnapshotPayload>;

const clusterCRDCollection = {
  getRows: (payload: ClusterCRDSnapshotPayload) => payload.definitions ?? [],
  withRows: (payload: ClusterCRDSnapshotPayload, rows: ClusterCRDEntry[]) => ({
    ...payload,
    definitions: rows,
  }),
  emptyPayload: (clusterId: string): ClusterCRDSnapshotPayload => ({
    definitions: [],
    clusterId,
  }),
  buildRowKey: (row: ClusterCRDEntry, fallbackClusterId: string) =>
    buildClusterCRDKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterCRDEntry>(update);
    return buildClusterCRDKey(
      updateClusterId(update, fallbackClusterId),
      update.name ?? row?.name ?? ''
    );
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
    buildClusterCustomKey(row.clusterId ?? fallbackClusterId, row.kind, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterCustomEntry>(update);
    return buildClusterCustomKey(
      updateClusterId(update, fallbackClusterId),
      update.kind ?? row?.kind ?? '',
      update.name ?? row?.name ?? ''
    );
  },
  sortRows: sortClusterCustomRows,
} satisfies ResourceStreamRowCollection<ClusterCustomEntry, ClusterCustomSnapshotPayload>;

const nodeCollection = {
  getRows: (payload: ClusterNodeSnapshotPayload) => payload.nodes ?? [],
  withRows: (payload: ClusterNodeSnapshotPayload, rows: ClusterNodeSnapshotEntry[]) => ({
    ...payload,
    nodes: rows,
  }),
  emptyPayload: (clusterId: string): ClusterNodeSnapshotPayload => ({ nodes: [], clusterId }),
  buildRowKey: (row: ClusterNodeSnapshotEntry, fallbackClusterId: string) =>
    buildNodeKey(row.clusterId ?? fallbackClusterId, row.name),
  buildUpdateKey: (update: ResourceStreamRowUpdate, fallbackClusterId: string) => {
    const row = updateRow<ClusterNodeSnapshotEntry>(update);
    return buildNodeKey(updateClusterId(update, fallbackClusterId), update.name ?? row?.name ?? '');
  },
  sortRows: sortNodeRows,
  mergeRow: mergeNodeMetricsRow,
} satisfies ResourceStreamRowCollection<ClusterNodeSnapshotEntry, ClusterNodeSnapshotPayload>;

export const resourceStreamDomainDescriptors = [
  {
    domain: 'pods',
    scopeKind: 'pod',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortPodRows),
    buildSnapshotKeys: snapshotKeys(buildPodKeySet),
    collection: podCollection,
  },
  {
    domain: 'namespace-workloads',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortWorkloadRows),
    buildSnapshotKeys: snapshotKeys(buildWorkloadKeySet),
    collection: workloadCollection,
  },
  {
    domain: 'namespace-config',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortConfigRows),
    buildSnapshotKeys: snapshotKeys(buildConfigKeySet),
    collection: namespaceConfigCollection,
  },
  {
    domain: 'namespace-network',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortNetworkRows),
    buildSnapshotKeys: snapshotKeys(buildNetworkKeySet),
    collection: namespaceNetworkCollection,
  },
  {
    domain: 'namespace-rbac',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortRBACRows),
    buildSnapshotKeys: snapshotKeys(buildRBACKeySet),
    collection: namespaceRBACCollection,
  },
  {
    domain: 'namespace-custom',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortCustomRows),
    buildSnapshotKeys: snapshotKeys(buildCustomKeySet),
    collection: namespaceCustomCollection,
  },
  {
    domain: 'namespace-helm',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortHelmRows),
    buildSnapshotKeys: snapshotKeys(buildHelmKeySet),
    collection: namespaceHelmCollection,
  },
  {
    domain: 'namespace-autoscaling',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortAutoscalingRows),
    buildSnapshotKeys: snapshotKeys(buildAutoscalingKeySet),
    collection: namespaceAutoscalingCollection,
  },
  {
    domain: 'namespace-quotas',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortQuotaRows),
    buildSnapshotKeys: snapshotKeys(buildQuotaKeySet),
    collection: namespaceQuotaCollection,
  },
  {
    domain: 'namespace-storage',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortStorageRows),
    buildSnapshotKeys: snapshotKeys(buildStorageKeySet),
    collection: namespaceStorageCollection,
  },
  {
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterRBACRows),
    buildSnapshotKeys: snapshotKeys(buildClusterRBACKeySet),
    collection: clusterRBACCollection,
  },
  {
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterStorageRows),
    buildSnapshotKeys: snapshotKeys(buildClusterStorageKeySet),
    collection: clusterStorageCollection,
  },
  {
    domain: 'cluster-config',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterConfigRows),
    buildSnapshotKeys: snapshotKeys(buildClusterConfigKeySet),
    collection: clusterConfigCollection,
  },
  {
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCRDRows),
    buildSnapshotKeys: snapshotKeys(buildClusterCRDKeySet),
    collection: clusterCRDCollection,
  },
  {
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCustomRows),
    buildSnapshotKeys: snapshotKeys(buildClusterCustomKeySet),
    collection: clusterCustomCollection,
  },
  {
    domain: 'nodes',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: true,
    sortRows: rowSorter(sortNodeRows),
    buildSnapshotKeys: snapshotKeys(buildNodeKeySet),
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
