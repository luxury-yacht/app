# Per-Cluster Namespace Scope ("Accessible Namespaces")

A cluster can be given a persisted namespace scope (`allowedNamespaces` in
the per-cluster section of `settings.json`, keyed by clusterId). When the
scope is non-empty, every namespaced data path for that cluster runs per
configured namespace instead of cluster-wide, which makes the app usable for
identities whose RBAC grants only per-namespace RoleBindings (issue #243) and
doubles as a noise/perf scope on large clusters.

## One code path, scope as a value

There is no "restricted mode". Every enforcement point takes a list of
namespaces where the empty list means cluster-wide; the unscoped path is the
same loop with a single cluster-wide entry. Changing the scope
(`SetClusterAllowedNamespaces`) persists first, then tears down and rebuilds
exactly that cluster's subsystem — the rebuild recreates the permission
checker, so the SSAR cache resets with it
(`backend/refresh/system/manager.go` `NewSubsystemWithServices`).

## The source-scope rule

**A permission check's scope must always match its data source's scope.**

- `permissions.Checker.Can` fans out over the scope (any-namespace-allows,
  per-namespace results cached individually) ONLY for resources whose data
  path is scoped — the predicate is "namespaced && ingest-owned"
  (`scopedResourcePredicate`, `backend/refresh/system/manager.go`).
- Resources served from cluster-wide sources (events, HPA, replicasets,
  gateway informers, the helm-storage factory) keep cluster-wide checks, so
  their domains register only when the identity can actually read the
  source: a scoped identity sees an honest permission-denied state, never a
  silently-empty view. `Checker.CanClusterWide` and
  `ResourceRequirement.ClusterWide` are the explicit escape hatches
  (helm-storage gate, namespace-helm runtime policy).
- Per-namespace surfaces use `Checker.CanInNamespace` (the ingest
  permission filter checks each reflector's own namespace).

## Enforcement points

- **Namespaces domain**: scoped clusters synthesize name-only rows from the
  configured list — no namespaces informer, no cluster permission, runtime
  policy exempted (`RegisterNamespaceDomain`,
  `backend/refresh/snapshot/namespaces.go`). NOTE: every domain has TWO
  permission gates — registration-time (the gate/policy table) and
  serve-time (`ensurePermissions` re-runs the runtime policy on every
  snapshot request, `backend/refresh/snapshot/service.go`). An exemption
  must cover both: `DomainConfig.RuntimePolicyExempt` is the single
  declaration the serve-time gate honors. Workload presence still comes
  from ingest; when NOTHING is tracked (pre-data or fully denied), rows
  report `workloadsUnknown` so the sidebar never dims them as
  authoritatively empty. Browse's namespace groups serve the same list
  (`catalogNamespaceGroups`). Each row also carries `unhealthyWorkloads`:
  controller health is counted from the retained object-map status projection,
  while only non-terminal, ownerless pod aggregates count as standalone
  workload rows. The namespaces source signature includes these counts so a
  status-only transition invalidates the snapshot and rings the same debounced
  doorbell without counting controller-owned pods twice. The same summary
  counts current Warning Event objects by involved-object namespace.
  `warningEventsState` distinguishes an authoritative `available` zero from an
  allowed informer that is still `loading` and an `unavailable` list/watch
  source. Event add/update/delete handlers feed the namespace notifier; its
  warning-count signature suppresses Normal-event churn and changes the
  snapshot's `warning-events` source clock when a visible count or source state
  changes. Events remain cluster-wide under a configured namespace scope, so
  this optional aggregate is enabled only when the identity can list and watch
  that cluster-wide source. Namespace utilization is served independently by
  the metric-only `namespace-metrics` domain and joined in visible namespace
  consumers by full Namespace identity. Metric collections advance only that
  domain's metric clock; they do not invalidate `namespaces` or ring its object
  doorbell. ResourceQuota
  ingest retains a compact aggregate half (namespace + highest used percentage)
  rather than the typed object or table row. Namespace rows expose quota count,
  the strongest percentage, explicit source state, and backend-owned pressure
  presentation (`warning` at 80%, `critical` at 100%). The quota signature
  suppresses object churn that does not change a namespace rollup and re-arms
  while the ResourceQuota store is warming so an empty synced store becomes an
  authoritative zero.
- **Ingest**: one reflector per (kind, namespace) writing ONE shared store
  through partition views; `ReplacePartition` fully defines only its own
  namespace and fans per-row sink events (never the bulk kind-wide Replace,
  whose contract would wipe sibling namespaces in maintained stores) —
  `backend/refresh/ingest/partition.go`. Readiness counts only launched
  partitions; a denied namespace is skipped without blanking or blocking the
  others; spill/restore keeps per-partition RVs for delta resume.
- **Object catalog**: collection fans out per namespace
  (`Dependencies.AllowedNamespaces`), and one Forbidden namespace target is
  skipped, never failing the kind (`backend/objectcatalog/collect.go`). The
  catalog's RBAC preflight asks the same way: namespaced descriptors are
  evaluated per scope namespace (any-of) instead of one cluster-wide ask
  that a scoped identity always fails (`backend/objectcatalog/sync.go`,
  `preflightNamespaces`).
- **Resource stream**: per-CRD dynamic informers fan out per namespace for
  namespaced CRDs; the namespace-custom all-namespaces view lists per scope
  namespace with per-target Forbidden skip.
- **Metrics**: the pod-metrics poll runs per scope namespace and merges the
  successes (`backend/refresh/metrics/poller.go`); node metrics stay
  cluster-scoped and permission-degrade as before.
- **Object map**: Gateway API and HPA collectors read synchronized cluster-wide
  informer caches and filter namespaced objects to the configured scope; graph
  builds do not issue Kubernetes LIST calls. Because those sources are
  cluster-wide, a namespace-scoped identity without cluster-wide list+watch is
  shown an insufficient-permissions warning for the affected kinds instead of
  receiving a per-namespace live-LIST fallback.
- **UI**: the sidebar namespaces section IS the editor — add affordance +
  per-row hover delete (`frontend/src/ui/layout/NamespaceScopeEditor.tsx`).
  The editing affordances are also the only "scope active" indicator by
  design. Validation is syntactic (DNS-1123); the backend re-validates.
  Scoped rows are enriched by a TTL-cached per-namespace GET probe
  (`probeScopedNamespace`): reachable namespaces serve their real
  phase/status; unreachable entries carry `scopeStatus` — "not-found"
  (permitted GET returned 404, definitive) or "no-access" (403 — may not
  exist; a restricted identity cannot distinguish). Probe transitions
  publish the "scope-probe" source clock so flag changes are delivered.

## Scope-change convergence (the `cluster:scope:changed` event)

A scope edit persists first, then rebuilds the cluster's subsystem through
the coordinated selection-mutation path (rapid edits coalesce: a queued
rebuild absorbs later edits; one that already started queues a fresh one).
The frontend must NOT refetch on save — the rebuild takes seconds and an
immediate fetch caches the stale pre-rebuild snapshot. Instead the backend
emits `cluster:scope:changed` after the rebuild
(`performClusterScopeRebuild`, `backend/app_cluster_settings.go`); the
orchestrator then clears every permission-denied scope latch (a scope
rebuild is the one in-session permission epoch change —
`resetPermissionDeniedScopedDomainStates`, otherwise denied scopes never
re-ask by design), restarts streaming, and NamespaceContext refetches the
namespaces domain.

## Fail-fast contract for denied domains

A typed 403 is a SETTLED answer everywhere it can surface: the orchestrator
stamps `permissionDenied` and stops background refetches; the typed query
hook reads the stamp, settles without warm-up retries, and the shared table
rendering shows "Insufficient permissions" (`resolveEmptyStateMessage`)
instead of a spinner or generic failure; a stream permission error frame
blocks that scope's streaming (`refresh:resource-stream-permission-denied` →
`blockStreaming`) instead of resync-looping. All three latches release on a
namespace-scope change or auth recovery.

## Deliberately cluster-wide (follow-up: scope the factory-backed kinds)

The typed shared-informer factory's namespaced informers (events,
replicasets, HPA v1/v2), the Gateway API informer factory, and the helm-storage
factory still watch cluster-wide. Under a scope their domains stay
permission-gated on the cluster-wide check (honest denial). Scoping them
means N per-namespace client-go factories plus multiplexed listers/handlers
at each consumer — tracked as the remaining Phase 4 slice in
`docs/plans/namespace-scope.md`, along with per-namespace GET row enrichment
(Phase 5) and the SSRR check optimization (reuse `backend/capabilities`).
