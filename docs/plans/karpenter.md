# Karpenter support

Accepted scope: discovery-gated Cluster → Resources → Karpenter; resource-specific
columns and rich overviews. Include discovered Karpenter APIs, preserving versions
and existing custom-resource YAML/actions. Object-map graph expansion is outside
this task. The user will perform visual confirmation.

Catalog discovery owns visibility independently of object count and LIST access.
A structural catalog family boundary owns rows, totals, facets, paging and export.
Backend Karpenter projection owns typed facts, shared by custom-row hydration and
object details. Existing cluster-scoped refresh admission and request paths remain
in use; the discovery subscription cannot depend on the Karpenter view being open.
Resource references retain full identity; incomplete related references stay
non-navigable. Projection packages do not import catalog, refresh, or the gateway.
The producer/consumer contract is documented in `docs/architecture/catalog.md`.

| Observable criterion | Status | Evidence |
| --- | --- | --- |
| Discovery present/absent, zero objects, removal, cluster switching | passed (automated) | `TestDiscoveredFamiliesDoNotDependOnObjectsOrListPermission`; `TestCatalogSnapshotPublishesDiscoveredKarpenterWithoutRows`; `Sidebar.test.tsx` discovery transition case. Catalog tests use discovery fixtures; Sidebar replaces refresh data with per-cluster fixtures. |
| Karpenter rows, counts, facets, pagination and export scope | passed (automated) | `TestKarpenterQueryRetainsFamilyAcrossFiltersAndPages` uses the real catalog query engine with seeded rows, including a colliding kind and a namespaced nonmember. `karpenterCatalogScope.test.ts` exercises the shared data/metadata/page/export scope builders. |
| Resource-specific fields, detail/status parity, source-version refresh | passed (automated) | Karpenter facts tests cover pools, claims, provider fields, and overlays. `TestKarpenterDetailsAndTableProjectionParity` compares shared status, identity, conditions, and table fields. `TestKarpenterDetailsUseDiscoveredVersionAndCluster` uses the real detail provider and snapshot builder with fake Kubernetes discovery/dynamic clients; checks lowercase panel scopes, changed resource versions, wrong cluster, and live GET denial. |
| Overview rendering and navigation | passed (automated) | `KarpenterOverview.test.tsx` renders the real descriptor/renderer, mocking header/metadata/link components. `useNavigateToView.test.tsx` checks destination, full-identity focus, namespace navigation, and incomplete-reference rejection with context/event mocks. The overview drift test accounts for the generated detail DTO. |
| Table state, command palette, favorites, existing custom-resource surfaces | passed (automated) | `/tmp/karpenter-adjacent-green.log`: 40 tests passed; `/tmp/karpenter-frontend-focused.log`: 116 tests passed. Full latest-worktree checks recorded below. |
| Rendered loading/error/empty/populated/navigation states | pending — user confirmation | The user explicitly took visual confirmation. Browser-only Vite access did not provide Wails runtime validation. The native computer-use request was declined; no native visual pass is claimed. The extra agent-owned dev process on port 9250 was stopped before final checks. |
| Affected coverage ≥80% | passed | `test:backend-coverage` exit 0 (`/tmp/karpenter-backend-coverage-final.log`), with 92.02% in changed functions. The supplementary family-classifier test covers all classifier statements (`/tmp/karpenter-family.cover`), bringing affected coverage to 92.82%. `test:frontend-coverage` exit 0: 524 files / 5,019 tests; affected production files 1,083/1,183 statements (91.55%), complete suite 87.42% (`/tmp/karpenter-frontend-coverage-final.log`, `/tmp/karpenter-frontend-coverage-report/coverage-summary.json`). Supplementary routing test also passes with coverage (`/tmp/karpenter-routing-tests.log`). |
| Changed-function complexity ≤12 | passed (local) | Pinned `gocognit@v1.2.1` report `/tmp/karpenter-go-complexity.json`; Biome max 12 check `/tmp/karpenter-ts-complexity.log` checks 19 production files. Three Go functions scoring 13 are unchanged (`newNamespaceMatcher`, `buildCatalogSnapshot`, `customResourceConditions`). `gh pr view --json number,url,headRefOid` reports no pull requests for `karpenter-support`; no pushed-revision Sonar analysis is available. |
| Final prerelease gate and worktree inspection | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exited 0 (`/tmp/karpenter-prerelease-final.log`): format/bindings, vet/staticcheck, race suite, lint, typecheck, 5,020 frontend tests across 524 files, knip, and Trivy. The first attempt found an incomplete display-reference test fixture; its cluster ID was corrected and the whole gate rerun. Final worktree inspected; `git diff --check` passes. |

Red/green evidence includes new discovery/family/overview tests plus regression
failures captured in `/tmp/karpenter-case-red.log`,
`/tmp/karpenter-overview-case-red.log`, `/tmp/karpenter-facets-red.log`,
`/tmp/karpenter-navigation-red.log`, and `/tmp/karpenter-identity-red.log`.
Their corresponding focused checks passed after the fixes. Tests prove their
listed seams, not native interactions or authorization on a live cluster.

Coverage method: Go counts instrumented statements in functions intersecting changed
source lines, including every function in new files; the report is
`/tmp/karpenter-affected-go-coverage-final.json`. Frontend counts statements across
all affected production files. Existing individual shared-file gaps remain in
`CustomResourceGridView` (71.42%), `useCatalogBackedCustomResourceRows` (71.42%),
`Overview/index` (75%), and the cluster dispatcher (41.17% in the full run, 52.94% in the
subsequent targeted Karpenter/custom routing check). These are not claims of full
branch coverage. Visual states remain pending user confirmation.
