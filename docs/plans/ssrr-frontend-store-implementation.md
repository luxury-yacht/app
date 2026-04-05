# SSRR Frontend Permission Store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `CapabilityEntry` / store / bootstrap machinery with a lightweight `PermissionEntry` store backed by the new `QueryPermissions` Wails endpoint, preserving the public `PermissionMap` / `PermissionStatus` / `getPermissionKey` API surface.

**Architecture:** New `permissionStore.ts` replaces `store.ts` as the single source of truth. The store holds `Map<string, PermissionEntry>` and builds `PermissionStatus` objects on change. `bootstrap.ts` is rewritten to call `QueryPermissions` instead of `EvaluateCapabilities`. Permission spec lists (`WORKLOAD_PERMISSIONS`, `CLUSTER_PERMISSIONS`, etc.) replace the `CapabilityDefinition` catalogs. `useCapabilities()` calls `QueryPermissions` immediately on mount.

**Tech Stack:** TypeScript, React (useSyncExternalStore), Wails RPC

**Design doc:** `docs/plans/ssrr-permissions-design.md`

**Depends on:** `docs/plans/ssrr-backend-implementation.md` (Plan 1 — backend `QueryPermissions` endpoint must be deployed first, or mocked for development)

---

## File Structure

| File | Responsibility |
|---|---|
| **Create:** `frontend/src/core/capabilities/permissionTypes.ts` | `PermissionSpec`, `PermissionEntry`, `PermissionStatus`, `PermissionQueryDiagnostics` types |
| **Create:** `frontend/src/core/capabilities/permissionSpecs.ts` | `WORKLOAD_PERMISSIONS`, `CLUSTER_PERMISSIONS`, `CONFIG_PERMISSIONS`, etc. — static permission spec lists |
| **Create:** `frontend/src/core/capabilities/permissionStore.ts` | `PermissionEntry` result map, `PermissionStatus` builder, `queryNamespacePermissions`, `queryClusterPermissions`, event bus subscriptions, refresh/TTL, diagnostics |
| **Create:** `frontend/src/core/capabilities/permissionStore.test.ts` | Store tests |
| **Modify:** `frontend/src/core/capabilities/hooks.ts` | Rewrite `useCapabilities()` — immediate `QueryPermissions`, `namedResults` map; rewrite `useCapabilityDiagnostics` to delegate to `subscribeDiagnostics`/`getPermissionQueryDiagnosticsSnapshot` from the new store, returning `PermissionQueryDiagnostics[]` (same shape the DiagnosticsPanel expects via `useSyncExternalStore`) |
| **Modify:** `frontend/src/core/capabilities/hooks.test.tsx` | Update tests for new hook behavior |
| **Modify:** `frontend/src/core/capabilities/bootstrap.ts` | Rewrite to use new store — `initializeUserPermissionsBootstrap` calls `queryClusterPermissions`, event bus subs call new store |
| **Modify:** `frontend/src/core/capabilities/bootstrap.test.ts` | Update tests |
| **Modify:** `frontend/src/core/capabilities/index.ts` | Update exports — add new public API, keep backward-compatible re-exports during migration |

---

### Task 1: New Types

**Files:**
- Create: `frontend/src/core/capabilities/permissionTypes.ts`

- [ ] **Step 1: Create the types file**

```typescript
// frontend/src/core/capabilities/permissionTypes.ts

/**
 * A lightweight permission check descriptor. Static data — no store state.
 */
export interface PermissionSpec {
  kind: string; // Resource kind (e.g., "Deployment", "Pod")
  verb: string; // RBAC verb (e.g., "list", "delete", "patch")
  subresource?: string; // Optional subresource (e.g., "scale", "portforward")
}

/**
 * A stored permission check result from the backend.
 */
export interface PermissionEntry {
  allowed: boolean;
  /** "ssrr" | "ssar" | "denied" | "error" — from PermissionResult.Source */
  source: string;
  /** Denial reason or error message, for UI display */
  reason: string | null;
  /** Query metadata — needed to populate PermissionStatus for consumers */
  descriptor: {
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  /** Which permission list produced this query (e.g., "workloads", "cluster") */
  feature: string | null;
}

/**
 * The public permission status exposed via useUserPermissions().
 * Preserves the contract that existing consumers depend on.
 */
export interface PermissionStatus {
  id: string; // permission key (same as map key)
  allowed: boolean;
  pending: boolean;
  reason: string | null;
  error: string | null;
  source: 'ssrr' | 'ssar' | 'denied' | 'error' | null; // null when pending
  descriptor: {
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  feature: string | null; // from the PermissionSpec list
  entry: {
    status: 'loading' | 'ready' | 'error';
  };
}

/**
 * Per-namespace batch diagnostics for the diagnostics panel.
 */
export interface PermissionQueryDiagnostics {
  key: string; // "clusterId|namespace" or "clusterId|cluster"
  clusterId?: string;
  namespace?: string; // null for cluster-scoped SSAR batch
  method: 'ssrr' | 'ssar'; // how this batch was resolved
  pendingCount: number;
  inFlightCount: number;
  inFlightStartedAt?: number;
  lastRunDurationMs?: number;
  lastRunCompletedAt?: number;
  lastError?: string | null;
  lastResult?: 'success' | 'error';
  totalChecks: number;
  consecutiveFailureCount: number;
  ssrrIncomplete?: boolean;
  ssrrRuleCount?: number;
  ssarFallbackCount?: number;
  lastDescriptors: PermissionSpec[];
}

export type PermissionKey = string;
export type PermissionMap = Map<PermissionKey, PermissionStatus>;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit src/core/capabilities/permissionTypes.ts`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/capabilities/permissionTypes.ts
git commit -m "feat(capabilities): add new permission types for SSRR store

PermissionSpec, PermissionEntry, PermissionStatus, and
PermissionQueryDiagnostics types. These replace CapabilityEntry,
CapabilityResult, and CapabilityNamespaceDiagnostics."
```

---

### Task 2: Permission Spec Lists

**Files:**
- Create: `frontend/src/core/capabilities/permissionSpecs.ts`

- [ ] **Step 1: Create the spec lists**

These replace `NAMESPACE_CAPABILITY_SPECS` (from `NsResourcesContext.tsx`) and `CLUSTER_CAPABILITIES` (from `catalog.ts`). The `feature` field is carried on the list, not on individual specs, since `PermissionEntry.feature` is derived from which list the spec came from.

```typescript
// frontend/src/core/capabilities/permissionSpecs.ts
import type { PermissionSpec } from './permissionTypes';

// Feature names must match diagnosticsPanelConfig.ts feature string constants.
export interface PermissionSpecList {
  feature: string;
  specs: PermissionSpec[];
}

export const WORKLOAD_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace workloads',
  specs: [
    { kind: 'Deployment', verb: 'list' },
    { kind: 'Deployment', verb: 'patch' },
    { kind: 'Deployment', verb: 'delete' },
    { kind: 'Deployment', verb: 'update', subresource: 'scale' },
    { kind: 'StatefulSet', verb: 'list' },
    { kind: 'StatefulSet', verb: 'patch' },
    { kind: 'StatefulSet', verb: 'delete' },
    { kind: 'StatefulSet', verb: 'update', subresource: 'scale' },
    { kind: 'ReplicaSet', verb: 'update', subresource: 'scale' },
    { kind: 'DaemonSet', verb: 'list' },
    { kind: 'DaemonSet', verb: 'patch' },
    { kind: 'DaemonSet', verb: 'delete' },
    { kind: 'Job', verb: 'list' },
    { kind: 'Job', verb: 'delete' },
    { kind: 'CronJob', verb: 'list' },
    { kind: 'CronJob', verb: 'delete' },
    { kind: 'Pod', verb: 'list' },
    { kind: 'Pod', verb: 'delete' },
    { kind: 'Pod', verb: 'get', subresource: 'log' },
    { kind: 'Pod', verb: 'create', subresource: 'portforward' },
  ],
};

export const CONFIG_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace config',
  specs: [
    { kind: 'ConfigMap', verb: 'list' },
    { kind: 'ConfigMap', verb: 'delete' },
    { kind: 'Secret', verb: 'list' },
    { kind: 'Secret', verb: 'delete' },
  ],
};

export const NETWORK_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace network',
  specs: [
    { kind: 'Service', verb: 'list' },
    { kind: 'Service', verb: 'delete' },
    { kind: 'Ingress', verb: 'list' },
    { kind: 'Ingress', verb: 'delete' },
    { kind: 'NetworkPolicy', verb: 'list' },
    { kind: 'NetworkPolicy', verb: 'delete' },
    { kind: 'EndpointSlice', verb: 'list' },
    { kind: 'EndpointSlice', verb: 'delete' },
  ],
};

export const RBAC_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace RBAC',
  specs: [
    { kind: 'Role', verb: 'list' },
    { kind: 'Role', verb: 'delete' },
    { kind: 'RoleBinding', verb: 'list' },
    { kind: 'RoleBinding', verb: 'delete' },
    { kind: 'ServiceAccount', verb: 'list' },
    { kind: 'ServiceAccount', verb: 'delete' },
  ],
};

export const STORAGE_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace storage',
  specs: [
    { kind: 'PersistentVolumeClaim', verb: 'list' },
    { kind: 'PersistentVolumeClaim', verb: 'delete' },
  ],
};

export const AUTOSCALING_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace autoscaling',
  specs: [
    { kind: 'HorizontalPodAutoscaler', verb: 'list' },
    { kind: 'HorizontalPodAutoscaler', verb: 'delete' },
  ],
};

export const QUOTA_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace quotas',
  specs: [
    { kind: 'ResourceQuota', verb: 'list' },
    { kind: 'ResourceQuota', verb: 'delete' },
    { kind: 'LimitRange', verb: 'list' },
    { kind: 'LimitRange', verb: 'delete' },
    { kind: 'PodDisruptionBudget', verb: 'list' },
    { kind: 'PodDisruptionBudget', verb: 'delete' },
  ],
};

export const EVENT_PERMISSIONS: PermissionSpecList = {
  feature: 'Namespace events',
  specs: [{ kind: 'Event', verb: 'list' }],
};

/** All namespace-scoped permission spec lists. */
export const ALL_NAMESPACE_PERMISSIONS: PermissionSpecList[] = [
  WORKLOAD_PERMISSIONS,
  CONFIG_PERMISSIONS,
  NETWORK_PERMISSIONS,
  RBAC_PERMISSIONS,
  STORAGE_PERMISSIONS,
  AUTOSCALING_PERMISSIONS,
  QUOTA_PERMISSIONS,
  EVENT_PERMISSIONS,
];

/** Cluster-scoped: QueryPermissions routes these to SSAR automatically. */
export const CLUSTER_PERMISSIONS: PermissionSpecList = {
  feature: 'Cluster',
  specs: [
    { kind: 'Namespace', verb: 'list' },
    { kind: 'Namespace', verb: 'create' },
    { kind: 'Namespace', verb: 'delete' },
    { kind: 'Node', verb: 'list' },
    { kind: 'Node', verb: 'get' },
    { kind: 'Node', verb: 'patch' },
    { kind: 'Node', verb: 'delete' },
    { kind: 'PersistentVolume', verb: 'list' },
    { kind: 'PersistentVolume', verb: 'update' },
    { kind: 'PersistentVolume', verb: 'delete' },
    { kind: 'StorageClass', verb: 'list' },
    { kind: 'StorageClass', verb: 'update' },
    { kind: 'StorageClass', verb: 'delete' },
    { kind: 'IngressClass', verb: 'list' },
    { kind: 'MutatingWebhookConfiguration', verb: 'list' },
    { kind: 'ValidatingWebhookConfiguration', verb: 'list' },
    { kind: 'ClusterRole', verb: 'list' },
    { kind: 'ClusterRole', verb: 'update' },
    { kind: 'ClusterRole', verb: 'delete' },
    { kind: 'ClusterRoleBinding', verb: 'list' },
    { kind: 'ClusterRoleBinding', verb: 'update' },
    { kind: 'ClusterRoleBinding', verb: 'delete' },
    { kind: 'CustomResourceDefinition', verb: 'list' },
    { kind: 'CustomResourceDefinition', verb: 'update' },
    { kind: 'CustomResourceDefinition', verb: 'delete' },
    { kind: 'Event', verb: 'list' },
  ],
};
```

- [ ] **Step 2: Verify the feature strings match `diagnosticsPanelConfig.ts`**

Run: `cd /Volumes/git/luxury-yacht/app && grep -n "feature" frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`

Cross-reference the feature strings in `CLUSTER_FEATURE_MAP` and `NAMESPACE_FEATURE_MAP` against the `feature` values above. Fix any mismatches.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/capabilities/permissionSpecs.ts
git commit -m "feat(capabilities): add static permission spec lists

Replace NAMESPACE_CAPABILITY_SPECS and CLUSTER_CAPABILITIES with
flat PermissionSpec arrays. Feature strings match diagnosticsPanelConfig.ts."
```

---

### Task 3: Permission Store

**Files:**
- Create: `frontend/src/core/capabilities/permissionStore.ts`
- Create: `frontend/src/core/capabilities/permissionStore.test.ts`

This is the core of the migration — the new store that replaces `store.ts` and most of `bootstrap.ts`.

- [ ] **Step 1: Write failing tests for the permission store**

```typescript
// frontend/src/core/capabilities/permissionStore.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@wailsjs/go/backend/App', () => ({
  QueryPermissions: vi.fn(),
}));

import { QueryPermissions } from '@wailsjs/go/backend/App';
const QueryPermissionsMock = vi.mocked(QueryPermissions);

import {
  getPermissionKey,
  makePermissionStatus,
} from './permissionStore';
import type { PermissionEntry } from './permissionTypes';

describe('getPermissionKey', () => {
  it('builds a pipe-delimited lowercase key', () => {
    const key = getPermissionKey('Deployment', 'delete', 'default', null, 'cluster-1');
    expect(key).toBe('cluster-1|deployment|delete|default|');
  });

  it('uses "cluster" for null namespace', () => {
    const key = getPermissionKey('Node', 'list', null, null, 'cluster-1');
    expect(key).toBe('cluster-1|node|list|cluster|');
  });

  it('includes subresource', () => {
    const key = getPermissionKey('Deployment', 'update', 'default', 'scale', 'cluster-1');
    expect(key).toBe('cluster-1|deployment|update|default|scale');
  });
});

describe('makePermissionStatus', () => {
  it('builds ready status from a definitive entry', () => {
    const entry: PermissionEntry = {
      allowed: true,
      source: 'ssrr',
      reason: null,
      descriptor: {
        clusterId: 'c1',
        resourceKind: 'Pod',
        verb: 'list',
        namespace: 'default',
        subresource: null,
      },
      feature: 'Namespace workloads',
    };
    const status = makePermissionStatus('c1|pod|list|default|', entry);
    expect(status.allowed).toBe(true);
    expect(status.pending).toBe(false);
    expect(status.source).toBe('ssrr');
    expect(status.entry.status).toBe('ready');
    expect(status.error).toBeNull();
    expect(status.descriptor.clusterId).toBe('c1');
    expect(status.feature).toBe('Namespace workloads');
  });

  it('builds error status with error field', () => {
    const entry: PermissionEntry = {
      allowed: false,
      source: 'error',
      reason: 'connection refused',
      descriptor: {
        clusterId: 'c1',
        resourceKind: 'Pod',
        verb: 'list',
        namespace: 'default',
        subresource: null,
      },
      feature: null,
    };
    const status = makePermissionStatus('key', entry);
    expect(status.allowed).toBe(false);
    expect(status.pending).toBe(false);
    expect(status.source).toBe('error');
    expect(status.entry.status).toBe('error');
    expect(status.error).toBe('connection refused');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/core/capabilities/permissionStore.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement the permission store**

```typescript
// frontend/src/core/capabilities/permissionStore.ts
import { QueryPermissions } from '@wailsjs/go/backend/App';
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
// Permission key (must match the existing format from bootstrap.ts:makePermissionKey)
// ---------------------------------------------------------------------------

export const getPermissionKey = (
  resourceKind: string,
  verb: string,
  namespace?: string | null,
  subresource?: string | null,
  clusterId?: string | null,
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
// avoid duplicate calls. The backend singleflight handles concurrency
// at the API level; this avoids redundant Wails RPC round-trips.
const inFlightQueries = new Set<string>();

// Pending specs for namespaces that haven't been queried yet.
// Used to build "pending" PermissionStatus entries before results arrive.
const pendingSpecs = new Map<string, Array<{ spec: PermissionSpec; feature: string; clusterId: string; namespace: string | null }>>();

let unsubChanging: UnsubscribeFn | null = null;
let unsubChanged: UnsubscribeFn | null = null;

// ---------------------------------------------------------------------------
// PermissionStatus builder
// ---------------------------------------------------------------------------

export const makePermissionStatus = (key: PermissionKey, entry: PermissionEntry): PermissionStatus => {
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

const makePendingStatus = (
  key: PermissionKey,
  descriptor: PermissionEntry['descriptor'],
  feature: string | null,
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

const rebuildPermissionMap = (): void => {
  const newMap: PermissionMap = new Map();

  // Materialized results.
  for (const [key, entry] of permissionResults) {
    newMap.set(key, makePermissionStatus(key, entry));
  }

  // Pending specs (not yet returned from backend).
  for (const [, items] of pendingSpecs) {
    for (const { spec, feature, clusterId, namespace } of items) {
      const key = getPermissionKey(spec.kind, spec.verb, namespace, spec.subresource ?? null, clusterId);
      if (!newMap.has(key)) {
        newMap.set(key, makePendingStatus(key, {
          clusterId,
          resourceKind: spec.kind,
          verb: spec.verb,
          namespace,
          subresource: spec.subresource ?? null,
        }, feature));
      }
    }
  }

  permissionMap = newMap;
};

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

const buildBatch = (
  specLists: PermissionSpecList[],
  namespace: string | null,
  clusterId: string,
): QueryBatchItem[] => {
  const items: QueryBatchItem[] = [];
  for (const list of specLists) {
    for (const spec of list.specs) {
      const key = getPermissionKey(spec.kind, spec.verb, namespace, spec.subresource ?? null, clusterId);
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

const applyResults = (
  results: Array<{ id: string; clusterId: string; resourceKind: string; verb: string; namespace: string; subresource: string; name: string; allowed: boolean; source: string; reason: string; error: string }>,
  batchItems: QueryBatchItem[],
): void => {
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
export const queryNamespacePermissions = (
  namespace: string,
  clusterId: string | null,
): void => {
  const cid = clusterId || currentClusterId;
  if (!cid || !namespace) return;

  const queryKey = `${cid}|${namespace.toLowerCase()}`;
  if (inFlightQueries.has(queryKey)) return;

  const batch = buildBatch(ALL_NAMESPACE_PERMISSIONS, namespace, cid);
  if (batch.length === 0) return;

  const batchSpecs = batch.map(item => ({
    kind: item.resourceKind, verb: item.verb, subresource: item.subresource || undefined,
  }));

  // Register pending specs for immediate UI feedback.
  pendingSpecs.set(queryKey, batch.map(item => ({
    spec: { kind: item.resourceKind, verb: item.verb, subresource: item.subresource || undefined },
    feature: item.feature,
    clusterId: cid,
    namespace,
  })));
  notify();

  inFlightQueries.add(queryKey);
  const startTime = Date.now();
  beginQueryDiagnostics(queryKey, cid, namespace, 'ssrr', batchSpecs, batch.length);

  const payload = batch.map(item => ({
    id: item.id,
    clusterId: item.clusterId,
    resourceKind: item.resourceKind,
    verb: item.verb,
    namespace: item.namespace,
    subresource: item.subresource,
    name: item.name,
  }));

  let queryError: string | null = null;

  // QueryPermissions returns { results, diagnostics } — the backend
  // populates real SSRR metadata (incomplete, ruleCount, fallbackCount).
  QueryPermissions(payload)
    .then((response) => {
      applyResults(response.results, batch);
      // Use backend-provided diagnostics instead of fabricating locally.
      const nsDiag = response.diagnostics?.find(d => d.key === queryKey);
      completeQueryDiagnostics(
        queryKey, true, null, startTime,
        nsDiag?.ssarFallbackCount,
        nsDiag?.ssrrRuleCount,
        nsDiag?.ssrrIncomplete,
        nsDiag?.method as 'ssrr' | 'ssar' | undefined,
      );
    })
    .catch((err) => {
      queryError = String(err);
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
 * Called on cluster connect.
 */
export const queryClusterPermissions = (clusterId: string): void => {
  const batch = buildBatch([CLUSTER_PERMISSIONS], null, clusterId);
  if (batch.length === 0) return;

  const queryKey = `${clusterId}|__cluster__`;
  if (inFlightQueries.has(queryKey)) return;

  const batchSpecs = batch.map(item => ({
    kind: item.resourceKind, verb: item.verb, subresource: item.subresource || undefined,
  }));

  pendingSpecs.set(queryKey, batch.map(item => ({
    spec: { kind: item.resourceKind, verb: item.verb, subresource: item.subresource || undefined },
    feature: item.feature,
    clusterId,
    namespace: null,
  })));
  notify();

  inFlightQueries.add(queryKey);
  const startTime = Date.now();
  beginQueryDiagnostics(queryKey, clusterId, null, 'ssar', batchSpecs, batch.length);

  const payload = batch.map(item => ({
    id: item.id,
    clusterId: item.clusterId,
    resourceKind: item.resourceKind,
    verb: item.verb,
    namespace: item.namespace,
    subresource: item.subresource,
    name: item.name,
  }));

  let queryError: string | null = null;

  QueryPermissions(payload)
    .then((response) => {
      applyResults(response.results, batch);
      const nsDiag = response.diagnostics?.find(d => d.key === queryKey);
      completeQueryDiagnostics(
        queryKey, true, null, startTime,
        nsDiag?.ssarFallbackCount,
        nsDiag?.ssrrRuleCount,
        nsDiag?.ssrrIncomplete,
        nsDiag?.method as 'ssrr' | 'ssar' | undefined,
      );
    })
    .catch((err) => {
      queryError = String(err);
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
  return () => permissionListeners.delete(listener);
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
  checkCount: number,
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
 */
const completeQueryDiagnostics = (
  queryKey: string,
  success: boolean,
  errorMessage: string | null,
  startTime: number,
  ssarFallbackCount?: number,
  ssrrRuleCount?: number,
  ssrrIncomplete?: boolean,
  /** Backend-reported method — overwrites the provisional value from
   *  beginQueryDiagnostics. For SSRR-fetch-failure batches the backend
   *  reports "ssar" even though begin optimistically set "ssrr". */
  method?: 'ssrr' | 'ssar',
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
  diag.consecutiveFailureCount = success ? 0 : (diag.consecutiveFailureCount + 1);
  if (ssarFallbackCount !== undefined) diag.ssarFallbackCount = ssarFallbackCount;
  if (ssrrRuleCount !== undefined) diag.ssrrRuleCount = ssrrRuleCount;
  if (ssrrIncomplete !== undefined) diag.ssrrIncomplete = ssrrIncomplete;
  if (method) diag.method = method;
  notifyDiagnostics();
};

export const subscribeDiagnostics = (listener: Listener): (() => void) => {
  diagnosticsListeners.add(listener);
  return () => diagnosticsListeners.delete(listener);
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

/** Match the existing permission cache TTL from the backend. */
const PERMISSION_REFRESH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Tracks when each (clusterId|namespace) pair was last queried.
 * Used to schedule periodic re-queries on the TTL interval.
 */
const lastQueryTimestamps = new Map<string, number>();

let refreshTimerId: ReturnType<typeof setInterval> | null = null;

/**
 * Called after every successful QueryPermissions response. Records
 * the query timestamp for the given key.
 */
const recordQueryTimestamp = (queryKey: string): void => {
  lastQueryTimestamps.set(queryKey, Date.now());
};

/**
 * Periodic refresh loop. Runs on PERMISSION_REFRESH_INTERVAL_MS.
 * Re-queries any (clusterId|namespace) pair whose last query is
 * older than the refresh interval. The backend's stale-while-revalidate
 * cache serves stale results immediately while the re-fetch runs,
 * so the UI never flashes to pending. Past the stale grace window,
 * the backend blocks on a fresh fetch or falls through to SSAR.
 */
const refreshExpiredQueries = (): void => {
  const now = Date.now();
  for (const [queryKey, timestamp] of lastQueryTimestamps) {
    if (now - timestamp < PERMISSION_REFRESH_INTERVAL_MS) continue;

    // Parse the query key to determine namespace vs cluster.
    const parts = queryKey.split('|');
    if (parts.length < 2) continue;
    const clusterId = parts[0];
    const namespace = parts[1];

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

export const setCurrentClusterId = (clusterId: string): void => {
  currentClusterId = clusterId;
};

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

// Test helper
export const __resetForTests = (): void => {
  resetPermissionStore();
  currentClusterId = '';
  version = 0;
  permissionListeners.clear();
  diagnosticsListeners.clear();
  unsubChanging?.();
  unsubChanging = null;
  unsubChanged?.();
  unsubChanged = null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/core/capabilities/permissionStore.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/capabilities/permissionStore.ts frontend/src/core/capabilities/permissionStore.test.ts
git commit -m "feat(capabilities): add new permission store backed by QueryPermissions

Replaces the CapabilityEntry store with a PermissionEntry result map.
Calls QueryPermissions RPC instead of EvaluateCapabilities. Preserves
the getPermissionKey format and PermissionMap/PermissionStatus contract.
Includes queryNamespacePermissions and queryClusterPermissions triggers."
```

---

### Task 4: Rewrite `useCapabilities` Hook

**Files:**
- Modify: `frontend/src/core/capabilities/hooks.ts`

- [ ] **Step 1: Rewrite the hook**

The key changes:
1. Replace `registerAdHocCapabilities` + `ensureCapabilityEntries` + `requestCapabilities` with a direct `QueryPermissions` call in the `useEffect`.
2. Add `namedResults` map for name-qualified descriptors.
3. Route results: `Name` non-empty → `namedResults`; `Name` empty → public store.

The full implementation depends on the exact current state of `hooks.ts`. The hook must:
- Call `QueryPermissions` immediately on mount/descriptor change (not deferred to a batch)
- Store named results in a hook-local `Map<string, PermissionEntry>` keyed by descriptor `id`
- Expose `getState(id)` that reads `namedResults` first, then falls back to the public permission map
- Preserve `UseCapabilitiesResult` interface shape

- [ ] **Step 2: Run existing hook tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/core/capabilities/hooks.test.tsx`
Expected: Tests that depend on old store internals will need updating; tests that check the public API shape should pass.

- [ ] **Step 3: Update hook tests for new behavior**

Update mocks to use `QueryPermissions` instead of `EvaluateCapabilities`. Update assertions to match the new `PermissionStatus` shape.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/capabilities/hooks.ts frontend/src/core/capabilities/hooks.test.tsx
git commit -m "feat(capabilities): rewrite useCapabilities with direct QueryPermissions

Hook calls QueryPermissions immediately on mount/descriptor change.
Named-resource results stored in hook-local namedResults map.
getState(id) reads namedResults first, falls back to public map."
```

---

### Task 5: Rewrite `useCapabilityDiagnostics` Hook

**Files:**
- Modify: `frontend/src/core/capabilities/hooks.ts`

The current `useCapabilityDiagnostics` (hooks.ts:174-179) delegates to
the old store's `subscribeDiagnostics` / `getCapabilityDiagnosticsSnapshot`
and returns `CapabilityNamespaceDiagnostics[]`. The new implementation
delegates to the new store and returns `PermissionQueryDiagnostics[]`.

The hook keeps the same export name (`useCapabilityDiagnostics`) so
`DiagnosticsPanel.tsx` continues to import it unchanged. The return
type changes from `CapabilityNamespaceDiagnostics[]` to
`PermissionQueryDiagnostics[]`, but the shapes share all fields that
DiagnosticsPanel reads (`key`, `namespace`, `pendingCount`,
`inFlightCount`, `lastRunDurationMs`, `lastRunCompletedAt`, `lastError`,
`lastResult`, `totalChecks`, `consecutiveFailureCount`,
`lastDescriptors`). The new type adds `method`, `ssrrIncomplete`,
`ssrrRuleCount`, `ssarFallbackCount`.

- [ ] **Step 1: Rewrite the diagnostics hook**

Replace the `useCapabilityDiagnostics` implementation in `hooks.ts`:

```typescript
import {
  subscribeDiagnostics,
  getPermissionQueryDiagnosticsSnapshot,
} from './permissionStore';
import type { PermissionQueryDiagnostics } from './permissionTypes';

export const useCapabilityDiagnostics = (): PermissionQueryDiagnostics[] =>
  useSyncExternalStore(
    subscribeDiagnostics,
    getPermissionQueryDiagnosticsSnapshot,
    getPermissionQueryDiagnosticsSnapshot
  );
```

- [ ] **Step 2: Update the diagnostics hook test**

In `hooks.test.tsx`, update the test for `useCapabilityDiagnostics` to
mock the new store functions instead of the old ones:

```typescript
vi.mock('./permissionStore', () => ({
  subscribeDiagnostics: vi.fn((cb) => { /* ... */ return () => {}; }),
  getPermissionQueryDiagnosticsSnapshot: vi.fn(() => []),
}));
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/capabilities/hooks.ts frontend/src/core/capabilities/hooks.test.tsx
git commit -m "feat(capabilities): rewrite useCapabilityDiagnostics for new store

Delegates to subscribeDiagnostics/getPermissionQueryDiagnosticsSnapshot
from permissionStore. Returns PermissionQueryDiagnostics[] with new
SSRR-specific fields (method, ssrrIncomplete, ssrrRuleCount,
ssarFallbackCount). Export name preserved for DiagnosticsPanel compat."
```

---

### Task 6: Rewrite Bootstrap

**Files:**
- Modify: `frontend/src/core/capabilities/bootstrap.ts`

- [ ] **Step 1: Rewrite `initializeUserPermissionsBootstrap`**

The bootstrap now delegates to the permission store:
1. `setCurrentClusterId(clusterId)`
2. `initializePermissionStore(clusterId)` — fires cluster bootstrap and sets up event bus subscriptions
3. Subscribe the `rebuildPermissionMap` listener to the store

The existing `refreshClusterPermissions`, `registerAdHocCapabilities`, `evaluateNamespacePermissions`, and the namespace descriptor registry become dead code and are removed.

The public API surface must be preserved during migration:
- `useUserPermissions()` → delegates to the new store's `subscribeUserPermissions` / `getUserPermissionMap`
- `useUserPermission()` → single key lookup on the map
- `getPermissionKey()` → delegates to the new store
- `evaluateNamespacePermissions()` → delegates to `queryNamespacePermissions` (backward compat shim during migration)

- [ ] **Step 2: Run bootstrap tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/core/capabilities/bootstrap.test.ts`
Expected: Many tests will need updating since the internal mechanism changed.

- [ ] **Step 3: Update bootstrap tests**

Focus on the public contract:
- `getPermissionKey` returns the same format
- `useUserPermissions` returns a `PermissionMap` with correct shape
- `initializeUserPermissionsBootstrap` triggers cluster permission queries
- `kubeconfig:changing` clears the store
- `kubeconfig:changed` re-queries cluster permissions

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/capabilities/bootstrap.ts frontend/src/core/capabilities/bootstrap.test.ts
git commit -m "feat(capabilities): rewrite bootstrap to use new permission store

initializeUserPermissionsBootstrap delegates to initializePermissionStore.
evaluateNamespacePermissions delegates to queryNamespacePermissions.
Public API surface (useUserPermissions, getPermissionKey) preserved."
```

---

### Task 7: Update Index Exports

**Files:**
- Modify: `frontend/src/core/capabilities/index.ts`

- [ ] **Step 1: Add new exports, keep backward-compatible re-exports**

Add exports for:
- `queryNamespacePermissions` from `./permissionStore`
- `queryClusterPermissions` from `./permissionStore`
- `PermissionSpec`, `PermissionEntry`, `PermissionStatus` (new types) from `./permissionTypes`
- `PermissionQueryDiagnostics` from `./permissionTypes`
- `ALL_NAMESPACE_PERMISSIONS`, `CLUSTER_PERMISSIONS` from `./permissionSpecs`

Keep existing exports that are still used:
- `useCapabilities`, `useCapabilityDiagnostics` from `./hooks`
- `useUserPermissions`, `useUserPermission`, `getPermissionKey` from `./bootstrap` (which now delegates to store)
- `evaluateNamespacePermissions` from `./bootstrap` (backward compat shim)
- `initializeUserPermissionsBootstrap` from `./bootstrap`

Remove exports for dead code:
- `ensureNamespaceActionCapabilities`, `CapabilityActionId`, `RestartableOwnerKind` from `./actionPlanner`
- `registerAdHocCapabilities`, `registerNamespaceCapabilityDefinitions` from `./bootstrap`
- `ensureCapabilityEntries`, `requestCapabilities`, `snapshotEntries` from `./store`
- `CLUSTER_CAPABILITIES` from `./catalog`

- [ ] **Step 2: Verify the build**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: Type errors from consumers that import removed exports — these are addressed in Plan 3.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/core/capabilities/index.ts
git commit -m "feat(capabilities): update index exports for new permission store

Add queryNamespacePermissions, new types, spec lists.
Remove dead exports (actionPlanner, old store internals, old catalog)."
```

---

### Task 8: Run QC

- [ ] **Step 1: Run the prerelease QC suite**

Run: `cd /Volumes/git/luxury-yacht/app && mage qc:prerelease`
Expected: Frontend type errors from consumers that still import removed symbols — these are addressed in Plan 3.

- [ ] **Step 2: Note any issues for Plan 3**

---

## Summary

| Task | What it builds |
|---|---|
| 1 | New types: `PermissionSpec`, `PermissionEntry`, `PermissionStatus`, `PermissionQueryDiagnostics` |
| 2 | Static permission spec lists replacing `NAMESPACE_CAPABILITY_SPECS` and `CLUSTER_CAPABILITIES` |
| 3 | New permission store: result map, builder, query functions, diagnostics, periodic refresh |
| 4 | Rewritten `useCapabilities` hook with immediate `QueryPermissions` and `namedResults` routing |
| 5 | Rewritten `useCapabilityDiagnostics` hook delegating to new store |
| 6 | Rewritten bootstrap delegating to new store |
| 7 | Updated index.ts exports |
| 8 | QC gate |

**Next:** Plan 3 (Frontend Consumer Migration) migrates the call sites and removes dead code.
