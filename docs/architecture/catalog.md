# Object Catalog Contract

The object catalog is the per-cluster source of truth for Kubernetes object
existence, discovery, GVK/GVR identity, resource descriptors, and namespace
metadata.

Keep `catalog-first`. Do not turn that into `catalog-only`.

## Agent Contract

- Use the catalog to answer what object exists, which cluster it belongs to, and
  its exact GVK/GVR/scope.
- Do not use catalog rows as rich detail, status, YAML, log, Helm, metric, or
  action payloads.
- Typed views may fetch richer refresh-domain data, but object opening,
  navigation, diff, YAML, permissions, and actions must preserve catalog-shaped
  identity.
- Backend lookups that cross app boundaries must require `clusterId`; do not
  guess from current selection.
- Each running catalog belongs to the exact refresh subsystem whose informer
  and ingest feeds it reads. Generation retirement cancels and joins that catalog
  and its bridges before stopping the feeds. Replacing a catalog entry also stops
  the displaced run; retiring an older generation cannot stop the new catalog.
- If discovery is degraded, preserve known identity where safe and surface
  degraded confidence instead of acting on ambiguous objects.
- After discovery and permission preflight, collection waits up to the ingest
  startup deadline for each tracked ingest-owned GVR in that discovery result
  to settle. This set comes from discovery rather than the catalog's
  permission-allowed subset; stores outside the discovery result do not gate.
  If the deadline expires, collection continues with the settled resources,
  reports the unsynced descriptors through the partial-sync diagnostic, and
  enters the failed-sync retry cadence instead of blocking the catalog run loop.
- Metadata controls that describe the object universe, such as namespace, Kind,
  and API-group filters, use catalog-derived metadata rather than the current
  row slice. The core API group uses the non-empty `"(core)"` query value and a
  `core` display label.
- Catalog summaries retain the object's exact label and annotation maps in the
  table-only `ResourceTableMetadata` projection. Browse rows pass that
  projection through so shared custom metadata columns can resolve an exact key
  without one API request per visible row. This projection remains object
  metadata, not rich detail or status data.
- Browse queries carry a structural resource scope and optional pinned
  namespaces separately from user filters. That structural scope is not a
  second user-selectable filter.
- API Groups is upstream of Kinds in Browse. The API Groups vocabulary describes
  the complete structural scope, while the Kinds vocabulary is recomputed for
  the selected API groups. Changing API Groups invalidates the existing Kind
  selection before the dependent query runs.
- `unfilteredTotal` removes search, Kind, user namespace, and API-group filters
  while retaining the structural boundary.
- Cold collection may publish progressive batches. A warm resync retains the
  published query rows, counts, facets, and readiness until collection finishes;
  it publishes the replacement, including retained failed descriptors, before
  broadcasting its completion signal. A kind still being collected is not an
  authoritative deletion.
- Frontend catalog state resets structural scope changes before React commits,
  so prior rows cannot enter the destination view's replay cache. Custom-resource
  hydration decorates only current catalog membership by full identity and UID,
  retaining those details during background reads and transient failures.

## Ingest callback ordering

Watch batches and ingest sinks share one incremental publication boundary. Under
`syncMu`, then the catalog write lock, apply the affected query rows, UID/identity
entries, namespace/kind counts, and finalizer findings before broadcasting.
Recreation removes the prior UID. Only full collection and initial source replay
replace the complete query baseline; individual changes do not rebuild it.
Source replay defers query publication and signals until every kind has replayed.

Query stores are mutable between full collections. Hold the catalog read lock
across a query's page, counts, and facets so they describe one publication. Source
callbacks and query-engine operations must not acquire these locks in reverse
order. This consistency boundary can make a publisher wait for a running query.

An ingest callback may run while its source store is write-locked. It cannot block
on the catalog's full-sync lock, because full sync reads those same source stores.
If the catalog lock is busy, coalesce a pending reconciliation by GVR and reread
the authoritative kind store after acquiring the sync lock. This applies to
incremental changes and whole-kind replacement, including changes arriving after
a full sync collected that kind. Catalog shutdown drains this worker before
signaling completion.

## Watch-to-query ordering

Runtime-discovered resource watches belong to the refresh generation's ingest
manager. Confirmed generic CRDs are admitted independently of object count;
non-CRD APIs and resources without visible CRD definitions retain the 5,000-object
promotion threshold. Existing registry, shared-informer and Gateway sources take
precedence. Catalog owns discovery and supplies its preferred served version,
but never owns or stops a watch. Streaming consumes catalog signals; catalog does
not read stream-manager object caches.

Subscribe before initial collection. Read only actually synced namespace
partitions from ingest; pending or LIST-only partitions use catalog's paginated
LIST under `ResourceFetchCallTimeout`. A failed collection retains prior rows and
reports partial health. Dynamic sources do not gate global ingest readiness.
A namespace without WATCH permission can still contribute LIST-authorized rows.

Callbacks never wait for the catalog publication lock. Coalesce contended
reconciliation by GVR, acquire publication ownership, then reread the current
source. Check source generations before applying incremental changes and object
UIDs before deletion. A queued event from a retired source cannot substitute its
old payload for a replacement's current state. Synced namespace baselines replace
only those partitions; preserve pending and LIST-only partitions.

The watch may use a different served version than discovery prefers. Translate
its group/resource to the catalog descriptor for query identity. CRD arrival,
change and deletion invalidate discovery and request collection through the
existing resync boundary. Confirmed deletion retires the matching definition UID
and reconciles rows, counts, facets and finalizer findings.

Gateway API collection and incremental handlers derive from the same resource
registry and reuse the Gateway informer factory. Publish catalog membership,
query counts/facets, and finalizer findings before the catalog bridge invalidates
snapshot caches and emits the catalog signal. Notifications on a different
resource domain do not establish catalog freshness.

`runLoop` owns the notifier lifetime. Register reactive handlers outside the
resync loop's critical path so a blocked registration cannot prevent the fast
retry after an incomplete initial sync. Notifier admission and the full-resync
safety-net interval use the same reactive-mode condition, including catalogs
whose only watch source is custom resources.

Catalog retirement cancels the notifier before joining it, removes its informer
handlers, and detaches static and dynamic ingest subscriptions before completing.
Detachment joins in-flight delivery without stopping the generation's producers.

## Layer Model

| Layer | Owns |
| --- | --- |
| Catalog | Identity, existence, descriptors, namespace metadata, bounded queries |
| Projection | Consumer-specific row or filter shapes derived from catalog identity |
| Hydration | Rich payloads fetched after identity is known |

Typed refresh rows are enrichments. They are not competing identity systems.

## Ownership

`backend/objectcatalog.Service` / `Summary` are owned per cluster by
`RefreshCoordinator` in `backend/refresh_object_catalog.go`. Browse snapshots
use the `catalog` domain in `backend/refresh/snapshot/catalog.go`. GVK/GVR
resolution belongs to `backend/objectcatalog/identity.go`;
`backend/resources/common/resource_identity.go` is only the shared resolver
interface/result contract. Do not add parallel resolver tables or kind-only
fallbacks outside the catalog.

- Catalog service and identity store: `backend/objectcatalog`
- Built-in and discovery-backed GVK/GVR resolution:
  `backend/objectcatalog/identity.go`
- Shared backend resolver contract:
  `backend/resources/common/resource_identity.go`
- Catalog snapshots and liveness doorbells:
  `backend/refresh/snapshot/catalog.go`,
  `backend/refresh_object_catalog.go`,
  `backend/refresh/resourcestream`
- Browse catalog consumer:
  `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`

Browse keeps separate page-query and metadata/facet report scopes, but both
share the cluster's physical catalog doorbell subscription. Catalog delivery
diagnostics are emitted as the `catalog` domain of the unified `resources`
stream; there is no standalone catalog diagnostics stream.

## Change Checklist

When touching catalog behavior:

1. Preserve `clusterId`, `group`, `version`, `kind`, `namespace`, and `name`
   where the object is concrete.
2. Decide whether the consumer needs identity, query metadata, or rich hydrated
   data.
3. Keep object existence and GVK/GVR lookup in catalog-owned paths.
4. Surface degraded/stale catalog confidence when lookup precision matters.
5. Test lookup, namespace metadata, and browse/query behavior for the changed
   path.

## Validation

Run focused catalog/objectcatalog tests and the frontend browse tests affected
by the change. For non-documentation work, finish with `wails3 task qc:prerelease`.

Custom-resource watch changes must cover different served source/catalog versions
and an initial replay larger than the payload queue. Prove that current membership
reconciles without an extra dynamic LIST, that recreation uses the current UID,
and that an unavailable source retains rows. Exercise startup deletion, blocked
handler registration, cancellation and publication-before-signal through the
real owners. Table consumption must meet the shared
[freshness evidence requirements](data-freshness.md#required-evidence-for-resource-source-changes).

## Discovered resource families

The catalog owns optional resource-family availability. `DiscoveredResourceFamilies`
reads discovered API identities before LIST permissions and object collection;
`CatalogSnapshot.resourceFamilies.cluster` and `.namespaced` carry that
availability separately for each scope with the cluster ID. Only a discovered
kind in the matching scope enables a family view; a ClusterIssuer alone does
not enable the namespace cert-manager view.
The shell subscribes to a small catalog scope before optional views open, and
accepts availability only for the active cluster. Empty installations remain
visible; successful rediscovery without the APIs removes the entry.

Karpenter is the cluster-scoped `karpenter.*` API family, including core kinds,
provider NodeClasses, and other discovered kinds. Its dedicated cluster view uses
`resourceFamily=karpenter` as a structural catalog boundary. Totals, facets,
continuation signatures, subsequent pages, and exports retain this boundary.
Discovery remains authoritative for GVK/GVR and served versions; Karpenter CRDs
are not added to the built-in identity registry.

Custom-resource row hydration and rich Karpenter details share the typed projection
in `backend/resources/karpenter`. Cluster custom rows carry a compact
`KarpenterSummary` with named relationship and instance fields; table cells and CSV
exports each display one value. The single table retains its kind filter. The overview exposes source configuration,
capacity, relationships, and conditions without inventing defaults. Related
NodeClass references without a source API version are resolved at the gateway
boundary using this cluster's catalog discovery, for both hydrated rows and rich
details. Resolution requires an unambiguous group/kind/scope match; unavailable
or ambiguous discovery leaves the reference display-only. Explicit source
versions are preserved. Resolution neither waits for object collection nor adds
API requests. Enriched details
use a live GET in the requested cluster and discovered Kubernetes scope, and
refresh header metadata from that same object,
so the snapshot's source version changes with its contents. Existing custom
resource YAML, capabilities, edit, and delete paths retain discovered identity.

Argo CD is the namespaced `argoproj.io` Application, ApplicationSet, and AppProject
family. Its namespace and All Namespaces views retain `resourceFamily=argocd`
alongside the namespace boundary across counts, facets, pages, and exports.
Classification matches both group and kind because other Argo products share
that API group. Namespace row hydration and rich details share
`backend/resources/argocd`; compact `ArgoCDSummary` rows contain table fields,
while source configuration and project policy remain detail-only. Application
health and sync are separate signals, and ApplicationSet errors take precedence
over ResourcesUpToDate when projecting health.

Family availability and catalog filtering are reusable; family registration is
explicit. Add classification in `backend/resourcekind/family.go` and regenerate
refresh contracts to export the same rules to frontend routing. Update discovered
availability in `useAvailableResourceViews`, table selection/persistence, and
rich-detail projection/descriptor for each family. Register each table's explicit
`viewId` with persistence cleanup. The navigation registry marks
optional entries with `resourceFamily`; the availability hook applies the
discovered scope arrays uniformly. `customresource.BuildDetails`
accepts the resolved scope; its gateway rejects namespace/scope mismatches before
GET and keys header metadata by namespace. A normalized request kind is only a
lookup key; dynamic projections retain the API object's canonical kind.
Preserve discovered scope through navigation, queries, details and permissions.
Related references need complete
identity; Argo destination cluster names and project names do not establish a
local cluster or control-plane namespace and must not be guessed into links.
Family projections may depend on shared resource semantics; they must not import
catalog, refresh or gateway packages. Object-map support is a separate surface
and does not follow automatically from a dedicated table or overview.

cert-manager, External Secrets, and Prometheus Operator use this same path.
Their supported group/kind/scope combinations are explicit in
`backend/resourcekind/family.go`; served versions remain discovered. Family
packages share decoding and condition primitives in `backend/resources/crdfacts`.
Gateway-owned `ResolveLinks` passes the active cluster's catalog resolver into
detail and row projections. Missing or ambiguous issuer/store versions remain
display-only; no Secret contents are read to enrich these families. A
ClusterExternalSecret template has no concrete destination namespace, so its
namespaced store and Secret references cannot become openable object links.
Unknown boolean readiness remains absent in row facts, not false. Operator
status overrides are applied before the shared deletion lifecycle precedence.

Presentation decisions are documented in
[custom-resource views](../frontend/custom-resource-views.md).
