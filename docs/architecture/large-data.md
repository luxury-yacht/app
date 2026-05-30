# Large Data Contract

Large-cluster support is a product constraint, not a table decoration. The app
must avoid loading, rendering, filtering, or exporting unbounded cluster data
without an explicit cap or pagination model.

## Agent Contract

- Preserve `clusterId` in row identity and persisted table state.
- Prefer server/query-side bounds for catalog-scale data.
- Use GridTable virtualization for large row sets; do not disable it to mask
  focus, hover, or width bugs.
- Metadata that claims to describe the object universe must come from catalog or
  query metadata, not a capped row slice.
- Make truncation, load-more, degraded data, and blocked reads visible in UI
  state.
- CSV/export actions should operate on the currently represented dataset and
  make limits clear.
- Keep large text surfaces such as logs bounded, searchable, and copyable
  without forcing the full buffer into expensive React rendering.

## Ownership

- Catalog query and metadata bounds: `backend/objectcatalog`,
  `backend/refresh/snapshot/catalog.go`
- Table virtualization and persistence:
  `frontend/src/shared/components/tables`
- Refresh payload caps and diagnostics: `backend/refresh/snapshot`,
  `frontend/src/core/refresh`
- Log viewer bounds: object-panel log viewer modules and log stream managers

## Change Checklist

When touching high-volume data:

1. Identify the maximum backend payload size and frontend rendered row count.
2. Check whether filters/search are local, query-backed, or both.
3. Preserve stable row keys and column keys for persistence.
4. Confirm empty, truncated, loading, blocked, and degraded states.
5. Add tests for capped/paginated behavior rather than only small fixtures.

## Validation

Use focused backend snapshot/catalog tests and frontend table tests for the
changed path. For visual table work, verify behavior with enough rows to trigger
virtualization.
