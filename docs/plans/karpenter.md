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

## Design revision after user review

The user rejected packed Context/Capacity/Configuration cells and the flat Details
layout. Keep the existing single table and kind filter; do not add resource tabs.
Table cells will contain one named fact. Details will retain the shared Overview
frame, with kind-specific summaries and labeled sections for repeated data.

The backend fact projection produces a compact typed table summary; cluster row
hydration, generated contracts, the catalog adapter, column factories and CSV export
consume it. The rich detail DTO remains the source of overview sections. Catalog
query ordering, permission readiness and complete references remain the existing
boundaries. The projection imports only shared resource semantics, avoiding a
catalog/refresh dependency cycle. Regressions cover summary/detail parity, fallback
rows, export values, and empty/populated kind-specific overview sections.

The user retains final native visual confirmation. The initial visual result was
rejection of the design; the following evidence covers the revision.

| Revision criterion | Status | Evidence |
| --- | --- | --- |
| Keep the single table and kind filter; replace packed cells with named fields | passed (automated and rendered) | `ClusterViewCustom.test.tsx`, `karpenterColumns.test.tsx`, and `customCatalogRowAdapter.test.ts` pass in `/tmp/karpenter-redesign-green.log` (84 focused tests). Columns are Kind, Name, Status, NodePool, NodeClass, Instance Type, Capacity Type, Age. The real GridTable/factories render fixture rows in `.playwright-mcp/karpenter-table-review.png`; minimum widths keep headings visible. Link click/alt-click tests preserve cluster/GVK; display-only references remain inert. |
| Kind-specific summaries and readable repeated data | passed (automated and rendered) | `KarpenterOverview.test.tsx` covers grouped pool configuration, claim links/capacity, separate provider resolution, sparse objects, budgets and zero values. New tests first failed in `/tmp/karpenter-redesign-red.log`. Real descriptor/renderer stories inspected at 420–560 px: `.playwright-mcp/karpenter-claim-review.png`, `karpenter-class-review.png`, `karpenter-pool-dark-review.png`, and `karpenter-empty-review.png`. DOM checks found no horizontal overflow; the sparse overview has no empty sections. Dark-mode inspection applies the production theme tokens to the fixture preview. |
| Compact wire summary and ordinary custom-resource behavior | passed (automated) | `/tmp/karpenter-redesign-backend-red.log` proves the old packed payload fails the new wire contract. Backend tests now check named fields, detail/status parity, non-Karpenter rows and nil objects. The hydration adapter preserves summary references and source versions. |
| Adjacent YAML, catalog navigation, loading/error/empty behavior | passed (automated); native confirmation pending | Focused table tests retain query scoping, error/empty handling and navigation. The full frontend coverage rerun passes 5,027 tests across 525 files (`/tmp/karpenter-redesign-frontend-coverage-final.log`). The first full run timed out in a YAML test, followed by 31 failures in that file; all 34 YAML tests passed in isolation and the complete coverage rerun passed. No YAML code or timeout settings changed. |
| Affected coverage ≥80% | passed | Frontend affected production files: 121/126 statements (96.03%), each over 90%; `/tmp/karpenter-redesign-affected-coverage.json`. Full backend coverage task passes (`/tmp/karpenter-redesign-backend-coverage.log`); supplementary generic-resource tests bring both changed custom-summary functions to 100% (`/tmp/karpenter-redesign-customresource.cover`); the changed snapshot conversion is 100% in `build/coverage/backend.coverage.out`. |
| Complexity ≤12 | passed (local) | Biome max-12 check for all five changed frontend production files passes (`/tmp/karpenter-redesign-complexity.log`). Pinned gocognit reports 1 for both changed custom-summary functions and no finding for the straight-line snapshot conversion (`/tmp/karpenter-redesign-go-complexity.json`). `gh pr view --json number,url,headRefOid` reports no PR for `karpenter-support`; no pushed-revision Sonar result is available. |
| Final prerelease gate and worktree inspection | passed | `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` exits 0 (`/tmp/karpenter-redesign-prerelease-final.log`): format/bindings, vet/staticcheck, race suite, lint/typecheck, 5,027 frontend tests, knip and Trivy. Post-gate worktree inspected; `git diff --check` passes. The first attempt linted generated coverage HTML; moving that report to `/tmp/karpenter-redesign-frontend-coverage-report` resolved it without changing lint rules. |
| Native visual acceptance | pending — user confirmation | Storybook uses real rendering with fixture data/provider responses. It does not prove live-cluster or native interactions. The preview logs the expected browser-only Wails warning and missing `/wails/custom.js`; no native pass is claimed. The agent-owned Storybook process was stopped after inspection. |

The remaining table records the historical initial implementation.

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

## Text-selection regression from visual review

The Subnets, Security Groups and Images lists inherited the `.app *` selection
reset. `OverviewBlocks.css` now allows text selection on shared reference-list
items and their descendants. The NodeClass story loads `App.css` and uses the
`.app` wrapper to reproduce this context.

Playwright reproduced `user-select: none` before the correction
(`.playwright-mcp/karpenter-selection-red.md`). Afterward, mouse dragging selected
the complete first identifier in each list, and `ControlOrMeta+C` followed by a
clipboard read matched `subnet-0123456789abcdef0`, `sg-0123456789abcdef0` and
`ami-0123456789abcdef0` exactly. This exercises the real components and CSS in
Storybook; native Wails Copy behavior remains for the user's confirmation.

Per the user's testing guidance, the added CSS-property assertion test was removed
and the frontend coverage run was stopped (exit 130). Validation for this small
styling correction uses the direct selection/copy checks above. The earlier
prerelease result applies to the design revision; it was not rerun for this
correction.

## Conditions badge alignment

`KarpenterSections.tsx:231` now renders every Karpenter kind's Conditions through
the same `StatusChip` component and wrapping `overview-condition-list` layout used
by the Node descriptor. True is healthy, False is unhealthy, and other states use
warning; the message or reason appears on hover. The former condition-message CSS
was removed. Existing overview tests use the same Tooltip stub as the Node tests;
the assertion requiring hover-only content in static markup was removed. No new
tests were added.

Focused validation: `npm run typecheck --prefix frontend` exited 0; the existing
`KarpenterOverview.test.tsx` suite passed all 7 tests; Biome check passed for the
three touched frontend files, and the local max-12 complexity check passed.
Commands ran through `mise exec --`. Visual confirmation remains with the user;
the full prerelease gate was not rerun for this presentation correction.

## Readable memory and ephemeral-storage capacity

`KarpenterSections.tsx` routes memory capacity, allocatable memory and memory limits
through the shared resource parser and display formatter. NodePool and NodeClaim
both use this capacity component. Direct formatter checks convert `33554432Ki`,
`34359738368` and `32768Mi` to `32.0Gi`, retain `1.5Ti`, and preserve zero.
Typecheck, Biome check, the local max-12 complexity check, and the 28 existing tests
in `KarpenterOverview.test.tsx` and `resourceCalculations.test.ts` passed through
`mise exec --`. No tests were added. Visual confirmation remains with the user;
the full prerelease gate was not rerun for this display-formatting correction.

The same formatting also covers ephemeral-storage capacity, allocatable values
and limits. The shared parser now recognizes milli-byte quantities so allocatable
storage is not inflated by 1,000. Direct formatter checks produced `20.0Gi` for
both `20971520Ki` and `21474836480`, and `1.0Gi` for `1073741824000m`. The existing
28 tests, typecheck, Biome check and local max-12 complexity check passed again;
no new tests were added. Native visual confirmation and the full prerelease gate
remain unrun for this extension.

Capacity rows now follow cpu, memory, storage, nodes, pods, pod-eni, then hugepages.
The display aliases are `ephemeral-storage` → `storage` and
`vpc.amazonaws.com/pod-eni` → `pod-eni`; hugepage size suffixes remain visible.
Unlisted resources follow alphabetically. Typecheck, Biome check, local max-12
complexity and the 7 existing overview tests passed for this ordering change;
no tests were added. Visual confirmation remains with the user; the full gate
was not rerun for this presentation change.

CPU capacity and allocatable values share one unit choice: whole cores when both
represent whole CPUs, otherwise millicores for both. Thus `4`/`4000m` displays as
`4`/`4`, while `4`/`3920m` displays as `4000m`/`3920m`. This is implemented in
`KarpenterCapacity` and `formatCapacityValue`. Typecheck, Biome check, local max-12 complexity and the 28 existing
overview/resource-calculation tests passed. No tests were added; these existing
tests do not directly assert the new paired-unit rule. Visual confirmation remains
with the user, and the full gate was not rerun for this presentation change.

The Capacity header remains unchanged. Each row now shows `n allocatable of n
total` when allocatable is available, `n (limit n)` when only a configured limit
is available, or just the total otherwise. Missing totals use `-`. The CPU pair
uses matching units for either total/allocatable or total/limit. Values remain
selectable through the shared `overview-row-value` style; the former legend/flex
layout was removed. No separate Limits section is added. Typecheck, Biome check,
local max-12 complexity and 28 existing tests passed during this change. No tests
were added; visual confirmation remains with the user and the full gate was not
rerun for this presentation change.

## Scheduling layout revision

Requirements use compact label/value rows. Known keys have explicit readable labels;
other keys use their name portion with word separators expanded and acronyms
preserved. Complete keys remain in the shared, keyboard-accessible Tooltip.
Membership values omit the redundant `In`
prefix; exclusions, comparisons and existence constraints retain distinct wording.
Minimum-value constraints remain visible. Taints and startup taints use the Node
panel's shared StatusChip pattern, preserving case and wrapping long keys.

Rendered verification uses the real descriptor and CSS in Storybook. The added
`SchedulingConstraints` story supplies longer lists, membership/comparison/existence operators,
minimum values, custom keys and taints. At viewport widths 360/420/600, Playwright
measured section client/scroll widths of 312/312, 372/372 and 552/552. Mouse
selection and clipboard checks copied `amd64, arm64`, `dedicated=batch:NoSchedule`
and the tooltip key `kubernetes.io/arch` exactly. Enter opens the key tooltip and
Escape closes it. The newly-created fixture renders zero Scheduling sections.
Light/dark screenshots were inspected: `.playwright-mcp/karpenter-scheduling-revision.png`,
`karpenter-scheduling-constraints.png` and `karpenter-scheduling-dark.png`.

Typecheck, Biome check, the local max-12 complexity check and all 7 existing
Karpenter overview tests pass. No tests were added; the story uses fixture data
and provider responses, not native Wails. The agent's Storybook server was stopped.
Native visual acceptance remains with the user; the full prerelease gate was not
rerun for the initial Scheduling layout revision.

The NodeClaim label follow-up adds NodePool/NodeClaim naming and readable fallback
labels for provider and custom keys. The NodeClaim story now includes CPU
manufacturer, EBS bandwidth, hypervisor, network bandwidth, zone ID and a custom
workload tier. Playwright rendered those labels and confirmed the Zone ID tooltip
contains `topology.k8s.aws/zone-id`; section client/scroll widths remained
312/312, 372/372 and 552/552 at viewport widths 360/420/600. Requirements keeps its
existing name. The Storybook server was stopped after these checks. Native visual
acceptance remains with the user.

For the label follow-up, `mise exec -- wails3 task qc:prerelease` passed, including
5027 existing frontend tests across 525 files. The gate reported no Biome changes;
the worktree inspection retained only the intended label, CSS, story and plan
edits. The local max-12 complexity check also passed. No tests were added.
`mise exec -- wails3 task test:frontend-coverage` passed all 5027 tests and measured
96% statement coverage for `KarpenterSections.tsx`.

The Capacity tooltip is supplied by the claim overview instead of the shared
capacity component, so pool and overlay overviews omit it. Final typecheck, Biome
and max-12 complexity checks pass. The 7 existing overview tests pass with 96%
statement coverage for `KarpenterSections.tsx` and 95% for the descriptor.
The final `mise exec -- wails3 task qc:prerelease` run also passed; no tests were
added. Native visual acceptance stays with the user.

Two validation failures were resolved before the final gate: generated coverage
HTML/CSS entered the lint scope, so those reports were moved outside the frontend
tree; `Object.hasOwn` was incompatible with the TypeScript target, so the label
lookups now use Maps. The successful final gate log is
`/tmp/karpenter-final-prerelease.log`.

## PR 345 Sonar remediation

The all-rule PR audit reported one open issue: `typescript:S4624`, key
`AaCXUN1w136A9JFWhVFL`, at `KarpenterSections.tsx:190` (nested template literals;
no complexity score). `KarpenterTaints` formats both taint and startup-taint chips
for the shared Scheduling section. The optional value suffix is now computed
before composing the label; the existing key/value/effect formatting is retained.

The 7 existing overview tests passed before and after the refactor, including
claim taints with and without values. Typecheck, Biome and the local max-12
complexity check pass. Direct statement coverage is 96.05% for the touched file;
tests mock metadata, links and tooltips, and do not establish native interaction.
No tests were added. The full prerelease gate passed, including all 5027 frontend
tests; its formatter made no frontend changes. Evidence is retained in
`/tmp/karpenter-sonar-pr345-prerelease.log`. The final worktree passed
`git diff --check`. Sonar closure requires analysis of a pushed revision; this
task has not been authorized to commit or push.
