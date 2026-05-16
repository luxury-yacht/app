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

export type ResourceDomain = AppEvents['refresh:resource-stream-drift']['domain'];

export type ResourceStreamScopeKind = 'pod' | 'namespace' | 'cluster';

export type ResourceStreamDomainDescriptor = {
  domain: ResourceDomain;
  scopeKind: ResourceStreamScopeKind;
  isClusterScoped: boolean;
  preserveMetrics: boolean;
  sortRows: (rows: unknown[]) => void;
  buildSnapshotKeys: (payload: unknown, fallbackClusterId: string) => Set<string>;
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

export const sortConfigRows = (rows: NamespaceConfigSummary[]): void => {
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

export const sortRBACRows = (rows: NamespaceRBACSummary[]): void => {
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

export const sortNetworkRows = (rows: NamespaceNetworkSummary[]): void => {
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

export const sortCustomRows = (rows: NamespaceCustomSummary[]): void => {
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

export const sortHelmRows = (rows: NamespaceHelmSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortAutoscalingRows = (rows: NamespaceAutoscalingSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortQuotaRows = (rows: NamespaceQuotaSummary[]): void => {
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

export const sortStorageRows = (rows: NamespaceStorageSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortClusterRBACRows = (rows: ClusterRBACEntry[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortClusterStorageRows = (rows: ClusterStorageEntry[]): void => {
  rows.sort((a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name)));
};

export const sortClusterConfigRows = (rows: ClusterConfigEntry[]): void => {
  rows.sort((a, b) => {
    const kind = normalizeSortKey(a.kind).localeCompare(normalizeSortKey(b.kind));
    if (kind !== 0) {
      return kind;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

export const sortClusterCRDRows = (rows: ClusterCRDEntry[]): void => {
  rows.sort((a, b) => normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name)));
};

export const sortClusterCustomRows = (rows: ClusterCustomEntry[]): void => {
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

export const buildPodKey = (clusterId: string, namespace: string, name: string): string =>
  `${clusterId}::${namespace}::${name}`;

export const buildWorkloadKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildConfigKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildRBACKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildNetworkKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildCustomKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildHelmKey = (clusterId: string, namespace: string, name: string): string =>
  `${clusterId}::${namespace}::${name}`;

export const buildAutoscalingKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildQuotaKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildStorageKey = (
  clusterId: string,
  namespace: string,
  kind: string,
  name: string
): string => `${clusterId}::${namespace}::${kind}::${name}`;

export const buildClusterRBACKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

export const buildClusterStorageKey = (clusterId: string, name: string): string =>
  `${clusterId}::${name}`;

export const buildClusterConfigKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

export const buildClusterCRDKey = (clusterId: string, name: string): string =>
  `${clusterId}::${name}`;

export const buildClusterCustomKey = (clusterId: string, kind: string, name: string): string =>
  `${clusterId}::${kind}::${name}`;

export const buildNodeKey = (clusterId: string, name: string): string => `${clusterId}::${name}`;

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

export const resourceStreamDomainDescriptors = [
  {
    domain: 'pods',
    scopeKind: 'pod',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortPodRows),
    buildSnapshotKeys: snapshotKeys(buildPodKeySet),
  },
  {
    domain: 'namespace-workloads',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: true,
    sortRows: rowSorter(sortWorkloadRows),
    buildSnapshotKeys: snapshotKeys(buildWorkloadKeySet),
  },
  {
    domain: 'namespace-config',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortConfigRows),
    buildSnapshotKeys: snapshotKeys(buildConfigKeySet),
  },
  {
    domain: 'namespace-network',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortNetworkRows),
    buildSnapshotKeys: snapshotKeys(buildNetworkKeySet),
  },
  {
    domain: 'namespace-rbac',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortRBACRows),
    buildSnapshotKeys: snapshotKeys(buildRBACKeySet),
  },
  {
    domain: 'namespace-custom',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortCustomRows),
    buildSnapshotKeys: snapshotKeys(buildCustomKeySet),
  },
  {
    domain: 'namespace-helm',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortHelmRows),
    buildSnapshotKeys: snapshotKeys(buildHelmKeySet),
  },
  {
    domain: 'namespace-autoscaling',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortAutoscalingRows),
    buildSnapshotKeys: snapshotKeys(buildAutoscalingKeySet),
  },
  {
    domain: 'namespace-quotas',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortQuotaRows),
    buildSnapshotKeys: snapshotKeys(buildQuotaKeySet),
  },
  {
    domain: 'namespace-storage',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
    sortRows: rowSorter(sortStorageRows),
    buildSnapshotKeys: snapshotKeys(buildStorageKeySet),
  },
  {
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterRBACRows),
    buildSnapshotKeys: snapshotKeys(buildClusterRBACKeySet),
  },
  {
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterStorageRows),
    buildSnapshotKeys: snapshotKeys(buildClusterStorageKeySet),
  },
  {
    domain: 'cluster-config',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterConfigRows),
    buildSnapshotKeys: snapshotKeys(buildClusterConfigKeySet),
  },
  {
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCRDRows),
    buildSnapshotKeys: snapshotKeys(buildClusterCRDKeySet),
  },
  {
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
    sortRows: rowSorter(sortClusterCustomRows),
    buildSnapshotKeys: snapshotKeys(buildClusterCustomKeySet),
  },
  {
    domain: 'nodes',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: true,
    sortRows: rowSorter(sortNodeRows),
    buildSnapshotKeys: snapshotKeys(buildNodeKeySet),
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
