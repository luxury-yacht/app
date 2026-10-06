# Live Age Contract

Object age is relative display text. Backend and snapshot producers carry
absolute timestamps; frontend renderers format relative text from the shared
clock.

## Invariants

- Never refetch snapshots or stream rows only to update age text.
- Resource table rows use `ageTimestamp` when exposed; catalog rows,
  object-panel headers, and object-map nodes use `creationTimestamp`. Backend
  `age` strings are only a fallback when no timestamp exists.
- Sort by timestamps, never by displayed strings such as `5m` or `2d`.
- Shared age UI uses the shared clock so visible ages repaint without row
  replacement.

## Surface Rules

| Surface | Rule | Owner |
| --- | --- | --- |
| Tables | Render through `createAgeColumn` unless a documented custom timestamp sort is needed | `shared/components/tables/columnFactories.tsx` |
| Browse/catalog rows | Keep `creationTimestamp`, derive `ageTimestamp` for display and sort; never bake `age` text into rows | `modules/browse/hooks/useBrowseColumns.tsx`, `customCatalogRowAdapter.ts` |
| Object-panel header | Render `creationTimestamp` through `LiveAgeText` | `shared/components/kubernetes/ResourceHeader.tsx` |
| Object-panel embedded tables | Pass row timestamps to the shared age column or `LiveAgeText` | `modules/object-panel/components/ObjectPanel` |
| Event tables | Keep newest-first timestamp sorting; render age with the live renderer | — |
| Object map | Derived `cardAgeText` is recomputed from the shared clock without changing graph identity or layout inputs | `modules/object-map` |

Shared pieces (under `frontend/src/`): formatter `utils/ageFormatter.ts`, clock
`shared/hooks/useAgeClock.ts`, renderer `shared/components/LiveAgeText.tsx`.

## Validation

Use fake timers around the affected surface and prove visible text advances
while the input row or detail payload stays stable:
`npm run test --prefix frontend -- LiveAgeText columnFactories browse object-panel object-map`.
