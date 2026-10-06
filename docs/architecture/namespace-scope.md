# Per-Cluster Namespace Scope ("Accessible Namespaces")

A cluster may have a persisted namespace scope (`allowedNamespaces` in the
per-cluster section of `settings.json`, keyed by `clusterId`). When non-empty,
every namespaced data path for that cluster runs per configured namespace
instead of cluster-wide. This serves identities with only per-namespace
RoleBindings (issue #243) and doubles as a noise/perf scope on large clusters.

## One code path, scope as a value

- There is no "restricted mode". Every enforcement point takes a namespace list;
  empty means cluster-wide, run as the same loop with one cluster-wide entry.
- `PreferencesService` is only the physical repository (shared settings
  document, file lock, atomic persistence). Validation,
  `Get/SetClusterAllowedNamespaces`, scope revision/health replay, coalescing,
  and persist-before-rebuild belong to `WorkspaceCoordinator`; replay state lives
  in the leaf `ClusterWorkspaceProjection`; subsystem work is delegated to
  `RefreshCoordinator`. Preferences never orchestrates namespace scope.
- A scope change rebuilds exactly that cluster's subsystem, which recreates the
  permission checker and so resets its SSAR cache
  (`NewSubsystemWithServices`, `backend/refresh/system/manager.go`).

## The source-scope rule

**A permission check's scope must always match its data source's scope.**

- `permissions.Checker.Can` fans out over the scope (any namespace allows;
  per-namespace results cached individually) only for resources whose data path
  is scoped: namespaced and ingest-owned (`scopedResourcePredicate`,
  `backend/refresh/system/manager.go`).
- Resources served from [cluster-wide sources](#deliberately-cluster-wide) keep
  cluster-wide checks, so their domains register only when the identity can read
  that source: a scoped identity sees honest permission denial, never a silently
  empty view. `Checker.CanClusterWide` and `ResourceRequirement.ClusterWide` are
  the explicit escape hatches (helm-storage gate, namespace-helm runtime policy).
- Per-namespace surfaces use `Checker.CanInNamespace` (the ingest permission
  filter checks each reflector's own namespace).

## Enforcement points

- **Namespaces domain** (`RegisterNamespaceDomain`,
  `backend/refresh/snapshot/namespaces.go`): scoped clusters synthesize
  name-only rows from the configured list, with no namespaces informer, no
  cluster permission, and runtime policy exempted. Browse namespace groups serve
  the same list (`catalogNamespaceGroups`).
  - Every domain has two permission gates: registration-time (gate/policy table)
    and serve-time (`ensurePermissions` re-runs the runtime policy per snapshot
    request, `backend/refresh/snapshot/service.go`). An exemption must cover
    both; `DomainConfig.RuntimePolicyExempt` is the single declaration the
    serve-time gate honors.
  - Workload presence comes from ingest. When nothing is tracked (pre-data or
    fully denied), rows report `workloadsUnknown` so the sidebar never dims them
    as authoritatively empty.
  - `unhealthyWorkloads` counts controller health from the retained object-map
    status projection plus non-terminal, ownerless pod aggregates (controller
    pods never count twice). The source signature includes these counts so a
    status-only transition invalidates the snapshot and rings the debounced
    doorbell.
  - Warning Event counts per involved-object namespace carry
    `warningEventsState`: `available` (authoritative zero), `loading` (allowed
    informer warming), or `unavailable` (list/watch source). Event handlers feed
    the namespace notifier; its signature ignores Normal-event churn and advances
    the `warning-events` source clock only when a visible count or source state
    changes. Events stay cluster-wide under a scope, so this aggregate is enabled
    only with cluster-wide list+watch on Events.
  - ResourceQuota ingest retains only a compact aggregate (namespace + highest
    used percentage). Rows expose quota count, strongest percentage, explicit
    source state, and backend-owned pressure (`warning` at 80%, `critical` at
    100%). The quota signature ignores churn that leaves the rollup unchanged and
    re-arms while the store warms, so an empty synced store becomes an
    authoritative zero.
  - Utilization is the separate `namespace-metrics` domain
    ([resource-metrics](resource-metrics.md)); metric collections never
    invalidate `namespaces` or ring its doorbell.
- **Ingest** (`backend/refresh/ingest/partition.go`): one reflector per (kind,
  namespace) writes one shared store through partition views.
  `ReplacePartition` defines only its own namespace and fans per-row sink events.
  Rejected: the bulk kind-wide Replace — it wipes sibling namespaces in
  maintained stores. Readiness counts only launched partitions; a denied
  namespace is skipped without blanking or blocking others; spill/restore keeps
  per-partition RVs for delta resume.
- **Object catalog**: collection fans out per namespace
  (`Dependencies.AllowedNamespaces`); one Forbidden namespace target is skipped,
  never failing the kind (`backend/objectcatalog/collect.go`). RBAC preflight
  evaluates namespaced descriptors per scope namespace (any-of), not one
  cluster-wide ask a scoped identity always fails (`preflightNamespaces`,
  `backend/objectcatalog/sync.go`).
- **Runtime-discovered resources**: ingest admits one watch per permitted
  namespace via the same partition filter as registry sources. Catalog LIST
  covers pending and LIST-only namespaces; watch reconciliation preserves those
  rows. Custom tables use the `catalog` domain with live page hydration.
- **Metrics**: the pod-metrics poll runs per scope namespace and merges successes
  (`backend/refresh/metrics/poller.go`); node metrics stay cluster-scoped and
  permission-degrade.
- **Object map**: Gateway API and HPA collectors read synchronized cluster-wide
  informer caches and filter namespaced objects to the scope. A scoped identity
  without cluster-wide list+watch gets an insufficient-permissions warning for
  those kinds. Rejected: per-namespace live-LIST fallback — graph builds issue
  no LIST calls.
- **UI** (`frontend/src/ui/layout/NamespaceScopeEditor.tsx`): the sidebar
  namespaces section is the editor (add affordance, per-row hover delete), and
  its affordances are deliberately the only "scope active" indicator. Validation
  is syntactic (DNS-1123); the backend re-validates. Scoped rows are enriched by
  a TTL-cached per-namespace GET probe (`probeScopedNamespace`): reachable
  namespaces show real phase/status; others carry `scopeStatus` `not-found`
  (permitted GET returned 404, definitive) or `no-access` (403; existence
  unknowable). Probe transitions advance the `scope-probe` source clock.

## Scope-change convergence (the `cluster:scope:changed` event)

- `WorkspaceCoordinator` persists through `PreferencesService`, then rebuilds the
  cluster's subsystem through the coordinated selection-mutation path. Rapid
  edits coalesce: a queued rebuild absorbs later edits; a started one queues a
  fresh rebuild.
- The frontend must not refetch on save: the rebuild takes seconds and an
  immediate fetch caches the stale pre-rebuild snapshot.
- After the rebuild the backend emits `cluster:scope:changed`
  (`performClusterScopeRebuild`, `backend/workspace_namespace_scope.go`). The
  orchestrator clears that cluster's permission-denied latches
  (`resetPermissionDeniedScopedDomainStates`; a scope rebuild is an in-session
  permission epoch change), restarts streaming, and NamespaceContext refetches
  the namespaces domain.

## Fail-fast contract for denied domains

A typed 403 (`SnapshotPermissionDeniedError`) is a settled answer everywhere it
surfaces:

- The orchestrator stamps the scope `permissionDenied` and stops background
  refetches.
- The typed query hook reads the stamp and settles without warm-up retries; the
  shared table shows "Insufficient permissions" (`resolveEmptyStateMessage`), not
  a spinner or generic failure.
- A stream permission error frame blocks that scope's streaming
  (`refresh:resource-stream-permission-denied` → `blockStreaming`) instead of
  resync-looping.

Manual refresh re-asks; otherwise all three latches hold until that cluster's
`cluster:scope:changed`, `cluster:permissions:changed`
([permissions](permissions.md#refresh-permission-rules)), or auth recovery
releases them.

## Deliberately cluster-wide

The typed shared-informer factory's namespaced informers (events, replicasets,
HPA v1/v2), the Gateway API informer factory, and the helm-storage factory watch
cluster-wide. Under a scope their domains stay gated on the cluster-wide check
(honest denial). Scoping them needs N per-namespace client-go factories plus
multiplexed listers/handlers at each consumer; do not call those domains
namespace-scoped until fan-out, lifecycle, and permissions exist end to end.
Per-namespace GET row enrichment uses the canonical capability path but does not
make those watches namespace-scoped.
