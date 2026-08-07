# Plan: TypeScript S3776 Remediation

Prepared 2026-08-06 from SonarQube Cloud analysis at
`2026-08-07T00:18:02Z` and repository revision
`b0d3344b976bf451f5a71ab6344599ae3e0754d9`. The local `main` checkout was at
that same revision when this inventory was produced.

## Goal

Close every open `typescript:S3776` finding without changing user-visible
behavior, weakening cluster/object identity, or disturbing refresh, query,
keyboard, focus, persistence, permission, and cleanup contracts. A finding is
not remediated merely because its branches moved into an arbitrary helper: the
result must make responsibilities and invariants easier to state and test.

This plan covers the 91 TypeScript findings in production source. The four
open `javascript:S3776` findings in
`frontend/scripts/check-error-reporting-boundaries.mjs` are tracked as a
separate follow-up inventory below and are not counted in the TypeScript total.

## Baseline

The public Sonar API reports 91 open CRITICAL code-smell findings across 71
production files. Their reported complexities sum to 2,346, which is 981
points above an aggregate maximum of 15 per function.

| Complexity | Findings |
|---:|---:|
| 16-20 | 39 |
| 21-30 | 33 |
| 31-50 | 16 |
| Above 50 | 3 |
| **Total** | **91** |

| Remediation domain | Findings |
|---|---:|
| Shared and app foundations | 15 |
| GridTable and query-backed data | 16 |
| Object map | 4 |
| Object panel | 14 |
| App shell and interactions | 26 |
| Refresh and diagnostics | 16 |
| **Total** | **91** |

## Progress snapshot

Checkboxes track local implementation and validation. Sonar verification is
reported separately and remains pending until the branch is pushed and analyzed.

| Phase | Local progress | Sonar verification |
|---|---:|---|
| Phase 0: no-regression rail | 6/7 | Branch protection remains external/unverified |
| Phase 1: shared and app foundations | **15/15** | Pending branch analysis |
| Phase 2: GridTable and query-backed data | **16/16** | Pending branch analysis |
| Phase 3: object map | **4/4** | Pending branch analysis |
| Phase 4: object panel | **14/14** | Pending branch analysis |
| Phase 5: app shell and interactions | **26/26** | Pending branch analysis |
| Phase 6: refresh and diagnostics | **16/16** | Pending branch analysis |
| **TypeScript findings** | **91/91 locally remediated** | Pending branch analysis |
| PR 283 cross-rule recovery | **51/51 locations corrected** | Verified: 0 new issues at `e256225b` |
| JavaScript checker follow-up | **4/4 locally remediated** | Pushed analysis pending |

Sonar classifies colocated tests separately through
`.sonarcloud.properties`; no test file appears in this inventory. Generated
Wails and generated refresh TypeScript are excluded by the same configuration
and must not be edited to manufacture a reduction.

Contract anchors reviewed for this plan:

- Sonar uses Automatic Analysis and has no checked-in CI scanner; generated
  sources and colocated tests are classified in
  [`.sonarcloud.properties`](../../.sonarcloud.properties).
- The frontend's checked-in validation commands are Biome, TypeScript, Vitest,
  and Knip in [`frontend/package.json`](../../frontend/package.json).
- Refresh scheduling/execution ownership and its query/snapshot lease contract
  are defined in
  [`docs/architecture/refresh-system.md`](../architecture/refresh-system.md),
  with ordering and retained-data behavior in
  [`docs/architecture/data-freshness.md`](../architecture/data-freshness.md).
- Table filtering, sorting, persistence, focus, virtualization, and pagination
  remain owned by the shared system documented in
  [`docs/frontend/gridtable.md`](../frontend/gridtable.md).
- Keyboard dispatch and surface priority are defined in
  [`docs/frontend/keyboard.md`](../frontend/keyboard.md); docked/floating/grouped
  state and identity are defined in
  [`docs/frontend/dockable-panels.md`](../frontend/dockable-panels.md).
- Object-map identity/layout boundaries and log-surface separation are defined
  in [`docs/workflows/object-map.md`](../workflows/object-map.md) and
  [`docs/workflows/logs/overview.md`](../workflows/logs/overview.md).
- Placement rules and the settled descriptor-driven object-panel Overview are
  defined in
  [`docs/frontend/component-structure.md`](../frontend/component-structure.md).

Inventory rules:

- The Sonar issue key and function identity own each work item. Current line
  numbers are navigation aids and will move during refactoring.
- Check an item when its local refactor, focused coverage, and repository gate
  pass. Record Sonar verification separately; remove a baseline issue key only
  after Sonar closes it. Add new keys to the earliest applicable phase.
- Deletion or exclusion is not remediation unless the owning behavior is
  intentionally removed and every consumer is updated and tested.
- A score increase in an existing function is a regression even when it remains
  below the reporting threshold.

## Target model

- React components render a prepared view model and delegate named event
  operations; they do not interleave large decision trees with JSX.
- Hooks retain one stable responsibility. Pure calculations move outside React;
  effectful work keeps the same hook order, dependency identity, cancellation,
  and cleanup behavior.
- Reducers and stateful services use explicit transition results. Callers do not
  infer partial state from unrelated booleans, nullable fields, or mutation
  order.
- Query, refresh, and stream orchestration reads as a short sequence of named
  stages. Pure request/response classification is separate from I/O and React
  state mutation.
- Repeated rendering choices become data or small domain presenters only when
  the data model makes the decision clearer. Existing registries remain the
  authority; no parallel registry is introduced.
- Every cluster/resource path retains `clusterId` and complete object identity:
  group, version, kind, namespace where applicable, and name.
- Remediated functions target a local complexity budget of 12 when a compatible
  analyzer can measure it, leaving margin below Sonar's maximum of 15. Sonar
  closure remains the final authority.

## Non-goals

- No rule suppression, accepted/false-positive disposition, threshold increase,
  or new source exclusion.
- No behavior, appearance, dependency upgrade, or feature work bundled into a
  complexity refactor.
- No broad subsystem rewrite, new state-management framework, compatibility
  layer, or duplicate registry.
- No custom-hook extraction that merely hides branches while increasing hook
  coupling or changing effect timing.
- No change to settled architecture: object-panel Overview stays descriptor
  driven; `LogViewer` keeps the existing `LogViewMode` discriminated-union
  reducer; table behavior stays in shared GridTable infrastructure; refresh
  keeps its existing domain registry and separate intentional cancellation
  hierarchies.
- No generated-source changes.

## Phase 0: Put the no-regression rail in place

**Outcome:** remediation cannot silently add a new S3776 issue, increase an
existing offender, or introduce a different Sonar issue while closing S3776.

- [x] Commit a machine-readable baseline containing all 91 issue keys, function
  identities, paths, and reported scores. The checker must require the baseline
  count and every retained score to be monotonic non-increasing.
- [x] Add a repository script that reads the public Sonar API for a supplied
  branch or pull request and fails for a new `typescript:S3776` key, a retained
  key with a higher score, or a total above the stored baseline.
- [x] Make baseline updates explicit: the script may remove closed keys after a
  successful main-branch analysis, but it must never auto-accept new or
  increased keys.
- [x] Keep an all-rule query beside the S3776 check and fail a remediation PR
  for any open/confirmed new-code issue. This prevents a complexity extraction
  from trading S3776 for duplication, accessibility, correctness, or another
  maintainability finding.
- [ ] Verify the Sonar check is required before merge. The repository uses
  Sonar Automatic Analysis rather than a checked-in CI scanner, so this branch
  protection is an external prerequisite and must be recorded as verified or
  unverified in each PR. GitHub's branch-protection API returned `404 Branch not
  protected` for `main` on 2026-08-06, so repository work cannot check this item
  off.
- [x] Spike a local cognitive-complexity analyzer against this exact inventory.
  Adopt it only if its TypeScript/JSX semantics reproduce the Sonar findings
  closely enough to be a useful early warning; do not treat an approximate
  local pass as stronger evidence than Sonar. Biome found 90 of the 91 Sonar
  locations but reported 224 production findings and materially different
  scores, so it is retained only as a directional per-function check.
- [x] Document the developer loop: run the local proxy if accepted, push the
  smallest batch, wait for Sonar, audit all rules, and only then update the
  baseline and this plan. The durable contract is
  [`docs/frontend/sonar.md`](../frontend/sonar.md).

## Safety loop for every finding

- [ ] Record the current function, score, issue key, callers/consumers, inputs,
  outputs, side effects, owning document, and directly affected test coverage.
- [ ] Identify hook ordering, dependency arrays, stale-closure risks, async
  cancellation, cleanup, focus, persistence, error, permission, and identity
  invariants before editing.
- [ ] For refresh, query, cache, stream, lifecycle, capability, or
  backend/frontend-boundary code, trace the producer and every affected
  consumer, readiness/ordering guarantees, and circular-dependency risk.
- [ ] Add missing characterization cases against current behavior and run them
  green. A pure refactor has no intended red phase.
- [ ] If the audit discovers a behavior defect, stop and fix it separately with
  a failing test first; do not hide a behavior change inside remediation.
- [ ] Extract one responsibility at a time. Prefer pure classifiers, parsers,
  geometry functions, comparators, presenters, transition results, and named
  effect stages over branch-moving wrappers.
- [ ] Keep React state ownership and hook call order fixed. When extracting a
  callback, prove dependency identity, cancellation, and cleanup parity.
- [ ] Run the focused tests after each extraction and measure directly affected
  statement coverage with `mise exec -- mage test:frontendCoverage`. Reach 80%
  or report the measured gap and pause for maintainer direction.
- [ ] Run `mise exec -- npm run check --prefix frontend`,
  `mise exec -- npm run typecheck --prefix frontend`, and the focused Vitest
  files before the full gate.
- [ ] Run `mise exec -- mage qc:prerelease` on the latest worktree, then inspect
  the worktree because formatting may have changed files.
- [ ] Wait for Sonar. Confirm the target key closed, no retained S3776 score
  increased, and the all-rule PR query is empty before checking off the item.

## Test-hardening inventory

Sixty of the 71 affected source files have a same-basename `*.test.ts[x]`
file. A missing same-basename file does not prove the behavior is untested, but
the following 11 sources require an explicit consumer/coverage trace before
their production refactor; add focused tests when indirect coverage does not
exercise every branch being moved:

- [x] `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts`
- [x] `frontend/src/core/refresh/resourceStreamViews.ts`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/schema.ts`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts`
- [x] `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts`
- [x] `frontend/src/shared/components/diff/diffUtils.ts`
- [x] `frontend/src/shared/components/modals/DrainNodeModal.tsx`
- [x] `frontend/src/shared/components/tables/hooks/useGridTableController.tsx`
- [x] `frontend/src/ui/dockable/useDockablePanelDragResize.ts`
- [ ] `frontend/src/ui/layout/AppLayout.tsx`

## Phase 1: Shared and app foundations (15/15 locally complete; Sonar pending)

**Outcome:** establish low-coupling refactor patterns in pure presenters,
parsers, algorithms, and boundary adapters before changing stateful feature
orchestration.

Likely seams include a parsed-resource result for `ResourceBar`, pure
connectivity and permission classifiers, declarative preference-change
dispatch, separate diff trace/backtrack stages, a prepared Sentry scope model,
and pure geometry for CodeMirror/scrollbars. Keep Sentry privacy filtering and
object-action GVK identity at their current boundaries.

- [x] **53** — `ResourceBar`, `frontend/src/shared/components/ResourceBar.tsx:47` — Sonar `AZ-P-P9RmYfklgBeFrDd`.
- [x] **43** — `ClusterOverview`, `frontend/src/modules/cluster/components/ClusterOverview.tsx:130` — Sonar `AZ-P-QVJmYfklgBeFrJQ`.
- [x] **30** — `layoutSearchPanel`, `frontend/src/core/codemirror/search.ts:159` — Sonar `AZ-P-QgsmYfklgBeFrLy`.
- [x] **25** — `buildConnectivityPresentation`, `frontend/src/core/connection/connectivityPresentation.ts:47` — Sonar `AZ-P-QgEmYfklgBeFrLs`.
- [x] **24** — `DrainNodeModal`, `frontend/src/shared/components/modals/DrainNodeModal.tsx:100` — Sonar `AZ-P-P6zmYfklgBeFrC9`.
- [x] **23** — `emitPreferenceChanges`, `frontend/src/core/settings/appPreferences.ts:654` — Sonar `AZ-P-Qf5mYfklgBeFrLr`.
- [x] **23** — `parseResource`, `frontend/src/shared/components/ResourceBar.tsx:90` — Sonar `AZ-P-P9RmYfklgBeFrDf`.
- [x] **23** — `buildMyersTrace`, `frontend/src/shared/components/diff/lineDiff.ts:58` — Sonar `AZ-P-P4KmYfklgBeFrCV`.
- [x] **21** — Sentry scope-enrichment callback, `frontend/src/core/telemetry/sentry.ts:947` — Sonar `AZ_PMfh-nvllwip2ec40`.
- [x] **21** — `mergeDiffLines`, `frontend/src/shared/components/diff/diffUtils.ts:42` — Sonar `AZ-P-P4UmYfklgBeFrCW`.
- [x] **18** — `resolveActionGVK`, `frontend/src/shared/actions/objectActionClient.ts:66` — Sonar `AZ-P-P_qmYfklgBeFrD9`.
- [x] **17** — `beforeSend`, `frontend/src/core/telemetry/sentry.ts:484` — Sonar `AZ_PMfh-nvllwip2ec4v`.
- [x] **16** — `queryNamespacesPermissions`, `frontend/src/core/capabilities/permissionStore.ts:447` — Sonar `AZ-P-QXRmYfklgBeFrJf`.
- [x] **16** — `ResourceMetadata` memo renderer, `frontend/src/shared/components/kubernetes/ResourceMetadata.tsx:19` — Sonar `AZ-P-P8vmYfklgBeFrDY`.
- [x] **16** — `updateOverlayScrollbarGeometry`, `frontend/src/shared/scrollbars/scrollbarActivity.ts:375` — Sonar `AZ-P-P_KmYfklgBeFrD1`.

Required characterization includes empty/malformed resource text, connectivity
state precedence, permission scope/GVK selection, preference-event ordering,
diff insert/delete/change grouping, Sentry scrubbing and tag precedence, modal
denial/loading/error states, and zero/partial DOM geometry.

Local remediation status (awaiting Sonar analysis):

- `ResourceBar` (`AZ-P-P9RmYfklgBeFrDd`) now renders a prepared resource-bar
  model and delegates animation, tooltip, track, and overcommit responsibilities
  to named units.
- The nested `parseResource` finding (`AZ-P-P9RmYfklgBeFrDf`) was removed by
  making `shared/utils/resourceCalculations.ts` the resource parsing and display
  contract used by the bar, table exports, overview/detail calculations, and
  sorting adapters. A failing regression test also exposed and fixed TiB table
  exports (`1.5Ti` previously exported as `0Mi`).
- The touched functions pass Biome's directional cognitive-complexity rule with
  a temporary local maximum of 12. Keep both issue checkboxes open until the
  pushed revision is analyzed and the Sonar keys close.
- `ClusterOverview` (`AZ-P-QVJmYfklgBeFrJQ`) now keeps refresh activation and
  cluster-switch hydration in the owning component while delegating prepared
  rendering, cluster-scoped selection, navigation, recent-event object
  identity, restrictions, and resource summaries to cohesive units. The
  component and every extracted production function pass the same temporary
  Biome maximum of 12. Its 26 component tests and 11 focused model tests pass;
  measured coverage is 81.98% statements for `ClusterOverview.tsx`, 100% for
  `ClusterOverviewView.tsx`, and 100% for `clusterOverviewModel.ts`. Keep the
  issue checkbox open until the pushed revision is analyzed and the Sonar key
  closes.
- `layoutSearchPanel` (`AZ-P-QgsmYfklgBeFrLy`) now separates native-control
  cleanup, primary/navigation preparation, replace/advanced row preparation,
  and deterministic row ordering. Its 10 focused tests pass with 92% statement
  coverage, and every touched production function passes the temporary Biome
  maximum of 12. Keep the issue checkbox open until Sonar analyzes the pushed
  revision.
- `buildConnectivityPresentation` (`AZ-P-QgEmYfklgBeFrLs`) now evaluates named
  inactive, authentication-recovery, lifecycle, namespace, and settled-health
  stages in the existing precedence order. Its 18 focused tests pass with 100%
  statement coverage, and every stage passes the temporary Biome maximum of
  12. Keep the issue checkbox open until Sonar analyzes the pushed revision.
- `emitPreferenceChanges` (`AZ-P-Qf5mYfklgBeFrLr`) now uses a typed
  select/compare/emit boundary while retaining the event sequence explicitly at
  the call site, including per-mode palette and color payloads. Its 43 focused
  preference tests pass with 94.5% statement coverage, and every touched
  production function passes the temporary Biome maximum of 12. Keep the issue
  checkbox open until Sonar analyzes the pushed revision.
- `buildMyersTrace` (`AZ-P-P4KmYfklgBeFrCV`) now separates frontier selection,
  compute-budget accounting, matching-line traversal, and frontier advancement
  while retaining the existing trace snapshots and backtracking input.
- `mergeDiffLines` (`AZ-P-P4UmYfklgBeFrCW`) now separates change-block
  collection, side pairing, and context projection. The two diff utilities pass
  14 focused tests with 97.29% combined statement coverage and every touched
  production function passes the temporary Biome maximum of 12. Keep both issue
  checkboxes open until Sonar analyzes the pushed revision.
- `resolveActionGVK` (`AZ-P-P_qmYfklgBeFrD9`) now separates carried identity,
  synthetic Helm identity, registered built-in identity, and custom-resource
  group/version validation. Its 12 direct tests pass with 98.57% statement
  coverage, four action consumer suites pass, and every touched production
  function passes the temporary Biome maximum of 12. Keep the issue checkbox
  open until Sonar analyzes the pushed revision.
- The `ResourceMetadata` memo renderer (`AZ-P-P8vmYfklgBeFrDY`) now renders a
  prepared metadata model that merges visible selectors without overwriting
  explicit labels. Its seven focused tests pass with 100% statement, branch,
  function, and line coverage, and every touched production function passes the
  temporary Biome maximum of 12. Keep the issue checkbox open until Sonar
  analyzes the pushed revision.
- `DrainNodeModal` (`AZ-P-P6zmYfklgBeFrC9`) now retains refresh activation and
  cluster-scoped drain execution in the owning component while delegating
  permission explanations, option normalization, job selection, and rendering
  to named model and view units. Its 13 direct component/model tests pass with
  94.85% combined statement coverage, and every extracted production function
  passes the temporary Biome maximum of 12. Keep the issue checkbox open until
  Sonar analyzes the pushed revision.
- The Sentry `beforeSend` (`AZ_PMfh-nvllwip2ec4v`) and scope-enrichment callback
  (`AZ_PMfh-nvllwip2ec40`) now separate event correlation, workspace/request
  breadcrumb selection, privacy sanitization, capture resolution, tag
  precedence, and allowlisted context projection. All 25 direct telemetry tests
  pass with 94.08% statement coverage, and every touched production function
  passes the temporary Biome maximum of 12. Keep both issue checkboxes open
  until Sonar analyzes the pushed revision.
- `queryNamespacesPermissions` (`AZ-P-QXRmYfklgBeFrJf`) now separates target
  planning, full GVK payload projection, pending/diagnostic registration,
  response classification, transient retry handling, and finalization. Its 25
  direct permission-store tests pass with 81.67% statement coverage; the target
  and its former nested transaction callback pass the temporary Biome maximum
  of 12. Keep the issue checkbox open until Sonar analyzes the pushed revision.
- `updateOverlayScrollbarGeometry` (`AZ-P-P_KmYfklgBeFrD1`) now delegates token
  reads, positioning, zero-size hiding, and vertical/horizontal geometry to
  axis-specific stages. Its 30 direct tests pass with 81.06% statement coverage,
  including disconnected, overflow-loss, container-move, resize, zero-size,
  and horizontal-only cases; the target and extracted production functions pass
  the temporary Biome maximum of 12. Keep the issue checkbox open until Sonar
  analyzes the pushed revision.

All 15 recorded Phase 1 findings are locally remediated. Sonar closure remains
pending until the pushed revision is analyzed.

## Phase 2: GridTable and query-backed data (16/16 locally complete; Sonar pending)

**Outcome:** table derivation, caching, measurement, persistence, filters, and
query reconciliation have explicit pure stages while the shared GridTable
contract remains the single owner.

Split sorting into decoration/cache-reuse/comparison stages; cell caching into
cache selection/read/render/write stages; column sizing into DOM measurement
and pure width decisions; persistence into validate/prune/serialize stages; and
query hooks into request planning, response classification, and state
application. Preserve stable row keys, durable column keys, local-versus-query
filter ownership, cursor identity, exact/approximate totals, virtualization,
and controlled focus.

- [x] **50** — `sortedData` memo, `frontend/src/hooks/useTableSort.ts:119` — Sonar `AZ-P-QrBmYfklgBeFrPG`.
- [x] **46** — `getCachedCellContent`, `frontend/src/shared/components/tables/hooks/useGridTableCellCache.tsx:72` — Sonar `AZ-P-PzimYfklgBeFrAG`.
- [x] **39** — `useGridTableController`, `frontend/src/shared/components/tables/hooks/useGridTableController.tsx:112` — Sonar `AZ-P-Pw9mYfklgBeFq_i`.
- [x] **37** — `measureColumnWidth`, `frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.ts:114` — Sonar `AZ-P-Px1mYfklgBeFq_s`.
- [x] **25** — `buildColumnWidthState`, `frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.ts:201` — Sonar `AZ-P-PzDmYfklgBeFrAA`.
- [x] **24** — `buildTypedResourceQueryScope`, `frontend/src/modules/resource-grid/typedResourceQueryScope.ts:136` — Sonar `AZ-P-QRHmYfklgBeFrIZ`.
- [x] **23** — `distributeFlexWidths`, `frontend/src/shared/components/tables/hooks/gridTableColumnWidthMath.ts:172` — Sonar `AZ-P-PytmYfklgBeFq_9`.
- [x] **22** — GridTable context-menu builder callback, `frontend/src/shared/components/tables/hooks/useGridTableContextMenuItems.tsx:34` — Sonar `AZ-P-PxemYfklgBeFq_n`.
- [x] **21** — `prunePersistedState`, `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts:436` — Sonar `AZ-P-P0OmYfklgBeFrAV`.
- [x] **21** — `buildPersistedStateForSave`, `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts:543` — Sonar `AZ-P-P0OmYfklgBeFrAW`.
- [x] **20** — catalog page-request transaction, `frontend/src/modules/browse/hooks/useBrowseCatalog.ts:484` — Sonar `AZ-P-QPZmYfklgBeFrH7`.
- [x] **20** — `buildGridTableFilterOptions`, `frontend/src/shared/components/tables/gridTableFilterEngine.ts:40` — Sonar `AZ-P-P2hmYfklgBeFrBC`.
- [x] **19** — `applyPayload`, `frontend/src/modules/resource-grid/useTypedResourceQuery.ts:372` — Sonar `AZ-P-QSOmYfklgBeFrIl`.
- [x] **17** — typed-query request effect, `frontend/src/modules/resource-grid/useTypedResourceQuery.ts:487` — Sonar `AZ-P-QSOmYfklgBeFrIp`.
- [x] **16** — `walkQueryCursorPages`, `frontend/src/modules/resource-grid/cursorPageWalk.ts:48` — Sonar `AZ-P-QSDmYfklgBeFrIk`.
- [x] **16** — local row-filter predicate, `frontend/src/shared/components/tables/gridTableFilterEngine.ts:227` — Sonar `AZ-P-P2hmYfklgBeFrBD`.

Required characterization includes stable sorting and cache reuse, duplicate or
missing row identities, primitive/object cache eviction, zero-width and
unmounted DOM, persisted schema normalization, `all`/`some`/`none` filters,
query-facet invalidation, stale-response rejection, cursor invalidation,
anchor/start-rank navigation, approximate totals, warm-up retry, typed
permission denial, and stream-signal coalescing.

Phase 2 batch 1 separates sorting decoration/cache reuse/comparison, cell-cache
selection/read/render/write, controller pagination/profiling/key validation,
and header/cell/kind measurement stages. The 80 focused tests pass. Directly
affected statement coverage is 92.95% for `useTableSort.ts`, 81.39% for
`useGridTableCellCache.tsx`, 82.60% for `useGridTableController.tsx` through
`GridTable.test.tsx`, and 89.11% for `useGridTableColumnMeasurer.ts`. All four
production files pass the temporary Biome maximum of 12. Sonar verification is
pending branch analysis.

Phase 2 batch 2 separates controlled/uncontrolled column-width state,
filter/facet/sort/predicate/page-address query projection, flex scaling and
rounding correction, and custom/sort context-menu sections. Its 32 focused
tests pass. Focused statement coverage is 84.09% for
`useGridTableColumnWidths.ts`, 80.21% for `typedResourceQueryScope.ts`, 86.81%
for `gridTableColumnWidthMath.ts`, and 97.43% for
`useGridTableContextMenuItems.tsx`. All four production files pass the
temporary Biome maximum of 12. Sonar verification is pending branch analysis.

Phase 2 batch 3 centralizes persisted visibility/width/sort/filter/page-size
pruning so load and save share one schema path, and separates dropdown option
collection from local row matching. Its 55 focused persistence/filter tests
pass. Statement coverage is 85.38% for `gridTablePersistence.ts` across the
persistence suite and 82.24% for `gridTableFilterEngine.ts`. Both production
files pass the temporary Biome maximum of 12. Sonar verification is pending
branch analysis.

Phase 2 batch 4 separates catalog request admission, result application, and
page landing; typed-query payload navigation, anchor landing, request dispatch,
and export planning; and cursor-walk drift transitions. Its 57 focused tests
pass. Full-suite statement coverage is 93.63% for `useBrowseCatalog.ts`, 91.45%
for `useTypedResourceQuery.ts`, and 88.88% for `cursorPageWalk.ts`. All 13 Phase
2 production files pass the temporary Biome maximum of 12 after the prerelease
gate. The full frontend coverage run passes 4,066 tests with 80.80% statement
coverage, and `mise exec -- mage qc:prerelease` passes. Sonar verification is
pending branch analysis.

All 16 recorded Phase 2 findings are locally remediated. Sonar closure remains
pending until the pushed revision is analyzed.

## Phase 3: Object map (4/4 locally complete; Sonar pending)

**Outcome:** graph preparation, visibility, layout, and rendering orchestration
are separate without changing backend-owned identity or relationship facts.

Prepare a typed visible-graph/view model before rendering; keep G6 lifecycle
effects in the component; keep layout inputs/outputs pure; and isolate
directional traversal from inclusion policy. Do not repair partial identity by
kind/name guessing, and keep raw, visible, and rendered debug states distinct.

- [x] **54** — `ObjectMap`, `frontend/src/modules/object-map/ObjectMap.tsx:102` — Sonar `AZ-P-QMsmYfklgBeFrHO`.
- [x] **27** — `orderColumnsByBarycenter`, `frontend/src/modules/object-map/objectMapLayout.ts:340` — Sonar `AZ-P-QOEmYfklgBeFrHk`.
- [x] **20** — `computeNodeColumns`, `frontend/src/modules/object-map/objectMapLayout.ts:164` — Sonar `AZ-P-QOEmYfklgBeFrHi`.
- [x] **17** — `filterByDirectionalReachability`, `frontend/src/modules/object-map/objectMapDirectionalFilter.ts:38` — Sonar `AZ-P-QMLmYfklgBeFrHJ`.

Phase 3 separates toolbar, legend, warnings, viewport preservation, and context
menu presentation from the object-map shell; graph construction from
longest-path propagation, cycle fallback, seed anchoring, and source pulling;
barycenter calculation/comparison from directional sweeps; and adjacency
construction from the two pure-direction traversals. The 25-file object-map
suite passes 189 tests, and the four directly affected suites pass 50 tests.
Focused statement coverage is 91.44% for `ObjectMap.tsx`, 97.27% for
`objectMapLayout.ts`, and 97.67% for `objectMapDirectionalFilter.ts`. All three
production files, including the adjacent extracted functions, pass the
temporary Biome maximum of 12. `mise exec -- mage qc:prerelease` passes all
4,066 frontend tests and the remaining repository gates. Sonar verification is
pending branch analysis.

All four recorded Phase 3 findings are locally remediated. Sonar closure remains
pending until the pushed revision is analyzed.

Required characterization includes empty and truncated graphs, cycles,
disconnected components, deterministic column/order output, `all`/`some`/`none`
kind filtering, directional reachability, collapse/selection, renderer cleanup,
complete refs for open/navigation actions, and bounded large-graph work.

## Phase 4: Object panel (14/14 locally complete; Sonar pending)

**Outcome:** detail derivation, log viewing, YAML transactions, and capability
projection are decomposed at their existing ownership boundaries.

Keep `LogViewMode` as the single async-state union and split reducer decisions
into explicit transition helpers; prepare `LogViewer` display/control models
outside JSX while leaving stream ownership and effects intact. Keep Overview
descriptor-driven, extracting descriptor-local presenters rather than new
per-kind components. Split YAML validation/transaction classification from
effects without changing dirty-state, save, conflict, or cancellation order.

- [x] **40** — `deriveDetailUtilizationData`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:61` — Sonar `AZ-P-QE8mYfklgBeFrFE`.
- [x] **36** — `LogViewerInner`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:396` — Sonar `AZ-P-QJemYfklgBeFrGK`.
- [x] **36** — `logViewerReducer`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts:212` — Sonar `AZ-P-QI2mYfklgBeFrGA`.
- [x] **29** — `NodeLogsTab`, `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.tsx:196` — Sonar `AZ-P-QKzmYfklgBeFrG1`.
- [x] **23** — `validateYamlDraft`, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlValidation.ts:127` — Sonar `AZ-P-QHLmYfklgBeFrFg`.
- [x] **22** — LogViewer action callback, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:1456` — Sonar `AZ-P-QJemYfklgBeFrGR`.
- [x] **21** — policy descriptor `renderMetric`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx:176` — Sonar `AZ-P-QDGmYfklgBeFrEs`.
- [x] **19** — `coverageKeys`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/schema.ts:101` — Sonar `AZ-P-QDmmYfklgBeFrE0`.
- [x] **19** — `YamlTab`, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:138` — Sonar `AZ-P-QGymYfklgBeFrFV`.
- [x] **19** — YAML transaction effect, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts:248` — Sonar `AZ-P-QHAmYfklgBeFrFc`.
- [x] **19** — `computeCapabilityDescriptors`, `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts:74` — Sonar `AZ-P-QB2mYfklgBeFrEa`.
- [x] **16** — `formatTimestampForMode`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:156` — Sonar `AZ-P-QJemYfklgBeFrGG`.
- [x] **16** — `longestSuffixPrefixOverlap`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useAnchoredLogEntries.ts:17` — Sonar `AZ-P-QIFmYfklgBeFrF2`.
- [x] **16** — filtered-log memo, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts:96` — Sonar `AZ-P-QHymYfklgBeFrFx`.

Phase 4 batch 1 separates YAML document parsing, mapping/identity extraction,
and expected-identity comparison; descriptor item coverage; log overlap prefix
construction/matching; and timestamp ordering, source selection, and text
matching. Its four focused suites pass 116 tests before the added YAML cases,
and the final YAML suite passes 17 tests. Focused statement coverage is 95.53%
for `yamlValidation.ts`, 100% for `schema.ts`, 88.23% for
`useAnchoredLogEntries.ts`, and 95.34% for `useLogFiltering.ts`. All four
production files and adjacent extracted functions pass the temporary Biome
maximum of 12. `mise exec -- mage qc:prerelease` passes all 4,074 frontend
tests and the remaining repository gates. Sonar verification is pending branch
analysis.

Phase 4 batch 2 separates detail-backed node, pod, and workload utilization;
log-viewer inventory, preferences, parsed-view, and asynchronous mode
transitions; HPA metric matching/name/target/current presentation; and
capability identity construction, feature-specific descriptor assembly,
node-log discovery projection, and denial reasons. Its nine combined focused
test files pass 165 tests after the batch 1 and reducer characterization
expansion. Focused statement coverage is 83.33% for `useUtilizationData.ts`,
92.72% for `policy.tsx`, 100% for `logViewerReducer.ts`, and 92.61% for
`useObjectPanelCapabilities.ts`. All eight completed Phase 4 production files
pass the temporary Biome maximum of 12 on the post-gate worktree.
`mise exec -- mage qc:prerelease` passes all 4,079 frontend tests and the
remaining repository gates. Sonar verification is pending branch analysis.

Phase 4 batch 3 separates node-log request planning, incremental fallback,
render-state selection, and toolbar composition; container-log snapshot,
fallback, active-pod, filter-chip, row-rendering, inventory, control, and
blocking-state responsibilities; timestamp-mode formatting; and YAML snapshot
adoption, post-apply verification, reload/merge, ownership-check, save, notice,
toolbar, and editor-surface responsibilities. Its nine focused test files pass
153 tests. Focused statement coverage is 81.8% for `LogViewer.tsx`, 86.11% for
`NodeLogsTab.tsx`, 89.47% for `YamlTab.tsx`, and 80.14% for
`yamlTransaction.ts`. All twelve completed Phase 4 production files pass the
temporary Biome maximum of 12 on the post-gate worktree. `mise exec -- mage
qc:prerelease` passes all 4,081 frontend tests across 465 test files and the
remaining repository gates. Sonar verification is pending branch analysis.

All fourteen recorded Phase 4 findings are locally remediated. Sonar closure
remains pending until the pushed revision is analyzed.

Required characterization includes complete object/cluster scope, metrics
absent/stale/error states, every `LogViewMode` transition, streaming/fallback
handoff, timestamp modes, anchor overlap, search/filter/wrap behavior, node-log
file/service modes, YAML parse/schema/identity failures, conflict/save/reset,
permission-gated actions, descriptor drift coverage, grouped-panel context, and
close-versus-transient-unmount cleanup.

## Phase 5: App shell and interactions (26/26 locally complete; Sonar pending)

**Outcome:** keyboard routing, command palette, navigation, favorites, dropdowns,
dockable geometry, and layout render from explicit action/view models while
their current surface ownership and persistence remain intact.

Use pure key-to-action classifiers and leave effect execution at the owning
surface; keep native input/editor behavior as the fallback. Extract pure drag
and window-bound geometry without moving dockable state ownership. Build
palette/sidebar/theme/favorite rows from prepared models rather than branching
inside JSX. Keep favorites as complete pane snapshots and cluster workspace in
its React-free store.

- [x] **50** — shortcut `handleKeyDown`, `frontend/src/ui/shortcuts/context.tsx:447` — Sonar `AZ-P-QhtmYfklgBeFrMJ`.
- [x] **48** — sidebar `onKeyDown`, `frontend/src/ui/layout/SidebarKeys.ts:250` — Sonar `AZ-P-QpXmYfklgBeFrOb`.
- [x] **46** — dropdown `handleKeyAction`, `frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts:74` — Sonar `AZ-P-P3DmYfklgBeFrB9`.
- [x] **42** — dockable `handleMouseMove`, `frontend/src/ui/dockable/useDockablePanelDragResize.ts:307` — Sonar `AZ-P-QmkmYfklgBeFrNS`.
- [x] **29** — `Sidebar`, `frontend/src/ui/layout/Sidebar.tsx:61` — Sonar `AZ-P-QpzmYfklgBeFrOg`.
- [x] **27** — favorite-navigation effect, `frontend/src/core/contexts/FavoritesContext.tsx:132` — Sonar `AZ-P-Qd1mYfklgBeFrLU`.
- [x] **26** — dockable window-bounds timeout callback, `frontend/src/ui/dockable/useDockablePanelWindowBounds.ts:68` — Sonar `AZ-P-QnTmYfklgBeFrNy`.
- [x] **25** — command-palette catalog scoring callback, `frontend/src/ui/command-palette/CommandPalette.tsx:149` — Sonar `AZ-P-Ql7mYfklgBeFrNH`.
- [x] **24** — tab-group update callback, `frontend/src/ui/dockable/DockablePanelProvider.tsx:445` — Sonar `AZ-P-QnKmYfklgBeFrNs`.
- [x] **23** — dropdown `getNextEnabledIndex`, `frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts:33` — Sonar `AZ-P-P3DmYfklgBeFrB8`.
- [x] **22** — `scrollToNextTab`, `frontend/src/shared/components/tabs/Tabs.tsx:166` — Sonar `AZ-P-P55mYfklgBeFrCo`.
- [x] **22** — `ObjectDiffModal`, `frontend/src/ui/modals/ObjectDiffModal.tsx:394` — Sonar `AZ-P-QiomYfklgBeFrMY`.
- [x] **20** — `mergeWireState`, `frontend/src/core/cluster-workspace/clusterWorkspaceStore.ts:312` — Sonar `AZ-P-QfImYfklgBeFrLk`.
- [x] **20** — `Dropdown`, `frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx:61` — Sonar `AZ-P-P3PmYfklgBeFrB_`.
- [x] **19** — shortcut-help row renderer, `frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx:97` — Sonar `AZ-P-QhJmYfklgBeFrL_`.
- [x] **18** — kubeconfig selection callback, `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx:349` — Sonar `AZ-P-QVYmYfklgBeFrJY`.
- [x] **18** — `AppLayout`, `frontend/src/ui/layout/AppLayout.tsx:97` — Sonar `AZ-P-QqLmYfklgBeFrOr`.
- [x] **17** — namespace row projection, `frontend/src/modules/namespace/contexts/NamespaceContext.tsx:270` — Sonar `AZ-P-P_5mYfklgBeFrD_`.
- [x] **17** — `parseQueryTokens` token callback, `frontend/src/ui/command-palette/CommandPalette.tsx:64` — Sonar `AZ-P-Ql7mYfklgBeFrNG`.
- [x] **17** — command registry memo, `frontend/src/ui/command-palette/CommandPaletteCommands.tsx:160` — Sonar `AZ-P-QlgmYfklgBeFrNC`.
- [x] **17** — `DockablePanelInner`, `frontend/src/ui/dockable/DockablePanel.tsx:167` — Sonar `AZ-P-QmxmYfklgBeFrNZ`.
- [x] **17** — theme row renderer, `frontend/src/ui/settings/sections/AppearanceSection.tsx:1144` — Sonar `AZ-P-QkGmYfklgBeFrMq`.
- [x] **16** — favorite match memo, `frontend/src/ui/favorites/FavToggle.tsx:268` — Sonar `AZ-P-QlUmYfklgBeFrM-`.
- [x] **16** — pending-favorite restore effect, `frontend/src/ui/favorites/FavToggle.tsx:326` — Sonar `AZ-P-QlUmYfklgBeFrM_`.
- [x] **16** — `describeElementTarget`, `frontend/src/ui/layout/SidebarKeys.ts:52` — Sonar `AZ-P-QpXmYfklgBeFrOa`.
- [x] **16** — `CommandPaletteComponent`, `frontend/src/ui/command-palette/CommandPalette.tsx:212` — Sonar `AZ-P-Ql7mYfklgBeFrNJ`.

Phase 5 batch 1 separates dropdown option traversal and per-key actions, tab
overflow target calculation and strip-item rendering, sidebar target decoding,
Tab-region transfer, navigation eligibility, and individual sidebar actions.
The dropdown and Tabs suites pass 75 focused tests; the Sidebar and SidebarKeys
suites pass 52. Focused statement coverage is 85.89% for
`useKeyboardNavigation.ts`, 88.64% for `Tabs.tsx`, and 90.94% for
`SidebarKeys.ts`. All three production files pass the temporary Biome maximum
of 12. `mise exec -- mage qc:prerelease` passes all 4,081 frontend tests across
465 test files and the remaining repository gates. Sonar verification is
pending branch analysis.

Phase 5 batch 2 gives every surface result one event-claim path, then separates
captured Tab routing, Escape candidate traversal, target-surface dispatch,
native-edit deferral, and registered-shortcut selection. Shortcut-help modifier,
key-content, row, and group presentation now have distinct renderers. Its three
focused suites pass 27 tests, including disabled-shortcut discovery, repeated
key dispatch, native-edit protection, menu paste, surface precedence, and modal
suppression. Focused statement coverage is 83.28% for `context.tsx` and 98.07%
for `ShortcutHelpModal.tsx`. Both production files pass the temporary Biome
maximum of 12. `mise exec -- mage qc:prerelease` passes all 4,082 frontend tests
across 465 test files and the remaining repository gates. Sonar verification is
pending branch analysis.

Phase 5 batch 3 separates docked keyboard sizing, floating drag and per-edge
resize geometry, animation-frame scheduling, window-bound calculation and
application, tab-group target resolution, panel group-view preparation, Tab
cycling, content rendering, resize-handle rendering, and dock focus selection.
Its four focused suites pass 58 tests. Focused statement coverage is 92.41% for
`DockablePanel.tsx`, 88.69% for `DockablePanelProvider.tsx`, 90.14% for
`useDockablePanelDragResize.ts`, and 89.65% for
`useDockablePanelWindowBounds.ts`. All four production files pass the temporary
Biome maximum of 12. `mise exec -- mage qc:prerelease` passes all 4,082 frontend
tests across 465 test files and the remaining repository gates. Sonar
verification is pending branch analysis.

Phase 5 batch 4 separates query-token classification, catalog scoring, palette
group and row rendering, application/cluster/global command construction, and
kubeconfig command presentation and selection. Its three focused suites pass
57 tests. Focused statement coverage is 86.26% for `CommandPalette.tsx` and
86.56% for `CommandPaletteCommands.tsx`; command-registry function coverage is
80%. Both production files pass the temporary Biome maximum of 12.
`mise exec -- mage qc:prerelease` passes all 4,084 frontend tests across 465
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Phase 5 batch 5 separates shared dropdown placement, trigger, controls, option
rows, and display-value presentation, and splits object-diff catalog stages,
match transactions, selection controls, diff-state rendering, and update
labels. The refactor also clears seven adjacent over-threshold functions in
the two files. Four focused suites pass 49 tests. Focused statement coverage
is 90.57% for `Dropdown.tsx` and 81.99% for `ObjectDiffModal.tsx`. Both
production files pass the temporary Biome maximum of 12.
`mise exec -- mage qc:prerelease` passes all 4,084 frontend tests across 465
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Phase 5 batch 6 separates sidebar expansion/scroll effects, namespace and
cluster row presentation, route content, resize and overlay presentation,
object-map debug formatting, theme comparison/save planning, and saved-theme
row controls. The three production files pass the temporary Biome maximum of
12. Seven layout-focused suites pass 68 tests; `Sidebar.tsx` has 93.95%
focused statement coverage. The six-test appearance suite passes, but
`AppearanceSection.tsx` measures 46.33% statement coverage, and the existing
layout suites do not import `AppLayout.tsx`, which therefore measures 0% in
the focused run. Those two coverage gaps are explicitly retained rather than
misrepresented as covered; the AppLayout test-hardening item above remains
open. `mise exec -- mage qc:prerelease` passes all 4,084 frontend tests across
465 test files and the remaining repository gates. Sonar verification is
pending branch analysis.

Phase 5 batch 7 separates favorite navigation readiness/application, current
favorite matching, pane restoration, cluster-workspace live-field merge,
kubeconfig selection planning/commit/rollback, and namespace presentation
summaries. All five production files pass the temporary Biome maximum of 12.
The two favorites suites pass 24 tests with 92.70% statement coverage for
`FavoritesContext.tsx` and 89.34% for `FavToggle.tsx`; six workspace/lifecycle
suites pass 75 tests with 90.17% for `clusterWorkspaceStore.ts`; the kubeconfig
suite passes 18 tests with 86.29% for `KubeconfigContext.tsx`; and two namespace
suites pass 24 tests with 86.41% for `NamespaceContext.tsx`.
`mise exec -- mage qc:prerelease` passes all 4,084 frontend tests across 465
test files and the remaining repository gates. All 26 Phase 5 findings are
locally remediated; Sonar verification is pending branch analysis.

Required characterization includes modal/palette/menu precedence, key repeat,
disabled shortcuts, native input editing, dropdown wrap/disabled/header
navigation, sidebar target descriptions and tree movement, palette token and
catalog scoring, docked/floating/grouped move/resize/close, stable group IDs,
cluster-tab switches, workspace event precedence, favorite pane hydration and
restore ordering, theme drag/drop, namespace cluster isolation, and focus
cleanup after unmount.

## Phase 6: Refresh and diagnostics (16/16 locally complete; Sonar pending)

**Outcome:** the highest-risk orchestration code becomes a pipeline of explicit
domain decisions and effect stages while preserving freshness, leases,
readiness, source clocks, polling fallback, error semantics, and diagnostics.

Start with test hardening. Extract diagnostics row/count/polling/health
presenters as pure functions; keep the existing domain configuration as the
single registry. Split refresh target selection from execution. In the
orchestrator, separate request planning, readiness/permission classification,
fetch execution, stale-result rejection, and commit/notification. In stream
managers, separate payload validation/classification from state mutation and
callbacks. Do not change the order that enables the operation needed to reach
ready state.

- [x] **76** — base diagnostics-row projection, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:907` — Sonar `AZ-P-QbMmYfklgBeFrKf`.
- [x] **44** — diagnostics domain-count resolver, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:1082` — Sonar `AZ-P-QbMmYfklgBeFrKq`.
- [x] **41** — `performFetch`, `frontend/src/core/refresh/orchestrator.ts:1265` — Sonar `AZ-P-QdNmYfklgBeFrLI`.
- [x] **35** — `refreshSingle`, `frontend/src/core/refresh/RefreshManager.ts:603` — Sonar `AZ-P-QcQmYfklgBeFrK9`.
- [x] **35** — `isResourceStreamViewActive`, `frontend/src/core/refresh/resourceStreamViews.ts:58` — Sonar `AZ-P-Qc9mYfklgBeFrLD`.
- [x] **30** — resource-stream `handleMessage`, `frontend/src/core/refresh/streaming/resourceStreamManager.ts:322` — Sonar `AZ-P-QY6mYfklgBeFrJz`.
- [x] **29** — `fetchScopedDomain`, `frontend/src/core/refresh/orchestrator.ts:1166` — Sonar `AZ-P-QdNmYfklgBeFrLH`.
- [x] **26** — `getForegroundRefreshTargets`, `frontend/src/core/refresh/RefreshManager.ts:498` — Sonar `AZ-P-QcQmYfklgBeFrK8`.
- [x] **26** — `isPermissionDeniedStatus`, `frontend/src/core/refresh/permissionErrors.ts:13` — Sonar `AZ-P-Qc0mYfklgBeFrLC`.
- [x] **25** — pod diagnostics-row projection, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:1248` — Sonar `AZ-P-QbMmYfklgBeFrKs`.
- [x] **25** — `setScopedDomainEnabled`, `frontend/src/core/refresh/orchestrator.ts:434` — Sonar `AZ-P-QdNmYfklgBeFrLG`.
- [x] **20** — `buildContainerLogsSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:946` — Sonar `AZ-P-QadmYfklgBeFrKV`.
- [x] **20** — container-log stream `applyPayload`, `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts:427` — Sonar `AZ-P-QZSmYfklgBeFrJ5`.
- [x] **18** — `buildCatalogSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:885` — Sonar `AZ-P-QadmYfklgBeFrKT`.
- [x] **17** — `resolveDomainNamespace`, `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts:22` — Sonar `AZ-P-QapmYfklgBeFrKZ`.
- [x] **17** — `buildMetricsSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:773` — Sonar `AZ-P-QadmYfklgBeFrKQ`.

Phase 6 batch 1 separates namespace/scope decoding, broker-read status,
capability descriptor indexing, permission row projection/filtering,
orchestrator and metrics presentation, catalog stream presentation, and
container-log summary statistics/content. It also clears six adjacent
over-threshold functions in `diagnosticsRowModel.ts`. Both production files
pass the temporary Biome maximum of 12. A new 29-case utility suite covers the
previously untested scope and duration helpers; the three diagnostics suites
pass 63 tests. Focused statement coverage is 91.97% for
`diagnosticsRowModel.ts` and 100% for `diagnosticsPanelUtils.ts`.
`mise exec -- mage qc:prerelease` passes all 4,113 frontend tests across 466
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Phase 6 batch 2 separates scope-role decoding, preferred cluster-state
selection, stream health/polling presentation, telemetry/metrics/count models,
pod/log/object-panel row projection, capability grouping, and diagnostics Tab
navigation. It clears the three recorded `DiagnosticsPanel.tsx` findings plus
eight adjacent over-threshold functions. The production file passes the
temporary Biome maximum of 12. Its 24-test suite passes with 85.90% focused
statement coverage; the three diagnostics suites pass 63 tests together.
`mise exec -- mage qc:prerelease` passes all 4,113 frontend tests across 466
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Phase 6 batch 3 replaces nested permission-payload validation with typed field
tables and separates permission-message detail assembly. It also replaces the
resource-stream view switch tree with explicit namespace and cluster domain
maps while preserving focused Pod leases. Both production files pass the
temporary Biome maximum of 12. The two focused suites pass 35 tests; statement
coverage is 100% for `permissionErrors.ts` and 95.23% for
`resourceStreamViews.ts`. `mise exec -- mage qc:prerelease` passes all 4,143
frontend tests across 467 test files and the remaining repository gates. Sonar
verification is pending branch analysis.

Phase 6 batch 4 separates normalized cluster-set comparison and visible target
selection from `RefreshManager` foreground scheduling. It also separates
automatic-refresh eligibility, in-flight supersession, successful completion,
intentional aborts, and failed completion from refresh execution. The
production file passes the temporary Biome maximum of 12. Its 59-test suite
passes with 94.45% focused statement coverage. `mise exec -- mage
qc:prerelease` passes all 4,143 frontend tests across 467 test files and the
remaining repository gates. Sonar verification is pending branch analysis.

Phase 6 batch 5 separates stale-scope cleanup, refresher activity, streaming
enablement, query-only reconciliation, streaming fetch decisions, in-flight
claiming, request setup, commit eligibility, response application, error
classification, and trailing doorbell replay from the orchestrator entry
points. It clears the three recorded findings plus the adjacent streaming-start
completion callback. The production file passes the temporary Biome maximum of
12. Its two focused suites pass 100 tests with 82.32% statement coverage.
`mise exec -- mage qc:prerelease` passes all 4,143 frontend tests across 467
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Phase 6 batch 6 separates resource-stream parsing, subscription resolution,
cluster-name capture, signal-envelope dispatch, legacy dispatch, reset replay,
and permission-error handling. Container-log payload validation is split into
required and optional field predicates, while payload application now separates
buffer projection, truncation totals, backend warnings, and scoped-store
commit. It clears both remaining recorded findings plus the adjacent payload
validator. Both production files pass the temporary Biome maximum of 12. Their
focused suites pass 74 tests; statement coverage is 83.40% for
`resourceStreamManager.ts` and 90.24% for `containerLogsStreamManager.ts`.
`mise exec -- mage qc:prerelease` passes all 4,143 frontend tests across 467
test files and the remaining repository gates. Sonar verification is pending
branch analysis.

Required characterization includes retained first paint, foreground versus user
intent, paused automatic refresh, query-versus-snapshot leases, stale response
rejection, loading-to-ready progress, typed permission denial, manual-job error
semantics, source-clock ownership, ACK/replay/reset, query-only fallback,
enable/disable/re-enable flaps, cancellation and teardown, manager replacement,
multi-cluster isolation, metrics/object-clock separation, truncated/partial
diagnostics, and empty/error/recovery row presentation.

## PR 283 cross-rule regression recovery

The first all-rule analysis of PR 283 at revision
`45dd72ed4ab6a1bc08eed117e48c067fbc918a4c` reported 51 open/confirmed new-code
issues: one bug and 50 code smells. The quality gate's C reliability rating came
from `typescript:S7727` in `useLogFiltering`; the same analysis also reported a
critical `javascript:S3776` regression in the Sonar checker itself. This result
demonstrates why an S3776-only local pass cannot close a remediation batch.

- [x] Inventory all 51 findings through the public PR issues API and group them
  by rule, severity, impact, and owning source file.
- [x] Correct the four rating/critical findings: the S7727 callback bug, two
  S6772 spacing findings, and the checker's new S3776 finding.
- [x] Correct the 29 mechanical/type findings across refresh diagnostics, logs,
  dropdowns, dockable panels, focus diagnostics, table sorting/persistence,
  query walking, and cluster event presentation.
- [x] Correct the 18 JSX/prop/deprecated-API findings. Contenteditable cut and
  paste now use Selection/Range operations covered by focused tests; rich
  listbox option semantics are centralized in a typed shared primitive without
  a Sonar suppression or source exclusion.
- [x] Focused Vitest passes 110 tests for the rating/critical batch, 467 tests
  for the mechanical/type batch, 536 tests for the shell/object-map/settings
  batch, 127 tests for Dropdown/Command Palette, and 11 tests for the
  contenteditable API change. Frontend type-check and the complete checked-in
  frontend check pass.
- [x] Full frontend coverage passes 4,145 tests across 467 files with 81.61%
  statement, 72.30% branch, 81.88% function, and 81.99% line coverage.
- [x] `mise exec -- mage qc:prerelease` passes Go formatting, vet,
  staticcheck, race tests, frontend check/type-check, all 4,145 frontend tests,
  Knip, and Trivy with zero reported dependency vulnerabilities.
- [x] PR 283 revision `e256225bbdf82e5438af91ce8688909a6add8e73`
  passes the Sonar quality gate with A reliability/security/maintainability,
  and the public issues API reports zero open/confirmed new-code findings.

### Copilot review follow-up

- [x] Audit all three visible Copilot threads plus the suppressed zero-value
  suggestion in Copilot's review summary.
- [x] Correct the ResourceBar warning grammar from “Requests exceeds” to
  “Requests exceed.”
- [x] Preserve explicit zero memory quantities through the shared formatter and
  GridTable export path. The red test proved `0`, `0Ki`, and `0Mi` were
  previously collapsed to `-`; focused utility, column-factory, and ResourceBar
  suites now pass 49 tests.
- [x] Retain the four type-only hook imports in the two Cluster Overview helper
  files. They are used exclusively in `typeof` type queries, and frontend
  type-check passes; changing them to value imports would add unnecessary
  runtime dependencies.
- [x] Frontend all-rule checks, type-check, and focused cognitive-complexity
  lint pass. Full frontend coverage passes 4,149 tests across 467 files with
  81.61% statement, 72.30% branch, 81.88% function, and 81.99% line coverage.
  Directly affected statement coverage is 100% for
  `resourceCalculations.ts`, 97.05% for `ResourceBar.tsx`, and 87.71% for
  `columnFactories.tsx`.
  `mise exec -- mage qc:prerelease` passes Go formatting, vet, staticcheck,
  race tests, frontend checks/type-check/all 4,149 tests, Knip, and Trivy with
  zero reported dependency vulnerabilities; post-gate `git diff --check`
  passes.
- [ ] Push the follow-up and require the PR all-rule Sonar audit to remain at
  zero before resolving the Copilot threads.

### JavaScript checker S3776 follow-up

- [x] The public main-branch Sonar API reports four open
  `javascript:S3776` findings in
  `frontend/scripts/check-error-reporting-boundaries.mjs`: issue
  `AZ_PMfx9nvllwip2ec45` at original score 36,
  `AZ_PMfx9nvllwip2ec48` at 29, `AZ_PMfx9nvllwip2ec49` at 46, and
  `AZ_PMfx9nvllwip2ec4-` at 55.
- [x] Separate binding-pattern collection, expression classification, source
  seeding, and fixed-point propagation into named helpers. Also refactor the
  adjacent over-threshold operational-surface attribute classifier found by
  the local cognitive-complexity lint.
- [x] Focused characterization expands from 22 to 33 passing tests and covers
  binding patterns, object/array/template/conditional propagation, property
  assignment, rejection handlers, function declarations/expressions, and
  incomplete React state tuples. Focused coverage is 83.44% statement, 80.26%
  branch, 87.64% function, and 83.29% line coverage.
- [x] The production script passes Biome's all-rule check, the local maximum-15
  cognitive-complexity lint, and the repository-wide error-boundary scan.
- [x] Full frontend coverage passes 4,160 tests across 467 files with 81.71%
  statement, 72.42% branch, 81.96% function, and 82.09% line coverage. The
  checker measures 84.38% statement, 81.84% branch, 88.63% function, and
  84.25% line coverage. `mise exec -- mage qc:prerelease` passes Go formatting,
  vet, staticcheck, race tests, frontend checks/type-check/all 4,160 tests,
  Knip, and Trivy with zero reported dependency vulnerabilities; post-gate
  `git diff --check` passes.
- [ ] Push the follow-up and require all four main-branch issue keys to close
  without any new open/confirmed Sonar finding before marking this inventory
  complete.

## PR and batch boundaries

- One review unit owns one runtime contract and normally two to six findings.
- Use test-hardening-only commits or PRs before refresh, stream, query,
  persistence, keyboard, drag/resize, and YAML transaction refactors when
  branch coverage is incomplete.
- Pure sibling algorithms may share a PR when they use the same tests and do not
  broaden runtime ownership; stateful hooks from different subsystems may not.
- Do not mix behavior fixes with S3776 remediation.
- If work is kept in one rolling PR, retain the same contract-sized commit
  boundaries and wait for an all-rule Sonar result after each pushed batch.
- A phase is complete only after its issues close in a fresh main-branch Sonar
  analysis and the monotonic baseline is updated.

## Validation by phase

- [ ] Every touched source has focused characterization for the branches moved.
- [x] Focused Vitest files pass.
- [ ] Directly affected statement coverage is at least 80%, or the measured gap
  has been reported and explicitly accepted.
- [x] `mise exec -- mage test:frontendCoverage` records frontend coverage on the
  latest worktree.
- [x] `mise exec -- npm run check --prefix frontend` passes.
- [x] `mise exec -- npm run typecheck --prefix frontend` passes.
- [x] `mise exec -- mage qc:prerelease` passes on the latest worktree.
- [x] `git diff --check` passes and the post-gate worktree has been inspected.
- [ ] The PR Sonar analysis shows the expected S3776 reduction, no increased
  retained finding, and zero open/confirmed new-code findings across all rules.

Latest aggregate coverage evidence: `mise exec -- mage test:frontendCoverage`
passes 4,145 tests across 467 files with 81.61% statement coverage, 72.30%
branch coverage, 81.88% function coverage, and 81.99% line coverage.
- [ ] The main-branch analysis confirms the reduction before the baseline and
  plan are updated.
- [ ] Rendered changes exercise relevant loading, error, denial, empty,
  populated, navigation, focus, keyboard, drag, resize, and recovery states in
  the standalone Wails UI. Pure non-rendering algorithms are exempt from manual
  UI validation.
- [ ] Any durable contract clarified by remediation is moved into its owning
  architecture, frontend, or workflow document before this temporary plan is
  removed.

## Completion criteria

- Sonar reports zero open `typescript:S3776` findings on `main`.
- No issue suppression, accepted disposition, threshold change, or source
  exclusion was used to reach zero.
- The separate four-item `javascript:S3776` inventory remains visible and is
  neither accidentally counted as TypeScript progress nor allowed to increase.
- Every affected contract retains or improves directly measured coverage.
- The monotonic S3776 check remains active with an empty TypeScript baseline and
  rejects any future TypeScript S3776 key.
- Every remediation PR was audited across all Sonar rules; an S3776-only pass
  was not treated as completion.
- Durable behavior discovered during the work is documented outside this plan,
  after which this temporary file can be deleted.

## Open decisions

- **PR topology:** recommended default is separate contract-sized PRs. If the
  maintainer prefers one rolling PR, use the same small commits and Sonar audit
  points; do not submit one unreviewable 91-function diff.
- **Local analyzer:** accept a new development dependency only after the Phase 0
  parity spike demonstrates useful TypeScript/JSX agreement with the 91-item
  Sonar baseline. The public Sonar result remains authoritative either way.
- **Coverage seams:** when 80% directly affected coverage would require an
  invasive dependency seam, stop and choose explicitly between adding the seam
  or accepting the measured exception; never proceed silently.
