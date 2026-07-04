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
  `backend/refresh/snapshot/namespaces.go`). Workload presence still comes
  from ingest; when NOTHING is tracked (pre-data or fully denied), rows
  report `workloadsUnknown` so the sidebar never dims them as
  authoritatively empty. Browse's namespace groups serve the same list
  (`catalogNamespaceGroups`).
- **Ingest**: one reflector per (kind, namespace) writing ONE shared store
  through partition views; `ReplacePartition` fully defines only its own
  namespace and fans per-row sink events (never the bulk kind-wide Replace,
  whose contract would wipe sibling namespaces in maintained stores) —
  `backend/refresh/ingest/partition.go`. Readiness counts only launched
  partitions; a denied namespace is skipped without blanking or blocking the
  others; spill/restore keeps per-partition RVs for delta resume.
- **Object catalog**: collection fans out per namespace
  (`Dependencies.AllowedNamespaces`), and one Forbidden namespace target is
  skipped, never failing the kind (`backend/objectcatalog/collect.go`).
- **Resource stream**: per-CRD dynamic informers fan out per namespace for
  namespaced CRDs; the namespace-custom all-namespaces view lists per scope
  namespace with per-target Forbidden skip.
- **Metrics**: the pod-metrics poll runs per scope namespace and merges the
  successes (`backend/refresh/metrics/poller.go`); node metrics stay
  cluster-scoped and permission-degrade as before.
- **Object map**: the live-LIST collectors (gateway kinds, HPA v2) list per
  scope namespace; cluster-scoped kinds keep one cluster-wide list.
- **UI**: the sidebar namespaces section IS the editor — add affordance +
  per-row hover delete (`frontend/src/ui/layout/NamespaceScopeEditor.tsx`).
  The editing affordances are also the only "scope active" indicator by
  design. Validation is syntactic (DNS-1123); the backend re-validates.

## Deliberately cluster-wide (follow-up: scope the factory-backed kinds)

The typed shared-informer factory's namespaced informers (events,
replicasets, HPA v1), the Gateway API informer factory, and the helm-storage
factory still watch cluster-wide. Under a scope their domains stay
permission-gated on the cluster-wide check (honest denial). Scoping them
means N per-namespace client-go factories plus multiplexed listers/handlers
at each consumer — tracked as the remaining Phase 4 slice in
`docs/plans/namespace-scope.md`, along with per-namespace GET row enrichment
(Phase 5) and the SSRR check optimization (reuse `backend/capabilities`).
