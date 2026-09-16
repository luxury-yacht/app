# Reviewer findings validation

Request: independently validate the pasted review against `cc7d78a6` and fix
supported findings. No commits or PRs are authorized. This record separates
source evidence, automated behavior checks, and rendered checks.

## Disposition

| Finding | Decision and evidence |
| --- | --- |
| 1. Quantity percentages | Confirmed. The new `resourceCalculations.test.ts` regression returned 54,975,581,388.8 for `512Gi / 1000G` before the fix, versus 54.9755813888 expected. Shared parsing now handles decimal SI, binary SI through Ei, exponents, and CPU subunits; malformed quantities stay unknown rather than becoming zero-percent usage. Existing spaced values and MB/GB display aliases retain their meaning. |
| 2. Family policy duplication | Confirmed source duplication, not an observed routing incident. `resourcekind.FamilyRules` now exports the same group/kind/scope table and prefix used by `FamilyForResource`; the refresh generator emits it for frontend routing. The frontend contract test failed before generation and passes against every generated membership/scope rule. The existing backend generated-contract test checks freshness. |
| 3. Favorites availability | Rejected as stated. `FavSaveModal.tsx` passes `disabled` to the view selector; it is a display of the current/saved route, not a way to choose an undiscovered family. Existing favorites can bind another cluster or Any Cluster, so requiring current discovery would invalidate portable or temporarily unavailable destinations. No favorites behavior changed. |
| 4. Sidebar mount disclosure | Confirmed by a failing mounted Sidebar regression. The hook now distinguishes the restored selection from a fresh request, while leaving an undiscovered destination pending until discovery arrives. Existing `Sidebar.navigation.test.tsx` caught that adjacent delayed-discovery requirement during development. Mount/remount, repeated navigation, and manual collapse pass. |
| 5. Catalog publication | Confirmed by `TestColdSyncPublishesOneFinalSignalAfterReplacement`: two non-ready final notifications before the fix, one afterward. Removed the preliminary finalization and retained chunk copies. Cold progress still publishes incomplete batches; warm collection records latency without copying/sorting unused batches. The test observes the subscriber queue during publication and checks final replacement and readiness, for partial and successful collection. |
| 6. Navigation documentation | Confirmed against `viewRegistry.ts` and `appPreferences.ts`. Corrected Helm placement and four persisted, global disclosure preferences in `docs/frontend/navigation.md`. |
| 7. ApplicationSet defaults | Confirmed by `ArgoCDOverview.test.tsx`: an absent applicationsSync rendered `sync`. Omitted policy fields now remain absent; explicit false still renders No. |
| 8. Overview consistency | Confirmed four repeated chip renderers. Shared `ConditionChips` owns markup/tooltip composition while callers retain semantic variant rules, including Karpenter disruption conditions. Karpenter primary status now uses the shared operator status renderer. Added the `.app` selection override; Playwright mouse selection of the blocking reason succeeds in the real component's Storybook fixture. |
| 9. Pruned tests | Partly confirmed. Restored meaningful missing/invalid timestamp, Markdown parsing, platform-shortcut, and no-helper retry cases; added Stop-port-forward pending/success/failure interaction coverage through the real status hook and mocked backend commands. `paletteTint.test.ts` already covers active, brightness-only, and inactive paths through `applyTintedPalette`, so no duplicate direct predicate tests were added. Historical #347 coverage impact remains unverified; present measurements cannot recreate that historical evidence. |
| Removed generated types | `git show 6a2fc2b1 -- backend/internal/genrefreshcontracts/registry.go` confirms four registration removals. Exact-name frontend source search found no references to the removed types. No supported runtime defect was found; do not restore unused generation merely to reclassify an old commit. |
| Unused CSS | Repository search found `.karpenter-fact-caption` only in its CSS declaration. Removed it. |
| Duplicate namespace labels | Confirmed count and list both used Provisioned Namespaces in `ExternalSecretsSections.tsx`. Count labels now explicitly say Count. |
| Wails upgrade evidence | Confirmed beta.20 → beta.22 in `cc7d78a6`. Read official beta.21 and beta.22 release notes and added links/context to pending release notes. Go module, CLI, and frontend runtime already use beta.22 together; no dependency change made here. |

## Cross-layer contracts considered before implementation

- Quantity producer: `backend/resources/karpenter/facts.go` forwards source
  quantity strings. Consumers: Karpenter table Usage, overview capacity Used,
  capacity formatting, shared resource bars, table columns/exports, and utility
  adapters. One shared parser fixes these consumers without changing DTOs.
- Family policy producer: `backend/resourcekind/family.go`. Backend consumers
  include catalog discovery/query boundaries and family fact projection;
  frontend consumers include `kindViewMap`, Cluster/Ns custom views, and their
  navigation consumers. Generation is one-way from Go policy to TypeScript;
  there is no runtime dependency back into navigation. Served versions remain
  discovered. Tests cover scope rejection as well as admitted destinations.
- Catalog producer: `catalogSync.finish/publish`, fed by concurrent collectors.
  The maintained catalog query store and finalizer-blocker subset must publish
  before the final streaming notification. `SubscribeStreaming` consumers
  include refresh catalog doorbells and readiness; frontend Browse/family views
  refetch through the refresh layer. Cold progress remains allowed before ready;
  warm collection preserves the previous published view until replacement.
  No new owner dependency or callback cycle was introduced.
- Sidebar producer: `ViewStateContext.sidebarSelection`; consumers are cluster
  and namespace instances of `useSidebarGroupExpansion`. Preferences hydrate
  before mounting. A new selection can precede discovery, so it is consumed only
  once a descriptor exists. Mounting itself is not a navigation request.

## Review's affirmative assertions

These do not inherit the earlier review's test results:

- Catalog family boundaries have direct query tests in
  `backend/objectcatalog/{karpenter,argocd,operator_families}_test.go` for totals,
  facets, pages, and scope. `query_engine.go` includes family in filtering and
  continuation signatures. Export source carries the family through
  `useBrowseCatalog` and hydrates all returned rows in
  `useCatalogBackedCustomResourceRows`; live CSV export remains unverified.
- Argo destination reads use a request-scoped resolver, the labelled Secret LIST
  selector, and controller namespace in `argocd/destinations.go:16,84,122`.
  Only name/server enter its cache. Destination resolver tests exercise explicit,
  templated, ambiguous, and unavailable cases with a fake Kubernetes client.
- `backend/operator_details_test.go:24` checks related-reference discovery and
  forbidden GET propagation. Scope rejection precedes GET in
  `backend/object_detail_custom.go:25,38`; this is source-order evidence, not a
  dedicated scope-mismatch runtime test. Family packages' production imports
  do not include catalog/refresh/gateway packages (repository import search).
- Serialized projection tests support the redaction assertion:
  `backend/resources/certmanager/facts_test.go:18,45,67` covers CSR, certificate,
  ACME key/token and provider credentials;
  `backend/resources/externalsecrets/facts_test.go:30,39` covers store tokens;
  `backend/resources/prometheus/facts_test.go:20,30` covers token references;
  `backend/resources/argocd/facts_test.go:63,68` covers project JWT identifiers.
  These assert JSON output from fixture objects, not live-cluster Secret access.
- Cluster close ordering, serialized cleanup/shutdown, sibling preservation,
  and one cluster-labelled failure log are asserted in
  `backend/workspace_cluster_close_test.go:16,88`.
- Hydration's key includes cluster, GVK, namespace/name, and UID in
  `frontend/src/modules/browse/hooks/useHydratedCustomCatalogRows.ts:23–41`;
  its tests cover recreation, late reads, other-cluster responses, and export
  identity. The seven family table descriptors are registered in
  `frontend/src/core/navigation/viewRegistry.ts:151,161,171,310,321,332,353`.
  A read-only comparison of `v2.3.0:viewRegistry.ts` against current descriptors
  found no removed IDs (unique-ID sets: 18 before, 25 current, removed `[]`).
- The generated drift guard is `backend/refresh_contract_generated_test.go:12`.
- Prior clean-worktree/gate counts and historical whole-range complexity are
  historical claims, not evidence for this modified worktree. New checks below
  replace them for this task. The condensed checklist links owning documents;
  exhaustive semantic equivalence to every removed sentence is unverified.

## Completion evidence

- Passed: red/green regressions for quantities, sidebar mount, absent
  ApplicationSet fields, missing generated family policy, and duplicate catalog
  notification. Focused overview/navigation run: 13 files, 112 tests.
- Passed: restored behavior cases: 6 files, 30 tests. Backend coverage task exit
  0; affected file statement coverage: streaming 95%, sync 95.54%, family 100%,
  generator render 84.60%.
- Passed: focused frontend coverage run: 43 files, 328 tests. The subsequent
  full coverage run measured family classifier, sidebar hook and quantity
  utilities at 100%; Argo sections 98.55%;
  Karpenter progress 100%, sections 95.06%, descriptor 95.23%; ConditionChips 80%.
- Failed then passed on retry: first full frontend coverage run had two 5-second
  timeouts (YAML initial render and error-boundary script); YAML then cascaded
  into 31 additional assertions. Both affected suites subsequently passed alone
  (67 tests). Full coverage retry passed 512 files / 4,706 tests, with 87.38%
  statement coverage (`/tmp/reviewer-frontend-coverage-retry.log`). No timeout
  configuration changed.
- Coverage gap: `OperatorOverview.tsx` measures 66.66%. Uncovered paths are
  mostly pre-existing helpers; the extracted condition variant callback is
  also uncovered. The new `ConditionChips.tsx` measures 80%. The user chose
  "Keep the current scope" when asked whether to expand into the other
  operator helper workflows; this measured gap is retained.
- Passed: typecheck. Local Go complexity max 12 in changed functions. Biome's
  default and explicit threshold-12 checks passed. This is local analysis,
  not a claim about Sonar findings on a pushed revision.
- Passed: Playwright rendered populated/blocked and newly-created Karpenter
  fixtures, explicit ApplicationSet policy fixture, capacity values, and actual
  mouse text selection. Storybook uses fixture data and mocked native APIs.
- Limitation: Wails browser URL renders but native backend bindings are
  unavailable there. Process inspection found the installed app running and
  no dev native process; single-instance mode is enabled in
  `internal/bootstrap/run.go:32`, so an instance conflict is inferred, not proven.
  Native tool selection by bundle ID is ambiguous across three builds;
  exact dev-path selection timed out. No claim of live-cluster/native validation.
- Passed: `GOCACHE=/tmp/luxury-yacht-go-build
  STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task
  qc:prerelease` exited 0. The gate ran format/bindings, vet/staticcheck, backend
  race tests, lint, typecheck, 512 frontend files / 4,706 tests, knip, and Trivy
  (zero findings). Full output: `/tmp/reviewer-prerelease.log`.
- Passed: post-gate `git diff --check`; inspected tracked and new task files.
  No remaining required automated check is failed or pending. The native/live
  and historical evidence limits above remain; this is not a release-readiness
  certification of the entire previously reviewed range.
