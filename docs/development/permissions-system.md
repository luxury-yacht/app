# Permissions system

This document explains how Luxury Yacht checks Kubernetes RBAC permissions, how domains degrade gracefully when a user has partial access, and what to watch out for when adding or modifying domains.

## Overview

There are two independent permission systems:

1. **Refresh subsystem permissions (backend)** -- Gates which refresh domains are active. Uses SSAR (SelfSubjectAccessReview) via `permissions.Checker`. Determines whether the backend should watch/list a resource type at all. Operates at startup (registration) and runtime (per-snapshot). Unchanged from the original architecture.

2. **UI permission map (frontend ↔ backend)** -- Gates context menu actions (Delete, Restart, Scale, Rollback, Port Forward) in the UI. Uses SSRR (SelfSubjectRulesReview) for namespace-scoped resources and SSAR for cluster-scoped resources, via the `QueryPermissions` Wails endpoint. One SSRR call per namespace returns all rules; the backend matches permissions locally against cached rules.

These systems are independent. The refresh subsystem's `permissions.Checker` and the UI's `QueryPermissions` endpoint have separate caches, separate TTLs, and separate code paths. Changing one does not affect the other.

---

# Refresh subsystem permissions (SSAR)

This section covers the backend refresh subsystem's permission checking, which gates domain registration and runtime access.

## Key files

| File                                            | Role                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `backend/refresh/permissions/checker.go`        | Issues SSAR calls, caches decisions, stale-while-revalidate logic                     |
| `backend/refresh/snapshot/permission_checks.go` | Defines per-domain permission requirements (`requireAll` / `requireAny`)              |
| `backend/refresh/snapshot/permission.go`        | Registers permission-denied placeholder domains                                       |
| `backend/refresh/snapshot/service.go`           | `ensurePermissions()` -- runtime permission gate before every snapshot build          |
| `backend/refresh/system/permission_gate.go`     | Startup permission gate for list / list+watch registration                            |
| `backend/refresh/system/registrations.go`       | Domain registration table -- maps domains to permission checks and register functions |
| `backend/internal/config/config.go`             | Timing constants (`PermissionCacheTTL`, `PermissionCacheStaleGracePeriod`, etc.)      |
| `backend/refresh/types.go`                      | `DomainConfig` struct including the `PermissionDenied` flag                           |

## Permission checker (`permissions.Checker`)

The checker wraps Kubernetes SSAR calls with caching and deduplication.

### Cache layers

Each permission decision flows through these layers, in order:

1. **Fresh cache** -- If the cached entry has not expired (within `PermissionCacheTTL`, default 2 minutes), return it immediately. Source: `DecisionSourceCache`.
2. **Stale-while-revalidate** -- If the entry is expired but within the grace window (`PermissionCacheTTL + PermissionCacheStaleGracePeriod`, default 2m30s total), return the stale value immediately and trigger a background goroutine to refresh it. Source: `DecisionSourceStale`.
3. **Blocking fetch** -- If the entry is expired beyond the grace window (or there is no cached entry), issue a blocking SSAR call. Source: `DecisionSourceFresh`.
4. **Transient error fallback** -- If the SSAR call fails with a transient error (timeout, rate limit, network) and a stale entry exists, return the stale value. Source: `DecisionSourceFallback`.

Concurrent SSAR calls for the same cache key are deduplicated via `singleflight`.

### Why stale-while-revalidate matters

Without it, every snapshot request hitting an expired cache entry blocks on an SSAR call. When multiple domains need permission re-validation simultaneously (e.g., after a namespace switch triggers new domain registrations), the combined SSAR load can cause multi-second delays. Stale-while-revalidate lets domain requests proceed with the last-known-good decision while the refresh happens in the background.

## Startup registration flow

The startup flow is driven by `registrations.go`:

```
NewSubsystemWithServices()
  -> PrimePermissions()         // pre-warm the SSAR cache for all known resources
  -> registerDomains()          // iterate the registration table
       for each domain:
         1. Universal runtime check (CheckDomainPermission)
            -> If denied: RegisterPermissionDeniedDomain() and skip
         2. Gate-specific check (listDomainConfig / listWatchDomainConfig)
            -> If denied: RegisterPermissionDeniedDomain() and skip
         3. Register the domain's builder with the registry
```

### Permission-denied placeholder domains

When a domain fails its permission checks at startup, `RegisterPermissionDeniedDomain` registers a stub `BuildSnapshot` that always returns `PermissionDeniedError`. The `DomainConfig.PermissionDenied` flag is set to `true`.

At runtime, `ensurePermissions()` checks this flag and **short-circuits** -- it skips SSAR calls entirely for placeholder domains. The stub builder returns the correct `PermissionDeniedError` on its own. This eliminates redundant SSAR calls for every denied domain on every request once the 2-minute cache expires.

## Runtime permission checks (`defaultPermissionChecks`)

The function `defaultPermissionChecks()` in `permission_checks.go` is the single source of truth for which permissions each domain requires. It maps domain names to `permissionCheck` structs that specify:

- A list of `permissionRequirement` entries (group, resource, verb)
- A mode: `requireAll` or `requireAny`

### `requireAll` vs `requireAny`

- **`requireAll`** -- The domain is blocked unless every listed resource is accessible. Used for single-resource domains (e.g., `namespaces`, `pods`, `nodes`).
- **`requireAny`** -- The domain is allowed if at least one resource is accessible. Used for multi-resource domains where partial data is useful (e.g., `namespace-workloads`, `namespace-config`, `cluster-rbac`).

### Which domains use which mode

**`requireAll` (single-resource or all-or-nothing)**:

- `namespaces`, `pods`, `nodes`
- `namespace-storage`, `namespace-autoscaling`, `namespace-helm`, `namespace-events`
- `cluster-storage`, `cluster-crds`, `cluster-custom`, `cluster-events`
- `object-events`

**`requireAny` (multi-resource, partial data)**:

- `namespace-workloads` (pods, deployments, statefulsets, daemonsets, jobs, cronjobs)
- `namespace-config` (configmaps, secrets)
- `namespace-network` (services, endpointslices, ingresses, networkpolicies)
- `namespace-quotas` (resourcequotas, limitranges, poddisruptionbudgets)
- `namespace-rbac` (roles, rolebindings, serviceaccounts)
- `cluster-rbac` (clusterroles, clusterrolebindings)
- `cluster-config` (storageclasses, ingressclasses, webhooks)
- `cluster-overview` (nodes, namespaces)

## Partial-data pattern for multi-resource domains

Multi-resource domains that use `requireAny` follow the `cluster-config` reference pattern:

1. **Permissions struct** -- Each domain defines a `*Permissions` struct with boolean fields for each resource (e.g., `NamespaceRBACPermissions.IncludeRoles`).
2. **Conditional lister wiring** -- The `Register*Domain()` function accepts the permissions struct and only wires informer listers for permitted resources. Denied resources get `nil` listers.
3. **Nil-lister guards in Build()** -- The builder checks each lister for nil before calling it. If nil, that resource type is simply omitted from the snapshot.
4. **`listRegistration` with `allowAny: true`** -- In `registrations.go`, the domain uses `listRegistration` instead of `directRegistration` or `listWatchRegistration`. The `allowAny` flag tells the permission gate to register the domain if any check passes, passing the per-resource allow map to the register callback.

### Example: namespace-rbac

```go
// permission_checks.go
namespaceRBACDomainName: requireAny(
    "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
    listPermission("rbac.authorization.k8s.io", "roles"),
    listPermission("rbac.authorization.k8s.io", "rolebindings"),
    listPermission("", "serviceaccounts"),
),

// registrations.go
listRegistration(listDomainConfig{
    name:     "namespace-rbac",
    allowAny: true,
    checks: []listCheck{
        {group: "rbac.authorization.k8s.io", resource: "roles"},
        {group: "rbac.authorization.k8s.io", resource: "rolebindings"},
        {group: "", resource: "serviceaccounts"},
    },
    register: func(allowed map[string]bool) error {
        return snapshot.RegisterNamespaceRBACDomain(
            deps.registry,
            deps.informerFactory.SharedInformerFactory(),
            snapshot.NamespaceRBACPermissions{
                IncludeRoles:           allowed["rbac.authorization.k8s.io/roles"],
                IncludeRoleBindings:    allowed["rbac.authorization.k8s.io/rolebindings"],
                IncludeServiceAccounts: allowed["core/serviceaccounts"],
            },
        )
    },
}),

// namespace_rbac.go -- nil-lister guard
if b.roleLister != nil {
    roles, err = b.roleLister.Roles(namespace).List(labels.Everything())
    ...
}
```

## Guidelines for future changes

### Adding a new multi-resource domain

1. Define a `*Permissions` struct with `Include*` booleans for each resource.
2. Update `Register*Domain()` to accept the struct and conditionally wire listers.
3. Guard every lister call in `Build()` with a nil check.
4. In `registrations.go`, use `listRegistration` with `allowAny: true` and pass the `allowed` map to the permissions struct.
5. In `permission_checks.go`, add a `requireAny` entry for the domain.
6. Add the domain's resources to `preflightRequests` (usually automatic from the registration checks).
7. Update `TestDomainRegistrationOrder` in `registrations_test.go` if the domain is new.

### Adding a new single-resource domain

Use `requireAll` in `permission_checks.go` and `directRegistration` in `registrations.go`. No permissions struct is needed.

### Common mistakes to avoid

- **Using `requireAll` for multi-resource domains** -- This blocks the entire domain when any single resource is denied, even when the user has valid access to other resources. Use `requireAny` with the partial-data pattern instead.
- **Forgetting nil-lister guards** -- If a domain uses the partial-data pattern, every lister access in `Build()` must check for nil. Otherwise a nil pointer panic will crash the snapshot build.
- **Mismatched keys between registrations.go and permission_checks.go** -- The `allowed` map keys use the format `group/resource` where the empty group is represented as `core` (e.g., `core/pods`, `rbac.authorization.k8s.io/roles`). The `permissionCheck` requirements use group/resource as-is (empty string for core). Make sure the keys in the `register` callback match what `listAllowedByKey` produces.
- **Adding SSAR checks without considering cache pressure** -- Each new permission requirement adds SSAR calls at startup and potentially at runtime. Keep the number of resources per domain reasonable and rely on `preflightRequests` to pre-warm the cache.
- **Modifying `PermissionCacheTTL` or `PermissionCacheStaleGracePeriod` without understanding the tradeoff** -- Shorter TTLs detect RBAC changes faster but increase SSAR load. The stale grace period must be shorter than the TTL to be meaningful. Current values: TTL=2m, grace=30s.

### Testing

- **`registrations_test.go`** -- `TestDomainRegistrationOrder` must list every domain in the exact registration order. Update it when adding or reordering domains.
- **`service_test.go`** -- Tests the runtime permission gate. `TestServiceBuildBlocksPermissionDenied` must deny ALL resources for `requireAny` domains. `TestServiceBuildAllowsPartialPermissions` verifies that partial access works. `TestServiceBuildSkipsEnsureForPermissionDeniedDomain` verifies the SSAR skip optimization.
- **`checker_test.go`** -- Tests cache behavior including stale-while-revalidate. `TestCheckerStaleWhileRevalidate` verifies stale returns + background refresh. `TestCheckerStaleGracePeriodExpired` verifies blocking fetch beyond grace.

### Timing constants reference

| Constant                          | Default | Purpose                                                 |
| --------------------------------- | ------- | ------------------------------------------------------- |
| `PermissionCacheTTL`              | 2 min   | How long SSAR decisions are cached before expiry        |
| `PermissionCacheStaleGracePeriod` | 30 sec  | Window beyond TTL where stale cache is served           |
| `PermissionCheckTimeout`          | 5 sec   | Timeout for individual SSAR calls                       |
| `PermissionPrimeTimeout`          | 10 sec  | Timeout for pre-warming the permission cache at startup |
| `PermissionPreflightTimeout`      | 15 sec  | Timeout for the full preflight permission check phase   |

---

# UI permission map (SSRR + SSAR)

This section covers the frontend permission system that gates context menu actions. It is completely independent of the refresh subsystem permissions above.

## Architecture

The UI permission system replaces per-check SSAR calls with per-namespace SSRR (SelfSubjectRulesReview) calls. One SSRR API call returns all RBAC rules for the current user in a given namespace. The backend matches permission queries locally against the cached rules.

Cluster-scoped resources (Nodes, PVs, StorageClasses, ClusterRoles, etc.) are routed to SSAR because namespace-scoped SSRR responses can contain false positives from namespace RoleBindings referencing ClusterRoles.

### Key files

| File                                                | Role                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `backend/capabilities/query.go`                     | `PermissionQuery`, `PermissionResult`, `NamespaceDiagnostics`, `QueryPermissionsResponse` types        |
| `backend/capabilities/rules.go`                     | SSRR cache (TTL + stale grace, singleflight), SSRR fetch, rule matching engine                         |
| `backend/app_permissions.go`                        | `QueryPermissions` Wails endpoint — GVR scope detection, SSRR matching, SSAR fallback                  |
| `backend/internal/config/config.go`                 | `SSRRFetchTimeout` constant                                                                            |
| `frontend/src/core/capabilities/permissionStore.ts` | Frontend permission store — calls `QueryPermissions`, caches results, periodic refresh                 |
| `frontend/src/core/capabilities/permissionSpecs.ts` | Static permission spec lists (`WORKLOAD_PERMISSIONS`, `CLUSTER_PERMISSIONS`, etc.)                     |
| `frontend/src/core/capabilities/permissionTypes.ts` | `PermissionSpec`, `PermissionEntry`, `PermissionStatus`, `PermissionQueryDiagnostics`                  |
| `frontend/src/core/capabilities/hooks.ts`           | `useCapabilities()` hook (ad-hoc queries), `useCapabilityDiagnostics()` hook                           |
| `frontend/src/core/capabilities/bootstrap.ts`       | Thin delegation layer — `initializeUserPermissionsBootstrap`, `useUserPermissions`, `getPermissionKey` |

### How `QueryPermissions` works

For each permission check in a batch:

1. Resolve `resourceKind` → `(apiGroup, pluralResource)` via the GVR discovery cache.
2. If the resource is non-namespaced (cluster-scoped), route directly to SSAR.
3. If namespaced, look up cached SSRR rules for `(clusterId, namespace)`. Fetch SSRR if not cached.
4. Match against the SSRR rules (apiGroup, resource, verb, subresource, resourceNames — with wildcard handling).
5. If matched → `allowed: true, source: "ssrr"`.
6. If not matched and SSRR `incomplete` is false → `allowed: false, source: "denied"`.
7. If not matched and SSRR `incomplete` is true → fire individual SSAR, return with `source: "ssar"`.

Error handling is per-item — a single failing namespace never takes down the entire batch.

### SSRR cache

The SSRR cache mirrors the refresh subsystem's SSAR cache policy:

| State                | Condition                  | Behavior                                                                         |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Fresh                | Within TTL (2 min)         | Serve cached rules                                                               |
| Stale (within grace) | Past TTL, within TTL + 30s | Serve stale, background re-fetch                                                 |
| Expired (past grace) | Past TTL + 30s             | Discard stale, synchronous fetch. If fetch fails, fall through to per-check SSAR |
| Absent               | No entry                   | Synchronous fetch                                                                |

Singleflight deduplicates concurrent SSRR fetches for the same `(clusterId, namespace)`.

### Rule matching

The rule matcher follows Kubernetes RBAC `ResourceMatches` semantics (`pkg/apis/rbac/helpers.go`):

- `"*"` in apiGroups/resources/verbs matches everything
- Exact string match for `resource/subresource`
- `"*/subresource"` matches any resource with that subresource
- `"resource/*"` is NOT valid K8s RBAC — the matcher rejects it
- `resourceNames` restricts matching to specific object names; empty means all names match; a generic (unnamed) query does NOT match a name-restricted rule

### Cluster-scoped safety

Namespace SSRR responses include rules from namespace RoleBindings that reference ClusterRoles. A RoleBinding in `"default"` referencing a ClusterRole with Node rules would make those rules appear in the SSRR response, but the RoleBinding does not grant cluster-wide access. To prevent false positives, `QueryPermissions` detects non-namespaced resources via GVR resolution and routes them to SSAR, never SSRR matching.

### Frontend query flow

**Single namespace** — When a namespace is selected, `queryNamespacePermissions` sends all namespace permission specs in one `QueryPermissions` batch. Results are cached by the store and reused until the 2-minute refresh interval.

**Cluster connect** — `queryClusterPermissions` sends all cluster permission specs. The backend routes them to SSAR (cluster-scoped resources).

**All Namespaces** — An effect collects distinct `(clusterId, namespace)` pairs from loaded domain data and calls `queryNamespacePermissions` for each. `queryNamespacePermissions` skips namespaces that already have fresh results within TTL, so only genuinely new namespaces trigger backend calls.

**CRD custom resources** — Lazy-loaded on first context menu open via `queryKindPermissions`. Queries delete/patch permissions for the specific CRD kind. Results are cached for subsequent opens. Feature tagged as `'Namespace custom resources'` or `'Cluster custom resources'` for diagnostics filtering.

**Periodic refresh** — A 2-minute `setInterval` re-queries any `(clusterId, namespace)` pair whose last query is older than the interval. Namespace refreshes are staggered by 500ms to avoid thundering herd.

### Frontend types

- `PermissionSpec` — Static descriptor: `{ kind, verb, subresource? }`. Grouped into `PermissionSpecList` with a `feature` string for diagnostics filtering.
- `PermissionEntry` — Stored result from the backend: `{ allowed, source, reason, descriptor, feature }`.
- `PermissionStatus` — Public type from `useUserPermissions()`: `{ id, allowed, pending, reason, error, source, descriptor, feature, entry: { status } }`. The `entry.status` field (`'loading' | 'ready' | 'error'`) is used by `ClusterResourcesContext` and `ClusterResourcesManager` to distinguish definitive denials from transient errors.

### Permission key format

All permission lookups use `getPermissionKey()` which produces:

```
${clusterId}|${resourceKind}|${verb}|${namespace_or_'cluster'}|${subresource_or_''}
```

All fields lowercased. Null namespace becomes the literal string `'cluster'`. Empty subresource becomes `''`.

### Diagnostics

The Diagnostics panel has two permission-related tabs:

- **Capabilities Checks** — Per-namespace batch diagnostics showing SSRR method, incomplete flag, rule count, SSAR fallback count, duration, and error state.
- **Effective Permissions** — Per-permission rows showing allowed/denied status, source, reason, and error. Filtered by active cluster and feature-scoped by view type.

Both tabs filter to the active cluster only — permissions from other clusters are never shown.

### Timing constants

| Constant                                    | Default | Purpose                                                               |
| ------------------------------------------- | ------- | --------------------------------------------------------------------- |
| `SSRRFetchTimeout`                          | 5 sec   | Timeout for individual SSRR API calls                                 |
| `PermissionCacheTTL`                        | 2 min   | SSRR cache TTL (reuses the refresh subsystem constant)                |
| `PermissionCacheStaleGracePeriod`           | 30 sec  | Stale grace window beyond TTL (reuses the refresh subsystem constant) |
| `PERMISSION_REFRESH_INTERVAL_MS` (frontend) | 2 min   | Frontend periodic re-query interval                                   |
| `STAGGER_INTERVAL_MS` (frontend)            | 500 ms  | Delay between namespace refreshes in All Namespaces sessions          |

### Guidelines for the UI permission system

**Adding permissions for a new resource kind** — Add a `PermissionSpec` entry to the appropriate list in `permissionSpecs.ts`. The backend resolves the kind via GVR discovery, so CRDs work automatically.

**Adding a new view that needs permissions** — If the view uses `useUserPermissions()` and `getPermissionKey()`, no changes are needed beyond adding the permission specs. If the view needs CRD kind permissions, use `queryKindPermissions` for lazy loading.

**Feature strings for diagnostics** — The `feature` field on each `PermissionSpecList` must match the corresponding entry in `diagnosticsPanelConfig.ts` (`CLUSTER_FEATURE_MAP` / `NAMESPACE_FEATURE_MAP`). Mismatches cause the Effective Permissions tab to show empty for that view.

**Named-resource checks** — `useCapabilities()` supports `name` on descriptors for per-object permission checks (e.g., `NodeMaintenanceTab` checking if a specific node can be cordoned). Named results are stored in a hook-local `namedResults` map and do not overwrite name-free results in the public permission map.
