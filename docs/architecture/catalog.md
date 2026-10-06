# Object Catalog Contract

The object catalog is the per-cluster source of truth for Kubernetes object
existence, discovery, GVK/GVR identity, resource descriptors, and namespace
metadata. Keep it `catalog-first`, not `catalog-only`.

| Layer | Owns |
| --- | --- |
| Catalog | Identity, existence, descriptors, namespace metadata, bounded queries |
| Projection | Consumer-specific row or filter shapes derived from catalog identity |
| Hydration | Rich payloads fetched after identity is known |

Typed refresh rows are enrichments, not competing identity systems.

## Agent Contract

- Catalog rows are not detail, status, YAML, log, Helm, metric, or action
  payloads. Opening, navigation, diff, YAML, permissions, and actions keep
  catalog-shaped identity even when a typed view fetches richer data.
- Degraded discovery: preserve known identity where safe and surface degraded
  confidence instead of acting on ambiguous objects.
- Object-universe controls (namespace, Kind, API-group filters) use
  catalog-derived metadata, not the current row slice. The core API group uses
  the non-empty `"(core)"` query value and a `core` label.
- Summaries keep exact label/annotation maps in the table-only
  `ResourceTableMetadata` projection, passed through Browse rows so custom
  metadata columns need no per-row API request. It is not detail or status.
- Browse queries carry a structural resource scope and optional pinned
  namespaces separately from user filters; structural scope is never a second
  user-selectable filter. `unfilteredTotal` drops search, Kind, user namespace,
  and API-group filters but keeps the structural boundary.
- API Groups is upstream of Kinds: its vocabulary covers the whole structural
  scope; Kinds is recomputed for the selected groups, and changing API Groups
  invalidates the Kind selection before the dependent query runs.
- Frontend catalog state resets on structural scope changes before React
  commits, so prior rows cannot enter the destination's replay cache.
  Custom-resource hydration decorates only current membership by full identity
  and UID, keeping details through background reads and transient failures.

## Lifecycle

- A running catalog belongs to the exact refresh subsystem whose informer and
  ingest feeds it reads. Generation retirement cancels and joins the catalog and
  its bridges before stopping the feeds. Replacing an entry stops the displaced
  run; retiring an older generation cannot stop the new catalog.
- `runLoop` owns the notifier. Register reactive handlers outside the resync
  loop's critical path so a blocked registration cannot prevent the fast retry
  after an incomplete initial sync. Notifier admission and the full-resync
  safety-net interval share one reactive-mode condition, including catalogs
  whose only watch source is custom resources.
- Retirement cancels the notifier before joining it, removes informer handlers,
  and detaches static and dynamic ingest subscriptions; detachment joins
  in-flight delivery without stopping the generation's producers.

## Startup collection

After discovery and permission preflight, collection waits (one startup
deadline) for the sources the discovery result reads: tracked ingest-owned GVRs
and the informers behind shared, Gateway API, and CRD kinds. The set is not the
permission-allowed subset; sources outside it (e.g. the Event informer) never
gate.

- Informers gate on the factory's settle contract (synced, permanently failed,
  or past its sync deadline), never raw client-go sync: the shared factory
  always starts cluster-wide ReplicaSet, HPA v1, and Event informers, which a
  namespace-only identity can never sync.
- Read an informer cache only after sync; a settled-but-unsynced empty cache is
  not authoritative absence. Per `ResourceReadiness`, an unavailable informer
  (forbidden watch, or created after factory start) is replaced by a live LIST,
  as for a permission denial; a pending or degraded informer fails its kind
  like an unsynced ingest store.
- Rejected: live-LISTing a still-syncing informer — it duplicates the initial
  LIST on large clusters, and a row deleted before sync survives until resync.
- On deadline expiry, continue with settled resources, report unsynced
  descriptors via the partial-sync diagnostic, and enter the failed-sync retry
  cadence instead of blocking the run loop.

## Publication

- Cold collection may publish progressive batches. A warm resync keeps the
  published rows, counts, facets, and readiness until done, then publishes the
  replacement (with retained failed descriptors) before broadcasting completion.
  A kind still being collected is not an authoritative deletion. Working maps
  stay private until swapped in under the write lock.
- Watch batches and ingest sinks share one incremental boundary: under `syncMu`,
  then the catalog write lock, apply query rows, UID/identity entries,
  namespace/kind counts, and finalizer findings before broadcasting. Recreation
  removes the prior UID. Only full collection and initial source replay replace
  the query baseline; replay defers publication and signals until every kind
  has replayed.
- Hold the catalog read lock across a query's page, counts, and facets so they
  describe one publication (a publisher may wait on a running query). Source
  callbacks and query-engine operations never take these locks in reverse.
- Ingest callbacks may run with their source store write-locked, so they never
  wait for the catalog sync/publication lock (full sync reads those stores). On
  contention, coalesce reconciliation by GVR, take publication ownership, then
  reread the authoritative kind store — for incremental changes and whole-kind
  replacement, including changes after a full sync collected that kind.
  Shutdown drains this worker before signaling completion.

## Watch-to-query ordering

- Runtime-discovered watches belong to the refresh generation's ingest manager
  ([data-layer](data-layer.md) owns admission). Confirmed generic CRDs are
  admitted regardless of object count; non-CRD APIs and resources without
  visible CRD definitions keep the 5,000-object promotion threshold. Registry,
  shared-informer, and Gateway sources take precedence.
- Catalog supplies the preferred served version but never owns or stops a
  watch. During a version change the watch may use another served version;
  translate its group/resource to the catalog descriptor for query identity.
  Streaming consumes catalog signals; catalog never reads stream-manager caches.
- Subscribe before initial collection. Read only synced namespace partitions
  from ingest; pending or LIST-only partitions use catalog's paginated LIST with
  `ResourceFetchCallTimeout` per request, renewed per page and retry. The
  multi-namespace collection has no overall deadline; caller cancellation
  still stops it.
- A failed kind keeps prior rows and reports partial health without canceling
  other kinds. Dynamic sources do not gate global ingest readiness.
- A namespace without WATCH can still contribute LIST-authorized rows; ingest
  partition readiness includes permission-skipped namespaces with no reflector.
  Unavailable watches surface as query issues and snapshot warnings (Browse,
  Diagnostics) without marking collected LIST rows incomplete.
- Check source generations before incremental changes and object UIDs before
  deletion; a queued event from a retired source never overwrites its
  replacement's state. Synced namespace baselines replace only their partitions;
  pending and LIST-only partitions are preserved.
- CRD arrival, deletion, or a change to served versions, scope, names, UID, or
  establishment invalidates discovery and requests collection through the
  full-resync boundary (its recovery and atomic publication). A CRD Add waits
  for Established (that update supplies the request). Routine metadata,
  schema, and status-reason updates change only the CRD's own row. Confirmed deletion retires the definition UID and
  reconciles rows, counts, facets, and finalizer findings.
- Before adding affected-kind collection, measure a warm full pass at realistic
  object counts, recording API LISTs (including aggregated APIs) separately
  from in-memory work.
- Gateway API collection and handlers derive from the same resource registry
  and reuse the Gateway informer factory. Publish membership, counts/facets, and
  finalizer findings before the bridge invalidates snapshot caches and emits the
  catalog signal; another domain's notification never establishes catalog
  freshness.

## Ownership

- `backend/objectcatalog` (`Service`, `Summary`): owned per cluster by
  `RefreshCoordinator` in `backend/refresh_object_catalog.go`.
- `backend/objectcatalog/identity.go`: built-in and discovery-backed GVK/GVR
  resolution; `backend/resources/common/resource_identity.go` is only the shared
  `ResourceResolver` interface and `ResolvedResource` result contract. Backend
  GVK/GVR/scope lookups go through that resolver: built-ins use their real
  group/version from its builtin seed, CRDs keep group/version from discovery.
  No parallel resolver tables or kind-only fallbacks.
- `backend/refresh/snapshot/catalog.go`: the `catalog` Browse domain; doorbells
  via `backend/refresh/resourcestream`. Delivery diagnostics are the `catalog`
  domain of the unified `resources` stream (no standalone catalog stream).
- `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`: page-query and
  metadata/facet scopes share the cluster's one catalog doorbell subscription.

## Required tests

- Any catalog change: focused `backend/objectcatalog` tests plus the affected
  frontend Browse tests, covering lookup, namespace metadata, and query
  behavior on the changed path.
- Custom-resource watch changes: different served source/catalog versions and an
  initial replay larger than the payload queue; current membership reconciles
  without an extra dynamic LIST, recreation uses the current UID, an
  unavailable source retains rows; startup deletion, blocked handler
  registration, cancellation, and publication-before-signal through the real
  owners; table consumption meets the
  [freshness evidence](data-freshness.md#required-evidence-for-resource-source-changes).
- Restricted-identity changes: a namespace-only identity denied the cluster-wide
  ReplicaSet, HPA, and Event informers, through the production subsystem, still
  completes first collection and publishes its readable rows. Custom-resource
  permission tests alone do not prove startup.

## Discovered resource families

`DiscoveredResourceFamilies` reads discovered API identities before LIST
permissions and object collection; `CatalogSnapshot.resourceFamilies.cluster`
and `.namespaced` carry per-scope availability with the cluster ID.

- Only a discovered kind in the matching scope enables a family view (a
  ClusterIssuer alone does not enable the namespace cert-manager view).
- The shell subscribes to a small catalog scope before optional views open and
  accepts availability only for the active cluster. Empty installations stay
  visible; rediscovery without the APIs removes the entry.
- Discovery stays authoritative for GVK/GVR and served versions; family CRDs
  never enter the built-in identity registry.
- `resourceFamily=<family>` is a structural catalog boundary (plus the namespace
  boundary for namespaced families); totals, facets, continuation signatures,
  later pages, and exports retain it.

Adding a family (availability and filtering are reusable; registration is
explicit):

- Classify explicit group/kind/scope combinations in
  `backend/resourcekind/family.go`, then regenerate refresh contracts so
  frontend routing gets the same rules.
- Update `useAvailableResourceViews`, table selection/persistence, and the
  rich-detail projection/descriptor; register each table's `viewId` with
  persistence cleanup. Navigation entries carry `resourceFamily`; the
  availability hook applies the discovered scope arrays uniformly.
- Row hydration and rich details share `backend/resources/<family>` (decoding
  and condition primitives in `backend/resources/crdfacts`). Compact
  `<Family>Summary` rows hold table fields; source configuration and policy stay
  detail-only. Family projections may use shared resource semantics but never
  import catalog, refresh, or gateway packages.
- Gateway-owned `ResolveLinks` passes the cluster's catalog resolver into row and
  detail projections. A reference without a source API version resolves only on
  an unambiguous group/kind/scope match, else stays display-only; explicit
  versions are preserved. Resolution never waits for collection or adds API
  requests.
- `customresource.BuildDetails` takes the resolved scope; its gateway rejects
  namespace/scope mismatches before GET and keys header metadata by namespace.
  Enriched details live-GET in the requested cluster and discovered scope and
  refresh header metadata from that object, so the snapshot source version
  tracks its contents. A normalized request kind is only a lookup key; dynamic
  projections keep the canonical kind. YAML, capabilities, edit, delete,
  navigation, queries, and permissions keep discovered identity and scope.
- Unknown boolean readiness stays absent in row facts, not false. Operator
  status overrides apply before shared deletion-lifecycle precedence. Secret
  contents are never read to enrich a family.
- Object-map support is separate; it does not follow from a table or overview.

Family specifics:

- **Karpenter** (`resourceFamily=karpenter`): all cluster-scoped `karpenter.*`
  kinds, including provider NodeClasses. `KarpenterSummary` has named
  relationship and instance fields. Details expose source configuration,
  capacity, relationships, and conditions without inventing defaults.
- **Argo CD** (`resourceFamily=argocd`, namespace and All Namespaces views):
  `argoproj.io` Application, ApplicationSet, AppProject, classified by group and
  kind because other Argo products share the group. Application health and sync
  are separate signals; ApplicationSet errors outrank ResourcesUpToDate in
  health. Destination cluster and project names never establish a local cluster
  or control-plane namespace, so they are never guessed into links.
- **cert-manager, External Secrets, Prometheus Operator**: missing or ambiguous
  issuer/store versions stay display-only. A ClusterExternalSecret template has
  no concrete destination namespace, so its store and Secret references are
  never openable.

Presentation: [custom-resource views](../frontend/custom-resource-views.md).
