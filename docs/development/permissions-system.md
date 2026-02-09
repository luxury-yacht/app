# Permissions system

This document explains how Luxury Yacht checks Kubernetes RBAC permissions at startup and at runtime, how domains degrade gracefully when a user has partial access, and what to watch out for when adding or modifying domains.

## Overview

The permissions system operates at two stages:

1. **Startup (registration time)** -- Before any user request arrives, the refresh subsystem probes the Kubernetes API to discover which resources the current identity can access. Domains that fail all permission checks are registered as permission-denied placeholders.
2. **Runtime (per-request)** -- On every snapshot request, `ensurePermissions()` re-validates the caller's access so that RBAC revocations are detected without restarting the app.

Both stages rely on `SelfSubjectAccessReview` (SSAR) calls issued through the `permissions.Checker`.

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

Without it, every snapshot request hitting an expired cache entry blocks on an SSAR call. When the namespace changes, `evaluateNamespacePermissions` fires ~70 SSAR calls through the same rate limiter. If domain permission checks also need to block on SSAR calls simultaneously, the combined load causes 5+ second delays. Stale-while-revalidate lets domain requests proceed with the last-known-good decision while the refresh happens in the background.

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
