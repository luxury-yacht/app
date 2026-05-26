# Catalog Architecture

The object catalog is Luxury Yacht's per-cluster index of Kubernetes object
identity and existence. It is discovery-oriented: it answers what objects exist
and how to refer to them, while richer views fetch domain-specific payloads from
typed refresh domains or object-detail providers.

See [README.md](README.md) for the architecture doc map.

Keep `catalog-first`. Avoid `catalog-only`.

## Core Rule

The catalog owns canonical object identity and the live object set.

That does not mean every screen should consume one universal row shape or render
directly from catalog summaries. It means the app should agree on one canonical
answer to:

- what object is being referred to
- whether it still exists
- which cluster it belongs to
- which exact GVR/GVK it has
- whether it is cluster-scoped or namespace-scoped

Consumer-specific retrieval then decides what richer data is needed.

## What The Catalog Stores

`backend/objectcatalog.Service` maintains an in-memory map of
`objectcatalog.Summary` values. Each summary includes:

- `clusterId` and `clusterName`
- `group`, `version`, `resource`, `kind`, and `scope`
- `namespace` and `name`
- `uid`, `resourceVersion`, and `creationTimestamp`
- optional `labelsDigest` for change detection

The catalog also caches sorted query chunks, kind metadata, namespace metadata,
allowed descriptors, first-batch latency, and health state.

Catalog rows are discovery summaries. They are not rich details, YAML, Helm
content, status overviews, metrics, logs, or action payloads.

Resource identity resolution is catalog-backed. Backend callers that need to
resolve `group/version/kind` to a Kubernetes resource use the shared
`ResourceResolver` contract, and app code supplies the per-cluster object
catalog implementation. The catalog seeds standard Kubernetes resources so
startup paths can resolve common objects before the first full sync, then
hydrates the same identity store from Kubernetes discovery and CRDs. Callers do
not choose between built-ins, cached descriptors, and discovery; those are
catalog implementation details.

The implementation split is intentional:

- `backend/objectcatalog/identity.go` owns the built-in seed list, discovery/CRD
  hydration, and `ResolveResourceForGVK` behavior.
- `backend/resources/common/resource_identity.go` owns only the small
  `ResourceResolver` / `ResolvedResource` contract shared by backend packages.
- `backend/cluster_dependencies.go` adapts app callers to the per-cluster
  catalog service and uses a cached per-cluster fallback resolver only before
  the service is available.
- `backend/object_detail_provider.go` has separate exact-GVK capability
  metadata for typed detail fetchers. That map says which typed fetcher can
  serve a detail payload; it is not a resource identity source.

If discovery is degraded, identity hydration should still try the CRD API before
returning a discovery error. This keeps YAML, permissions, and actions working
for CRDs when preferred discovery is temporarily incomplete.

## Service Lifecycle

The backend starts one catalog service per selected cluster in
`backend/app_object_catalog.go`. Each service is tied to the cluster's refresh
subsystem and shared informer factories.

The sync pipeline in `backend/objectcatalog/sync.go`:

1. Discovers API resources.
2. Evaluates list permission with the capabilities service.
3. Collects summaries from shared informers where available.
4. Falls back to dynamic client list calls for resources without usable informer
   data.
5. Promotes high-volume dynamic resources to dedicated informers when the
   promotion threshold is reached.
6. Publishes query caches and stream notifications.

With reactive updates enabled, `backend/objectcatalog/watch.go` attaches shared
informer event handlers for common resources and applies debounced add/update/
delete batches to the catalog. Periodic full resync remains the consistency
safety net.

## Query And Lookup Surfaces

Catalog API surfaces are intentionally narrow:

- `Query()` returns paginated, filtered summaries plus `continue`, total count,
  resource count, kind metadata, and namespace metadata.
- `Namespaces()` returns catalog-derived namespaces for sidebar and browse
  metadata.
- `Descriptors()` returns discovered/allowed resource descriptors.
- `Health()` returns sync health for diagnostics.
- `ResolveResourceForGVK(ctx, gvk)` resolves a full GVK to GVR/scope through the
  catalog identity store.
- `FindExactMatch(namespace, group, version, kind, name)` resolves one object by
  canonical identity within a cluster.
- `FindByUID(uid)` resolves one object by UID within a cluster.
- `SubscribeStreaming()` notifies catalog SSE subscribers when queryable catalog
  state changes.

Frontend and Wails-facing object lookup must carry `clusterId`. Backend lookup
entry points such as `FindCatalogObjectMatch` and `FindCatalogObjectByUID`
reject missing cluster IDs instead of guessing.

## Refresh Integration

The `catalog` and `catalog-diff` refresh domains are registered in
`backend/refresh/system/registrations.go` and implemented by
`backend/refresh/snapshot/catalog.go`.

Catalog snapshots expose:

- `items`
- `continue`
- `total`
- `resourceCount`
- `kinds`
- `namespaces`
- `namespaceGroups`
- `batchIndex`, `batchSize`, `totalBatches`, and `isFinal`
- `firstBatchLatencyMs`

The SSE handler in `backend/refresh/snapshot/catalog_stream.go` subscribes to
catalog updates, re-runs the catalog query, and pushes snapshot-shaped events.
Stream payloads include `cacheReady`, `ready`, `truncated`, `snapshotMode`, and
sequence metadata.

The frontend catalog stream manager applies those snapshots into the refresh
store. Manual/filter/pagination requests still use normal snapshot fetches; SSE
is not a replacement for query-specific fetches.

## Browse Ownership

Browse is catalog-backed but not catalog-only.

`frontend/src/modules/browse/hooks/useBrowseCatalog.ts` owns catalog scopes for
Browse views. It:

- builds cluster-prefixed query scopes with `limit`, `search`, `kind`,
  `namespace`, and `continue`
- enables and disables the relevant `catalog` refresh scopes
- triggers startup/manual snapshot requests
- derives filter metadata from catalog snapshot metadata
- reconciles full replacement snapshots by UID/resourceVersion
- uses additive upsert only for load-more pagination

`frontend/src/modules/browse/hooks/useBrowseColumns.tsx` projects catalog items
into Browse table rows and opens/navigates with required canonical object
references.

## Layered Retrieval Model

| Layer            | Owns                                                                                            | Examples                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Catalog          | Object identity, existence, descriptors, namespace metadata, and bounded object-summary queries | exact lookup, UID lookup, namespace metadata, resource descriptors                              |
| Query/projection | Consumer-shaped views over the canonical catalog                                                | Browse rows, sidebar namespace groups, kind/namespace filter metadata, object selection queries |
| Hydration        | Rich payloads fetched after identity is known                                                   | object details, YAML, Helm content, diff inputs, typed refresh-domain rows                      |

Typed screens may fetch richer refresh-domain data, but open/diff/navigation/
action flows still preserve catalog-shaped identity.

## Constraints

Using the catalog as the canonical source does not mean:

- shipping the full catalog to every screen
- forcing every screen onto one shared payload shape
- rebuilding every typed screen from minimal catalog rows on the client
- adding one extra fetch per row
- using catalog rows as rich object detail payloads

The correct consequence is narrower:

- use the catalog to decide what object the app is talking about
- use consumer-specific retrieval to decide what data about that object is
  needed next

## Metadata Rule

Metadata-driven controls should come from explicit catalog-derived metadata
where the control represents the object universe rather than the currently
displayed slice.

That is especially important for:

- sidebar cluster/namespace listings
- kind filters
- namespace filters
- counts and groupings

Row-derived metadata is acceptable only when the table explicitly owns a local,
capped row set and the metadata does not claim to describe the whole cluster.

## Freshness And Confidence

The catalog should update near real time where informers are available, but the
app must not silently treat stale or degraded catalog data as exact.

Current confidence signals:

- `HealthStatus` reports `unknown`, `ok`, `degraded`, or `error`.
- `Stale`, `ConsecutiveFailures`, `FailedResources`, `LastSync`,
  `LastSuccess`, and `LastError` are exposed for diagnostics.
- Catalog snapshots and streams report `truncated`, batch metadata, cache
  readiness, and first-batch latency.
- Failed descriptor collection retains previous data for that descriptor and
  marks the catalog degraded rather than dropping known objects immediately.
- `EvictionTTL` controls pruning for missing items after successful collection.

When confidence is lost, callers should surface degraded state or fall back to
explicit refresh/resync behavior. Do not quietly open, diff, navigate, or act on
ambiguous catalog identity.

## Relationship To Typed Views

Typed views may use typed refresh domains and richer projections. They are still
expected to remain consistent with catalog identity:

- rows carry `clusterId`, `group`, `version`, `kind`, `namespace`, and `name`
- object opening uses canonical identity
- actions remain `clusterId` + GVK aware
- object links use catalog lookup only when the source identity is incomplete and
  a safe lookup key such as UID is available
- typed payloads are enrichments, not competing identity systems
