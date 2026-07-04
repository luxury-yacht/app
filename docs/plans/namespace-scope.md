# Per-Cluster Namespace Scope ("Accessible Namespaces")

Issue: [#243](https://github.com/luxury-yacht/app/issues/243)
Todo item: `docs/todo.md` — "Allow the user to manually add namespaces if they
don't have list namespaces permissions."

A user whose RBAC grants access to only a few namespaces (RoleBindings, no
cluster-wide grants) cannot use the app today: every cluster-wide LIST/WATCH
and every cluster-scoped SelfSubjectAccessReview is denied, so nearly every
domain registers as permission-denied. This plan adds a per-cluster list of
namespaces the app should operate in. When the list is set, all namespaced
data paths run per-namespace instead of cluster-wide.

## Current state (verified 2026-07-04)

- Every ingest reflector LIST/WATCHes cluster-wide. Both creation sites live
  in `backend/refresh/ingest/manager.go`: `installReflector` (line 231,
  `cache.NewListWatchFromClient(..., metav1.NamespaceAll, ...)`) and
  `dynamicListWatch` (line 332, `.Namespace(metav1.NamespaceAll)`).
- Every permission check is a cluster-scoped SSAR — no
  `ResourceAttributes.Namespace`, no namespace in the cache key
  (`backend/refresh/permissions/checker.go:86-94`).
- The `namespaces` domain fails fast by design when cluster-wide list is
  denied, with manual namespace entry named as the future work
  (`backend/refresh/system/registrations.go:260-284`). The sidebar renders
  "You do not have permission to list namespaces."
  (`frontend/src/ui/layout/Sidebar.tsx:412-418`).
- The object catalog collects every GVR cluster-wide: `sync.go:402` passes
  `nil` namespaces into `collectResource`, but the whole collect layer is
  already namespace-parameterized (`backend/objectcatalog/collect.go:27,95`,
  `helpers.go:52-72`) — the hook exists, it is just never fed.
- There are THREE cluster-wide shared-informer factories, not one: the typed
  factory (`backend/refresh/informer/factory.go:135`), the label-filtered
  Helm storage factory (`backend/refresh/informer/helm_storage.go:108`,
  gated by cluster-scoped secret/configmap SSAR at lines 117-123), and the
  Gateway API factory (`backend/cluster_clients.go:362`) which serves the
  namespaced gateway kinds (`backend/objectcatalog/collect.go:80-89`). The
  resource-stream dynamic informers are namespace-parameterized but fed
  `NamespaceAll` (`backend/refresh/resourcestream/manager.go:463-467,504`).
- The pod-metrics poller lists cluster-wide
  (`backend/refresh/metrics/poller.go:409`, `PodMetricses("")`). With the
  serve-time metric join, a scoped user gets no pod metrics unless the
  poller fans out per namespace. Node metrics (`poller.go:368`) is a
  cluster-scoped concern and can stay permission-gated like other
  cluster-scoped kinds.
- The object map does direct cluster-wide LISTs outside ingest: seven
  gateway kinds (`backend/resources/{gateway,httproute,tlsroute,grpcroute,listenerset,referencegrant,backendtlspolicy}/objectmapnode.go:18`)
  and HPA (`backend/refresh/snapshot/object_map.go:516`).
- The CRD-backed namespace-custom domain lists each namespaced CRD at
  `NamespaceAll` when the view scope is all-namespaces
  (`backend/refresh/snapshot/namespace_custom.go:164-168`); errors route
  through `shouldSkipError`, so under a scoped cluster the all-namespaces
  variant would silently serve nothing.
- The catalog snapshot carries its own namespace-groups payload via
  `ObjectCatalogNamespaces` (`backend/app_refresh_setup.go:234` →
  `backend/app_object_catalog.go:373`) — Browse's namespace list is a
  separate consumer from the sidebar's `namespaces` domain.
- Degrade-only cluster-wide reads (no scope plumbing planned; must 403
  gracefully): ClusterRole details lists RoleBindings cluster-wide
  (`backend/resources/clusterrole/details.go:68`); object events for
  cluster-scoped objects list at `NamespaceAll`
  (`backend/refresh/snapshot/object_events.go:176,194`) — only reachable in
  scoped mode by the perf-scope persona, whose RBAC permits it.
- There is no per-cluster settings store. Persisted settings are global
  (`backend/app_settings.go:68`). Per-cluster keying precedents: favorites
  and tab order key by clusterId (`kubeconfigName:context`,
  `backend/kubeconfig_selection.go:122`); grid tables key by a hash of
  `path:context`.
- `system.Config` (`backend/refresh/system/manager.go:55`) is the single
  struct through which per-cluster configuration reaches subsystem
  construction. `rebuildClusterSubsystem` (`backend/cluster_auth.go:191`) is
  the existing single-cluster teardown-and-rebuild path (used by auth
  recovery).

## Reference behavior (Lens/OpenLens/Freelens)

Per-cluster "Accessible Namespaces" setting: a free-form list of namespace
names. When non-empty: the namespace list is synthesized from the setting
(no LIST, no WATCH of namespaces), and every namespaced resource store does
one LIST + one WATCH per configured namespace. Cluster-scoped resources are
gated independently by SSAR. When the cluster-wide namespace LIST 403s and
no list is configured, a notification deep-links to the setting.

Documented pitfalls to avoid (from lensapp/lens issues #2111, #2010, #1946,
#2209): (a) "configured list" and "discovered list" as two separate code
paths drift and break independently; (b) one forbidden namespace must not
blank the others; (c) list permission does not imply watch permission.

## Design

### Guiding principle: one code path, scope as a value

Do not build a parallel "restricted mode". Every namespaced data path gains
an explicit scope value — a list of namespaces where `[""]`
(`metav1.NamespaceAll` is the empty string) means cluster-wide. Unscoped
clusters run the same loop with a one-element `[""]` list and produce
exactly today's objects. This makes the Lens dual-path drift structurally
impossible and keeps the change testable as a pure generalization.

### Setting

`allowedNamespaces: string[]` per cluster, empty by default. Non-empty means
the scope applies unconditionally (not only when cluster-wide access is
denied) — one predictable behavior, and it doubles as a noise/perf scope on
large clusters. Stored in a new per-cluster section of `settings.json`
keyed by clusterId, matching the favorites/tab-order precedent. Changing
the setting triggers a single-cluster teardown and rebuild modeled on
`rebuildClusterSubsystem`, which should also reset the SSAR cache — Phase 1
must confirm the rebuild path actually recreates the permission checker
(stale SSAR results after a scope change would mimic the known
reconnect-after-RBAC-change issue).

Cost note: because the scope applies unconditionally, a user configuring
many namespaces on a large cluster gets kinds × namespaces watch streams
(Lens has the same model). Phase 5 adds a soft warning in the editor above
a threshold list size rather than any hard cap.

### Enforcement points (all behind the same scope value)

| Surface | Change |
| --- | --- |
| Ingest reflectors | `installReflector`/`dynamicListWatch` fan out one reflector per scope entry per GVR (namespaced kinds only). `[""]` degenerates to today's single reflector. |
| Ingest stores | Replace from one namespace's reflector must not wipe rows from sibling namespaces. Same bug class as the multi-kind unscoped `BundleSink` wipe. Preferred direction for the Phase 4 design pass: one entry/store per (GVR, namespace) with a merged read path — keeps each reflector's Replace = full-state contract intact and sidesteps the wipe bug class structurally, vs. defending against it with source-partitioned Replace. |
| Permission checks | Checks gain a namespace dimension (attributes + cache key, `checker.go:254` is `group/resource/verb` today). Scoped clusters check per configured namespace; a domain registers if allowed in at least one namespace; unscoped clusters check `""` = today. Strategy (SSAR fan-out vs per-namespace `SelfSubjectRulesReview`) is open decision 4. |
| `namespaces` domain | When scope is set, register a variant that serves the configured names without the cluster-wide gate (rows enriched per-namespace where permitted; workload presence comes from scoped ingest as today). |
| Object catalog | Feed the scope into `collectResource` (the `nil` at `sync.go:402`); per-namespace machinery already exists. Also feed the synthesized names into the catalog's namespace-groups payload (`ObjectCatalogNamespaces`) so Browse and the sidebar agree. |
| Shared informer factories (×3) | Typed, Helm storage, and Gateway API factories all need per-namespace scoping for namespaced kinds (client-go `WithNamespace` takes one namespace). Helm storage additionally moves its secret/configmap gate from cluster-scoped to per-namespace (decided: Helm is included in scoped mode from Phase 4, not deferred). Cluster-scoped kinds (nodes, CRDs, *Class kinds) are unaffected — they stay permission-gated and degrade exactly as shipped in #244/#246. |
| Resource stream | Pass scope namespaces into the already-parameterized `NewFilteredDynamicInformer` call. Also fan out the namespace-custom domain's all-namespaces LIST (`namespace_custom.go:164-168`) over the scope. |
| Metrics poller | `PodMetricses("")` (`poller.go:409`) fans out per scope entry; node metrics stays cluster-gated. Without this, scoped users get no pod metrics at all (serve-time join has no other source). |
| Object map | The seven gateway-kind direct LISTs (`objectmapnode.go:18`) and the HPA LIST (`object_map.go:516`) loop the scope entries. Everything else reaches the map via ingest stores and is covered by the ingest rows above. |

Degrade-only surfaces (no scope plumbing; verify graceful 403 in Phase 5):
ClusterRole details' RoleBindings list, object events for cluster-scoped
objects. Both are unreachable or permitted for the restricted persona; the
perf-scope persona has the RBAC for them.

### UI

The sidebar Namespaces section IS the editor — no modal, no settings
surface. When a scope is set (or the cluster-wide list is denied), the
section renders the configured names as an inline-editable list: an "Add
namespace" affordance plus a hover delete icon per row, following the
Favorites dropdown's inline-edit pattern. The permission-denied state —
the discovery moment for exactly the user in #243 — swaps the static
message for the same editable list, starting empty.

Validation is syntactic only (DNS-1123 label) at entry time; per-namespace
access states appear on the rows once Phase 3's scoped checks exist.

No separate "scope active" indicator is needed: the editing affordances
themselves make it visible that the list is user-curated rather than
discovered, for both the restricted and the perf-scope persona.

## Phases

Each phase is independently shippable and TDD'd; red/green per slice.

- [x] ✅ **Phase 1 — Plumbing** (shipped 2026-07-04, `mage qc:prerelease`
  green). Per-cluster settings storage + Wails RPC +
  frontend settings access for `allowedNamespaces`; thread the scope through
  `system.Config` into subsystem construction (carried but not yet
  enforced); rebuild-on-change for the affected cluster only. ✅ Confirmed
  during implementation: the permission checker is created inside every
  subsystem build (`backend/refresh/system/manager.go:131`), so the rebuild
  resets the SSAR cache with no extra work.
- [x] ✅ **Phase 2 — Namespace list** (shipped 2026-07-04). Scoped
  `namespaces`-domain registration serves the configured names (synthesized
  rows, no informer, runtime policy exempted); Browse's namespace groups
  serve the same list; inline sidebar editor (add + hover-delete) shipped in
  `NamespaceScopeEditor.tsx` + `Sidebar.tsx`. Workload presence: "ingest
  tracks no workload kind" reports `workloadsUnknown`, so scoped rows are
  never dimmed as authoritatively empty (unscoped behavior unchanged).
- [x] ✅ **Phase 3 — Permission dimension** (shipped 2026-07-04).
  Namespace in the SSAR attributes + cache key; `Can` fans out concurrently
  (any-namespace-allows) — but ONLY for resources whose data path is scoped
  (`scopedResourcePredicate`: namespaced && ingest-owned). Cluster-wide
  sources (events/HPA/RS/gateway/helm) keep cluster-wide checks via
  `CanClusterWide` / `ResourceRequirement.ClusterWide`, so no domain can
  register against a source it cannot read (no silent-empty). SSAR chosen
  per decision 4; SSRR stays a measured future optimization.
- [x] ✅ **Phase 4 — Data paths** (shipped 2026-07-04, EXCEPT the
  factory-backed kinds — see follow-up below). Design pass outcome: ONE
  store per GVR with per-namespace reflector partition views
  (`ingest/partition.go`) — partition Replace fully defines only its own
  namespace and fans per-row sink events, never the bulk kind-wide Replace,
  which structurally prevents the maintained-store wipe class while keeping
  every serve/sink/readiness surface unchanged. Per-namespace permission
  skip (one denied namespace skips one reflector), per-partition spill/
  resume RVs. Also shipped: catalog collect scope with per-namespace
  Forbidden skip; resource-stream per-CRD informers fan out per namespace;
  namespace-custom all-namespaces fan-out; metrics-poller pod fan-out with
  partial-failure merge; object-map gateway/HPA LIST fan-out.
- [x] ✅ **Phase 5 — Polish** (shipped 2026-07-04, except row enrichment).
  One forbidden namespace degrades only itself on every scoped surface;
  editor soft warning above 20 namespaces; architecture doc
  `docs/architecture/namespace-scope.md`; release-note fragment.

### Remaining follow-ups (not blocking #243)

- [ ] **Scope the factory-backed kinds** (the deliberate Phase 4 leftover):
  events, replicasets, HPA v1 (typed factory), the 8 gateway kinds (gateway
  factory), helm secrets/configmaps (helm-storage factory). Requires N
  per-namespace client-go factories + multiplexed listers/handlers at each
  consumer (~10 sites mapped this session). Until then these domains show
  an HONEST permission-denied state for scoped identities (never silent
  empty), enforced by the source-scope rule. Flipping a source to scoped =
  scope its informers AND add its resources to `scopedResourcePredicate`
  AND remove its ClusterWide overrides.
- [ ] **Namespace row enrichment** (per-namespace GET where permitted) —
  name-only rows shipped per decision 3.
- [ ] **Verify degrade-only surfaces against the restricted test cluster**
  (ClusterRole details RoleBindings list, cluster-scoped object events) —
  needs the new 2-namespace RoleBindings SA from the test-setup note.
- [ ] **SSRR optimization** if scoped-connect SSAR fan-out measures slow
  (decision 4 note: reuse `backend/capabilities` machinery).

## Decisions (resolved 2026-07-04)

1. **Editor home: the sidebar Namespaces section itself.** No modal, no
   Settings-modal section — inline editing per the UI section above,
   following the Favorites dropdown's inline-edit pattern.
2. **Persistence key: clusterId** (`name:context`), consistent with
   favorites/tabs. Accepted tradeoff: a kubeconfig display-name change
   orphans the setting, same as favorites/tabs today.
3. **Namespace row fidelity: name-only rows in Phase 2** (Lens-style),
   per-namespace GET enrichment in Phase 5.
4. **Permission-check strategy: concurrent namespaced SSAR fan-out.** One
   code path through the existing checker — namespace added to the request
   attributes and the cache key. `SelfSubjectRulesReview` is a measured
   optimization only: adopt it later if the fan-out shows up on the startup
   path of the restricted test cluster, and then only with a per-check SSAR
   fallback (SSRR may return incomplete rules on webhook-authorizer
   clusters). Note for that future pass: the capabilities subsystem already
   runs SSRR with a configurable fetch concurrency
   (`backend/capabilities/rules.go`, `SetPermissionSSRRFetchConcurrency` in
   `backend/app_settings.go`) — reuse that machinery rather than adding a
   second SSRR path.
5. **Editor validation: syntactic only** (DNS-1123 label) at entry time;
   per-namespace access states on rows come from Phase 3's scoped checks,
   not edit-time probes.
6. **Helm: included in scoped mode from Phase 4** (per-namespace Helm
   storage gating), not deferred.
7. **No separate "scope active" indicator.** The inline-editable sidebar
   list is itself the signal that the namespace list is user-curated rather
   than discovered; no badge or connectivity-presentation mention.

## Test setup note

The existing restricted-cluster kind setup uses an SA with cluster-wide
`view` — it can list namespaces, so it does not reproduce #243. Testing this
feature needs an SA with RoleBindings in 2 namespaces and no cluster-scoped
grants.
