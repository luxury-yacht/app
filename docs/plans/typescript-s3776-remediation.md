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
`frontend/scripts/check-error-reporting-boundaries.mjs` are a separate inventory
and are not counted here.

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
- Refresh the inventory after every Sonar analysis. Remove a checkbox only when
  the issue key closes; add new keys to the earliest applicable phase.
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

- [ ] `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts`
- [ ] `frontend/src/core/refresh/resourceStreamViews.ts`
- [ ] `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx`
- [ ] `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/schema.ts`
- [ ] `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts`
- [ ] `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts`
- [ ] `frontend/src/shared/components/diff/diffUtils.ts`
- [ ] `frontend/src/shared/components/modals/DrainNodeModal.tsx`
- [ ] `frontend/src/shared/components/tables/hooks/useGridTableController.tsx`
- [ ] `frontend/src/ui/dockable/useDockablePanelDragResize.ts`
- [ ] `frontend/src/ui/layout/AppLayout.tsx`

## Phase 1: Shared and app foundations (15)

**Outcome:** establish low-coupling refactor patterns in pure presenters,
parsers, algorithms, and boundary adapters before changing stateful feature
orchestration.

Likely seams include a parsed-resource result for `ResourceBar`, pure
connectivity and permission classifiers, declarative preference-change
dispatch, separate diff trace/backtrack stages, a prepared Sentry scope model,
and pure geometry for CodeMirror/scrollbars. Keep Sentry privacy filtering and
object-action GVK identity at their current boundaries.

- [ ] **53** — `ResourceBar`, `frontend/src/shared/components/ResourceBar.tsx:47` — Sonar `AZ-P-P9RmYfklgBeFrDd`.
- [ ] **43** — `ClusterOverview`, `frontend/src/modules/cluster/components/ClusterOverview.tsx:130` — Sonar `AZ-P-QVJmYfklgBeFrJQ`.
- [ ] **30** — `layoutSearchPanel`, `frontend/src/core/codemirror/search.ts:159` — Sonar `AZ-P-QgsmYfklgBeFrLy`.
- [ ] **25** — `buildConnectivityPresentation`, `frontend/src/core/connection/connectivityPresentation.ts:47` — Sonar `AZ-P-QgEmYfklgBeFrLs`.
- [ ] **24** — `DrainNodeModal`, `frontend/src/shared/components/modals/DrainNodeModal.tsx:100` — Sonar `AZ-P-P6zmYfklgBeFrC9`.
- [ ] **23** — `emitPreferenceChanges`, `frontend/src/core/settings/appPreferences.ts:654` — Sonar `AZ-P-Qf5mYfklgBeFrLr`.
- [ ] **23** — `parseResource`, `frontend/src/shared/components/ResourceBar.tsx:90` — Sonar `AZ-P-P9RmYfklgBeFrDf`.
- [ ] **23** — `buildMyersTrace`, `frontend/src/shared/components/diff/lineDiff.ts:58` — Sonar `AZ-P-P4KmYfklgBeFrCV`.
- [ ] **21** — Sentry scope-enrichment callback, `frontend/src/core/telemetry/sentry.ts:947` — Sonar `AZ_PMfh-nvllwip2ec40`.
- [ ] **21** — `mergeDiffLines`, `frontend/src/shared/components/diff/diffUtils.ts:42` — Sonar `AZ-P-P4UmYfklgBeFrCW`.
- [ ] **18** — `resolveActionGVK`, `frontend/src/shared/actions/objectActionClient.ts:66` — Sonar `AZ-P-P_qmYfklgBeFrD9`.
- [ ] **17** — `beforeSend`, `frontend/src/core/telemetry/sentry.ts:484` — Sonar `AZ_PMfh-nvllwip2ec4v`.
- [ ] **16** — `queryNamespacesPermissions`, `frontend/src/core/capabilities/permissionStore.ts:447` — Sonar `AZ-P-QXRmYfklgBeFrJf`.
- [ ] **16** — `ResourceMetadata` memo renderer, `frontend/src/shared/components/kubernetes/ResourceMetadata.tsx:19` — Sonar `AZ-P-P8vmYfklgBeFrDY`.
- [ ] **16** — `updateOverlayScrollbarGeometry`, `frontend/src/shared/scrollbars/scrollbarActivity.ts:375` — Sonar `AZ-P-P_KmYfklgBeFrD1`.

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

## Phase 2: GridTable and query-backed data (16)

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

- [ ] **50** — `sortedData` memo, `frontend/src/hooks/useTableSort.ts:119` — Sonar `AZ-P-QrBmYfklgBeFrPG`.
- [ ] **46** — `getCachedCellContent`, `frontend/src/shared/components/tables/hooks/useGridTableCellCache.tsx:72` — Sonar `AZ-P-PzimYfklgBeFrAG`.
- [ ] **39** — `useGridTableController`, `frontend/src/shared/components/tables/hooks/useGridTableController.tsx:112` — Sonar `AZ-P-Pw9mYfklgBeFq_i`.
- [ ] **37** — `measureColumnWidth`, `frontend/src/shared/components/tables/hooks/useGridTableColumnMeasurer.ts:114` — Sonar `AZ-P-Px1mYfklgBeFq_s`.
- [ ] **25** — `buildColumnWidthState`, `frontend/src/shared/components/tables/hooks/useGridTableColumnWidths.ts:201` — Sonar `AZ-P-PzDmYfklgBeFrAA`.
- [ ] **24** — `buildTypedResourceQueryScope`, `frontend/src/modules/resource-grid/typedResourceQueryScope.ts:136` — Sonar `AZ-P-QRHmYfklgBeFrIZ`.
- [ ] **23** — `distributeFlexWidths`, `frontend/src/shared/components/tables/hooks/gridTableColumnWidthMath.ts:172` — Sonar `AZ-P-PytmYfklgBeFq_9`.
- [ ] **22** — GridTable context-menu builder callback, `frontend/src/shared/components/tables/hooks/useGridTableContextMenuItems.tsx:34` — Sonar `AZ-P-PxemYfklgBeFq_n`.
- [ ] **21** — `prunePersistedState`, `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts:436` — Sonar `AZ-P-P0OmYfklgBeFrAV`.
- [ ] **21** — `buildPersistedStateForSave`, `frontend/src/shared/components/tables/persistence/gridTablePersistence.ts:543` — Sonar `AZ-P-P0OmYfklgBeFrAW`.
- [ ] **20** — catalog page-request transaction, `frontend/src/modules/browse/hooks/useBrowseCatalog.ts:484` — Sonar `AZ-P-QPZmYfklgBeFrH7`.
- [ ] **20** — `buildGridTableFilterOptions`, `frontend/src/shared/components/tables/gridTableFilterEngine.ts:40` — Sonar `AZ-P-P2hmYfklgBeFrBC`.
- [ ] **19** — `applyPayload`, `frontend/src/modules/resource-grid/useTypedResourceQuery.ts:372` — Sonar `AZ-P-QSOmYfklgBeFrIl`.
- [ ] **17** — typed-query request effect, `frontend/src/modules/resource-grid/useTypedResourceQuery.ts:487` — Sonar `AZ-P-QSOmYfklgBeFrIp`.
- [ ] **16** — `walkQueryCursorPages`, `frontend/src/modules/resource-grid/cursorPageWalk.ts:48` — Sonar `AZ-P-QSDmYfklgBeFrIk`.
- [ ] **16** — local row-filter predicate, `frontend/src/shared/components/tables/gridTableFilterEngine.ts:227` — Sonar `AZ-P-P2hmYfklgBeFrBD`.

Required characterization includes stable sorting and cache reuse, duplicate or
missing row identities, primitive/object cache eviction, zero-width and
unmounted DOM, persisted schema normalization, `all`/`some`/`none` filters,
query-facet invalidation, stale-response rejection, cursor invalidation,
anchor/start-rank navigation, approximate totals, warm-up retry, typed
permission denial, and stream-signal coalescing.

## Phase 3: Object map (4)

**Outcome:** graph preparation, visibility, layout, and rendering orchestration
are separate without changing backend-owned identity or relationship facts.

Prepare a typed visible-graph/view model before rendering; keep G6 lifecycle
effects in the component; keep layout inputs/outputs pure; and isolate
directional traversal from inclusion policy. Do not repair partial identity by
kind/name guessing, and keep raw, visible, and rendered debug states distinct.

- [ ] **54** — `ObjectMap`, `frontend/src/modules/object-map/ObjectMap.tsx:102` — Sonar `AZ-P-QMsmYfklgBeFrHO`.
- [ ] **27** — `orderColumnsByBarycenter`, `frontend/src/modules/object-map/objectMapLayout.ts:340` — Sonar `AZ-P-QOEmYfklgBeFrHk`.
- [ ] **20** — `computeNodeColumns`, `frontend/src/modules/object-map/objectMapLayout.ts:164` — Sonar `AZ-P-QOEmYfklgBeFrHi`.
- [ ] **17** — `filterByDirectionalReachability`, `frontend/src/modules/object-map/objectMapDirectionalFilter.ts:38` — Sonar `AZ-P-QMLmYfklgBeFrHJ`.

Required characterization includes empty and truncated graphs, cycles,
disconnected components, deterministic column/order output, `all`/`some`/`none`
kind filtering, directional reachability, collapse/selection, renderer cleanup,
complete refs for open/navigation actions, and bounded large-graph work.

## Phase 4: Object panel (14)

**Outcome:** detail derivation, log viewing, YAML transactions, and capability
projection are decomposed at their existing ownership boundaries.

Keep `LogViewMode` as the single async-state union and split reducer decisions
into explicit transition helpers; prepare `LogViewer` display/control models
outside JSX while leaving stream ownership and effects intact. Keep Overview
descriptor-driven, extracting descriptor-local presenters rather than new
per-kind components. Split YAML validation/transaction classification from
effects without changing dirty-state, save, conflict, or cancellation order.

- [ ] **40** — `deriveDetailUtilizationData`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/useUtilizationData.ts:61` — Sonar `AZ-P-QE8mYfklgBeFrFE`.
- [ ] **36** — `LogViewerInner`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:396` — Sonar `AZ-P-QJemYfklgBeFrGK`.
- [ ] **36** — `logViewerReducer`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/logViewerReducer.ts:212` — Sonar `AZ-P-QI2mYfklgBeFrGA`.
- [ ] **29** — `NodeLogsTab`, `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.tsx:196` — Sonar `AZ-P-QKzmYfklgBeFrG1`.
- [ ] **23** — `validateYamlDraft`, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlValidation.ts:127` — Sonar `AZ-P-QHLmYfklgBeFrFg`.
- [ ] **22** — LogViewer action callback, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:1456` — Sonar `AZ-P-QJemYfklgBeFrGR`.
- [ ] **21** — policy descriptor `renderMetric`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx:176` — Sonar `AZ-P-QDGmYfklgBeFrEs`.
- [ ] **19** — `coverageKeys`, `frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/schema.ts:101` — Sonar `AZ-P-QDmmYfklgBeFrE0`.
- [ ] **19** — `YamlTab`, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx:138` — Sonar `AZ-P-QGymYfklgBeFrFV`.
- [ ] **19** — YAML transaction effect, `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts:248` — Sonar `AZ-P-QHAmYfklgBeFrFc`.
- [ ] **19** — `computeCapabilityDescriptors`, `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts:74` — Sonar `AZ-P-QB2mYfklgBeFrEa`.
- [ ] **16** — `formatTimestampForMode`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx:156` — Sonar `AZ-P-QJemYfklgBeFrGG`.
- [ ] **16** — `longestSuffixPrefixOverlap`, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useAnchoredLogEntries.ts:17` — Sonar `AZ-P-QIFmYfklgBeFrF2`.
- [ ] **16** — filtered-log memo, `frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogFiltering.ts:96` — Sonar `AZ-P-QHymYfklgBeFrFx`.

Required characterization includes complete object/cluster scope, metrics
absent/stale/error states, every `LogViewMode` transition, streaming/fallback
handoff, timestamp modes, anchor overlap, search/filter/wrap behavior, node-log
file/service modes, YAML parse/schema/identity failures, conflict/save/reset,
permission-gated actions, descriptor drift coverage, grouped-panel context, and
close-versus-transient-unmount cleanup.

## Phase 5: App shell and interactions (26)

**Outcome:** keyboard routing, command palette, navigation, favorites, dropdowns,
dockable geometry, and layout render from explicit action/view models while
their current surface ownership and persistence remain intact.

Use pure key-to-action classifiers and leave effect execution at the owning
surface; keep native input/editor behavior as the fallback. Extract pure drag
and window-bound geometry without moving dockable state ownership. Build
palette/sidebar/theme/favorite rows from prepared models rather than branching
inside JSX. Keep favorites as complete pane snapshots and cluster workspace in
its React-free store.

- [ ] **50** — shortcut `handleKeyDown`, `frontend/src/ui/shortcuts/context.tsx:447` — Sonar `AZ-P-QhtmYfklgBeFrMJ`.
- [ ] **48** — sidebar `onKeyDown`, `frontend/src/ui/layout/SidebarKeys.ts:250` — Sonar `AZ-P-QpXmYfklgBeFrOb`.
- [ ] **46** — dropdown `handleKeyAction`, `frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts:74` — Sonar `AZ-P-P3DmYfklgBeFrB9`.
- [ ] **42** — dockable `handleMouseMove`, `frontend/src/ui/dockable/useDockablePanelDragResize.ts:307` — Sonar `AZ-P-QmkmYfklgBeFrNS`.
- [ ] **29** — `Sidebar`, `frontend/src/ui/layout/Sidebar.tsx:61` — Sonar `AZ-P-QpzmYfklgBeFrOg`.
- [ ] **27** — favorite-navigation effect, `frontend/src/core/contexts/FavoritesContext.tsx:132` — Sonar `AZ-P-Qd1mYfklgBeFrLU`.
- [ ] **26** — dockable window-bounds timeout callback, `frontend/src/ui/dockable/useDockablePanelWindowBounds.ts:68` — Sonar `AZ-P-QnTmYfklgBeFrNy`.
- [ ] **25** — command-palette catalog scoring callback, `frontend/src/ui/command-palette/CommandPalette.tsx:149` — Sonar `AZ-P-Ql7mYfklgBeFrNH`.
- [ ] **24** — tab-group update callback, `frontend/src/ui/dockable/DockablePanelProvider.tsx:445` — Sonar `AZ-P-QnKmYfklgBeFrNs`.
- [ ] **23** — dropdown `getNextEnabledIndex`, `frontend/src/shared/components/dropdowns/Dropdown/hooks/useKeyboardNavigation.ts:33` — Sonar `AZ-P-P3DmYfklgBeFrB8`.
- [ ] **22** — `scrollToNextTab`, `frontend/src/shared/components/tabs/Tabs.tsx:166` — Sonar `AZ-P-P55mYfklgBeFrCo`.
- [ ] **22** — `ObjectDiffModal`, `frontend/src/ui/modals/ObjectDiffModal.tsx:394` — Sonar `AZ-P-QiomYfklgBeFrMY`.
- [ ] **20** — `mergeWireState`, `frontend/src/core/cluster-workspace/clusterWorkspaceStore.ts:312` — Sonar `AZ-P-QfImYfklgBeFrLk`.
- [ ] **20** — `Dropdown`, `frontend/src/shared/components/dropdowns/Dropdown/Dropdown.tsx:61` — Sonar `AZ-P-P3PmYfklgBeFrB_`.
- [ ] **19** — shortcut-help row renderer, `frontend/src/ui/shortcuts/components/ShortcutHelpModal.tsx:97` — Sonar `AZ-P-QhJmYfklgBeFrL_`.
- [ ] **18** — kubeconfig selection callback, `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx:349` — Sonar `AZ-P-QVYmYfklgBeFrJY`.
- [ ] **18** — `AppLayout`, `frontend/src/ui/layout/AppLayout.tsx:97` — Sonar `AZ-P-QqLmYfklgBeFrOr`.
- [ ] **17** — namespace row projection, `frontend/src/modules/namespace/contexts/NamespaceContext.tsx:270` — Sonar `AZ-P-P_5mYfklgBeFrD_`.
- [ ] **17** — `parseQueryTokens` token callback, `frontend/src/ui/command-palette/CommandPalette.tsx:64` — Sonar `AZ-P-Ql7mYfklgBeFrNG`.
- [ ] **17** — command registry memo, `frontend/src/ui/command-palette/CommandPaletteCommands.tsx:160` — Sonar `AZ-P-QlgmYfklgBeFrNC`.
- [ ] **17** — `DockablePanelInner`, `frontend/src/ui/dockable/DockablePanel.tsx:167` — Sonar `AZ-P-QmxmYfklgBeFrNZ`.
- [ ] **17** — theme row renderer, `frontend/src/ui/settings/sections/AppearanceSection.tsx:1144` — Sonar `AZ-P-QkGmYfklgBeFrMq`.
- [ ] **16** — favorite match memo, `frontend/src/ui/favorites/FavToggle.tsx:268` — Sonar `AZ-P-QlUmYfklgBeFrM-`.
- [ ] **16** — pending-favorite restore effect, `frontend/src/ui/favorites/FavToggle.tsx:326` — Sonar `AZ-P-QlUmYfklgBeFrM_`.
- [ ] **16** — `describeElementTarget`, `frontend/src/ui/layout/SidebarKeys.ts:52` — Sonar `AZ-P-QpXmYfklgBeFrOa`.
- [ ] **16** — `CommandPaletteComponent`, `frontend/src/ui/command-palette/CommandPalette.tsx:212` — Sonar `AZ-P-Ql7mYfklgBeFrNJ`.

Required characterization includes modal/palette/menu precedence, key repeat,
disabled shortcuts, native input editing, dropdown wrap/disabled/header
navigation, sidebar target descriptions and tree movement, palette token and
catalog scoring, docked/floating/grouped move/resize/close, stable group IDs,
cluster-tab switches, workspace event precedence, favorite pane hydration and
restore ordering, theme drag/drop, namespace cluster isolation, and focus
cleanup after unmount.

## Phase 6: Refresh and diagnostics (16)

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

- [ ] **76** — base diagnostics-row projection, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:907` — Sonar `AZ-P-QbMmYfklgBeFrKf`.
- [ ] **44** — diagnostics domain-count resolver, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:1082` — Sonar `AZ-P-QbMmYfklgBeFrKq`.
- [ ] **41** — `performFetch`, `frontend/src/core/refresh/orchestrator.ts:1265` — Sonar `AZ-P-QdNmYfklgBeFrLI`.
- [ ] **35** — `refreshSingle`, `frontend/src/core/refresh/RefreshManager.ts:603` — Sonar `AZ-P-QcQmYfklgBeFrK9`.
- [ ] **35** — `isResourceStreamViewActive`, `frontend/src/core/refresh/resourceStreamViews.ts:58` — Sonar `AZ-P-Qc9mYfklgBeFrLD`.
- [ ] **30** — resource-stream `handleMessage`, `frontend/src/core/refresh/streaming/resourceStreamManager.ts:322` — Sonar `AZ-P-QY6mYfklgBeFrJz`.
- [ ] **29** — `fetchScopedDomain`, `frontend/src/core/refresh/orchestrator.ts:1166` — Sonar `AZ-P-QdNmYfklgBeFrLH`.
- [ ] **26** — `getForegroundRefreshTargets`, `frontend/src/core/refresh/RefreshManager.ts:498` — Sonar `AZ-P-QcQmYfklgBeFrK8`.
- [ ] **26** — `isPermissionDeniedStatus`, `frontend/src/core/refresh/permissionErrors.ts:13` — Sonar `AZ-P-Qc0mYfklgBeFrLC`.
- [ ] **25** — pod diagnostics-row projection, `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:1248` — Sonar `AZ-P-QbMmYfklgBeFrKs`.
- [ ] **25** — `setScopedDomainEnabled`, `frontend/src/core/refresh/orchestrator.ts:434` — Sonar `AZ-P-QdNmYfklgBeFrLG`.
- [ ] **20** — `buildContainerLogsSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:946` — Sonar `AZ-P-QadmYfklgBeFrKV`.
- [ ] **20** — container-log stream `applyPayload`, `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts:427` — Sonar `AZ-P-QZSmYfklgBeFrJ5`.
- [ ] **18** — `buildCatalogSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:885` — Sonar `AZ-P-QadmYfklgBeFrKT`.
- [ ] **17** — `resolveDomainNamespace`, `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts:22` — Sonar `AZ-P-QapmYfklgBeFrKZ`.
- [ ] **17** — `buildMetricsSummary`, `frontend/src/core/refresh/components/diagnostics/diagnosticsRowModel.ts:773` — Sonar `AZ-P-QadmYfklgBeFrKQ`.

Required characterization includes retained first paint, foreground versus user
intent, paused automatic refresh, query-versus-snapshot leases, stale response
rejection, loading-to-ready progress, typed permission denial, manual-job error
semantics, source-clock ownership, ACK/replay/reset, query-only fallback,
enable/disable/re-enable flaps, cancellation and teardown, manager replacement,
multi-cluster isolation, metrics/object-clock separation, truncated/partial
diagnostics, and empty/error/recovery row presentation.

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
- [ ] Focused Vitest files pass.
- [ ] Directly affected statement coverage is at least 80%, or the measured gap
  has been reported and explicitly accepted.
- [ ] `mise exec -- mage test:frontendCoverage` records frontend coverage on the
  latest worktree.
- [ ] `mise exec -- npm run check --prefix frontend` passes.
- [ ] `mise exec -- npm run typecheck --prefix frontend` passes.
- [ ] `mise exec -- mage qc:prerelease` passes on the latest worktree.
- [ ] `git diff --check` passes and the post-gate worktree has been inspected.
- [ ] The PR Sonar analysis shows the expected S3776 reduction, no increased
  retained finding, and zero open/confirmed new-code findings across all rules.
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
