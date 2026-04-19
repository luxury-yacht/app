/**
 * frontend/src/core/capabilities/permissionStore.ts
 *
 * Core permission store backed by the QueryPermissions Wails endpoint.
 * Replaces the CapabilityEntry store with a PermissionEntry result map.
 * Manages periodic refresh, diagnostics, and event bus integration.
 */

import { eventBus, type UnsubscribeFn } from '@/core/events';
import { resolveBuiltinGroupVersion } from '@/shared/constants/builtinGroupVersions';
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

/**
 * Resolve GVK for a permission lookup. When the caller supplied explicit
 * group/version they win (CRD callers must pass explicit values so two
 * CRDs sharing a Kind don't collide). Otherwise fall back to the
 * builtin lookup table so the spec-emit path and the lookup path agree
 * on the same key for built-in kinds without every caller having to
 * spell out group/version. See  and
 * frontend/src/shared/constants/builtinGroupVersions.ts.
 */
const resolvePermissionGVK = (
  resourceKind: string,
  group?: string | null,
  version?: string | null
): { group: string; version: string } => {
  const g = (group ?? '').trim();
  const ver = (version ?? '').trim();
  if (ver) {
    // Caller supplied a version — honour it verbatim (including empty
    // group for core/v1 resources). Required for CRDs and any caller
    // that wants to disambiguate a colliding Kind.
    return { group: g, version: ver };
  }
  const builtin = resolveBuiltinGroupVersion(resourceKind);
  if (builtin.version) {
    return { group: builtin.group ?? '', version: builtin.version };
  }
  return { group: g, version: ver };
};

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
  /**
   * API group for the target kind. Optional: when present alongside
   * `version`, the backend routes through the strict GVK resolver. When
   * absent, the backend falls back to kind-only resolution. This is what
   * lets the permission store disambiguate colliding CRDs (e.g. two
   * different DBInstance kinds).
   */
  group?: string;
  /** API version paired with `group`. */
  version?: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
}

interface QueryResponseResult {
  id: string;
  clusterId: string;
  group?: string;
  version?: string;
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
 *   `${clusterId}|${group}/${version}|${resourceKind}|${verb}|${namespace_or_'cluster'}|${subresource_or_''}`
 * All fields lowercased except group (case-sensitive in Kubernetes).
 * Group/version segment is included so two CRDs sharing a Kind get
 * distinct keys and don't silently clobber each other in the permission
 * cache. Null namespace becomes literal string 'cluster'. Empty
 * subresource becomes ''.
 */
export const getPermissionKey = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
  group?: string | null,
  version?: string | null
): PermissionKey => {
  const cid = (clusterId || currentClusterId || '').toLowerCase();
  // Auto-resolve built-in GVK when the caller didn't specify one, so
  // the key shape matches on both the spec-emit path (buildBatch) and
  // the lookup path (useUserPermission, getUserPermission) without
  // every caller having to pass `resolveBuiltinGroupVersion(kind)`
  // explicitly. CRD callers still win when they supply group/version.
  const { group: g, version: ver } = resolvePermissionGVK(resourceKind, group, version);
  const rk = resourceKind.toLowerCase();
  const v = verb.toLowerCase();
  const ns = namespace ? namespace.toLowerCase() : 'cluster';
  const sub = subresource ? subresource.toLowerCase() : '';
  return `${cid}|${g}/${ver}|${rk}|${v}|${ns}|${sub}`;
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
let permissionNotifyScheduled = false;
let permissionNotifyHandle: number | null = null;

const diagnosticsMap = new Map<string, PermissionQueryDiagnostics>();
let diagnosticsSnapshot: PermissionQueryDiagnostics[] = [];
let diagnosticsDirty = true;
const diagnosticsListeners = new Set<Listener>();
let diagnosticsNotifyScheduled = false;
let diagnosticsNotifyHandle: number | null = null;

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
    feature: entry.feature ?? undefined,
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
  feature: feature ?? undefined,
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
        clusterId,
        spec.group ?? null,
        spec.version ?? null
      );
      if (!newMap.has(key)) {
        newMap.set(
          key,
          makePendingStatus(
            key,
            {
              clusterId,
              group: spec.group ?? null,
              version: spec.version ?? null,
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
const flushPermissionListeners = (): void => {
  permissionNotifyScheduled = false;
  permissionNotifyHandle = null;
  for (const listener of permissionListeners) {
    listener();
  }
};

const schedulePermissionNotify = (): void => {
  if (permissionNotifyScheduled) {
    return;
  }
  permissionNotifyScheduled = true;
  // Deliver external-store notifications in a later task, not the current
  // render/commit turn. rAF was still too eager here and could trip React's
  // nested-update guard in large sessions with several permission subscribers.
  permissionNotifyHandle = setTimeout(() => {
    flushPermissionListeners();
  }, 0) as unknown as number;
};

const notify = (): void => {
  version++;
  rebuildPermissionMap();
  schedulePermissionNotify();
};

// ---------------------------------------------------------------------------
// QueryPermissions integration
// ---------------------------------------------------------------------------

interface QueryBatchItem {
  id: string;
  clusterId: string;
  group: string;
  version: string;
  resourceKind: string;
  verb: string;
  namespace: string;
  subresource: string;
  name: string;
  feature: string;
}

/**
 * Expands permission spec lists into individual query batch items.
 * The feature string is carried from the list onto each item. Specs
 * for built-in kinds typically leave group/version undefined; CRD specs
 * (or lazy queryKindPermissions calls) populate them so the backend can
 * disambiguate colliding kinds.
 */
const buildBatch = (
  specLists: PermissionSpecList[],
  namespace: string | null,
  clusterId: string
): QueryBatchItem[] => {
  const items: QueryBatchItem[] = [];
  for (const list of specLists) {
    for (const spec of list.specs) {
      // Resolve GVK at batch-build time so the backend receives a
      // non-empty apiVersion (app_permissions.go now rejects queries
      // with missing Version). Built-in kinds fall through to
      // resolveBuiltinGroupVersion; CRD specs supply explicit
      // group/version.
      const { group, version } = resolvePermissionGVK(spec.kind, spec.group, spec.version);
      const key = getPermissionKey(
        spec.kind,
        spec.verb,
        namespace,
        spec.subresource ?? null,
        clusterId,
        group,
        version
      );
      items.push({
        id: key,
        clusterId,
        group,
        version,
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
    const feature = featureByKey.get(key);
    const entry: PermissionEntry = {
      allowed: r.allowed,
      source: r.source || 'error',
      reason: r.reason || r.error || null,
      descriptor: {
        clusterId: r.clusterId,
        group: r.group || null,
        version: r.version || null,
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
export const queryNamespacePermissions = (
  namespace: string,
  clusterId: string | null,
  options?: { force?: boolean }
): void => {
  const cid = clusterId || currentClusterId;
  if (!cid || !namespace) return;

  const queryKey = `${cid}|${namespace.toLowerCase()}`;
  if (inFlightQueries.has(queryKey)) return;

  // Skip if we already have fresh results within the TTL window,
  // unless force is set. This prevents redundant re-queries when
  // the All Namespaces effect runs on every data update.
  if (!options?.force) {
    const lastQuery = lastQueryTimestamps.get(queryKey);
    if (lastQuery && Date.now() - lastQuery < PERMISSION_REFRESH_INTERVAL_MS) {
      return;
    }
  }

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
    group: item.group || undefined,
    version: item.version || undefined,
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
            group: item.group || null,
            version: item.version || null,
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
  if (!clusterId) return;

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
    group: item.group || undefined,
    version: item.version || undefined,
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
            group: item.group || null,
            version: item.version || null,
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

/**
 * Lazy-query permissions for a specific resource kind. Used for CRD custom
 * objects whose kinds aren't in the static permission spec lists. Queries
 * delete and patch verbs for the given kind. Results are cached under the
 * standard permission key format and reused by all objects of the same kind
 * in the same namespace.
 *
 * Designed for lazy/on-demand use (e.g., first context menu open on a CRD
 * object). The first call fires the query; subsequent calls for the same
 * kind+namespace within TTL are no-ops.
 *
 * `group` and `version` MUST be supplied by callers when known so the
 * backend can disambiguate colliding CRDs (e.g. two `DBInstance` kinds
 * from different operators). Without them, the backend falls back to its
 * legacy first-match-wins resolver and would silently check permission
 * against the wrong CRD.
 */
export const queryKindPermissions = (
  kind: string,
  namespace: string | null,
  clusterId: string | null,
  group?: string | null,
  version?: string | null
): void => {
  const cid = clusterId || currentClusterId;
  if (!cid || !kind) return;

  // Resolve GVK once: honour caller-supplied group/version (required for
  // CRDs) or fall back to the built-in lookup. The backend rejects
  // queries with missing Version, so every payload item must carry a
  // resolved version before we fire the RPC.
  const { group: groupVal, version: versionVal } = resolvePermissionGVK(kind, group, version);

  // Include group/version in the query key so per-CRD TTL skip works.
  // Two DBInstance CRDs from different groups must NOT share a query key.
  const ns = namespace ?? '';
  const gvSegment = `${groupVal}/${versionVal}`;
  const queryKey = `${cid}|${ns}|kind:${gvSegment}/${kind.toLowerCase()}`;
  if (inFlightQueries.has(queryKey)) return;

  const lastQuery = lastQueryTimestamps.get(queryKey);
  if (lastQuery && Date.now() - lastQuery < PERMISSION_REFRESH_INTERVAL_MS) {
    return;
  }

  const verbs = ['delete', 'patch'];
  const payload: QueryPayloadItem[] = verbs.map((verb) => ({
    id: getPermissionKey(kind, verb, namespace, null, cid, groupVal, versionVal),
    clusterId: cid,
    group: groupVal || undefined,
    version: versionVal || undefined,
    resourceKind: kind,
    verb,
    namespace: ns,
    subresource: '',
    name: '',
  }));

  const feature = namespace ? 'Namespace custom resources' : 'Cluster custom resources';

  // Register pending specs so the permission map immediately contains
  // pending entries. This lets the context menu show "Awaiting permissions"
  // on the first open rather than an empty action list.
  pendingSpecs.set(
    queryKey,
    verbs.map((verb) => ({
      spec: {
        kind,
        verb,
        group: groupVal || undefined,
        version: versionVal || undefined,
      },
      feature,
      clusterId: cid,
      namespace: namespace,
    }))
  );
  notify();

  inFlightQueries.add(queryKey);

  QueryPermissions(payload)
    .then((response) => {
      for (const r of response.results) {
        permissionResults.set(r.id, {
          allowed: r.allowed,
          source: r.source || 'error',
          reason: r.reason || r.error || null,
          descriptor: {
            clusterId: r.clusterId,
            group: r.group || null,
            version: r.version || null,
            resourceKind: r.resourceKind,
            verb: r.verb,
            namespace: r.namespace || null,
            subresource: r.subresource || null,
          },
          feature,
        });
      }
    })
    .catch(() => {
      // Silently fail — the permission just won't appear in the context menu.
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

const flushDiagnosticsListeners = (): void => {
  diagnosticsNotifyScheduled = false;
  diagnosticsNotifyHandle = null;
  for (const listener of diagnosticsListeners) {
    listener();
  }
};

const notifyDiagnostics = (): void => {
  diagnosticsDirty = true;
  if (diagnosticsNotifyScheduled) {
    return;
  }
  diagnosticsNotifyScheduled = true;
  // Match permission notifications: diagnostics subscribers also use
  // useSyncExternalStore, so keep them out of the current React turn.
  diagnosticsNotifyHandle = setTimeout(() => {
    flushDiagnosticsListeners();
  }, 0) as unknown as number;
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
  diag.lastDescriptors = specs.map((s) => ({
    resourceKind: s.kind,
    verb: s.verb,
    namespace: namespace ?? undefined,
    subresource: s.subresource,
  }));
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

/**
 * Called in .finally() of each query to record the timestamp.
 * Uses the module-level lastQueryTimestamps map declared above.
 */
const recordQueryTimestamp = (queryKey: string): void => {
  lastQueryTimestamps.set(queryKey, Date.now());
};

/** Stagger interval between namespace refreshes in All Namespaces sessions. */
const STAGGER_INTERVAL_MS = 500;

/**
 * Periodic refresh loop. Re-queries any (clusterId|namespace) pair
 * whose last query is older than the refresh interval. Namespace
 * refreshes are staggered by 500ms to avoid thundering herd when
 * many namespaces expire at once (common in All Namespaces sessions
 * where all namespaces were queried near-simultaneously).
 */
const refreshExpiredQueries = (): void => {
  const now = Date.now();
  const expired: Array<{ clusterId: string; namespace: string }> = [];

  for (const [queryKey, timestamp] of lastQueryTimestamps) {
    if (now - timestamp < PERMISSION_REFRESH_INTERVAL_MS) continue;

    const pipeIdx = queryKey.indexOf('|');
    if (pipeIdx < 0) continue;
    const clusterId = queryKey.slice(0, pipeIdx);
    const namespace = queryKey.slice(pipeIdx + 1);
    expired.push({ clusterId, namespace });
  }

  // Cluster-scoped refreshes fire immediately (small batch, no stagger).
  // Namespace-scoped refreshes are staggered.
  let staggerDelay = 0;
  for (const { clusterId, namespace } of expired) {
    if (namespace === '__cluster__') {
      queryClusterPermissions(clusterId);
    } else {
      if (staggerDelay === 0) {
        queryNamespacePermissions(namespace, clusterId, { force: true });
      } else {
        setTimeout(
          () => queryNamespacePermissions(namespace, clusterId, { force: true }),
          staggerDelay
        );
      }
      staggerDelay += STAGGER_INTERVAL_MS;
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
  if (permissionNotifyHandle != null) {
    clearTimeout(permissionNotifyHandle);
    permissionNotifyHandle = null;
    permissionNotifyScheduled = false;
  }
  if (diagnosticsNotifyHandle != null) {
    clearTimeout(diagnosticsNotifyHandle);
    diagnosticsNotifyHandle = null;
    diagnosticsNotifyScheduled = false;
  }
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
