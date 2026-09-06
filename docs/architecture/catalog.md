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

## Ingest callback ordering

An ingest callback may run while its source store is write-locked. It cannot block
on the catalog's full-sync lock, because full sync reads those same source stores.
If the catalog lock is busy, coalesce a pending reconciliation by GVR and reread
the authoritative kind store after acquiring the sync lock. This applies to
incremental changes and whole-kind replacement, including changes arriving after
a full sync collected that kind. Catalog shutdown drains this worker before
signaling completion.

## Layer Model

| Layer | Owns |
| --- | --- |
| Catalog | Identity, existence, descriptors, namespace metadata, bounded queries |
| Projection | Consumer-specific row or filter shapes derived from catalog identity |
| Hydration | Rich payloads fetched after identity is known |

Typed refresh rows are enrichments. They are not competing identity systems.

## Ownership

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
