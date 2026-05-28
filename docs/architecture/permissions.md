# Permissions

This document explains how Luxury Yacht checks Kubernetes RBAC permissions, how domains degrade gracefully when a user has partial access, and what to watch out for when adding or modifying domains.

## Overview

Luxury Yacht has one permission and capability contract with separate runtime
evaluators:

1. **Refresh-domain permission evaluation (backend)** -- Gates which refresh
   domains are active. Uses SSAR (SelfSubjectAccessReview) via
   `permissions.Checker`. Determines whether the backend should list/watch a
   resource type at all. Operates at startup registration and again at runtime
   before snapshot builds.

2. **UI permission and capability evaluation (frontend + backend)** -- Gates
   context menu actions, object-panel workflow controls, and diagnostics. Uses
   SSRR (SelfSubjectRulesReview) for namespace-scoped resources and SSAR for
   cluster-scoped resources, via the `QueryPermissions` Wails endpoint. One SSRR
   call per namespace returns all rules; the backend matches permissions locally
   against cached rules.

3. **Backend mutation permission checks** -- Remain the final authority before
   any write or imperative operation changes cluster state.

These evaluators are intentionally separate because their cache shapes, failure
handling, and diagnostics differ. The shared contract is enforced by descriptor
catalogs and parity tests rather than by merging the refresh SSAR checker with
the UI SSRR/SSAR permission store.

---

## Refresh Domain Permissions

This section covers the backend refresh subsystem's permission checking, which gates domain registration and runtime access.

### Key Files

| File                                            | Role                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `backend/refresh/permissions/resource_requirement.go` | Shared group/resource/verb descriptor helpers for refresh permission contracts |
| `backend/refresh/permissions/checker.go`        | Issues SSAR calls, caches decisions, stale-while-revalidate logic                     |
| `backend/refresh/domainpermissions/spec.go` | Defines per-domain runtime and stream permission requirements |
| `backend/refresh/domainpermissions/access.go` | Evaluates runtime access for refresh domains |
| `backend/refresh/snapshot/permission.go`        | Registers permission-denied placeholder domains                                       |
| `backend/refresh/snapshot/service.go`           | `ensurePermissions()` -- runtime permission gate before every snapshot build          |
| `backend/refresh/system/permission_gate.go`     | Startup permission gate for list / list+watch registration                            |
| `backend/refresh/system/registrations.go`       | Domain registration table -- maps domains to permission checks and register functions |
| `backend/refresh/resourcestream/projection_descriptors_test.go` | Resource-stream domain resources checked against the shared permission contract |
| `backend/internal/config/config.go`             | Timing constants (`PermissionCacheTTL`, `PermissionCacheStaleGracePeriod`, etc.)      |
| `backend/refresh/types.go`                      | `DomainConfig` struct including the `PermissionDenied` flag                           |

### Permission Checker (`permissions.Checker`)

The checker wraps Kubernetes SSAR calls with caching and deduplication.

#### Cache Layers

Each permission decision flows through these layers, in order:

1. **Fresh cache** -- If the cached entry has not expired (within `PermissionCacheTTL`, default 2 minutes), return it immediately. Source: `DecisionSourceCache`.
2. **Stale-while-revalidate** -- If the entry is expired but within the grace window (`PermissionCacheTTL + PermissionCacheStaleGracePeriod`, default 2m30s total), return the stale value immediately and trigger a background goroutine to refresh it. Source: `DecisionSourceStale`.
3. **Blocking fetch** -- If the entry is expired beyond the grace window (or there is no cached entry), issue a blocking SSAR call. Source: `DecisionSourceFresh`.
4. **Transient error fallback** -- If the SSAR call fails with a transient error (timeout, rate limit, network) and a stale entry exists, return the stale value. Source: `DecisionSourceFallback`.

Concurrent SSAR calls for the same cache key are deduplicated via `singleflight`.

#### Why Stale-While-Revalidate Matters

Without it, every snapshot request hitting an expired cache entry blocks on an SSAR call. When multiple domains need permission re-validation simultaneously (e.g., after a namespace switch triggers new domain registrations), the combined SSAR load can cause multi-second delays. Stale-while-revalidate lets domain requests proceed with the last-known-good decision while the refresh happens in the background.

### Startup Registration Flow

The startup flow is driven by `registrations.go`:

```
NewSubsystemWithServices()
  -> PrimePermissions()         // pre-warm the SSAR cache for all known resources
  -> registerDomains()          // iterate the registration table
       for each domain:
         1. Universal runtime check (domainpermissions.RuntimeAccess)
            -> If denied: RegisterPermissionDeniedDomain() and skip
         2. Gate-specific check (listDomainConfig / listWatchDomainConfig)
            -> If denied: RegisterPermissionDeniedDomain() and skip
         3. Register the domain's builder with the registry
```

#### Permission-Denied Placeholder Domains

When a domain fails its permission checks at startup, `RegisterPermissionDeniedDomain` registers a stub `BuildSnapshot` that always returns `PermissionDeniedError`. The `DomainConfig.PermissionDenied` flag is set to `true`.

At runtime, `ensurePermissions()` checks this flag and **short-circuits** -- it skips SSAR calls entirely for placeholder domains. The stub builder returns the correct `PermissionDeniedError` on its own. This eliminates redundant SSAR calls for every denied domain on every request once the 2-minute cache expires.

### Runtime Permission Checks (`domainpermissions.RuntimeAccess`)

The policies in `domainpermissions/spec.go` are the single source of truth for which permissions each domain requires. `RuntimeAccess` evaluates those policies and returns an access decision with a denial reason.

- A list of `permissions.ResourceRequirement` entries (group, resource, verb)
- A mode: `ModeAll` or `ModeAny`

#### `ModeAll` vs `ModeAny`

- **`ModeAll`** -- The domain is blocked unless every listed resource is accessible. Used for single-resource domains (e.g., `namespaces`, `pods`, `nodes`).
- **`ModeAny`** -- The domain is allowed if at least one resource is accessible. Used for multi-resource domains where partial data is useful (e.g., `namespace-workloads`, `namespace-config`, `cluster-rbac`).

#### Which Domains Use Which Mode

**`ModeAll` (single-resource or all-or-nothing)**:

- `namespaces`, `pods`, `nodes`
- `namespace-storage`, `namespace-autoscaling`, `namespace-helm`, `namespace-events`
- `cluster-storage`, `cluster-crds`, `cluster-custom`, `cluster-events`
- `object-events`

**`ModeAny` (multi-resource, partial data)**:

- `namespace-workloads` (pods, deployments, statefulsets, daemonsets, jobs, cronjobs)
- `namespace-config` (configmaps, secrets)
- `namespace-network` (services, endpointslices, ingresses, networkpolicies)
- `namespace-quotas` (resourcequotas, limitranges, poddisruptionbudgets)
- `namespace-rbac` (roles, rolebindings, serviceaccounts)
- `cluster-rbac` (clusterroles, clusterrolebindings)
- `cluster-config` (storageclasses, ingressclasses, webhooks)
- `cluster-overview` (nodes, namespaces)

### Partial-Data Pattern For Multi-Resource Domains

Multi-resource domains that use `ModeAny` follow the `cluster-config` reference pattern:

1. **Permissions struct** -- Each domain defines a `*Permissions` struct with boolean fields for each resource (e.g., `NamespaceRBACPermissions.IncludeRoles`).
2. **Conditional lister wiring** -- The `Register*Domain()` function accepts the permissions struct and only wires informer listers for permitted resources. Denied resources get `nil` listers.
3. **Nil-lister guards in Build()** -- The builder checks each lister for nil before calling it. If nil, that resource type is simply omitted from the snapshot.
4. **`listRegistration` with `allowAny: true`** -- In `registrations.go`, the domain uses `listRegistration` instead of `directRegistration` or `listWatchRegistration`. The `allowAny` flag tells the permission gate to register the domain if any check passes, passing the per-resource allow map to the register callback.

#### Example: namespace-rbac

```go
// domainpermissions/spec.go
{
    Domain: "namespace-rbac",
    Mode:   ModeAny,
    Reason: "rbac.authorization.k8s.io/roles,rolebindings,serviceaccounts",
    Runtime: []permissions.ResourceRequirement{
        list("rbac.authorization.k8s.io", "roles"),
        list("rbac.authorization.k8s.io", "rolebindings"),
        list("", "serviceaccounts"),
    },
},

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

### Guidelines For Future Changes

#### Adding A New Multi-Resource Domain

1. Define a `*Permissions` struct with `Include*` booleans for each resource.
2. Update `Register*Domain()` to accept the struct and conditionally wire listers.
3. Guard every lister call in `Build()` with a nil check.
4. In `registrations.go`, use `listRegistration` with `allowAny: true` and pass the `allowed` map to the permissions struct.
5. In `domainpermissions/spec.go`, add a `ModeAny` runtime policy for the domain.
6. If the domain is resource-streamed, add its stream list/watch requirements to `domainpermissions/spec.go` so the stream contract remains aligned with snapshot runtime permissions.
7. Add the domain's resources to `preflightRequests` (usually automatic from the registration checks).
8. Update `TestDomainRegistrationOrder` in `registrations_test.go` if the domain is new.

#### Adding A New Single-Resource Domain

Use `ModeAll` in `domainpermissions/spec.go` and `directRegistration` in `registrations.go`. No permissions struct is needed.

#### Common Mistakes To Avoid

- **Using `ModeAll` for multi-resource domains** -- This blocks the entire domain when any single resource is denied, even when the user has valid access to other resources. Use `ModeAny` with the partial-data pattern instead.
- **Forgetting nil-lister guards** -- If a domain uses the partial-data pattern, every lister access in `Build()` must check for nil. Otherwise a nil pointer panic will crash the snapshot build.
- **Mismatched keys between registrations.go and domainpermissions/spec.go** -- The `allowed` map keys use the format `group/resource` where the empty group is represented as `core` (e.g., `core/pods`, `rbac.authorization.k8s.io/roles`). The shared policy requirements use the Kubernetes API group as-is (empty string for core). Make sure the keys in the `register` callback match what `listAllowedByKey` produces.
- **Adding SSAR checks without considering cache pressure** -- Each new permission requirement adds SSAR calls at startup and potentially at runtime. Keep the number of resources per domain reasonable and rely on `preflightRequests` to pre-warm the cache.
- **Modifying `PermissionCacheTTL` or `PermissionCacheStaleGracePeriod` without understanding the tradeoff** -- Shorter TTLs detect RBAC changes faster but increase SSAR load. The stale grace period must be shorter than the TTL to be meaningful. Current values: TTL=2m, grace=30s.

#### Testing

- **`registrations_test.go`** -- `TestDomainRegistrationOrder` must list every domain in the exact registration order. Update it when adding or reordering domains.
- **`registrations_test.go`** -- `TestDomainRegistrationsHaveRuntimePermissionPolicyOrExemption` requires every registered refresh domain to have a runtime permission contract or a documented exemption.
- **`registrations_test.go`** -- `TestDomainPermissionContractsJoinExpectedRequirementSources` requires every resource-streamed domain to include the corresponding snapshot runtime resources.
- **`domainpermissions/access_test.go`** -- Tests the shared runtime access adapter, including `ModeAll`, `ModeAny`, unknown domains, and denial reasons.
- **`service_test.go`** -- Tests the snapshot runtime permission gate. `TestServiceBuildBlocksPermissionDenied` must deny ALL resources for `ModeAny` domains. `TestServiceBuildAllowsPartialPermissions` verifies that partial access works. `TestServiceBuildSkipsEnsureForPermissionDeniedDomain` verifies the SSAR skip optimization.
- **`checker_test.go`** -- Tests cache behavior including stale-while-revalidate. `TestCheckerStaleWhileRevalidate` verifies stale returns + background refresh. `TestCheckerStaleGracePeriodExpired` verifies blocking fetch beyond grace.

#### Timing Constants Reference

| Constant                          | Default | Purpose                                                 |
| --------------------------------- | ------- | ------------------------------------------------------- |
| `PermissionCacheTTL`              | 2 min   | How long SSAR decisions are cached before expiry        |
| `PermissionCacheStaleGracePeriod` | 30 sec  | Window beyond TTL where stale cache is served           |
| `PermissionCheckTimeout`          | 5 sec   | Timeout for individual SSAR calls                       |
| `PermissionPrimeTimeout`          | 10 sec  | Timeout for pre-warming the permission cache at startup |
| `PermissionPreflightTimeout`      | 15 sec  | Timeout for the full preflight permission check phase   |

---

## UI Action Permissions

This section covers the frontend/backend evaluator that gates context menu
actions, object-panel controls, and permission diagnostics. It is a separate
runtime path from refresh-domain permission evaluation, but it shares the same
contract rule: concrete checks must carry explicit cluster, group, version,
kind, namespace, name, verb, and subresource where applicable.

### Architecture

The UI permission system replaces per-check SSAR calls with per-namespace SSRR (SelfSubjectRulesReview) calls. One SSRR API call returns all RBAC rules for the current user in a given namespace. The backend matches permission queries locally against the cached rules.

Cluster-scoped resources (Nodes, PVs, StorageClasses, ClusterRoles, etc.) are routed to SSAR because namespace-scoped SSRR responses can contain false positives from namespace RoleBindings referencing ClusterRoles.

### Key files

| File                                                    | Role                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/capabilities/query.go`                         | `PermissionQuery`, `PermissionResult`, `NamespaceDiagnostics`, `QueryPermissionsResponse` types. `PermissionQuery` carries explicit `Group`/`Version` fields. |
| `backend/capabilities/rules.go`                         | SSRR cache (TTL + stale grace, singleflight), SSRR fetch, rule matching engine                                                                                |
| `backend/app_permissions.go`                            | `QueryPermissions` Wails endpoint. `resolveGVRForPermissionQuery` routes each query through the strict GVK resolver; SSRR matching; SSAR fallback             |
| `backend/objectcatalog/identity.go`                     | Catalog-backed strict group+version+kind resolver implementation, built-in seed list, discovery hydration, and CRD fallback.                                  |
| `backend/resources/common/resource_identity.go`         | `ResourceResolver` / `ResolvedResource` — the shared resolver contract used by permission/action/YAML callers.                                                |
| `backend/resources/common/discover.go`                  | `DiscoverGVRByKind` — a kind-only walker retained only for the mutation path's partial-discovery safety net. Explicitly documented as non-deterministic.      |
| `backend/internal/config/config.go`                     | `SSRRFetchTimeout` constant                                                                                                                                   |
| `frontend/src/core/capabilities/permissionStore.ts`     | Frontend permission store — calls `QueryPermissions`, caches results, periodic refresh. Owns the GVK-aware permission key format.                             |
| `frontend/src/core/capabilities/permissionFeatures.ts`   | Stable feature keys and display labels used by permission specs, diagnostics, and capability catalogs                                                        |
| `frontend/src/core/capabilities/permissionSpecs.ts`     | Static permission spec lists (`ALL_NAMESPACE_PERMISSIONS`, `CLUSTER_PERMISSIONS`)                                                                             |
| `frontend/src/core/capabilities/permissionTypes.ts`     | `PermissionSpec`, `PermissionEntry`, `PermissionStatus`, `PermissionQueryDiagnostics`                                                                         |
| `frontend/src/core/capabilities/hooks.ts`               | `useCapabilities()` hook (ad-hoc queries), `useCapabilityDiagnostics()` hook                                                                                  |
| `frontend/src/core/capabilities/bootstrap.ts`           | Thin delegation layer — `initializeUserPermissionsBootstrap`, `useUserPermissions`, `getPermissionKey`                                                        |
| `frontend/src/shared/actions/objectActionPermissionMatrix.ts` | UI-visible mutating action matrix mapping action ids to frontend permission descriptors, Wails methods, backend checks, and denied reasons |
| `backend/objectcatalog/builtin-resource-identities.json` | Backend-owned source of truth for built-in K8s Kind → GroupVersion/Resource/scope. |
| `frontend/src/shared/constants/builtinGroupVersions.ts` | `resolveBuiltinGroupVersion(kind)` — frontend adapter over the backend-owned built-in identity contract. Plus `parseApiVersion` / `formatBuiltinApiVersion` helpers. |

### How `QueryPermissions` works

Each `PermissionQuery` carries a fully-qualified `(Group, Version, Kind)` — empty `Version` is a hard error. Callers populate Group/Version via `resolveBuiltinGroupVersion(kind)` for built-ins (automatic in `permissionStore.getPermissionKey` and `buildBatch`) or via the CRD's apiGroup/apiVersion explicitly for custom resources (e.g. `queryKindPermissions(kind, ns, cid, group, version)`).

For each permission check in a batch:

1. `resolveGVRForPermissionQuery` calls the injected `ResourceResolver` to turn the query's `(Group, Version, Kind)` into a `GroupVersionResource`. Group and version are matched **strictly** (case-sensitive, no wildcards); there is no kind-only fallback. A query with `Version == ""` returns an error rather than silently picking whichever GVR discovery yielded first.
2. If the resolved resource is non-namespaced (cluster-scoped), route directly to SSAR.
3. If namespaced, look up cached SSRR rules for `(clusterId, namespace)`. Fetch SSRR if not cached.
4. Match against the SSRR rules (apiGroup, resource, verb, subresource, resourceNames — with wildcard handling).
5. If matched → `allowed: true, source: "ssrr"`.
6. If not matched and SSRR `incomplete` is false → `allowed: false, source: "denied"`.
7. If not matched and SSRR `incomplete` is true → fire individual SSAR, return with `source: "ssar"`.

Error handling is per-item — a single failing namespace never takes down the entire batch.

#### Why strict GVK resolution

Earlier versions of the permission system resolved `resourceKind` to a GVR by walking discovery and returning the first match (the "kind-only resolver"). This broke when two CRDs from different API groups defined the same Kind — a concrete real-world collision is `DBInstance` being defined by both `rds.services.k8s.aws/v1alpha1` (AWS Controllers for Kubernetes) and `kinda.rocks/v1beta1` (db-operator). First-match-wins resolution meant the RBAC gate for "can I delete this DBInstance?" would silently be asked about whichever CRD discovery returned first, regardless of which one the user had actually clicked. The fix threaded explicit group/version through every permission-relevant surface (the Wails payload, the frontend cache key, the backend resolver) and retired the kind-only discovery cache.

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

Namespace SSRR responses include rules from namespace RoleBindings that reference ClusterRoles. A RoleBinding in `"default"` referencing a ClusterRole with Node rules would make those rules appear in the SSRR response, but the RoleBinding does not grant cluster-wide access. To prevent false positives, `QueryPermissions` detects non-namespaced resources via the strict GVK resolver's `namespaced` flag and routes them to SSAR, never SSRR matching.

### Frontend query flow

**Single namespace** — When a namespace is selected, `queryNamespacePermissions` sends all namespace permission specs in one `QueryPermissions` batch. Results are cached by the store and reused until the 2-minute refresh interval.

**Cluster connect** — `queryClusterPermissions` sends all cluster permission specs. The backend routes them to SSAR (cluster-scoped resources).

**All Namespaces** — An effect collects distinct `(clusterId, namespace)` pairs from loaded domain data and calls `queryNamespacePermissions` for each. `queryNamespacePermissions` skips namespaces that already have fresh results within TTL, so only genuinely new namespaces trigger backend calls.

**CRD custom resources** — Lazy-loaded on first context menu open via `queryKindPermissions(kind, namespace, clusterId, group, version)`. **Callers MUST supply explicit `group` and `version`** for colliding-Kind CRDs — without them, the backend's strict resolver hard-errors. `NsViewCustom`/`ClusterViewCustom` pass `resource.apiGroup` and `resource.apiVersion` from the catalog row; `BrowseView`'s context menu reads `row.item.group`/`row.item.version`. Queries delete/patch permissions for the specific CRD GVK. Results are cached per-GVK (two DBInstance CRDs from different groups get distinct cache entries). Diagnostics use the stable `namespace.custom` or `cluster.custom` feature keys and render their user-facing labels separately.

**Periodic refresh** — A 2-minute `setInterval` re-queries any `(clusterId, namespace)` pair whose last query is older than the interval. Namespace refreshes are staggered by 500ms to avoid thundering herd.

### Frontend types

- `PermissionSpec` — Static descriptor: `{ kind, verb, subresource?, group?, version? }`. Built-in specs omit `group`/`version` (they're auto-resolved from `resolveBuiltinGroupVersion(kind)` at key-build time); CRD specs MUST supply them explicitly. Grouped into `PermissionSpecList` with a stable `PermissionFeatureKey` for diagnostics filtering.
- `PermissionEntry` — Stored result from the backend: `{ allowed, source, reason, descriptor, feature }`. The `descriptor` carries `group`/`version` alongside `resourceKind`.
- `PermissionStatus` — Public type from `useUserPermissions()`: `{ id, allowed, pending, reason, error, source, descriptor, feature, entry: { status } }`. The `entry.status` field (`'loading' | 'ready' | 'error'`) is used by `ClusterResourcesContext` and `ClusterResourcesManager` to distinguish definitive denials from transient errors.
- `PermissionFeatureKey` — Stable feature identity from `permissionFeatures.ts`. Display text comes from `PERMISSION_FEATURE_LABELS`, so copy changes do not change diagnostics filtering.

### Permission key format

All permission lookups use `getPermissionKey()` which produces:

```
${clusterId}|${group}/${version}|${resourceKind}|${verb}|${namespace_or_'cluster'}|${subresource_or_''}
```

- `clusterId`, `resourceKind`, `verb`, `namespace`, `subresource` are lowercased.
- `group` and `version` are **case-sensitive** — Kubernetes API groups and versions are RFC 1123 DNS labels, never case-insensitive. Lowercasing them would collapse `rds.services.k8s.aws` and `RDS.SERVICES.K8S.AWS` into the same cache entry, which is exactly the kind of collision this segment exists to prevent.
- Null namespace becomes the literal string `'cluster'`. Empty subresource becomes `''`.
- Empty `group` (for core resources like Pods, Services) renders as a leading slash: `|/v1|pod|...`. Two core resources can't share a Kind, but the segment format stays uniform.

When the frontend caller doesn't supply `group`/`version`, `resolvePermissionGVK` auto-resolves from the backend-owned built-in identity contract via the frontend adapter (so `resolveBuiltinGroupVersion('Pod')` returns `{ group: '', version: 'v1' }`). CRD callers supply explicit values — the same group/version they'd use to write an apiVersion string.

The GVK segment was added as part of the kind-only-objects fix. Before it, the cache was keyed by `resourceKind` alone, and two CRDs from different groups sharing a Kind would overwrite each other's permission entries. A user viewing an ACK `DBInstance` might see a delete button reflecting the permission the user had for the db-operator `DBInstance` in the same namespace — security-relevant.

### Diagnostics

The Diagnostics panel has two permission-related tabs:

- **Capabilities Checks** — Per-namespace batch diagnostics showing SSRR method, incomplete flag, rule count, SSAR fallback count, duration, and error state.
- **Effective Permissions** — Per-permission rows showing allowed/denied status, source, reason, and error. Filtered by active cluster and feature-scoped by view type.

Both tabs filter to the active cluster only — permissions from other clusters are never shown.

Diagnostics filtering uses stable feature keys from `PERMISSION_FEATURES`, not
display labels. When adding a permission feature, update
`PERMISSION_FEATURE_LABELS` and the scoped feature maps in
`diagnosticsPanelConfig.ts`; `permissionFeatures.test.ts` verifies specs,
capability definitions, and diagnostics filters all resolve to known labels.

### Action and capability parity

UI-visible mutating actions must be represented in
`OBJECT_ACTION_PERMISSION_MATRIX`. Each entry names the action id, frontend
permission descriptor, Wails method, backend permission check, and the
denied/pending reason source shown by the UI.

Derived UI actions that reuse the same backend operation still get their own
matrix entries. For example, regular `Scale`, HPA-managed `Scale to 0`, and
HPA-managed `Resume from 0` all call `RunObjectAction(scale)` and require
`update` on the target workload `scale` subresource, but each label is a
separate action id so tests can keep visible behavior and permission gating in
sync.

The matrix is a contract test surface; it does not replace backend enforcement.
Every backend mutation path still checks RBAC immediately before mutating
cluster state. For example:

- `TriggerCronJob` requires `batch/v1` `Job create`.
- `SuspendCronJob` and resume require `batch/v1` `CronJob patch`.
- `RollbackWorkload` requires `update` on the target workload.
- `ScaleWorkload`, including `Scale to 0` and `Resume from 0`, requires
  `update` on the target workload `scale` subresource.
- Port-forward requires `create` on `Pod/portforward`.

### Timing constants

| Constant                                    | Default | Purpose                                                               |
| ------------------------------------------- | ------- | --------------------------------------------------------------------- |
| `SSRRFetchTimeout`                          | 5 sec   | Timeout for individual SSRR API calls                                 |
| `PermissionCacheTTL`                        | 2 min   | SSRR cache TTL (reuses the refresh subsystem constant)                |
| `PermissionCacheStaleGracePeriod`           | 30 sec  | Stale grace window beyond TTL (reuses the refresh subsystem constant) |
| `PERMISSION_REFRESH_INTERVAL_MS` (frontend) | 2 min   | Frontend periodic re-query interval                                   |
| `STAGGER_INTERVAL_MS` (frontend)            | 500 ms  | Delay between namespace refreshes in All Namespaces sessions          |

### Guidelines for the UI permission system

**Adding permissions for a new built-in resource kind** — Add a `PermissionSpec` entry to the appropriate list in `permissionSpecs.ts`. Leave `group` and `version` off; `resolvePermissionGVK` will auto-resolve from `resolveBuiltinGroupVersion(kind)`. If the kind is brand new, add it to `backend/objectcatalog/builtin-resource-identities.json` and `builtinResourceCatalog` in `backend/objectcatalog/identity.go`; the parity tests keep the frontend adapter aligned.

**Adding permissions for a CRD** — CRD specs MUST carry explicit `group` and `version`. The backend's strict resolver hard-errors on missing `Version`. In practice, CRD-scoped views use `queryKindPermissions(kind, namespace, clusterId, group, version)` rather than static `PermissionSpec` entries — see `NsViewCustom.getContextMenuItems` and `ClusterViewCustom.getContextMenuItems` for the canonical pattern.

**Adding a new view that needs permissions** — If the view uses `useUserPermissions()` and `getPermissionKey()` for built-in kinds, no changes are needed beyond adding the permission specs. For CRD kind permissions, call `queryKindPermissions` with the CRD's apiGroup/apiVersion threaded through from the row data — never let `group`/`version` be `undefined`.

**Feature keys for diagnostics** — The `feature` field on each `PermissionSpecList` must use `PERMISSION_FEATURES`. Add a display label in `PERMISSION_FEATURE_LABELS` and, when it should appear in a scoped diagnostics view, add the key to `CLUSTER_FEATURE_MAP` or `NAMESPACE_FEATURE_MAP`. Do not use user-facing copy as the filter key.

**Adding a UI-visible mutating action** — Add the shared object action descriptor, wire the frontend capability state, keep the backend Wails method's `resourcePermissionCheck`, and update `OBJECT_ACTION_PERMISSION_MATRIX`. Add or update tests for denied and pending UI states.

**Named-resource checks** — `useCapabilities()` supports `name` on descriptors for per-object permission checks (e.g., `NodeMaintenanceTab` checking if a specific node can be cordoned). Named results are stored in a hook-local `namedResults` map and do not overwrite name-free results in the public permission map.
