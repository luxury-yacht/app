/**
 * frontend/src/core/capabilities/permissionStore.ts
 *
 * Core permission store backed by the QueryPermissions Wails endpoint.
 * Replaces the CapabilityEntry store with a PermissionEntry result map.
 * Manages periodic refresh, diagnostics, and event bus integration.
 */

import { eventBus, type UnsubscribeFn } from '@/core/events';
import type {
  PermissionEntry,
  PermissionKey,
  PermissionMap,
  PermissionSpec,
  PermissionStatus,
  PermissionQueryDiagnostics,
} from './permissionTypes';
import {
  ALL_NAMESPACE_PERMISSIONS,
  CLUSTER_PERMISSIONS,
  type PermissionSpecList,
} from './permissionSpecs';

// ---------------------------------------------------------------------------
// QueryPermissions RPC
// ---------------------------------------------------------------------------

// Locally-typed wrapper for the QueryPermissions Wails endpoint. Uses the
// same runtime call path as generated Wails bindings (window.go.backend.App).
// Once `wails generate module` is run against the Go backend that exposes
// QueryPermissions, the generated App.js will include the real binding and
// this wrapper can be replaced with:
//   import { QueryPermissions } from '@wailsjs/go/backend/App';

interface QueryPayloadItem {
  id: string;
  clusterId: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
}

interface QueryResponseResult {
  id: string;
  clusterId: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
  allowed: boolean;
  source: string;
  reason: string;
  error: string;
}

interface QueryResponseDiagnostics {
  key: string;
  clusterId: string;
  namespace?: string;
  method: string;
  ssrrIncomplete: boolean;
  ssrrRuleCount: number;
  ssarFallbackCount: number;
  checkCount: number;
}

interface QueryPermissionsResponse {
  results: QueryResponseResult[];
  diagnostics: QueryResponseDiagnostics[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const window: {
  go: Record<string, Record<string, Record<string, (...args: any[]) => any>>>;
};

function QueryPermissions(queries: QueryPayloadItem[]): Promise<QueryPermissionsResponse> {
  return window['go']['backend']['App']['QueryPermissions'](queries);
}

// ---------------------------------------------------------------------------
// Permission key (must match the existing format from bootstrap.ts)
// ---------------------------------------------------------------------------

/**
 * Builds the canonical permission key. Format:
 *   `${clusterId}|${resourceKind}|${verb}|${namespace_or_'cluster'}|${subresource_or_''}`
 * All fields lowercased. Null namespace becomes literal string 'cluster'.
 * Empty subresource becomes ''.
 */
export const getPermissionKey = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null
): PermissionKey => {
  const cid = (clusterId || currentClusterId || '').toLowerCase();
  const rk = resourceKind.toLowerCase();
  const v = verb.toLowerCase();
  const ns = namespace ? namespace.toLowerCase() : 'cluster';
  const sub = subresource ? subresource.toLowerCase() : '';
  return `${cid}|${rk}|${v}|${ns}|${sub}`;
};

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

type Listener = () => void;

interface PendingSpecItem {
  spec: PermissionSpec;
  feature: string;
  clusterId: string;
  namespace: string | null;
}

let currentClusterId = '';
let version = 0;

const permissionResults = new Map<string, PermissionEntry>();
let permissionMap: PermissionMap = new Map();
const permissionListeners = new Set<Listener>();

const diagnosticsMap = new Map<string, PermissionQueryDiagnostics>();
let diagnosticsSnapshot: PermissionQueryDiagnostics[] = [];
let diagnosticsDirty = true;
const diagnosticsListeners = new Set<Listener>();

// Tracks which (clusterId|namespace) pairs have in-flight queries to
// avoid duplicate Wails RPC round-trips.
const inFlightQueries = new Set<string>();

// Pending specs for queries that haven't returned yet.
// Used to build "pending" PermissionStatus entries before results arrive.
const pendingSpecs = new Map<string, PendingSpecItem[]>();

// Timestamps for periodic refresh.
const lastQueryTimestamps = new Map<string, number>();
let refreshTimerId: ReturnType<typeof setInterval> | null = null;

let unsubChanging: UnsubscribeFn | null = null;
let unsubChanged: UnsubscribeFn | null = null;

// ---------------------------------------------------------------------------
// PermissionStatus builder
// ---------------------------------------------------------------------------

/**
 * Builds a PermissionStatus from a materialized PermissionEntry.
 * source "error" maps to entry.status 'error' with error populated;
 * all other sources map to 'ready'.
 */
export const makePermissionStatus = (
  key: PermissionKey,
  entry: PermissionEntry
): PermissionStatus => {
  const isError = entry.source === 'error';
  return {
    id: key,
    allowed: entry.allowed,
    pending: false,
    reason: entry.reason,
    error: isError ? entry.reason : null,
    source: entry.source as PermissionStatus['source'],
    descriptor: { ...entry.descriptor },
    feature: entry.feature,
    entry: {
      status: isError ? 'error' : 'ready',
    },
  };
};

/**
 * Builds a loading PermissionStatus for an in-flight query.
 */
const makePendingStatus = (
  key: PermissionKey,
  descriptor: PermissionEntry['descriptor'],
  feature: string | null
): PermissionStatus => ({
  id: key,
  allowed: false,
  pending: true,
  reason: null,
  error: null,
  source: null,
  descriptor: { ...descriptor },
  feature,
  entry: { status: 'loading' },
});

// ---------------------------------------------------------------------------
// Permission map rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuilds the public PermissionMap from materialized results and pending specs.
 */
const rebuildPermissionMap = (): void => {
  const newMap: PermissionMap = new Map();

  // Materialized results first.
  for (const [key, entry] of permissionResults) {
    newMap.set(key, makePermissionStatus(key, entry));
  }

  // Pending specs (not yet returned from backend) — only if not already in results.
  for (const [, items] of pendingSpecs) {
    for (const { spec, feature, clusterId, namespace } of items) {
      const key = getPermissionKey(
        spec.kind,
        spec.verb,
        namespace,
        spec.subresource ?? null,
        clusterId
      );
      if (!newMap.has(key)) {
        newMap.set(
          key,
          makePendingStatus(
            key,
            {
              clusterId,
              resourceKind: spec.kind,
              verb: spec.verb,
              namespace,
              subresource: spec.subresource ?? null,
            },
            feature
          )
        );
      }
    }
  }

  permissionMap = newMap;
};

/**
 * Increments the store version, rebuilds the permission map, and fires listeners.
 */
const notify = (): void => {
  version++;
  rebuildPermissionMap();
  for (const listener of permissionListeners) {
    listener();
  }
};

// ---------------------------------------------------------------------------
// QueryPermissions integration
// ---------------------------------------------------------------------------

interface QueryBatchItem {
  id: string;
  clusterId: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
  feature: string;
}

/**
 * Expands permission spec lists into individual query batch items.
 * The feature string is carried from the list onto each item.
 */
const buildBatch = (
  specLists: PermissionSpecList[],
  namespace: string | null,
  clusterId: string
): QueryBatchItem[] => {
  const items: QueryBatchItem[] = [];
  for (const list of specLists) {
    for (const spec of list.specs) {
      const key = getPermissionKey(
        spec.kind,
        spec.verb,
        namespace,
        spec.subresource ?? null,
        clusterId
      );
      items.push({
        id: key,
        clusterId,
        resourceKind: spec.kind,
        verb: spec.verb,
        namespace: namespace ?? '',
        subresource: spec.subresource ?? '',
        name: '',
        feature: list.feature,
      });
    }
  }
  return items;
};

/**
 * Maps backend response results into the permissionResults map.
 */
const applyResults = (results: QueryResponseResult[], batchItems: QueryBatchItem[]): void => {
  const featureByKey = new Map<string, string>();
  for (const item of batchItems) {
    featureByKey.set(item.id, item.feature);
  }

  for (const r of results) {
    const key = r.id;
    const feature = featureByKey.get(key) ?? null;
    const entry: PermissionEntry = {
      allowed: r.allowed,
      source: r.source || 'error',
      reason: r.reason || r.error || null,
      descriptor: {
        clusterId: r.clusterId,
        resourceKind: r.resourceKind,
        verb: r.verb,
        namespace: r.namespace || null,
        subresource: r.subresource || null,
      },
      feature,
    };
    permissionResults.set(key, entry);
  }
};

/**
 * Query permissions for a namespace's full spec set.
 * Called from NamespaceContext, NsResourcesContext, and ObjectPanel.
 */
export const queryNamespacePermissions = (namespace: string, clusterId: string | null): void => {
  const cid = clusterId || currentClusterId;
  if (!cid || !namespace) return;

  const queryKey = `${cid}|${namespace.toLowerCase()}`;
  if (inFlightQueries.has(queryKey)) return;

  const batch = buildBatch(ALL_NAMESPACE_PERMISSIONS, namespace, cid);
  if (batch.length === 0) return;

  const batchSpecs: PermissionSpec[] = batch.map((item) => ({
    kind: item.resourceKind,
    verb: item.verb,
    subresource: item.subresource || undefined,
  }));

  // Register pending specs for immediate UI feedback.
  pendingSpecs.set(
    queryKey,
    batch.map((item) => ({
      spec: {
        kind: item.resourceKind,
        verb: item.verb,
        subresource: item.subresource || undefined,
      },
      feature: item.feature,
      clusterId: cid,
      namespace,
    }))
  );
  notify();

  inFlightQueries.add(queryKey);
  const startTime = Date.now();
  beginQueryDiagnostics(queryKey, cid, namespace, 'ssrr', batchSpecs, batch.length);

  const payload: QueryPayloadItem[] = batch.map((item) => ({
    id: item.id,
    clusterId: item.clusterId,
    resourceKind: item.resourceKind,
    verb: item.verb,
    namespace: item.namespace,
    subresource: item.subresource,
    name: item.name,
  }));

  // QueryPermissions returns { results, diagnostics } — the backend
  // populates real SSRR metadata (incomplete, ruleCount, fallbackCount).
  QueryPermissions(payload)
    .then((response) => {
      applyResults(response.results, batch);
      // Use backend-provided diagnostics instead of fabricating locally.
      const nsDiag = response.diagnostics?.find((d) => d.key === queryKey);
      completeQueryDiagnostics(
        queryKey,
        true,
        null,
        startTime,
        nsDiag?.ssarFallbackCount,
        nsDiag?.ssrrRuleCount,
        nsDiag?.ssrrIncomplete,
        nsDiag?.method as 'ssrr' | 'ssar' | undefined
      );
    })
    .catch((err) => {
      const queryError = String(err);
      for (const item of batch) {
        permissionResults.set(item.id, {
          allowed: false,
          source: 'error',
          reason: queryError,
          descriptor: {
            clusterId: item.clusterId,
            resourceKind: item.resourceKind,
            verb: item.verb,
            namespace: item.namespace || null,
            subresource: item.subresource || null,
          },
          feature: item.feature,
        });
      }
      completeQueryDiagnostics(queryKey, false, queryError, startTime);
    })
    .finally(() => {
      inFlightQueries.delete(queryKey);
      pendingSpecs.delete(queryKey);
      recordQueryTimestamp(queryKey);
      notify();
    });
};

/**
 * Query cluster-scoped permissions (routed to SSAR by backend).
 * Called on cluster connect. CLUSTER_PERMISSIONS is already a
 * PermissionSpecList[] so it's passed directly to buildBatch.
 */
export const queryClusterPermissions = (clusterId: string): void => {
  const queryKey = `${clusterId}|__cluster__`;
  if (inFlightQueries.has(queryKey)) return;

  const batch = buildBatch(CLUSTER_PERMISSIONS, null, clusterId);
  if (batch.length === 0) return;

  const batchSpecs: PermissionSpec[] = batch.map((item) => ({
    kind: item.resourceKind,
    verb: item.verb,
    subresource: item.subresource || undefined,
  }));

  pendingSpecs.set(
    queryKey,
    batch.map((item) => ({
      spec: {
        kind: item.resourceKind,
        verb: item.verb,
        subresource: item.subresource || undefined,
      },
      feature: item.feature,
      clusterId,
      namespace: null,
    }))
  );
  notify();

  inFlightQueries.add(queryKey);
  const startTime = Date.now();
  // Cluster-scoped always routes to SSAR.
  beginQueryDiagnostics(queryKey, clusterId, null, 'ssar', batchSpecs, batch.length);

  const payload: QueryPayloadItem[] = batch.map((item) => ({
    id: item.id,
    clusterId: item.clusterId,
    resourceKind: item.resourceKind,
    verb: item.verb,
    namespace: item.namespace,
    subresource: item.subresource,
    name: item.name,
  }));

  QueryPermissions(payload)
    .then((response) => {
      applyResults(response.results, batch);
      const nsDiag = response.diagnostics?.find((d) => d.key === queryKey);
      completeQueryDiagnostics(
        queryKey,
        true,
        null,
        startTime,
        nsDiag?.ssarFallbackCount,
        nsDiag?.ssrrRuleCount,
        nsDiag?.ssrrIncomplete,
        nsDiag?.method as 'ssrr' | 'ssar' | undefined
      );
    })
    .catch((err) => {
      const queryError = String(err);
      for (const item of batch) {
        permissionResults.set(item.id, {
          allowed: false,
          source: 'error',
          reason: queryError,
          descriptor: {
            clusterId: item.clusterId,
            resourceKind: item.resourceKind,
            verb: item.verb,
            namespace: null,
            subresource: item.subresource || null,
          },
          feature: item.feature,
        });
      }
      completeQueryDiagnostics(queryKey, false, queryError, startTime);
    })
    .finally(() => {
      inFlightQueries.delete(queryKey);
      pendingSpecs.delete(queryKey);
      recordQueryTimestamp(queryKey);
      notify();
    });
};

// ---------------------------------------------------------------------------
// Public API for React hooks (useSyncExternalStore)
// ---------------------------------------------------------------------------

export const subscribeUserPermissions = (listener: Listener): (() => void) => {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
};

export const getUserPermissionMap = (): PermissionMap => permissionMap;

export const getStoreVersion = (): number => version;

// ---------------------------------------------------------------------------
// Diagnostics — populates PermissionQueryDiagnostics per (clusterId|namespace)
// ---------------------------------------------------------------------------

const notifyDiagnostics = (): void => {
  diagnosticsDirty = true;
  for (const listener of diagnosticsListeners) {
    listener();
  }
};

/**
 * Called before a QueryPermissions RPC to record in-flight state.
 */
const beginQueryDiagnostics = (
  queryKey: string,
  clusterId: string,
  namespace: string | null,
  method: 'ssrr' | 'ssar',
  specs: PermissionSpec[],
  checkCount: number
): void => {
  let diag = diagnosticsMap.get(queryKey);
  if (!diag) {
    diag = {
      key: queryKey,
      clusterId,
      namespace: namespace ?? undefined,
      method,
      pendingCount: 0,
      inFlightCount: 0,
      totalChecks: 0,
      consecutiveFailureCount: 0,
      lastDescriptors: [],
    };
    diagnosticsMap.set(queryKey, diag);
  }
  diag.pendingCount += checkCount;
  diag.inFlightCount += checkCount;
  diag.inFlightStartedAt = diag.inFlightStartedAt ?? Date.now();
  diag.totalChecks = checkCount;
  diag.lastDescriptors = specs;
  diag.method = method;
  notifyDiagnostics();
};

/**
 * Called after a QueryPermissions RPC completes (success or error).
 * The method parameter overwrites the provisional value from begin —
 * for SSRR-fetch-failure batches the backend reports "ssar" even
 * though begin optimistically set "ssrr".
 */
const completeQueryDiagnostics = (
  queryKey: string,
  success: boolean,
  errorMessage: string | null,
  startTime: number,
  ssarFallbackCount?: number,
  ssrrRuleCount?: number,
  ssrrIncomplete?: boolean,
  method?: 'ssrr' | 'ssar'
): void => {
  const diag = diagnosticsMap.get(queryKey);
  if (!diag) return;

  const now = Date.now();
  diag.pendingCount = 0;
  diag.inFlightCount = 0;
  diag.inFlightStartedAt = undefined;
  diag.lastRunDurationMs = now - startTime;
  diag.lastRunCompletedAt = now;
  diag.lastResult = success ? 'success' : 'error';
  diag.lastError = errorMessage;
  diag.consecutiveFailureCount = success ? 0 : diag.consecutiveFailureCount + 1;
  if (ssarFallbackCount !== undefined) diag.ssarFallbackCount = ssarFallbackCount;
  if (ssrrRuleCount !== undefined) diag.ssrrRuleCount = ssrrRuleCount;
  if (ssrrIncomplete !== undefined) diag.ssrrIncomplete = ssrrIncomplete;
  if (method) diag.method = method;
  notifyDiagnostics();
};

export const subscribeDiagnostics = (listener: Listener): (() => void) => {
  diagnosticsListeners.add(listener);
  return () => {
    diagnosticsListeners.delete(listener);
  };
};

export const getPermissionQueryDiagnosticsSnapshot = (): PermissionQueryDiagnostics[] => {
  if (diagnosticsDirty) {
    diagnosticsSnapshot = Array.from(diagnosticsMap.values());
    diagnosticsDirty = false;
  }
  return diagnosticsSnapshot;
};

// ---------------------------------------------------------------------------
// Periodic Refresh (TTL-driven re-query)
// ---------------------------------------------------------------------------

/** Match the backend permission cache TTL. */
const PERMISSION_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Tracks when each (clusterId|namespace) pair was last queried. */
const lastQueryTimestamps = new Map<string, number>();

/**
 * Called in .finally() of each query to record the timestamp.
 */
const recordQueryTimestamp = (queryKey: string): void => {
  lastQueryTimestamps.set(queryKey, Date.now());
};

/**
 * Periodic refresh loop. Re-queries any (clusterId|namespace) pair
 * whose last query is older than the refresh interval. The backend's
 * stale-while-revalidate cache serves stale results immediately while
 * the re-fetch runs, so the UI never flashes to pending.
 */
const refreshExpiredQueries = (): void => {
  const now = Date.now();
  for (const [queryKey, timestamp] of lastQueryTimestamps) {
    if (now - timestamp < PERMISSION_REFRESH_INTERVAL_MS) continue;

    // Parse the query key to determine namespace vs cluster.
    const pipeIdx = queryKey.indexOf('|');
    if (pipeIdx < 0) continue;
    const clusterId = queryKey.slice(0, pipeIdx);
    const namespace = queryKey.slice(pipeIdx + 1);

    if (namespace === '__cluster__') {
      queryClusterPermissions(clusterId);
    } else {
      queryNamespacePermissions(namespace, clusterId);
    }
  }
};

const startRefreshTimer = (): void => {
  if (refreshTimerId) return;
  refreshTimerId = setInterval(refreshExpiredQueries, PERMISSION_REFRESH_INTERVAL_MS);
};

const stopRefreshTimer = (): void => {
  if (refreshTimerId) {
    clearInterval(refreshTimerId);
    refreshTimerId = null;
  }
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Initializes the permission store for a cluster. Sets the current
 * cluster ID, queries cluster-scoped permissions, starts the refresh
 * timer, and subscribes to event bus lifecycle events.
 */
export const initializePermissionStore = (clusterId: string): void => {
  currentClusterId = clusterId;
  queryClusterPermissions(clusterId);
  startRefreshTimer();

  if (!unsubChanging) {
    unsubChanging = eventBus.on('kubeconfig:changing', () => {
      resetPermissionStore();
    });
  }
  if (!unsubChanged) {
    unsubChanged = eventBus.on('kubeconfig:changed', () => {
      if (currentClusterId) {
        queryClusterPermissions(currentClusterId);
      }
    });
  }
};

/**
 * Updates the module-level cluster ID used as a fallback in getPermissionKey.
 */
export const setCurrentClusterId = (clusterId: string): void => {
  currentClusterId = clusterId;
};

/**
 * Clears all permission state, stops the refresh timer, and notifies listeners.
 */
export const resetPermissionStore = (): void => {
  permissionResults.clear();
  pendingSpecs.clear();
  inFlightQueries.clear();
  lastQueryTimestamps.clear();
  diagnosticsMap.clear();
  diagnosticsDirty = true;
  permissionMap = new Map();
  stopRefreshTimer();
  notify();
};

/**
 * Full reset including listeners and event bus unsubs. For tests only.
 */
export const __resetForTests = (): void => {
  resetPermissionStore();
  currentClusterId = '';
  version = 0;
  permissionListeners.clear();
  diagnosticsListeners.clear();
  if (unsubChanging) {
    unsubChanging();
    unsubChanging = null;
  }
  if (unsubChanged) {
    unsubChanged();
    unsubChanged = null;
  }
};
