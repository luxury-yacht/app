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
- If discovery is degraded, preserve known identity where safe and surface
  degraded confidence instead of acting on ambiguous objects.
- Metadata controls that describe the object universe, such as namespace, Kind,
  and API-group filters, use catalog-derived metadata rather than the current
  row slice. The core API group uses the non-empty `"(core)"` query value and a
  `core` display label.
- Browse queries carry a structural resource scope and optional pinned
  namespaces separately from user filters. That structural scope is not a
  second user-selectable filter.
- API Groups is upstream of Kinds in Browse. The API Groups vocabulary describes
  the complete structural scope, while the Kinds vocabulary is recomputed for
  the selected API groups. Changing API Groups invalidates the existing Kind
  selection before the dependent query runs.
- `unfilteredTotal` removes search, Kind, user namespace, and API-group filters
  while retaining the structural boundary.

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
  `backend/app_object_catalog.go`,
  `backend/refresh/resourcestream`
- Browse catalog consumer:
  `frontend/src/modules/browse/hooks/useBrowseCatalog.ts`

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
by the change. For non-documentation work, finish with `mage qc:prerelease`.
