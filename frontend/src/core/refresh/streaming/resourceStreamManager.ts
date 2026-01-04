/**
 * frontend/src/core/refresh/streaming/resourceStreamManager.ts
 *
 * Resource stream manager for watch-style resource updates.
 */

import { ensureRefreshBaseURL, fetchSnapshot, type Snapshot, type SnapshotStats } from '../client';
import { setDomainState, setScopedDomainState } from '../store';
import type {
  ClusterNodeSnapshotEntry,
  ClusterNodeSnapshotPayload,
  ClusterConfigEntry,
  ClusterConfigSnapshotPayload,
  ClusterCRDEntry,
  ClusterCRDSnapshotPayload,
  ClusterCustomEntry,
  ClusterCustomSnapshotPayload,
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
  PermissionDeniedStatus,
} from '../types';
import { buildClusterScopeList, parseClusterScopeList } from '../clusterScope';
import { errorHandler } from '@utils/errorHandler';
import { eventBus, type AppEvents } from '@/core/events';
import { logAppInfo, logAppWarn } from '@/core/logging/appLogClient';
import { resolvePermissionDeniedMessage } from '../permissionErrors';

const RESOURCE_STREAM_PATH = '/api/v2/stream/resources';
const UPDATE_COALESCE_MS = 150;
const RESYNC_COOLDOWN_MS = 1000;
const RESYNC_MESSAGE = 'Stream resyncing';
const STREAM_ERROR_NOTIFY_THRESHOLD = 3;
const DRIFT_SAMPLE_SIZE = 5;
// Linger stream stops briefly to avoid rapid subscribe/unsubscribe churn.
const STREAM_UNSUBSCRIBE_DEBOUNCE_MS = 500;
// Cap queued updates to avoid unbounded memory growth under bursty streams.
const MAX_UPDATE_QUEUE = 1000;
// Add jitter to reconnect backoff to avoid thundering-herd reconnects.
const RECONNECT_JITTER_FACTOR = 0.2;

const logInfo = (message: string): void => {
  logAppInfo(message, 'ResourceStream');
};

const logWarning = (message: string): void => {
  logAppWarn(message, 'ResourceStream');
};

const MESSAGE_TYPES = {
  request: 'REQUEST',
  cancel: 'CANCEL',
  heartbeat: 'HEARTBEAT',
  reset: 'RESET',
  complete: 'COMPLETE',
  error: 'ERROR',
  added: 'ADDED',
  modified: 'MODIFIED',
  deleted: 'DELETED',
} as const;

// Keep stream domain literals aligned with the event bus payload contract.
type ResourceStreamDomain = AppEvents['refresh:resource-stream-drift']['domain'];
type ResourceDomain = ResourceStreamDomain;

type StreamMessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

type ClientMessage = {
  type: StreamMessageType;
  clusterId?: string;
  domain: ResourceDomain;
  scope: string;
  resourceVersion?: string;
  resumeToken?: string;
};

type ServerMessage = {
  type: StreamMessageType;
  clusterId?: string;
  clusterName?: string;
  domain?: string;
  scope?: string;
  resourceVersion?: string;
  sequence?: string;
  uid?: string;
  name?: string;
  namespace?: string;
  kind?: string;
  row?: unknown;
  error?: string;
  errorDetails?: PermissionDeniedStatus;
};

type UpdateMessage = ServerMessage & { domain: ResourceDomain; scope: string };

const isSupportedDomain = (value: string | undefined): value is ResourceDomain =>
  value === 'pods' ||
  value === 'namespace-workloads' ||
  value === 'namespace-config' ||
  value === 'namespace-network' ||
  value === 'namespace-rbac' ||
  value === 'namespace-custom' ||
  value === 'namespace-helm' ||
  value === 'namespace-autoscaling' ||
  value === 'namespace-quotas' ||
  value === 'namespace-storage' ||
  value === 'cluster-rbac' ||
  value === 'cluster-storage' ||
  value === 'cluster-config' ||
  value === 'cluster-crds' ||
  value === 'cluster-custom' ||
  value === 'nodes';

const isMultiClusterDomain = (domain: ResourceDomain): boolean =>
  domain === 'pods' ||
  domain === 'namespace-workloads' ||
  domain === 'nodes' ||
  domain === 'cluster-rbac' ||
  domain === 'cluster-storage' ||
  domain === 'cluster-config' ||
  domain === 'cluster-crds' ||
  domain === 'cluster-custom';

const isMultiClusterScope = (scope: string): boolean => parseClusterScopeList(scope).isMultiCluster;

const hasMessageType = (value: unknown): value is StreamMessageType =>
  typeof value === 'string' && Object.values(MESSAGE_TYPES).includes(value as StreamMessageType);

const isUpdateMessage = (message: ServerMessage): message is UpdateMessage =>
  hasMessageType(message.type) &&
  isSupportedDomain(message.domain) &&
  typeof message.scope === 'string';

const parseResourceVersion = (value?: string | number): bigint | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return BigInt(Math.floor(value));
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return BigInt(trimmed);
  } catch (_err) {
    return null;
  }
};

// Stream sequence parsing mirrors resourceVersion semantics for resume tokens.
const parseStreamSequence = (value?: string | number): bigint | null => parseResourceVersion(value);

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

export const normalizeResourceScope = (domain: ResourceDomain, scope: string): string => {
  switch (domain) {
    case 'pods':
      return normalizePodScope(scope);
    case 'namespace-workloads':
      return normalizeNamespaceScope(scope, 'namespace-workloads');
    case 'namespace-config':
      return normalizeNamespaceScope(scope, 'namespace-config');
    case 'namespace-network':
      return normalizeNamespaceScope(scope, 'namespace-network');
    case 'namespace-rbac':
      return normalizeNamespaceScope(scope, 'namespace-rbac');
    case 'namespace-custom':
      return normalizeNamespaceScope(scope, 'namespace-custom');
    case 'namespace-helm':
      return normalizeNamespaceScope(scope, 'namespace-helm');
    case 'namespace-autoscaling':
      return normalizeNamespaceScope(scope, 'namespace-autoscaling');
    case 'namespace-quotas':
      return normalizeNamespaceScope(scope, 'namespace-quotas');
    case 'namespace-storage':
      return normalizeNamespaceScope(scope, 'namespace-storage');
    case 'cluster-rbac':
    case 'cluster-storage':
    case 'cluster-config':
    case 'cluster-crds':
    case 'cluster-custom':
      if (!scope || scope.trim() === '' || scope.trim().toLowerCase() === 'cluster') {
        return '';
      }
      throw new Error(`cluster stream does not accept scope ${scope}`);
    case 'nodes':
      if (!scope || scope.trim() === '' || scope.trim().toLowerCase() === 'cluster') {
        return '';
      }
      throw new Error(`nodes stream does not accept scope ${scope}`);
    default:
      throw new Error(`unsupported resource stream domain ${domain}`);
  }
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

// Keep custom rows ordered to match snapshot sorting.
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

// Keep helm rows ordered to match snapshot sorting.
export const sortHelmRows = (rows: NamespaceHelmSummary[]): void => {
  rows.sort((a, b) => {
    const ns = normalizeSortKey(a.namespace).localeCompare(normalizeSortKey(b.namespace));
    if (ns !== 0) {
      return ns;
    }
    return normalizeSortKey(a.name).localeCompare(normalizeSortKey(b.name));
  });
};

// Keep autoscaling rows ordered to match snapshot sorting.
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

// Keep cluster tab rows ordered to match snapshot sorting.
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

// Include kind so autoscaling entries remain distinct if multiple autoscaler types land later.
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

type KeyDiff = {
  missingKeys: number;
  extraKeys: number;
  missingSample: string[];
  extraSample: string[];
};

const diffKeySets = (expected: Set<string>, actual: Set<string>, sampleLimit: number): KeyDiff => {
  const missingSample: string[] = [];
  const extraSample: string[] = [];
  let missingKeys = 0;
  let extraKeys = 0;

  expected.forEach((key) => {
    if (!actual.has(key)) {
      missingKeys += 1;
      if (missingSample.length < sampleLimit) {
        missingSample.push(key);
      }
    }
  });

  actual.forEach((key) => {
    if (!expected.has(key)) {
      extraKeys += 1;
      if (extraSample.length < sampleLimit) {
        extraSample.push(key);
      }
    }
  });

  return { missingKeys, extraKeys, missingSample, extraSample };
};

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
  if (!existing || !preserveMetrics) {
    return incoming;
  }
  return {
    ...incoming,
    cpuUsage: existing.cpuUsage ?? incoming.cpuUsage,
    memUsage: existing.memUsage ?? incoming.memUsage,
  };
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

const updateStats = (stats: SnapshotStats | null, itemCount: number): SnapshotStats => {
  if (!stats) {
    return { itemCount, buildDurationMs: 0 };
  }
  return { ...stats, itemCount };
};

// Merge cluster payloads by replacing rows for a single cluster id.
const mergeClusterRows = <T extends { clusterId?: string | null }>(
  existing: T[] | null | undefined,
  incoming: T[] | null | undefined,
  clusterId: string
): T[] => {
  const targetCluster = clusterId.trim();
  const next = (existing ?? []).filter((row) => {
    const rowCluster = (row.clusterId ?? targetCluster).trim();
    return rowCluster !== targetCluster;
  });
  if (incoming && incoming.length > 0) {
    next.push(...incoming);
  }
  return next;
};

type StreamSubscription = {
  key: string;
  domain: ResourceDomain;
  storeScope: string;
  reportScope: string;
  normalizedScope: string;
  clusterId: string;
  clusterName?: string;
  resourceVersion?: bigint;
  // Track the last stream sequence applied so we can resume after reconnects.
  lastSequence?: bigint;
  updateQueue: UpdateMessage[];
  updateTimer: number | null;
  pendingReset: boolean;
  resyncInFlight: boolean;
  lastResyncAt: number;
  preserveMetrics: boolean;
  shadowKeys: Set<string>;
  hasBaseline: boolean;
  driftDetected: boolean;
};

export type ResourceStreamTelemetrySummary = {
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
};

type StreamTelemetry = {
  resyncCount: number;
  fallbackCount: number;
  lastResyncAt?: number;
  lastResyncReason?: string;
  lastFallbackAt?: number;
  lastFallbackReason?: string;
};

type PendingUnsubscribe = {
  timerId: number;
};

class ResourceStreamConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closed = false;
  private paused = false;
  private reconnectTimer: number | null = null;
  private pendingMessages: ClientMessage[] = [];

  constructor(private readonly manager: ResourceStreamManager) {}

  async connect(): Promise<void> {
    if (this.closed || this.paused || typeof window === 'undefined') {
      return;
    }
    try {
      const baseURL = await ensureRefreshBaseURL();
      if (this.closed || this.paused) {
        return;
      }
      const url = new URL(RESOURCE_STREAM_PATH, baseURL);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

      const socket = new WebSocket(url.toString());
      this.socket = socket;
      socket.onopen = () => this.handleOpen();
      socket.onmessage = (event) => this.handleMessage(event);
      socket.onerror = () => this.handleError('Resource stream connection error');
      socket.onclose = () => this.handleClose('Resource stream connection closed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open resource stream';
      this.handleError(message);
      this.scheduleReconnect();
    }
  }

  pause(): void {
    this.paused = true;
    this.clearReconnect();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.closed = false;
    void this.connect();
  }

  close(): void {
    this.closed = true;
    this.clearReconnect();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.pendingMessages.push(message);
  }

  private handleOpen(): void {
    this.attempt = 0;
    this.manager.handleConnectionOpen('');
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    pending.forEach((message) => this.send(message));
  }

  private handleMessage(event: MessageEvent): void {
    this.manager.handleMessage('', event.data);
  }

  private handleError(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.manager.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private handleClose(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.manager.handleConnectionError('', message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.paused) {
      return;
    }
    this.clearReconnect();
    const baseDelay = Math.min(30_000, 1000 * Math.pow(2, this.attempt));
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_FACTOR;
    const delay = Math.max(0, Math.round(baseDelay * jitter));
    this.attempt += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export class ResourceStreamManager {
  private subscriptions = new Map<string, StreamSubscription>();
  // Single socket used to multiplex subscriptions across clusters.
  private connection: ResourceStreamConnection | null = null;
  private lastNotifiedErrors = new Map<string, string>();
  private consecutiveErrors = new Map<string, number>();
  private suspendedForVisibility = false;
  private streamTelemetry = new Map<string, StreamTelemetry>();
  private pendingUnsubscribes = new Map<string, PendingUnsubscribe>();

  constructor() {
    eventBus.on('kubeconfig:changing', () => this.stopAll(true));
    eventBus.on('view:reset', () => this.stopAll(false));
    eventBus.on('app:visibility-hidden', () => this.suspendForVisibility());
    eventBus.on('app:visibility-visible', () => this.resumeFromVisibility());
  }

  // Aggregate stream telemetry so diagnostics can display resync/fallback activity.
  getTelemetrySummary(): ResourceStreamTelemetrySummary {
    const summary: ResourceStreamTelemetrySummary = {
      resyncCount: 0,
      fallbackCount: 0,
    };

    this.streamTelemetry.forEach((stats) => {
      summary.resyncCount += stats.resyncCount;
      summary.fallbackCount += stats.fallbackCount;
      if (stats.lastResyncAt && stats.lastResyncAt > (summary.lastResyncAt ?? 0)) {
        summary.lastResyncAt = stats.lastResyncAt;
        summary.lastResyncReason = stats.lastResyncReason;
      }
      if (stats.lastFallbackAt && stats.lastFallbackAt > (summary.lastFallbackAt ?? 0)) {
        summary.lastFallbackAt = stats.lastFallbackAt;
        summary.lastFallbackReason = stats.lastFallbackReason;
      }
    });

    return summary;
  }

  async start(domain: ResourceDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscriptions = this.ensureSubscriptions(domain, scope);
    await Promise.all(
      subscriptions.map((subscription) => this.resyncSubscription(subscription, 'initial'))
    );
  }

  stop(domain: ResourceDomain, scope: string, reset = false): void {
    const subscriptions = this.getSubscriptions(domain, scope);
    if (subscriptions.length === 0) {
      return;
    }
    subscriptions.forEach((subscription) => this.scheduleUnsubscribe(subscription, reset));
  }

  async refreshOnce(domain: ResourceDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscriptions = this.ensureSubscriptions(domain, scope);
    await Promise.all(
      subscriptions.map((subscription) =>
        this.resyncSubscription(subscription, 'manual refresh', true)
      )
    );
  }

  handleMessage(clusterId: string, raw: string): void {
    let parsed: ServerMessage | null = null;
    try {
      parsed = JSON.parse(raw) as ServerMessage;
    } catch (_err) {
      console.error('Invalid resource stream payload');
      return;
    }
    if (!parsed || !hasMessageType(parsed.type)) {
      return;
    }
    if (!isUpdateMessage(parsed)) {
      return;
    }
    const messageClusterId = parsed.clusterId?.trim() || clusterId;
    if (!messageClusterId) {
      return;
    }
    const normalizedScope = parsed.scope.trim();
    const subscription = this.subscriptions.get(
      this.subscriptionKey(messageClusterId, parsed.domain, normalizedScope)
    );
    if (!subscription) {
      return;
    }
    const errorMessage = resolvePermissionDeniedMessage(parsed.error, parsed.errorDetails);

    switch (parsed.type) {
      case MESSAGE_TYPES.heartbeat:
        return;
      case MESSAGE_TYPES.reset:
        if (subscription.pendingReset) {
          subscription.pendingReset = false;
          return;
        }
        void this.resyncSubscription(subscription, 'reset');
        return;
      case MESSAGE_TYPES.complete:
        void this.resyncSubscription(subscription, errorMessage || 'complete');
        return;
      case MESSAGE_TYPES.error:
        void this.resyncSubscription(subscription, errorMessage || 'stream error', true);
        return;
      case MESSAGE_TYPES.added:
      case MESSAGE_TYPES.modified:
      case MESSAGE_TYPES.deleted:
        this.handleUpdate(subscription, parsed);
        return;
      default:
        return;
    }
  }

  handleConnectionOpen(clusterId: string): void {
    const targetClusterId = clusterId.trim();
    // Log when the websocket is connected so it is clear streaming is active.
    logInfo(`[resource-stream] connection open clusterId=${targetClusterId || 'all'}`);
    if (targetClusterId) {
      this.clearStreamError(targetClusterId);
    } else {
      this.clearAllStreamErrors();
    }
    this.subscriptions.forEach((subscription) => {
      if (targetClusterId && subscription.clusterId !== targetClusterId) {
        return;
      }
      this.subscribe(subscription);
      if (
        subscription.lastSequence &&
        !subscription.resyncInFlight &&
        !subscription.driftDetected
      ) {
        // Clear resync state when a resume-capable stream reconnects.
        this.markResyncComplete(subscription);
      }
    });
  }

  handleConnectionError(clusterId: string, message: string): void {
    const targetClusterId = clusterId.trim();
    this.subscriptions.forEach((subscription) => {
      if (targetClusterId && subscription.clusterId !== targetClusterId) {
        return;
      }
      this.markResyncing(subscription);
      if (!subscription.lastSequence) {
        void this.resyncSubscription(subscription, message);
      }
    });
  }

  private suspendForVisibility(): void {
    if (this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = true;
    this.connection?.pause();
  }

  private resumeFromVisibility(): void {
    if (!this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = false;
    this.connection?.resume();
    this.subscriptions.forEach((subscription) => {
      this.markResyncing(subscription);
      void this.resyncSubscription(subscription, 'visibility resume');
    });
  }

  private ensureSubscriptions(domain: ResourceDomain, scope: string): StreamSubscription[] {
    const { clusterIds, normalizedScope, reportScope } = this.resolveSubscriptionScope(
      domain,
      scope
    );
    return clusterIds.map((clusterId) =>
      this.ensureSubscriptionForCluster(domain, clusterId, normalizedScope, reportScope)
    );
  }

  private ensureSubscriptionForCluster(
    domain: ResourceDomain,
    clusterId: string,
    normalizedScope: string,
    reportScope: string
  ): StreamSubscription {
    const key = this.subscriptionKey(clusterId, domain, normalizedScope);
    const existing = this.subscriptions.get(key);
    if (existing) {
      this.cancelPendingUnsubscribe(existing);
      return existing;
    }

    const storeScope = buildClusterScopeList([clusterId], normalizedScope);
    const subscription: StreamSubscription = {
      key,
      domain,
      storeScope,
      reportScope,
      normalizedScope,
      clusterId,
      updateQueue: [],
      updateTimer: null,
      pendingReset: false,
      resyncInFlight: false,
      lastResyncAt: 0,
      preserveMetrics: domain === 'pods' || domain === 'namespace-workloads' || domain === 'nodes',
      shadowKeys: new Set(),
      hasBaseline: false,
      driftDetected: false,
    };
    this.subscriptions.set(key, subscription);
    logInfo(
      `[resource-stream] subscription created domain=${subscription.domain} scope=${subscription.storeScope}`
    );
    return subscription;
  }

  private getSubscriptions(domain: ResourceDomain, scope: string): StreamSubscription[] {
    const parsed = parseClusterScopeList(scope);
    if (parsed.clusterIds.length === 0) {
      return [];
    }
    if (parsed.isMultiCluster && !isMultiClusterDomain(domain)) {
      return [];
    }
    let normalizedScope = '';
    try {
      normalizedScope = normalizeResourceScope(domain, parsed.scope);
    } catch (_err) {
      return [];
    }

    return parsed.clusterIds
      .map((clusterId) =>
        this.subscriptions.get(this.subscriptionKey(clusterId, domain, normalizedScope))
      )
      .filter((subscription): subscription is StreamSubscription => Boolean(subscription));
  }

  private resolveSubscriptionScope(
    domain: ResourceDomain,
    scope: string
  ): { clusterIds: string[]; normalizedScope: string; reportScope: string } {
    const parsed = parseClusterScopeList(scope);
    if (parsed.clusterIds.length === 0) {
      throw new Error('Resource streaming requires a cluster scope');
    }
    if (parsed.isMultiCluster && !isMultiClusterDomain(domain)) {
      throw new Error('Resource streaming requires a single cluster scope');
    }
    const normalizedScope = normalizeResourceScope(domain, parsed.scope);
    const reportScope = buildClusterScopeList(parsed.clusterIds, normalizedScope);
    return { clusterIds: parsed.clusterIds, normalizedScope, reportScope };
  }

  private subscriptionKey(clusterId: string, domain: ResourceDomain, scope: string): string {
    return `${clusterId}::${domain}::${scope}`;
  }

  private getConnection(): ResourceStreamConnection {
    if (this.connection) {
      return this.connection;
    }
    const connection = new ResourceStreamConnection(this);
    this.connection = connection;
    void connection.connect();
    return connection;
  }

  private subscribe(subscription: StreamSubscription): void {
    // Avoid re-subscribing while a debounced stop is pending.
    if (this.pendingUnsubscribes.has(subscription.key)) {
      return;
    }
    const connection = this.getConnection();
    const resumeToken = subscription.lastSequence
      ? subscription.lastSequence.toString()
      : undefined;
    subscription.pendingReset = !resumeToken;
    connection.send({
      type: MESSAGE_TYPES.request,
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      scope: subscription.storeScope,
      resourceVersion: subscription.resourceVersion
        ? subscription.resourceVersion.toString()
        : undefined,
      resumeToken,
    });
  }

  private unsubscribe(subscription: StreamSubscription, reset: boolean): void {
    this.cancelPendingUnsubscribe(subscription);
    const connection = this.connection;
    if (connection) {
      connection.send({
        type: MESSAGE_TYPES.cancel,
        clusterId: subscription.clusterId,
        domain: subscription.domain,
        scope: subscription.storeScope,
      });
    }

    if (subscription.updateTimer !== null) {
      window.clearTimeout(subscription.updateTimer);
    }
    this.subscriptions.delete(subscription.key);

    if (reset) {
      this.clearStreamError(subscription.clusterId);
    }

    if (this.subscriptions.size === 0 && connection) {
      connection.close();
      this.connection = null;
    }
  }

  private scheduleUnsubscribe(subscription: StreamSubscription, reset: boolean): void {
    if (reset || typeof window === 'undefined' || STREAM_UNSUBSCRIBE_DEBOUNCE_MS <= 0) {
      this.unsubscribe(subscription, reset);
      return;
    }
    if (this.pendingUnsubscribes.has(subscription.key)) {
      return;
    }
    const timerId = window.setTimeout(() => {
      this.pendingUnsubscribes.delete(subscription.key);
      this.unsubscribe(subscription, reset);
    }, STREAM_UNSUBSCRIBE_DEBOUNCE_MS);
    this.pendingUnsubscribes.set(subscription.key, { timerId });
    logInfo(
      `[resource-stream] debounce unsubscribe domain=${subscription.domain} scope=${subscription.storeScope} delayMs=${STREAM_UNSUBSCRIBE_DEBOUNCE_MS}`
    );
  }

  private cancelPendingUnsubscribe(subscription: StreamSubscription): void {
    const pending = this.pendingUnsubscribes.get(subscription.key);
    if (!pending) {
      return;
    }
    window.clearTimeout(pending.timerId);
    this.pendingUnsubscribes.delete(subscription.key);
    logInfo(
      `[resource-stream] debounce cancel domain=${subscription.domain} scope=${subscription.storeScope}`
    );
  }

  private clearPendingUnsubscribes(): void {
    this.pendingUnsubscribes.forEach((pending) => window.clearTimeout(pending.timerId));
    this.pendingUnsubscribes.clear();
  }

  private handleUpdate(subscription: StreamSubscription, message: UpdateMessage): void {
    if (subscription.resyncInFlight) {
      return;
    }
    if (subscription.driftDetected) {
      return;
    }

    const incomingVersion = parseResourceVersion(message.resourceVersion);
    if (!incomingVersion) {
      void this.resyncSubscription(subscription, 'missing resource version');
      return;
    }
    if (subscription.resourceVersion && incomingVersion <= subscription.resourceVersion) {
      void this.resyncSubscription(subscription, 'out-of-order update');
      return;
    }
    subscription.resourceVersion = incomingVersion;
    const incomingSequence = parseStreamSequence(message.sequence);
    if (
      incomingSequence &&
      (!subscription.lastSequence || incomingSequence > subscription.lastSequence)
    ) {
      subscription.lastSequence = incomingSequence;
    }

    subscription.updateQueue.push(message);
    if (subscription.updateQueue.length > MAX_UPDATE_QUEUE) {
      // Drop the backlog and force a resync so we don't apply stale updates.
      subscription.updateQueue = [];
      void this.resyncSubscription(subscription, 'update backlog overflow', true);
      return;
    }
    if (subscription.updateTimer !== null) {
      return;
    }
    subscription.updateTimer = window.setTimeout(() => {
      subscription.updateTimer = null;
      this.flushUpdates(subscription);
    }, UPDATE_COALESCE_MS);
  }

  private flushUpdates(subscription: StreamSubscription): void {
    if (subscription.updateQueue.length === 0) {
      return;
    }
    const updates = subscription.updateQueue.splice(0, subscription.updateQueue.length);
    const now = Date.now();

    // Always update shadow keys so drift checks can compare snapshots to streamed changes.
    this.applyShadowUpdates(subscription, updates);

    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => {
        const currentPayload = previous.data ?? { pods: [] };
        const existingRows = currentPayload.pods ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildPodKey(row.clusterId ?? subscription.clusterId, row.namespace, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildPodKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          const incoming = update.row as PodSnapshotEntry;
          const existing = byKey.get(key);
          byKey.set(key, mergePodMetricsRow(existing, incoming, subscription.preserveMetrics));
        });

        const nextRows = Array.from(byKey.values());
        sortPodRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, pods: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => {
        const currentPayload = previous.data ?? { workloads: [] };
        const existingRows = currentPayload.workloads ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildWorkloadKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildWorkloadKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          const incoming = update.row as NamespaceWorkloadSummary;
          const existing = byKey.get(key);
          byKey.set(key, mergeWorkloadMetricsRow(existing, incoming, subscription.preserveMetrics));
        });

        const nextRows = Array.from(byKey.values());
        sortWorkloadRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, workloads: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildConfigKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildConfigKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceConfigSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortConfigRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-network') {
      setDomainState('namespace-network', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildNetworkKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildNetworkKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceNetworkSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortNetworkRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildRBACKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildRBACKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceRBACSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortRBACRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      setDomainState('namespace-custom', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildCustomKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildCustomKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceCustomSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortCustomRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      setDomainState('namespace-helm', (previous) => {
        const currentPayload = previous.data ?? { releases: [] };
        const existingRows = currentPayload.releases ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildHelmKey(row.clusterId ?? subscription.clusterId, row.namespace, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildHelmKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceHelmSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortHelmRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, releases: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      setDomainState('namespace-autoscaling', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildAutoscalingKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildAutoscalingKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceAutoscalingSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortAutoscalingRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      setDomainState('namespace-quotas', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildQuotaKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildQuotaKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceQuotaSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortQuotaRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      setDomainState('namespace-storage', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildStorageKey(
              row.clusterId ?? subscription.clusterId,
              row.namespace,
              row.kind,
              row.name
            ),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildStorageKey(
            update.clusterId ?? subscription.clusterId,
            update.namespace ?? '',
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as NamespaceStorageSummary);
        });

        const nextRows = Array.from(byKey.values());
        sortStorageRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      setDomainState('cluster-rbac', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildClusterRBACKey(row.clusterId ?? subscription.clusterId, row.kind, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildClusterRBACKey(
            update.clusterId ?? subscription.clusterId,
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as ClusterRBACEntry);
        });

        const nextRows = Array.from(byKey.values());
        sortClusterRBACRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      setDomainState('cluster-storage', (previous) => {
        const currentPayload = previous.data ?? { volumes: [] };
        const existingRows = currentPayload.volumes ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildClusterStorageKey(row.clusterId ?? subscription.clusterId, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildClusterStorageKey(
            update.clusterId ?? subscription.clusterId,
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as ClusterStorageEntry);
        });

        const nextRows = Array.from(byKey.values());
        sortClusterStorageRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, volumes: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-config') {
      setDomainState('cluster-config', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildClusterConfigKey(row.clusterId ?? subscription.clusterId, row.kind, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildClusterConfigKey(
            update.clusterId ?? subscription.clusterId,
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as ClusterConfigEntry);
        });

        const nextRows = Array.from(byKey.values());
        sortClusterConfigRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      setDomainState('cluster-crds', (previous) => {
        const currentPayload = previous.data ?? { definitions: [] };
        const existingRows = currentPayload.definitions ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildClusterCRDKey(row.clusterId ?? subscription.clusterId, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildClusterCRDKey(
            update.clusterId ?? subscription.clusterId,
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as ClusterCRDEntry);
        });

        const nextRows = Array.from(byKey.values());
        sortClusterCRDRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, definitions: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      setDomainState('cluster-custom', (previous) => {
        const currentPayload = previous.data ?? { resources: [] };
        const existingRows = currentPayload.resources ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildClusterCustomKey(row.clusterId ?? subscription.clusterId, row.kind, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildClusterCustomKey(
            update.clusterId ?? subscription.clusterId,
            update.kind ?? '',
            update.name ?? ''
          );
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          byKey.set(key, update.row as ClusterCustomEntry);
        });

        const nextRows = Array.from(byKey.values());
        sortClusterCustomRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, resources: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => {
        const currentPayload = previous.data ?? { nodes: [] };
        const existingRows = currentPayload.nodes ?? [];
        const byKey = new Map(
          existingRows.map((row) => [
            buildNodeKey(row.clusterId ?? subscription.clusterId, row.name),
            row,
          ])
        );

        updates.forEach((update) => {
          const key = buildNodeKey(update.clusterId ?? subscription.clusterId, update.name ?? '');
          if (update.type === MESSAGE_TYPES.deleted) {
            byKey.delete(key);
            return;
          }
          if (!update.row) {
            return;
          }
          const incoming = update.row as ClusterNodeSnapshotEntry;
          const existing = byKey.get(key);
          byKey.set(key, mergeNodeMetricsRow(existing, incoming, subscription.preserveMetrics));
        });

        const nextRows = Array.from(byKey.values());
        sortNodeRows(nextRows);
        return {
          ...previous,
          status: 'ready',
          data: { ...currentPayload, nodes: nextRows },
          stats: updateStats(previous.stats, nextRows.length),
          lastUpdated: now,
          lastAutoRefresh: now,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
    }
  }

  private applyShadowUpdates(subscription: StreamSubscription, updates: UpdateMessage[]): void {
    if (!subscription.hasBaseline) {
      return;
    }

    if (subscription.domain === 'pods') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as PodSnapshotEntry | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildPodKey(clusterId, namespace, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceWorkloadSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildWorkloadKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-config') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceConfigSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildConfigKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-network') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceNetworkSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildNetworkKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceRBACSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildRBACKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceCustomSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildCustomKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceHelmSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildHelmKey(clusterId, namespace, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceAutoscalingSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildAutoscalingKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceQuotaSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildQuotaKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as NamespaceStorageSummary | undefined;
        const namespace = update.namespace ?? row?.namespace ?? '';
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildStorageKey(clusterId, namespace, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterRBACEntry | undefined;
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildClusterRBACKey(clusterId, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterStorageEntry | undefined;
        const name = update.name ?? row?.name ?? '';
        const key = buildClusterStorageKey(clusterId, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'cluster-config') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterConfigEntry | undefined;
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildClusterConfigKey(clusterId, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterCRDEntry | undefined;
        const name = update.name ?? row?.name ?? '';
        const key = buildClusterCRDKey(clusterId, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterCustomEntry | undefined;
        const kind = update.kind ?? row?.kind ?? '';
        const name = update.name ?? row?.name ?? '';
        const key = buildClusterCustomKey(clusterId, kind, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
      return;
    }

    if (subscription.domain === 'nodes') {
      updates.forEach((update) => {
        const clusterId = update.clusterId ?? subscription.clusterId;
        const row = update.row as ClusterNodeSnapshotEntry | undefined;
        const name = update.name ?? row?.name ?? '';
        const key = buildNodeKey(clusterId, name);
        if (update.type === MESSAGE_TYPES.deleted) {
          subscription.shadowKeys.delete(key);
        } else {
          subscription.shadowKeys.add(key);
        }
      });
    }
  }

  // Track resync activity so diagnostics can surface stream health.
  private recordResync(subscription: StreamSubscription, reason: string): void {
    if (!this.shouldTrackResync(reason)) {
      return;
    }
    const stats = this.ensureStreamTelemetry(subscription);
    stats.resyncCount += 1;
    stats.lastResyncAt = Date.now();
    stats.lastResyncReason = reason;
  }

  // Track snapshot fallbacks when drift forces streaming to stop.
  private recordFallback(subscription: StreamSubscription, reason: string): void {
    const stats = this.ensureStreamTelemetry(subscription);
    stats.fallbackCount += 1;
    stats.lastFallbackAt = Date.now();
    stats.lastFallbackReason = reason;
  }

  private shouldTrackResync(reason: string): boolean {
    return reason !== 'initial' && reason !== 'manual refresh';
  }

  private ensureStreamTelemetry(subscription: StreamSubscription): StreamTelemetry {
    const existing = this.streamTelemetry.get(subscription.key);
    if (existing) {
      return existing;
    }
    const stats: StreamTelemetry = {
      resyncCount: 0,
      fallbackCount: 0,
    };
    this.streamTelemetry.set(subscription.key, stats);
    return stats;
  }

  // Resync clears queued updates and refreshes the snapshot after stream gaps.
  private async resyncSubscription(
    subscription: StreamSubscription,
    reason: string,
    force = false
  ): Promise<void> {
    // Skip resync work for subscriptions that are already scheduled to stop.
    if (this.pendingUnsubscribes.has(subscription.key)) {
      return;
    }
    if (subscription.resyncInFlight) {
      return;
    }
    if (subscription.driftDetected) {
      return;
    }
    const now = Date.now();
    if (
      !force &&
      subscription.lastResyncAt &&
      now - subscription.lastResyncAt < RESYNC_COOLDOWN_MS
    ) {
      return;
    }
    subscription.resyncInFlight = true;
    subscription.lastResyncAt = now;
    this.recordResync(subscription, reason);
    this.markResyncing(subscription);
    if (subscription.updateTimer !== null) {
      window.clearTimeout(subscription.updateTimer);
      subscription.updateTimer = null;
    }
    subscription.updateQueue = [];
    subscription.lastSequence = undefined;

    try {
      const { snapshot, notModified } = await fetchSnapshotForSubscription(subscription);
      if (notModified) {
        this.markResyncComplete(subscription);
        subscription.pendingReset = false;
        if (subscription.driftDetected) {
          this.unsubscribe(subscription, false);
          return;
        }
        this.subscribe(subscription);
        return;
      }
      if (!snapshot) {
        throw new Error('resource stream snapshot missing');
      }
      this.applySnapshot(subscription, snapshot);
      subscription.resourceVersion =
        parseResourceVersion(snapshot.version) ?? subscription.resourceVersion;
      subscription.pendingReset = false;
      if (subscription.driftDetected) {
        this.unsubscribe(subscription, false);
        return;
      }
      this.subscribe(subscription);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStreamError(subscription, message);
    } finally {
      subscription.resyncInFlight = false;
    }
  }

  private applySnapshot(subscription: StreamSubscription, snapshot: Snapshot<any>): void {
    // Drift detection compares streamed keys against the latest snapshot.
    this.updateShadowBaseline(subscription, snapshot);

    const generatedAt = snapshot.generatedAt || Date.now();

    if (subscription.domain === 'pods') {
      const payload = snapshot.payload as PodSnapshotPayload;
      // Multi-cluster snapshots must merge per-cluster rows into the shared scope.
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setScopedDomainState('pods', subscription.reportScope, (previous) => {
        const incoming = payload.pods ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.pods, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortPodRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, pods: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      const payload = snapshot.payload as NamespaceWorkloadSnapshotPayload;
      // Multi-cluster snapshots must merge per-cluster rows into the shared scope.
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('namespace-workloads', (previous) => {
        const incoming = payload.workloads ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.workloads, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortWorkloadRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, workloads: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-config') {
      const payload = snapshot.payload as NamespaceConfigSnapshotPayload;
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-network') {
      const payload = snapshot.payload as NamespaceNetworkSnapshotPayload;
      setDomainState('namespace-network', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      const payload = snapshot.payload as NamespaceRBACSnapshotPayload;
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      const payload = snapshot.payload as NamespaceCustomSnapshotPayload;
      setDomainState('namespace-custom', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      const payload = snapshot.payload as NamespaceHelmSnapshotPayload;
      setDomainState('namespace-helm', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      const payload = snapshot.payload as NamespaceAutoscalingSnapshotPayload;
      setDomainState('namespace-autoscaling', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      const payload = snapshot.payload as NamespaceQuotasSnapshotPayload;
      setDomainState('namespace-quotas', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      const payload = snapshot.payload as NamespaceStorageSnapshotPayload;
      setDomainState('namespace-storage', (previous) => ({
        ...previous,
        status: 'ready',
        data: payload,
        stats: snapshot.stats ?? null,
        version: snapshot.version,
        checksum: snapshot.checksum,
        etag: snapshot.checksum ?? previous.etag,
        lastUpdated: generatedAt,
        lastAutoRefresh: generatedAt,
        error: null,
        isManual: false,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      const payload = snapshot.payload as ClusterRBACSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('cluster-rbac', (previous) => {
        const incoming = payload.resources ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.resources, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortClusterRBACRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, resources: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      const payload = snapshot.payload as ClusterStorageSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('cluster-storage', (previous) => {
        const incoming = payload.volumes ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.volumes, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortClusterStorageRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, volumes: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-config') {
      const payload = snapshot.payload as ClusterConfigSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('cluster-config', (previous) => {
        const incoming = payload.resources ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.resources, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortClusterConfigRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, resources: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      const payload = snapshot.payload as ClusterCRDSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('cluster-crds', (previous) => {
        const incoming = payload.definitions ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.definitions, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortClusterCRDRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, definitions: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      const payload = snapshot.payload as ClusterCustomSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('cluster-custom', (previous) => {
        const incoming = payload.resources ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.resources, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortClusterCustomRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, resources: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'nodes') {
      const payload = snapshot.payload as ClusterNodeSnapshotPayload;
      const shouldMerge = isMultiClusterScope(subscription.reportScope);
      setDomainState('nodes', (previous) => {
        const incoming = payload.nodes ?? [];
        const merged = shouldMerge
          ? mergeClusterRows(previous.data?.nodes, incoming, subscription.clusterId)
          : incoming;
        if (shouldMerge) {
          sortNodeRows(merged);
        }
        return {
          ...previous,
          status: 'ready',
          data: shouldMerge ? { ...payload, nodes: merged } : payload,
          stats: updateStats(snapshot.stats ?? previous.stats ?? null, merged.length),
          version: snapshot.version,
          checksum: snapshot.checksum,
          etag: snapshot.checksum ?? previous.etag,
          lastUpdated: generatedAt,
          lastAutoRefresh: generatedAt,
          error: null,
          isManual: false,
          scope: subscription.reportScope,
        };
      });
      this.clearStreamError(subscription.clusterId);
    }
  }

  private updateShadowBaseline(subscription: StreamSubscription, snapshot: Snapshot<any>): void {
    let snapshotKeys: Set<string> | null = null;

    if (subscription.domain === 'pods') {
      snapshotKeys = buildPodKeySet(
        snapshot.payload as PodSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-workloads') {
      snapshotKeys = buildWorkloadKeySet(
        snapshot.payload as NamespaceWorkloadSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-config') {
      snapshotKeys = buildConfigKeySet(
        snapshot.payload as NamespaceConfigSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-network') {
      snapshotKeys = buildNetworkKeySet(
        snapshot.payload as NamespaceNetworkSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-rbac') {
      snapshotKeys = buildRBACKeySet(
        snapshot.payload as NamespaceRBACSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-custom') {
      snapshotKeys = buildCustomKeySet(
        snapshot.payload as NamespaceCustomSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-helm') {
      snapshotKeys = buildHelmKeySet(
        snapshot.payload as NamespaceHelmSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-autoscaling') {
      snapshotKeys = buildAutoscalingKeySet(
        snapshot.payload as NamespaceAutoscalingSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-quotas') {
      snapshotKeys = buildQuotaKeySet(
        snapshot.payload as NamespaceQuotasSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'namespace-storage') {
      snapshotKeys = buildStorageKeySet(
        snapshot.payload as NamespaceStorageSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'cluster-rbac') {
      snapshotKeys = buildClusterRBACKeySet(
        snapshot.payload as ClusterRBACSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'cluster-storage') {
      snapshotKeys = buildClusterStorageKeySet(
        snapshot.payload as ClusterStorageSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'cluster-config') {
      snapshotKeys = buildClusterConfigKeySet(
        snapshot.payload as ClusterConfigSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'cluster-crds') {
      snapshotKeys = buildClusterCRDKeySet(
        snapshot.payload as ClusterCRDSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'cluster-custom') {
      snapshotKeys = buildClusterCustomKeySet(
        snapshot.payload as ClusterCustomSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    } else if (subscription.domain === 'nodes') {
      snapshotKeys = buildNodeKeySet(
        snapshot.payload as ClusterNodeSnapshotPayload | null | undefined,
        subscription.clusterId
      );
    }

    if (!snapshotKeys) {
      return;
    }

    if (subscription.hasBaseline && !subscription.driftDetected) {
      const streamCount = subscription.shadowKeys.size;
      const snapshotCount = snapshotKeys.size;
      const diff = diffKeySets(snapshotKeys, subscription.shadowKeys, DRIFT_SAMPLE_SIZE);
      if (diff.missingKeys > 0 || diff.extraKeys > 0) {
        this.flagDrift(subscription, {
          reason: 'snapshot mismatch',
          streamCount,
          snapshotCount,
          missingKeys: diff.missingKeys,
          extraKeys: diff.extraKeys,
          missingSample: diff.missingSample,
          extraSample: diff.extraSample,
        });
      }
    }

    subscription.shadowKeys = snapshotKeys;
    subscription.hasBaseline = true;
  }

  private flagDrift(
    subscription: StreamSubscription,
    details: {
      reason: string;
      streamCount: number;
      snapshotCount: number;
      missingKeys: number;
      extraKeys: number;
      missingSample: string[];
      extraSample: string[];
    }
  ): void {
    if (subscription.driftDetected) {
      return;
    }
    this.recordFallback(subscription, details.reason);
    subscription.driftDetected = true;

    eventBus.emit('refresh:resource-stream-drift', {
      domain: subscription.domain,
      scope: subscription.reportScope,
      reason: details.reason,
      streamCount: details.streamCount,
      snapshotCount: details.snapshotCount,
      missingKeys: details.missingKeys,
      extraKeys: details.extraKeys,
    });

    logWarning(
      `[resource-stream] drift detected domain=${subscription.domain} scope=${subscription.reportScope} reason=${details.reason} streamCount=${details.streamCount} snapshotCount=${details.snapshotCount} missingKeys=${details.missingKeys} extraKeys=${details.extraKeys}`
    );
  }

  private markResyncComplete(subscription: StreamSubscription): void {
    const now = Date.now();
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-network') {
      setDomainState('namespace-network', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      setDomainState('namespace-custom', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      setDomainState('namespace-helm', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      setDomainState('namespace-autoscaling', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      setDomainState('namespace-quotas', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      setDomainState('namespace-storage', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      setDomainState('cluster-rbac', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      setDomainState('cluster-storage', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-config') {
      setDomainState('cluster-config', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      setDomainState('cluster-crds', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      setDomainState('cluster-custom', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.reportScope,
      }));
      this.clearStreamError(subscription.clusterId);
    }
  }

  private markResyncing(subscription: StreamSubscription): void {
    const message = RESYNC_MESSAGE;
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-network') {
      setDomainState('namespace-network', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-custom') {
      setDomainState('namespace-custom', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-helm') {
      setDomainState('namespace-helm', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-autoscaling') {
      setDomainState('namespace-autoscaling', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-quotas') {
      setDomainState('namespace-quotas', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-storage') {
      setDomainState('namespace-storage', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-rbac') {
      setDomainState('cluster-rbac', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-storage') {
      setDomainState('cluster-storage', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-config') {
      setDomainState('cluster-config', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-crds') {
      setDomainState('cluster-crds', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'cluster-custom') {
      setDomainState('cluster-custom', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
      return;
    }

    if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.reportScope,
      }));
    }
  }

  private setStreamError(subscription: StreamSubscription, message: string): void {
    const key = `${subscription.clusterId}::${subscription.domain}::${subscription.storeScope}`;
    const attempts = (this.consecutiveErrors.get(key) ?? 0) + 1;
    this.consecutiveErrors.set(key, attempts);
    const isTerminal = attempts >= STREAM_ERROR_NOTIFY_THRESHOLD;

    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.reportScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-network') {
      setDomainState('namespace-network', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-custom') {
      setDomainState('namespace-custom', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-helm') {
      setDomainState('namespace-helm', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-rbac') {
      setDomainState('cluster-rbac', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-storage') {
      setDomainState('cluster-storage', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-config') {
      setDomainState('cluster-config', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-crds') {
      setDomainState('cluster-crds', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'cluster-custom') {
      setDomainState('cluster-custom', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-autoscaling') {
      setDomainState('namespace-autoscaling', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-quotas') {
      setDomainState('namespace-quotas', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'namespace-storage') {
      setDomainState('namespace-storage', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    } else if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.reportScope,
      }));
    }

    if (isTerminal) {
      this.notifyStreamError(subscription.clusterId, message);
    }
  }

  private clearStreamError(clusterId: string): void {
    const keys = Array.from(this.lastNotifiedErrors.keys()).filter((key) =>
      key.startsWith(clusterId)
    );
    keys.forEach((key) => this.lastNotifiedErrors.delete(key));
    const errorKeys = Array.from(this.consecutiveErrors.keys()).filter((key) =>
      key.startsWith(clusterId)
    );
    errorKeys.forEach((key) => this.consecutiveErrors.delete(key));
  }

  private clearAllStreamErrors(): void {
    this.lastNotifiedErrors.clear();
    this.consecutiveErrors.clear();
  }

  private notifyStreamError(clusterId: string, message: string): void {
    const key = `${clusterId}::resource-stream`;
    if (this.lastNotifiedErrors.get(key) === message) {
      return;
    }
    this.lastNotifiedErrors.set(key, message);
    errorHandler.handle(new Error(message), {
      source: 'resource-stream',
    });
  }

  private stopAll(reset: boolean): void {
    const subscriptions = Array.from(this.subscriptions.values());
    subscriptions.forEach((subscription) => this.unsubscribe(subscription, reset));
    this.subscriptions.clear();
    this.connection?.close();
    this.connection = null;
    this.lastNotifiedErrors.clear();
    this.consecutiveErrors.clear();
    this.streamTelemetry.clear();
    this.clearPendingUnsubscribes();
  }
}

const fetchSnapshotForSubscription = async (
  subscription: StreamSubscription
): Promise<{ snapshot?: Snapshot<any>; notModified: boolean }> => {
  const { snapshot, notModified } = await fetchSnapshot(subscription.domain, {
    scope: subscription.storeScope,
  });
  return { snapshot, notModified };
};

export const resourceStreamManager = new ResourceStreamManager();
