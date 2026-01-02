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
  NamespaceConfigSnapshotPayload,
  NamespaceConfigSummary,
  NamespaceRBACSnapshotPayload,
  NamespaceRBACSummary,
  NamespaceWorkloadSnapshotPayload,
  NamespaceWorkloadSummary,
  PodSnapshotEntry,
  PodSnapshotPayload,
} from '../types';
import { buildClusterScopeList, parseClusterScope } from '../clusterScope';
import { errorHandler } from '@utils/errorHandler';
import { eventBus, type AppEvents } from '@/core/events';
import { logAppInfo, logAppWarn } from '@/core/logging/appLogClient';

const RESOURCE_STREAM_PATH = '/api/v2/stream/resources';
const UPDATE_COALESCE_MS = 150;
const RESYNC_COOLDOWN_MS = 1000;
const RESYNC_MESSAGE = 'Stream resyncing';
const STREAM_ERROR_NOTIFY_THRESHOLD = 3;
const DRIFT_SAMPLE_SIZE = 5;

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
};

type ServerMessage = {
  type: StreamMessageType;
  clusterId?: string;
  clusterName?: string;
  domain?: string;
  scope?: string;
  resourceVersion?: string;
  uid?: string;
  name?: string;
  namespace?: string;
  kind?: string;
  row?: unknown;
  error?: string;
};

type UpdateMessage = ServerMessage & { domain: ResourceDomain; scope: string };

const isSupportedDomain = (value: string | undefined): value is ResourceDomain =>
  value === 'pods' ||
  value === 'namespace-workloads' ||
  value === 'namespace-config' ||
  value === 'namespace-rbac' ||
  value === 'nodes';

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
    case 'namespace-rbac':
      return normalizeNamespaceScope(scope, 'namespace-rbac');
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

type StreamSubscription = {
  key: string;
  domain: ResourceDomain;
  storeScope: string;
  normalizedScope: string;
  clusterId: string;
  clusterName?: string;
  resourceVersion?: bigint;
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

class ResourceStreamConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private closed = false;
  private paused = false;
  private reconnectTimer: number | null = null;
  private pendingMessages: ClientMessage[] = [];

  constructor(
    private readonly clusterId: string,
    private readonly clusterScope: string,
    private readonly manager: ResourceStreamManager
  ) {}

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
      url.searchParams.set('scope', this.clusterScope);
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
    this.manager.handleConnectionOpen(this.clusterId);
    const pending = [...this.pendingMessages];
    this.pendingMessages = [];
    pending.forEach((message) => this.send(message));
  }

  private handleMessage(event: MessageEvent): void {
    this.manager.handleMessage(this.clusterId, event.data);
  }

  private handleError(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.manager.handleConnectionError(this.clusterId, message);
    this.scheduleReconnect();
  }

  private handleClose(message: string): void {
    if (this.closed || this.paused) {
      return;
    }
    this.manager.handleConnectionError(this.clusterId, message);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.paused) {
      return;
    }
    this.clearReconnect();
    const delay = Math.min(30_000, 1000 * Math.pow(2, this.attempt));
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
  private connections = new Map<string, ResourceStreamConnection>();
  private lastNotifiedErrors = new Map<string, string>();
  private consecutiveErrors = new Map<string, number>();
  private suspendedForVisibility = false;
  private streamTelemetry = new Map<string, StreamTelemetry>();

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
    const subscription = this.ensureSubscription(domain, scope);
    await this.resyncSubscription(subscription, 'initial');
  }

  stop(domain: ResourceDomain, scope: string, reset = false): void {
    const subscription = this.getSubscription(domain, scope);
    if (!subscription) {
      return;
    }
    this.unsubscribe(subscription, reset);
  }

  async refreshOnce(domain: ResourceDomain, scope: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    const subscription = this.ensureSubscription(domain, scope);
    await this.resyncSubscription(subscription, 'manual refresh', true);
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
    const normalizedScope = parsed.scope.trim();
    const subscription = this.subscriptions.get(
      this.subscriptionKey(clusterId, parsed.domain, normalizedScope)
    );
    if (!subscription) {
      return;
    }

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
        void this.resyncSubscription(subscription, parsed.error || 'complete');
        return;
      case MESSAGE_TYPES.error:
        void this.resyncSubscription(subscription, parsed.error || 'stream error', true);
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
    // Log when the websocket is connected so it is clear streaming is active.
    logInfo(`[resource-stream] connection open clusterId=${clusterId}`);
    this.clearStreamError(clusterId);
    this.subscriptions.forEach((subscription) => {
      if (subscription.clusterId !== clusterId) {
        return;
      }
      this.subscribe(subscription);
    });
  }

  handleConnectionError(clusterId: string, message: string): void {
    this.subscriptions.forEach((subscription) => {
      if (subscription.clusterId !== clusterId) {
        return;
      }
      this.markResyncing(subscription);
      void this.resyncSubscription(subscription, message);
    });
  }

  private suspendForVisibility(): void {
    if (this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = true;
    this.connections.forEach((connection) => connection.pause());
  }

  private resumeFromVisibility(): void {
    if (!this.suspendedForVisibility) {
      return;
    }
    this.suspendedForVisibility = false;
    this.connections.forEach((connection) => connection.resume());
    this.subscriptions.forEach((subscription) => {
      this.markResyncing(subscription);
      void this.resyncSubscription(subscription, 'visibility resume');
    });
  }

  private ensureSubscription(domain: ResourceDomain, scope: string): StreamSubscription {
    const parsed = parseClusterScope(scope);
    if (!parsed.clusterId || parsed.isMultiCluster) {
      throw new Error('Resource streaming requires a single cluster scope');
    }
    const normalizedScope = normalizeResourceScope(domain, parsed.scope);
    const storeScope = buildClusterScopeList([parsed.clusterId], normalizedScope);
    const key = this.subscriptionKey(parsed.clusterId, domain, normalizedScope);

    const existing = this.subscriptions.get(key);
    if (existing) {
      return existing;
    }

    const subscription: StreamSubscription = {
      key,
      domain,
      storeScope,
      normalizedScope,
      clusterId: parsed.clusterId,
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

  private getSubscription(domain: ResourceDomain, scope: string): StreamSubscription | null {
    const parsed = parseClusterScope(scope);
    if (!parsed.clusterId || parsed.isMultiCluster) {
      return null;
    }
    const normalizedScope = normalizeResourceScope(domain, parsed.scope);
    return (
      this.subscriptions.get(this.subscriptionKey(parsed.clusterId, domain, normalizedScope)) ??
      null
    );
  }

  private subscriptionKey(clusterId: string, domain: ResourceDomain, scope: string): string {
    return `${clusterId}::${domain}::${scope}`;
  }

  private getConnection(clusterId: string): ResourceStreamConnection {
    const existing = this.connections.get(clusterId);
    if (existing) {
      return existing;
    }
    const clusterScope = buildClusterScopeList([clusterId], '');
    const connection = new ResourceStreamConnection(clusterId, clusterScope, this);
    this.connections.set(clusterId, connection);
    void connection.connect();
    return connection;
  }

  private subscribe(subscription: StreamSubscription): void {
    const connection = this.getConnection(subscription.clusterId);
    subscription.pendingReset = true;
    connection.send({
      type: MESSAGE_TYPES.request,
      clusterId: subscription.clusterId,
      domain: subscription.domain,
      scope: subscription.storeScope,
      resourceVersion: subscription.resourceVersion
        ? subscription.resourceVersion.toString()
        : undefined,
    });
  }

  private unsubscribe(subscription: StreamSubscription, reset: boolean): void {
    const connection = this.connections.get(subscription.clusterId);
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

    const remaining = Array.from(this.subscriptions.values()).some(
      (item) => item.clusterId === subscription.clusterId
    );
    if (!remaining && connection) {
      connection.close();
      this.connections.delete(subscription.clusterId);
    }
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

    subscription.updateQueue.push(message);
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
      setScopedDomainState('pods', subscription.storeScope, (previous) => {
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
          scope: subscription.storeScope,
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
          scope: subscription.storeScope,
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
          scope: subscription.storeScope,
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
          scope: subscription.storeScope,
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
          scope: subscription.storeScope,
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
      setScopedDomainState('pods', subscription.storeScope, (previous) => ({
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
        scope: subscription.storeScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      const payload = snapshot.payload as NamespaceWorkloadSnapshotPayload;
      setDomainState('namespace-workloads', (previous) => ({
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
        scope: subscription.storeScope,
      }));
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
        scope: subscription.storeScope,
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
        scope: subscription.storeScope,
      }));
      this.clearStreamError(subscription.clusterId);
      return;
    }

    if (subscription.domain === 'nodes') {
      const payload = snapshot.payload as ClusterNodeSnapshotPayload;
      setDomainState('nodes', (previous) => ({
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
        scope: subscription.storeScope,
      }));
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
    } else if (subscription.domain === 'namespace-rbac') {
      snapshotKeys = buildRBACKeySet(
        snapshot.payload as NamespaceRBACSnapshotPayload | null | undefined,
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
      scope: subscription.storeScope,
      reason: details.reason,
      streamCount: details.streamCount,
      snapshotCount: details.snapshotCount,
      missingKeys: details.missingKeys,
      extraKeys: details.extraKeys,
    });

    logWarning(
      `[resource-stream] drift detected domain=${subscription.domain} scope=${subscription.storeScope} reason=${details.reason} streamCount=${details.streamCount} snapshotCount=${details.snapshotCount} missingKeys=${details.missingKeys} extraKeys=${details.extraKeys}`
    );
  }

  private markResyncComplete(subscription: StreamSubscription): void {
    const now = Date.now();
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.storeScope, (previous) => ({
        ...previous,
        status: previous.data ? 'ready' : 'idle',
        error: null,
        lastUpdated: previous.lastUpdated ?? now,
        lastAutoRefresh: now,
        scope: subscription.storeScope,
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
        scope: subscription.storeScope,
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
        scope: subscription.storeScope,
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
        scope: subscription.storeScope,
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
        scope: subscription.storeScope,
      }));
      this.clearStreamError(subscription.clusterId);
    }
  }

  private markResyncing(subscription: StreamSubscription): void {
    const message = RESYNC_MESSAGE;
    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.storeScope, (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.storeScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.storeScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.storeScope,
      }));
      return;
    }

    if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.storeScope,
      }));
      return;
    }

    if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => ({
        ...previous,
        status: previous.data ? 'updating' : 'initialising',
        error: message,
        scope: subscription.storeScope,
      }));
    }
  }

  private setStreamError(subscription: StreamSubscription, message: string): void {
    const key = `${subscription.clusterId}::${subscription.domain}::${subscription.storeScope}`;
    const attempts = (this.consecutiveErrors.get(key) ?? 0) + 1;
    this.consecutiveErrors.set(key, attempts);
    const isTerminal = attempts >= STREAM_ERROR_NOTIFY_THRESHOLD;

    if (subscription.domain === 'pods') {
      setScopedDomainState('pods', subscription.storeScope, (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.storeScope,
      }));
    } else if (subscription.domain === 'namespace-workloads') {
      setDomainState('namespace-workloads', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.storeScope,
      }));
    } else if (subscription.domain === 'namespace-config') {
      setDomainState('namespace-config', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.storeScope,
      }));
    } else if (subscription.domain === 'namespace-rbac') {
      setDomainState('namespace-rbac', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.storeScope,
      }));
    } else if (subscription.domain === 'nodes') {
      setDomainState('nodes', (previous) => ({
        ...previous,
        status: isTerminal ? 'error' : previous.status,
        error: isTerminal ? message : previous.error,
        scope: subscription.storeScope,
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
    this.connections.forEach((connection) => connection.close());
    this.connections.clear();
    this.lastNotifiedErrors.clear();
    this.consecutiveErrors.clear();
    this.streamTelemetry.clear();
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
