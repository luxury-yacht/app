# SelfSubjectRulesReview Permission System

Replace per-check `SelfSubjectAccessReview` (SSAR) calls with per-namespace
`SelfSubjectRulesReview` (SSRR) calls. One API call per namespace returns all
rules for the current user; the backend matches permissions locally against
the cached rules.

## Problem

The current system fires ~70 individual SSAR requests per namespace to build
the permission map. Each is a separate HTTP round-trip to the Kubernetes API
server. This causes:

1. **Latency on namespace enter.** ~70 SSARs through 32 parallel workers means
   2-3 batches of API round-trips before context menu items appear.
2. **All Namespaces view is broken.** Every capability registration path bails
   out when the namespace is the synthetic "All Namespaces" value. Zero
   permissions are fetched. Permission-gated context menu items (Delete,
   Restart, Scale, Port Forward, Rollback) silently never appear.
3. **Excessive storage overhead.** Five layers of abstraction store ~1.4 KB per
   permission check. The UI reads two booleans (`allowed`, `pending`).

## Kubernetes API Background

### SelfSubjectAccessReview (SSAR)

Checks one specific action. Returns `allowed: true/false`. One API call per
verb/resource combination. Works with all authorizer modes.

### SelfSubjectRulesReview (SSRR)

Returns all rules the current user has in a given namespace. One API call.

Request: `{ spec: { namespace: "kube-system" } }`

Response:

```yaml
status:
  incomplete: false
  resourceRules:
    - verbs: ['get', 'list', 'watch']
      apiGroups: ['']
      resources: ['pods']
    - verbs: ['*']
      apiGroups: ['apps']
      resources: ['deployments']
  nonResourceRules: [...]
```

Key properties (verified against Kubernetes source):

- **Namespace is required.** Empty string returns `400 Bad Request`.
- **ClusterRoleBinding rules are included.** The RBAC rule resolver
  (`VisitRulesFor` in `pkg/registry/rbac/validation/rule.go`) processes
  ClusterRoleBindings unconditionally before namespace-scoped RoleBindings.
  Cluster-scoped resource permissions (Nodes, PVs, StorageClasses, etc.)
  granted via ClusterRoleBindings appear in any namespace's SSRR response.
- **`incomplete` flag.** Set to `true` if any authorizer in the chain doesn't
  support rule enumeration. Webhook authorizers return empty rules with
  `incomplete: true`. The union authorizer (`staging/.../union/union.go`)
  merges: RBAC rules are present and valid; `incomplete` is true because the
  webhook couldn't contribute.
- **Rules are additive.** If a rule appears, the permission is granted. Absence
  with `incomplete: false` means denied. Absence with `incomplete: true` means
  unknown.
- **Wildcard handling.** Rules may contain `"*"` in `apiGroups`, `resources`, or
  `verbs`, meaning "all."
- **Subresource encoding.** Verified in `ResourceRule` struct
  (`k8s.io/api/authorization/v1/types.go`): subresources are encoded in the
  `Resources` field as `"resource/subresource"` strings. Examples:
  `"pods/log"`, `"pods/portforward"`, `"deployments/scale"`. The wildcard
  `"*"` means "all resources in the specified apiGroups." `"*/foo"` means
  "subresource foo for all resources in the specified apiGroups."
- **SSRR creation is available to all authenticated users.** The
  `system:basic-user` ClusterRole grants `create` on both
  `selfsubjectaccessreviews` and `selfsubjectrulesreviews`, and is bound to
  `system:authenticated` via the RBAC bootstrap policy
  (`plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go`). An admin
  could delete or modify this binding; the bootstrap must handle a 403
  response (see Fallback).

### What managed clusters (EKS, GKE, AKS) return

These clusters typically chain RBAC + a webhook authorizer (for IAM identity
mapping). SSRR returns:

- The full set of RBAC-granted rules (resource permissions live here)
- `incomplete: true` (webhook authorizer can't enumerate)
- An evaluation error string from the webhook

The RBAC rules are valid and contain the resource-level permissions we need.
The webhook authorizer handles identity mapping, not fine-grained resource
authorization.

## Design

### Architecture Decision: All Matching on the Backend

SSRR rules use API group + plural resource name (e.g., `apiGroups: ["apps"]`,
`resources: ["deployments"]`). The frontend works with resource kinds (e.g.,
`"Deployment"`). Translating between them requires per-cluster GVR resolution,
which the backend already has via `getGVRForDependencies` in
`app_capabilities.go`. A static frontend mapping table cannot handle CRDs
(`NsViewCustom.tsx` passes arbitrary kinds from CRD instances).

All rule matching happens on the backend:

1. Backend fetches SSRR response, caches the raw rules per
   `(clusterId, namespace)`.
2. Frontend sends permission queries using `resourceKind` (same tuples it
   sends today).
3. Backend resolves kind → (apiGroup, pluralResource) using its GVR cache.
   For namespace-scoped resources: matches against the cached SSRR rules.
   For cluster-scoped resources (non-namespaced per GVR resolution):
   routes directly to SSAR (see Cluster-Scoped Permissions).
4. If a namespace-scoped query has no match and SSRR was `incomplete`, the
   backend fires a targeted SSAR inline before returning — transparent to
   the frontend.

This means:
- One implementation of matching logic, in Go, where K8s types are native.
- GVR resolution is always current (uses the live API discovery cache).
- CRDs work automatically.
- The `incomplete` fallback is invisible to the frontend — no pending state
  model needed for fallback items.
- Cluster-scoped checks are authorization-correct (SSAR, not SSRR).
- The frontend sends the same query shape it sends today and gets back
  booleans.

### Backend: `QueryPermissions` Endpoint

**New Wails endpoint replacing the primary permission flow:**

```go
type PermissionQuery struct {
    ID           string // Caller-supplied identifier, echoed in result
    ClusterId    string
    ResourceKind string
    Verb         string
    Namespace    string
    Subresource  string
    Name         string
}

type PermissionResult struct {
    ID           string // Caller-supplied, echoed back for correlation
    ClusterId    string
    ResourceKind string
    Verb         string
    Namespace    string
    Subresource  string
    Name         string
    Allowed      bool
    // Source indicates how the result was determined:
    // "ssrr" (matched cached rules), "ssar" (incomplete fallback or
    // cluster-scoped resource routed to SSAR), "denied" (no match,
    // complete rules), "error" (check failed).
    Source       string
    // Reason is the denial explanation from the K8s API (SSAR path)
    // or a human-readable "no matching rule" for SSRR denials. Populated
    // when Allowed is false and Source is not "error". Maps to
    // CheckResult.DeniedReason for SSAR results. Used by
    // ClusterResourcesManager to display "Insufficient permissions" or
    // a specific K8s reason string.
    Reason       string
    // Error is set only when the check itself failed (Source "error").
    // Not set for clean denials — use Reason for those.
    Error        string
}

func (a *App) QueryPermissions(checks []PermissionQuery) ([]PermissionResult, error)
```

For each check, the backend:

1. Resolves `resourceKind` → `(apiGroup, pluralResource)` via the GVR cache.
2. Determines resource scope: if the resolved resource is non-namespaced
   (cluster-scoped), routes directly to SSAR — returns the result with
   `source: "ssar"`. This avoids the false-positive risk of matching
   cluster-scoped resources against namespace SSRR rules (see
   Cluster-Scoped Permissions).
3. For namespace-scoped resources: looks up the cached SSRR rules for
   `(clusterId, namespace)`. If not cached, fetches SSRR and caches the
   result (singleflight-deduped).
4. Matches against the SSRR rules (apiGroup, resource, verb, subresource,
   resourceNames — with wildcard handling).
5. If matched: returns `allowed: true, source: "ssrr"`.
6. If not matched and SSRR `incomplete` is false: returns
   `allowed: false, source: "denied"`.
7. If not matched and SSRR `incomplete` is true: fires an individual SSAR
   for that specific check, returns the SSAR result with
   `source: "ssar"`.

**Error handling: per-item, never batch-level.** `QueryPermissions` never
returns a top-level error that fails the entire batch. Every check produces
a `PermissionResult`, even on failure:

- SSRR fetch fails for a namespace: each check targeting that namespace
  falls through to SSAR. If SSAR also fails, the individual result gets
  `allowed: false, source: "error", error: "..."`.
- GVR resolution fails for a resourceKind: that check gets
  `allowed: false, source: "error", error: "failed to resolve kind X"`.
- SSAR fallback fails for a specific check: that check gets
  `allowed: false, source: "error", error: "..."`.
- SSAR fallback fails for ALL checks in a sub-batch (triggers the
  `service.Evaluate()` top-level error): `QueryPermissions` catches the
  error and converts it to per-item `source: "error"` results. The
  batch-level return is still `([]PermissionResult, nil)`.

The frontend receives a complete result array with one entry per query,
regardless of partial failures. This is a deliberate departure from
`EvaluateCapabilities` / `service.go`, which returns a top-level error
when all checks fail (`service.go:200`). `QueryPermissions` absorbs that
error. A single bad namespace or unreachable cluster must not take down
the entire batch — especially in All Namespaces multi-cluster flows where
one cluster being unreachable should not hide permissions for all other
clusters.

**SSRR caching:** Cache the raw `SubjectRulesReviewStatus` per
`clusterId|namespace` with TTL + stale grace, matching the existing
backend SSAR cache policy (`backend/refresh/permissions/checker.go`):

- **Fresh:** Entry is within TTL → serve directly, no API call.
- **Stale (within grace window):** Entry is expired but within
  `TTL + staleGrace` → serve the stale rules immediately, trigger a
  background SSRR re-fetch. This is the stale-while-revalidate path.
- **Expired (past grace window):** Entry is older than `TTL + staleGrace`
  → discard the stale rules, fetch fresh SSRR synchronously. If the
  fetch fails, fall through to per-check SSAR (same as the `incomplete`
  path). **Stale rules are not served past the grace window** — this
  prevents revoked permissions from surviving indefinitely if SSRR
  refreshes keep failing.
- **Absent:** No entry exists → fetch SSRR synchronously.

Singleflight deduplicates concurrent requests for the same
`clusterId|namespace`. One cache entry per namespace replaces ~70
individual SSAR cache entries.

**Rule matching logic** (in Go):

- `apiGroups` matching: rule's apiGroups contains the target group, or `"*"`
- `resources` matching: rule's resources contains the target resource, or
  `"*"`. For subresource checks, also match against
  `"resource/subresource"` (exact) and `"*/subresource"` (wildcard
  resource with specific subresource). Note: `"resource/*"` is **not** a
  valid Kubernetes RBAC match form — the `ResourceMatches` function in
  `pkg/apis/rbac/helpers.go` supports only `"*"` (all), exact string,
  and `"*/subresource"`. Implementing `"resource/*"` would overgrant
  access relative to SSAR.
- `verbs` matching: rule's verbs contains the target verb, or `"*"`
- `resourceNames` matching: if rule's resourceNames is empty, all names
  match. If non-empty, only the listed names match.
- Multiple rules: union semantics — any matching rule grants access.

**Wildcard `"*"` and subresources:** Whether `resources: ["*"]` covers
subresources must be verified on a live cluster before implementation
(see Risk 3). If it does not, the matcher must synthesize subresource
coverage from `"*"` rules to match SSAR behavior.

**Keep `EvaluateCapabilities`** (the existing Wails SSAR batch endpoint)
as-is for any direct callers. It is not removed.

**Fallback calls `service.Evaluate()` directly, not the Wails endpoint.**
`QueryPermissions` calls the `capabilities.Service.Evaluate()` method
for SSAR fallback (both the `incomplete` path and cluster-scoped
routing). It does **not** call the Wails-bound `EvaluateCapabilities`,
which would be unusual (Wails endpoint calling Wails endpoint) and would
propagate the top-level error from `service.go:200` ("all capability
checks failed") in a way that violates the per-item error contract.

Instead, `QueryPermissions` calls `service.Evaluate()` and:
- If `service.Evaluate()` returns a top-level error (all checks failed),
  converts it to per-item `source: "error"` results for each affected
  check. The batch-level return is still `([]PermissionResult, nil)`.
- If `service.Evaluate()` succeeds with partial individual failures,
  maps each `CheckResult.Error` to the corresponding
  `PermissionResult.Error` with `source: "error"`.

### Frontend

The frontend becomes a thin consumer. It sends permission query batches
to the backend and stores the boolean results.

**Permission list.** The frontend defines what permissions to query as a
lightweight list of `PermissionSpec` tuples per view category. This
replaces the current `NAMESPACE_CAPABILITY_SPECS` and
`CLUSTER_CAPABILITIES` catalogs — same data, but without the
`CapabilityDefinition` / `CapabilityEntry` / store / TTL / diagnostics
machinery. Just inert data:

```typescript
interface PermissionSpec {
  kind: string;           // Resource kind (e.g., "Deployment", "Pod")
  verb: string;           // RBAC verb (e.g., "list", "delete", "patch")
  subresource?: string;   // Optional subresource (e.g., "scale", "portforward")
}
```

```typescript
const WORKLOAD_PERMISSIONS: PermissionSpec[] = [
  { kind: 'Deployment', verb: 'list' },
  { kind: 'Deployment', verb: 'patch' },
  { kind: 'Deployment', verb: 'delete' },
  { kind: 'Deployment', verb: 'update', subresource: 'scale' },
  { kind: 'StatefulSet', verb: 'list' },
  { kind: 'StatefulSet', verb: 'patch' },
  { kind: 'StatefulSet', verb: 'delete' },
  // ... etc
];

// Cluster-scoped: QueryPermissions routes these to SSAR automatically
// (backend detects non-namespaced resources via GVR resolution).
const CLUSTER_PERMISSIONS: PermissionSpec[] = [
  { kind: 'Node', verb: 'list' },
  { kind: 'Node', verb: 'patch' },
  { kind: 'Node', verb: 'delete' },
  { kind: 'StorageClass', verb: 'list' },
  // ... etc
];
```

**Dynamic CRD permissions.** `NsViewCustom.tsx` and `ClusterViewCustom.tsx`
look up permissions for arbitrary CRD kinds (`resource.kind`) that are not
in the static permission lists. Today these lookups return `null` because
the kinds are never seeded into the permission map — this is a pre-existing
gap, not a regression. The new design improves this:

When a custom resource view renders objects, it collects the distinct
`kind` values from the displayed objects and queries permissions via
`useCapabilities()`:

```typescript
// In NsViewCustom / ClusterViewCustom, via useCapabilities():
const crdSpecs: PermissionSpec[] = distinctKinds.flatMap((kind) => [
  { kind, verb: 'delete' },
  { kind, verb: 'patch' },
]);
// useCapabilities() issues a QueryPermissions call on mount (see below)
```

The backend resolves each CRD kind → GVR via discovery. The same
cluster-scoped vs namespace-scoped routing applies:

- **Namespace-scoped CRDs** (rendered in `NsViewCustom`): matched against
  the cached SSRR rules for the object's namespace.
- **Cluster-scoped CRDs** (rendered in `ClusterViewCustom`, where objects
  have no namespace): the backend detects the resource is non-namespaced
  via GVR resolution and routes to SSAR, same as built-in cluster-scoped
  resources like Nodes.

If GVR resolution fails (CRD not yet discovered), the individual check
gets `source: "error"` — the context menu item is hidden rather than
incorrectly shown.

**Query flow.** When the frontend needs permissions for a namespace:

1. Build the query batch: expand the permission list with the target
   `(namespace, clusterId)`.
2. Call `QueryPermissions(batch)` — one Wails RPC call.
3. Backend matches against cached SSRR rules (or fetches SSRR first),
   handles `incomplete` fallback transparently, returns results.
4. Store results and build the permission map.

The Wails RPC is in-process (~5ms). Backend matching against cached rules
is near-zero latency. Total round-trip is dominated by the SSRR fetch on
first call for a namespace; subsequent calls for the same namespace hit
the cache.

**Multiple trigger points.** `QueryPermissions` is called from:
- **Namespace selection** (`NamespaceContext.tsx`) — primary trigger for
  the selected namespace's permission specs.
- **Object panel open** (`ObjectPanel.tsx`) — ensures permissions are
  populated for the object's `(clusterId, namespace)` even when it
  differs from the sidebar selection (e.g., opened via search or
  cross-reference). With backend caching, this is a no-op if the
  namespace was already queried.
- **All Namespaces view** — per distinct `(clusterId, namespace)` pair
  from the displayed object list (see All Namespaces View).
- **Cluster connect** — `CLUSTER_PERMISSIONS` bootstrap (routed to SSAR).
- **Ad-hoc queries** — `useCapabilities()` hook for dynamic permission
  checks (e.g., `NodeMaintenanceTab`, CRD views).

**Storage.** Replace the per-entry `CapabilityEntry` store with a result
map:

```typescript
interface PermissionEntry {
  allowed: boolean;
  // "ssrr" | "ssar" | "denied" | "error" — from PermissionResult.Source
  source: string;
  // Denial reason or error message, for UI display
  reason: string | null;
  // Query metadata — needed to populate PermissionStatus for consumers
  descriptor: {
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  // Which permission list produced this query (e.g., "workloads", "cluster")
  feature: string | null;
}

// Key: same permission key format as today
const permissionResults = new Map<string, PermissionEntry>();
```

This is significantly smaller than the current `CapabilityEntry` (which
stores the full descriptor, full result object, status, timestamp, and
error), but retains the fields that live consumers actually read. The
`descriptor` and `feature` fields are derived from the `PermissionSpec`
that triggered the query and are needed by `DiagnosticsPanel` (see
Diagnostics section).

**Permission map contract preserved.** `useUserPermissions()` still returns
a `PermissionMap` (Map of permission keys → `PermissionStatus`). The
`PermissionStatus` type preserves the fields consumers depend on:

- `allowed: boolean` — whether the action is permitted
- `pending: boolean` — whether the result is still in flight
- `reason: string | null` — denial reason or error message (used by
  `ClusterResourcesManager` to display "Insufficient permissions")
- `error: string | null` — error message (used by `useCapabilities` to
  distinguish `status: 'error'` from `status: 'ready'`)
- `entry.status` — lightweight status metadata preserved specifically so
  existing consumers that check `permission.entry?.status === "ready"`
  continue to work without modification

The plan does **not** keep the full old `CapabilityEntry`. It keeps
the lightweight status metadata that existing consumers read, plus the
fields that `DiagnosticsPanel` depends on (see Diagnostics section):

```typescript
type PermissionStatus = {
  id: string;                        // permission key (same as map key)
  allowed: boolean;
  pending: boolean;
  reason: string | null;
  error: string | null;
  source: 'ssrr' | 'ssar' | 'denied' | 'error' | null; // null when pending
  descriptor: {                      // lightweight query fields
    clusterId: string;
    resourceKind: string;
    verb: string;
    namespace: string | null;
    subresource: string | null;
  };
  feature: string | null;            // from the PermissionSpec list
  entry: {
    status: 'loading' | 'ready' | 'error';
  };
};
```

**Definitive denial vs transient error.** `ClusterResourcesContext` and
`ClusterResourcesManager` currently check `entry.status === 'ready'` to
distinguish a definitive "not allowed" from a transient error that should
not hide views. With the new store, this maps to the `source` field:

- `source: "denied"` → definitive denial (SSRR rules complete, no match)
- `source: "ssrr"` → definitive allow
- `source: "error"` → transient error, do not treat as denial
- `source: "ssar"` → SSAR fallback result (definitive either way)

The permission map builder translates each `PermissionEntry` to a
`PermissionStatus`. The `id` is the permission map key. The `descriptor`,
`feature`, and `source` are carried over from the entry:

- Entry exists, `source` is `"denied"` or `"ssrr"` or `"ssar"` →
  `{ id: key, allowed: entry.allowed, pending: false, reason: entry.reason,
  error: null, source: entry.source, descriptor: entry.descriptor,
  feature: entry.feature, entry: { status: "ready" } }`
- Entry exists, `source` is `"error"` →
  `{ id: key, allowed: false, pending: false, reason: entry.reason,
  error: entry.reason, source: "error", descriptor: entry.descriptor,
  feature: entry.feature, entry: { status: "error" } }` — consumers that
  check `error` will see transient failure and not treat it as denial
- Entry does not exist (query in flight) →
  `{ id: key, allowed: false, pending: true, reason: null, error: null,
  source: null, descriptor: fromSpec, feature: fromSpec,
  entry: { status: "loading" } }` — `descriptor` and `feature` are
  derived from the `PermissionSpec` that initiated the query;
  `source` is null because no result exists yet

`useObjectActions()` and all 16+ view components are unchanged.

### `useCapabilities()` Hook

`useCapabilities()` becomes a thin wrapper over the permission map, as it
is today — it already reads from `useUserPermissions()`. The
`registerAdHocCapabilities` and `requestCapabilities` calls are replaced
by a direct `QueryPermissions` call.

**Execution model:** The current hook actively issues requests on
mount/update (`hooks.ts:64-74`). The new hook preserves this: on
mount or when descriptors change, `useCapabilities()` calls
`QueryPermissions` immediately in its `useEffect` — not deferred to a
future batch. This guarantees that callers like `NodeMaintenanceTab` see
results within a single render cycle after mount, matching the current
latency. The backend's singleflight deduplication and SSRR caching ensure
that concurrent or redundant calls from multiple hooks are cheap.

**Named-resource checks.** `NodeMaintenanceTab` passes `name` (e.g., "can
I patch Node `worker-1`?"). The public permission map key
(`getPermissionKey`) drops `name` — existing behavior, the current system
has the same collapse. Today, `useCapabilities()` routes around this via
`stateById.get(descriptor.id)`, keying on a caller-supplied ID string
(e.g., `"object-maintenance:cordon:node-a"`) rather than the permission
map hash.

The new `useCapabilities()` preserves this pattern:

1. The hook includes `name` in the `QueryPermissions` call. The backend's
   rule matcher checks `resourceNames` in the SSRR rules (or delegates to
   SSAR for cluster-scoped resources like Nodes) and returns the correct
   answer for that specific name.
2. **Frontend routing rule:** When processing `PermissionResult[]` from
   the backend, the frontend routes each result based on whether `Name`
   is set:
   - `Name` is non-empty → store in the hook's **`namedResults` map**,
     keyed by the caller-supplied `id` string:
     `Map<string, PermissionEntry>`. This map is not exposed through
     `useUserPermissions()`.
   - `Name` is empty → store in the public `permissionResults` map under
     the standard `getPermissionKey()` hash.
3. The hook's `getCapabilityState(id)` method reads from `namedResults`
   first, falling back to the public permission map. This matches the
   current lookup order where `stateById` takes precedence.
4. The public permission map only contains name-free results. Consumers
   that don't pass `name` see the same behavior as today. Named results
   never overwrite name-free results in the public map.

### Cluster-Scoped Permissions

**Cluster-scoped permissions stay on SSAR.** SSRR cannot be used to
answer cluster-wide checks because namespace SSRR responses include rules
from namespace RoleBindings that reference ClusterRoles. A RoleBinding in
`"default"` referencing a ClusterRole with Node/PV rules would make those
rules appear in the SSRR response, but the RoleBinding does not actually
grant cluster-wide access — only a ClusterRoleBinding does. The SSRR
response has no way to distinguish which binding type contributed each
rule. Using namespace SSRR for cluster-scoped checks would produce false
positives (reporting `allowed: true` when SSAR would correctly deny).

**Bootstrap:** On cluster connect, call `QueryPermissions` with the
`CLUSTER_PERMISSIONS` list. The backend detects that these are
cluster-scoped resources (no namespace in the query, or resource is
non-namespaced per GVR resolution) and routes them through
`service.Evaluate()` as individual SSAR checks — the same 26-check
batch as today, but now behind the `QueryPermissions` interface. The
frontend is unaware of the routing difference.

This keeps the current authorization-correct behavior for cluster-scoped
checks while providing the SSRR optimization for namespace-scoped checks
(where the per-namespace round-trip savings are significant).

### All Namespaces View

Currently broken: `getCapabilityNamespace("namespace:all")` returns `null`,
all registration paths bail out, zero permissions fetched.

**Fix:** When the All Namespaces view renders objects, collect the distinct
`(clusterId, namespace)` pairs from the displayed object list and query
permissions for each. The mechanism is the same as single-namespace, just
applied to multiple pairs.

**Concurrency and load management:**

- **Batch by cluster.** Group the distinct `(clusterId, namespace)` pairs
  by cluster. Issue one `QueryPermissions` call per cluster containing all
  that cluster's namespace queries. The backend fans out SSRR fetches
  internally (singleflight-deduped per `clusterId|namespace`).
- **Concurrency limit: 5 concurrent clusters.** If the user has more than
  5 clusters connected, process clusters in batches of 5. Within a single
  cluster, all namespace SSRR fetches run concurrently (each is one API
  call, deduped by singleflight).
- **Cap: 50 namespaces per cluster.** If a cluster has more than 50
  distinct namespaces in the displayed objects, query the first 50
  (ordered by object count, descending — prioritize namespaces with the
  most visible objects). Remaining namespaces are queried lazily when the
  user scrolls to objects in those namespaces or opens an object panel.
- **Debounce initial load.** The object list populates incrementally as
  refresh streams deliver data. Debounce the permission query trigger by
  500ms after the last object-list change to avoid a thundering herd of
  partial queries during initial load.
- **Singleflight dedup.** If multiple trigger points (namespace selection,
  object panel open, All Namespaces batch) request the same
  `(clusterId, namespace)` concurrently, the backend's singleflight
  ensures only one SSRR call is made. Subsequent callers block on the
  in-flight result.

In a multi-cluster session, `team-a` in cluster A and `team-a` in cluster
B are different permission scopes, require separate SSRR calls, and produce
separate cache entries.

### Refresh and Revalidation

**Periodic refresh:** Re-call `QueryPermissions` per cached
`(clusterId, namespace)` on the existing permission cache TTL interval.
Backend re-fetches SSRR if the cached response has expired. For
cluster-scoped permissions (SSAR path), the same TTL-driven refresh
re-fires the SSAR batch through `service.Evaluate()`. The frontend
triggers both namespace-scoped and cluster-scoped refreshes on the same
interval.

**Stale-while-revalidate:** During refresh, if the cached SSRR rules are
within the stale grace window (see SSRR caching above), the backend
serves stale results immediately while the background re-fetch runs. The
frontend never sees "pending" for a previously-loaded namespace. Only the
initial load shows pending state. If the stale grace window has elapsed,
the backend blocks on a fresh SSRR fetch (or falls through to SSAR on
failure) — revoked permissions are not served indefinitely.

**Kubeconfig change:** Backend clears cached SSRR rules for the affected
cluster. Frontend clears permission results. Fresh `QueryPermissions`
calls on reconnect.

**Namespace change:** If the backend has cached SSRR rules within TTL for
the target namespace, `QueryPermissions` returns immediately from cache
(no loading state). Otherwise fetches.

**SSRR fetch failure:** Backend serves stale cached rules only if within
the stale grace window. If the grace window has elapsed or no stale cache
exists (first load), backend falls through to individual SSAR for each
query in the batch. Frontend receives results either way — it does not
need to know whether results came from SSRR or SSAR.

### Backend Refresh Subsystem (Separate Concern)

`backend/refresh/permissions/checker.go` and `permission_gate.go` use SSAR
to decide whether entire refresh domains should be active (e.g., "can this
user list pods?"). These are backend-internal gates for the streaming/watch
subsystem and are **not part of the UI permission map**.

`backend/response_cache_permissions.go` uses `permissions.Checker` (the
backend SSAR cache) to guard cached detail/YAML responses. Verified
independent of the frontend capability store.

These stay on SSAR. They check a small number of permissions per domain
(typically 1-3 `list` checks) and run infrequently. Separate concern.

### Multi-Cluster Rule Set Lifecycle

SSRR rules are cached on the backend per `clusterId|namespace`. When
switching clusters:

- Cached rules for other clusters remain valid (user may switch back).
- On kubeconfig change (cluster disconnect/reconnect), clear cached rules
  for the affected cluster only.
- On cluster removal, clear all cached rules for that cluster.

### Migration Path

The change is internal to the capabilities module. The public API surface
that components consume does not change:

- `useUserPermissions()` → `PermissionMap` (same)
- `useObjectActions()` → `ContextMenuItem[]` (same)
- `getPermissionKey()` (same)
- `PermissionStatus` contract (same externally, including
  `allowed`/`pending` plus the lightweight status/error fields existing
  consumers already rely on)

Modules to modify:

| Module | Change |
|---|---|
| `backend/capabilities/` | Add `QueryPermissions` endpoint, SSRR fetch/cache, rule matching with GVR resolution, cluster-scoped SSAR routing, `incomplete` fallback. Call `service.Evaluate()` directly for SSAR paths (not the Wails endpoint). |
| `frontend/src/core/capabilities/store.ts` | Replace per-entry CapabilityEntry store with simple result map |
| `frontend/src/core/capabilities/bootstrap.ts` | Build permission map from QueryPermissions results. Replace catalog-driven SSAR registration with permission list + single RPC call. |
| `frontend/src/core/capabilities/hooks.ts` | Rewrite `useCapabilities()` as thin wrapper; remove `registerAdHocCapabilities`/`requestCapabilities` calls; replace `useCapabilityDiagnostics` with `usePermissionQueryDiagnostics` |
| `frontend/src/core/capabilities/catalog.ts` | Replace `CLUSTER_CAPABILITIES` CapabilityDefinition array with lightweight `CLUSTER_PERMISSIONS` spec list |
| `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx` | Replace `NAMESPACE_CAPABILITY_SPECS`, capability registration in load callbacks, and blanket effect at line 1184 with single `QueryPermissions` call on namespace enter |
| `frontend/src/modules/namespace/contexts/NamespaceContext.tsx` | Trigger `QueryPermissions` when namespace selected |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | Replace `evaluateNamespacePermissions` with `QueryPermissions` for the object's `(clusterId, namespace)` — this call is not redundant, it handles cross-namespace object panel opens where the object's namespace differs from the sidebar selection |
| `frontend/src/core/refresh/components/DiagnosticsPanel.tsx` | Update to consume `usePermissionQueryDiagnostics`; add SSRR-specific columns (`method`, `ssrrIncomplete`, `ssrrRuleCount`, `ssarFallbackCount`) |

Modules to add:

| Module | Purpose |
|---|---|
| `backend/capabilities/rules.go` | SSRR fetch, response caching (singleflight-deduped), rule matching engine with wildcard/subresource/resourceNames handling, GVR resolution integration |
| `backend/capabilities/rules_test.go` | Rule matching unit tests (see Testing Phase 2) |

Modules to remove:

| Module | Reason |
|---|---|
| `frontend/src/core/capabilities/actionPlanner.ts` | Dead code (never called from components) |

### What Stays Unchanged

- `useObjectActions()` hook and all 16+ view components
- `buildObjectActionItems()` function
- `getPermissionKey()` key format
- `PermissionStatus` contract as consumed by view components:
  `allowed`, `pending`, `reason`, `error`, and `entry.status`.
  Extended with `id`, `descriptor`, `feature`, `source` for diagnostics
  (see Diagnostics section).
- `EvaluateCapabilities` backend endpoint (kept for any direct callers;
  `QueryPermissions` calls `service.Evaluate()` directly for fallback)
- `backend/refresh/permissions/checker.go` and
  `response_cache_permissions.go`
- Backend refresh subsystem permission gates

## Risks

### Risk 1: Cluster view bootstrap timing

`ClusterResourcesContext.tsx` makes 10 `useUserPermission()` calls for
cluster-scoped resources (Node list, StorageClass list, ClusterRole list,
etc.). These render immediately on cluster connect. Currently populated by
the 26-SSAR bootstrap which fires before any namespace is selected.

With the new design, cluster-scoped checks still use SSAR (routed
through `QueryPermissions`), so the bootstrap timing is identical to
today — same 26 SSAR checks, same loading window, same behavior.

**Mitigation:** No change needed. The existing loading-state behavior
(treating `undefined` permission status as "pending," not denied) is
preserved because the cluster-scoped path is unchanged.

### Risk 2: Silent action disappearance from rule matching bugs

If the backend rule matcher produces a different answer than SSAR would for
the same permission (e.g., a wildcard mismatch, subresource encoding
difference, or apiGroup casing issue), actions silently disappear from
context menus. No error is shown — the item just isn't there.

**Mitigation:** Contract tests (see Testing Strategy) that assert specific
permission map outputs for known RBAC configurations. Backend tests that
compare SSRR matching results against SSAR results for the same checks.

### Risk 3: Wildcard `"*"` and subresource coverage — unverified

Whether `resources: ["*"]` in an SSRR `ResourceRule` covers subresources
like `pods/log`, `pods/exec`, `deployments/scale`. In RBAC PolicyRules,
`"*"` covers subresources. But the SSRR `ResourceRule` docs say `"*"`
means "all in the specified apiGroups" without explicitly mentioning
subresources. If `"*"` doesn't cover subresources in SSRR responses, users
with broad permissions (like `cluster-admin`) would paradoxically lose
action items.

**Mitigation:** Must be verified on a live cluster before implementation.
Create a test ClusterRole with `resources: ["*"]` and verify that SSRR
returns rules that allow subresource access. If `"*"` doesn't cover
subresources in the SSRR response, the rule matcher must synthesize
subresource coverage from `"*"` rules.

### Risk 4: No existing regression tests for permission map output

The current test suite covers store mechanics (batching, TTL, diagnostics)
and hook wiring, but there are no tests that assert "given this set of
RBAC rules / SSAR results, the permission map should contain these
specific allowed/denied entries for these specific keys." We are replacing
the engine with no contract tests for the output.

**Mitigation:** Write contract tests before implementation (see below).

### Risk 5: `system:basic-user` binding removed

The bootstrap depends on SSRR creation being available to all authenticated
users. This is true by default (RBAC bootstrap policy), but an admin could
remove or modify the `system:basic-user` ClusterRoleBinding. If SSRR
returns 403, the backend must fall through to SSAR for all checks in the
batch.

**Mitigation:** The `QueryPermissions` backend handles SSRR fetch failure
by falling through to individual SSAR checks. This is the same fallback as
the `incomplete` path. The frontend is unaware of which path was taken.

### Risk 6: SSRR response size for broadly-permissioned users

Users with `cluster-admin` or extensive ClusterRoleBindings can have SSRR
responses containing hundreds of `ResourceRule` entries. The rule matcher
performs a linear scan over these rules for each permission check.

**Assessment:** Acceptable. A `cluster-admin` SSRR response on a cluster
with 50 CRDs contains ~200-300 rules. Matching 70 permission checks
against 300 rules is ~21,000 string comparisons — sub-millisecond in Go.
The SSRR response itself is typically 10-50 KB, well within reason for a
single cached object. No mitigation needed unless profiling shows
otherwise.

### Risk 7: GVR cache and SSRR cache staleness race

The rule matcher resolves `resourceKind → (apiGroup, pluralResource)` via
the GVR discovery cache, then matches against cached SSRR rules. If a CRD
is installed after the SSRR rules are cached but before the GVR cache
refreshes, the matcher will fail to resolve the kind (`source: "error"`).
If the GVR cache refreshes first but the SSRR rules are stale, the
matcher resolves the kind but the rules don't contain the CRD's
permissions yet.

**Assessment:** Low risk. Both caches operate on the same TTL cycle, so
the window is small. In both cases the failure mode is conservative: the
permission check fails or returns denied, and the context menu item is
hidden. On the next refresh cycle both caches update and the permission
resolves correctly. This matches the current SSAR behavior, where a newly
installed CRD's permissions are not checked until the next capability
evaluation cycle.

## Testing Strategy

### Phase 1: Contract tests (write BEFORE implementation)

Write tests against the current system that assert permission map output
for known inputs. These tests pin the current behavior and serve as
regression tests during the migration.

**Permission map contract tests:**
- Given a mock `EvaluateCapabilities` that returns allowed for Deployment
  delete/patch/update and denied for Pod delete, verify the permission map
  contains the expected `PermissionStatus` entries with correct keys.
- Cover all permission types used by `useObjectActions`: delete, patch
  (restart/rollback), update/scale subresource, create/portforward
  subresource.
- Cover cluster-scoped permissions: Node list/patch/delete, StorageClass
  list, ClusterRole list.
- Cover the "pending" state: permission map entries before backend results
  arrive should have `pending: true`.

**`useObjectActions` output tests:**
- Given specific permission map contents, verify the correct context menu
  items are produced (present, absent, disabled).
- Cover: Deployment (restart, rollback, scale, delete, port-forward),
  Pod (delete, port-forward), DaemonSet (restart, delete), CronJob
  (trigger, suspend — not permission-gated).

These tests should be mock-based and should pass against the current SSAR
implementation. They then serve as regression tests when `QueryPermissions`
is swapped in.

### Phase 2: Backend rule matching tests

Thorough Go unit tests for the rule matching engine in `rules.go`:

- Exact resource match: `resources: ["pods"]` + `verb: "delete"` → allowed
- Wildcard verb: `verbs: ["*"]` matches any verb
- Wildcard apiGroup: `apiGroups: ["*"]` matches any group
- Wildcard resource: `resources: ["*"]` matches any resource (and verify
  subresource behavior)
- Subresource match: `resources: ["pods/log"]` + `verb: "get"` → allowed
- Subresource wildcard: `resources: ["*/portforward"]` +
  `verb: "create"` → allowed for any resource
- Invalid wildcard form: `resources: ["pods/*"]` must NOT match
  `pods/log` — `"resource/*"` is not valid Kubernetes RBAC matching
- Negative cases: resource present but verb missing, apiGroup mismatch,
  subresource mismatch
- `resourceNames` handling: empty means all, specific names restrict
- Multiple rules: union semantics (any matching rule grants access)
- GVR resolution: `resourceKind: "Deployment"` resolves to
  `apiGroup: "apps"`, `resource: "deployments"`
- `incomplete` fallback: no match + incomplete → SSAR fires, result
  returned transparently
- SSRR fetch failure: falls through to SSAR for all checks
- Cluster-scoped routing: non-namespaced resources (Node, PV,
  StorageClass, etc.) always route to SSAR, never SSRR matching
- RoleBinding false-positive prevention: a namespace RoleBinding
  referencing a ClusterRole with Node rules must NOT produce
  `allowed: true` for Node checks (verifies the cluster-scoped routing
  bypasses SSRR)
- SSRR cache stale grace expiry: cached rules within `TTL + staleGrace`
  are served while background re-fetch runs; cached rules past
  `TTL + staleGrace` are discarded and a synchronous SSRR fetch is
  required (or SSAR fallback on failure). Verifies that revoked
  permissions do not survive indefinitely when SSRR refreshes keep
  failing.

### Phase 3: Integration tests

- **Cluster bootstrap timing:** Verify cluster views receive permissions
  before or during first render (not `undefined`).
- **All Namespaces flow:** Verify permissions populate for objects from
  multiple `(clusterId, namespace)` pairs.
- **Stale-while-revalidate:** Verify the UI doesn't flash to pending
  during rule set refresh (stale within grace window).
- **Stale grace expiry:** Verify that after the grace window elapses
  with continuous SSRR fetch failures, the stale results are discarded
  and the UI reflects the SSAR fallback results (not the stale SSRR
  rules). Confirms revoked permissions are eventually cleared.
- **Named-resource checks:** Verify `NodeMaintenanceTab` receives correct
  per-node permission results.
- **CRD dynamic permissions:** Verify `NsViewCustom` receives correct
  permission results for arbitrary CRD kinds queried via
  `useCapabilities()`.
- **Cross-namespace object panel:** Verify that opening an object panel
  for a namespace not currently selected in the sidebar populates
  permissions for that object's `(clusterId, namespace)`.

### Phase 4: Live cluster verification (before merge)

- Verify SSRR response on a pure RBAC cluster (e.g., kind, minikube).
- Verify SSRR response on a managed cluster with webhook authorizer (EKS
  or GKE) — confirm RBAC rules are present, `incomplete: true`.
- Verify wildcard `"*"` and subresource behavior on both cluster types.
- Compare `QueryPermissions` results against `EvaluateCapabilities` results
  for the same user/namespace/checks to confirm identical outcomes.
- Verify SSRR creation works without `namespaces.list` permission.
- Verify cluster-scoped routing: create a user with a RoleBinding in
  `"default"` referencing a ClusterRole that includes Node rules, but no
  ClusterRoleBinding. Confirm `QueryPermissions` correctly denies Node
  access (SSAR path) even though SSRR for `"default"` would include Node
  rules.

## Comparison

| Metric | Current | Proposed |
|---|---|---|
| K8s API calls on cluster connect | 26 SSAR | 26 SSAR (unchanged — cluster-scoped stays on SSAR) |
| K8s API calls per namespace enter | ~70 SSAR | 1 SSRR (cached after first) |
| All Namespaces (15 namespaces) | 0 (broken) | 15 SSRR + cluster SSAR (shared with bootstrap) |
| Frontend storage per namespace | ~70 CapabilityEntry objects | Compact result map (`allowed`, `source`, `reason`, `descriptor`, `feature`) |
| Latency to populate context menu | 2-3 batches of SSAR round-trips | 1 SSRR + backend matching (namespace-scoped) |
| UI contract changes | None | None |
| `incomplete` handling | N/A | Transparent SSAR fallback on backend |
| Cluster-scoped check correctness | SSAR (correct) | SSAR (correct — no SSRR false positives) |

## Diagnostics

The `DiagnosticsPanel` (`frontend/src/core/refresh/components/
DiagnosticsPanel.tsx`) actively reads two data sources from the current
permission system:

1. **Batch diagnostics** via `useCapabilityDiagnostics()` — per-namespace
   timing (last run duration, last completed, in-flight runtime),
   error tracking (last error, consecutive failure count, last result),
   and per-batch descriptor lists. Used to build the "Capabilities" tab
   rows showing SSAR batch health.

2. **Permission map entries** via `useUserPermissions()` — per-permission
   `descriptor` (resourceKind, verb, namespace, subresource), `id`,
   `feature`, allowed/pending status. Used to build the "Permissions" tab
   rows with feature-scoped filtering.

The plan removes the `CapabilityEntry` / store / diagnostics machinery
that produces (1). The `PermissionEntry` and `PermissionStatus` types
retain the `descriptor`, `id`, and `feature` fields that (2) depends on
(see Frontend section).

**Batch diagnostics must be explicitly migrated:**

**New batch diagnostics type** — replace `CapabilityNamespaceDiagnostics`
with `PermissionQueryDiagnostics`:

```typescript
interface PermissionQueryDiagnostics {
  key: string;                       // "clusterId|namespace" or "clusterId|cluster"
  clusterId?: string;
  namespace?: string;                // null for cluster-scoped SSAR batch
  method: 'ssrr' | 'ssar';          // how this batch was resolved
  pendingCount: number;
  inFlightCount: number;
  inFlightStartedAt?: number;
  lastRunDurationMs?: number;
  lastRunCompletedAt?: number;
  lastError?: string | null;
  lastResult?: 'success' | 'error';
  totalChecks: number;
  consecutiveFailureCount: number;
  ssrrIncomplete?: boolean;          // was the SSRR response incomplete?
  ssrrRuleCount?: number;            // number of rules in the cached SSRR response
  ssarFallbackCount?: number;        // checks that fell through to SSAR
  lastDescriptors: PermissionSpec[]; // specs in the last query batch
}
```

The backend emits this data per `QueryPermissions` call. The frontend
aggregates it by `(clusterId, namespace)` key. `useCapabilityDiagnostics`
is replaced by `usePermissionQueryDiagnostics` returning the same shape
the DiagnosticsPanel expects.

**`PermissionStatus` already includes diagnostics fields.** The
`PermissionStatus` type (defined in the Frontend section above) includes
`id`, `descriptor`, `feature`, and `source` — these are the fields
`DiagnosticsPanel` reads to build the "Permissions" tab rows and
feature-scoped filtering. No separate type is needed.

**Multi-cluster indexing.** Today, `DiagnosticsPanel` reconstructs
permission keys from `(resourceKind, verb, namespace, subresource)`
without `clusterId` (`DiagnosticsPanel.tsx:1500, 1574`). This works
because the current system only tracks one cluster's permissions at a
time. In multi-cluster All Namespaces sessions, the same permission
tuple on clusters A and B would collide. The rewritten panel must index
by `status.id` (which is the full cluster-qualified permission key from
`getPermissionKey`) or by `descriptor.clusterId` + the other fields.
The `descriptor` now includes `clusterId` for this reason.

## Open Questions

1. **All Namespaces concurrency configurability.** The design specifies
   5 concurrent clusters and 50 namespaces per cluster as hard defaults.
   Should these be user-configurable (e.g., via settings), or are fixed
   defaults sufficient?
