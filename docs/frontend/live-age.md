# Live Age Contract

Object age is relative display text. Backend and snapshot producers should carry
absolute timestamps; frontend renderers format the relative text from the
current clock.

## Invariants

- Do not refetch snapshots or stream rows only to update age text.
- Prefer `ageTimestamp` for resource table rows that already expose it.
- Prefer `creationTimestamp` for catalog rows, object-panel headers, and
  object-map nodes.
- Keep backend `age` strings only as compatibility fallback text when a
  timestamp is unavailable.
- Sort by stable timestamp values, not by displayed strings such as `5m` or
  `2d`.
- Shared age UI must use the shared clock so visible ages repaint without row
  replacement.

## Ownership

- Relative formatting: `frontend/src/utils/ageFormatter.ts`
- Shared clock: `frontend/src/shared/hooks/useAgeClock.ts`
- Shared renderer: `frontend/src/shared/components/LiveAgeText.tsx`
- Shared table age column:
  `frontend/src/shared/components/tables/columnFactories.tsx`
- Browse catalog timestamp adaptation:
  `frontend/src/modules/browse/hooks/useBrowseColumns.tsx`
- Catalog-backed custom row adaptation:
  `frontend/src/modules/browse/hooks/customCatalogRowAdapter.ts`
- Object-panel header:
  `frontend/src/shared/components/kubernetes/ResourceHeader.tsx`
- Object-panel related tables:
  `frontend/src/modules/object-panel/components/ObjectPanel`
- Object-map age text:
  `frontend/src/modules/object-map`

## Surface Rules

- Tables should render age through `createAgeColumn` unless a view has a
  documented reason to use a custom timestamp sort.
- Browse/catalog-backed rows should preserve `creationTimestamp` and derive
  `ageTimestamp` for display and sorting. Do not bake `age` text into row data
  when creation time is available.
- Object-panel headers should render `creationTimestamp` through
  `LiveAgeText`.
- Object-panel embedded tables should pass their row timestamp into the shared
  age column or `LiveAgeText`.
- Event tables should keep newest-first sorting on timestamps while rendering
  age through the shared live renderer.
- Object-map render data may include derived `cardAgeText`, but it must be
  recomputed from the shared age clock without changing backend graph identity
  or layout inputs.

## Validation

For age behavior changes, use fake timers around the affected surface and prove
visible text advances while the input row or detail payload remains stable.

Focused commands:

```sh
npm run test --prefix frontend -- LiveAgeText columnFactories browse object-panel object-map
npm run typecheck --prefix frontend
```

For non-documentation changes, finish with `mage qc:prerelease`.
