# Cluster Identities

## Scope

Add Identities directly under Cluster, after Events and outside Resources.
Show User and Group subjects referenced by readable bindings and ServiceAccount
objects across the connection's accessible namespaces. Users/groups are derived
subjects, never fabricated Kubernetes resources. Keep RBAC tables unchanged.

## Contract trace

- Producer: existing ingest-owned RoleBinding, ClusterRoleBinding, and
  ServiceAccount projections. Their retained object-map bundle carries canonical
  subject relationships and source object identity; no additional LIST/watch or
  frontend discovery is needed.
- New consumer: cluster-identities snapshot derives subject rows and serves the
  existing backend query envelope. The shared query/table controller owns paging,
  search, filters, export, persistence, loading, errors, and partial visibility.
- Object references identify only ServiceAccounts and source bindings. Subject
  identity is cluster + type + exact name, with namespace for ServiceAccounts.
- Permission registration uses any-readable-source admission and request-time
  source filtering/readiness. Missing sources report partial results; no access
  reports denial. Source-readiness gates must still admit bootstrap LIST/watch.
- Ordering: projectors register before ingest starts. Intake commits retained
  projections before catalog notifications invalidate the identities snapshot
  cache and signal its cluster-scoped subscribers. The table refetches on that
  signal, with polling only as stream-down recovery.
- No new dependency cycle: snapshot reads ingest leaf projections; resource
  stream uses its existing catalog notification path. Neither calls Refresh
  coordinator or resource services in reverse.

## Acceptance and evidence

| Outcome | Status | Evidence |
| --- | --- | --- |
| Direct sidebar route reachable with Resources collapsed | passed | `Sidebar.test.tsx` regression; Playwright sidebar interaction |
| Users/groups deduplicated by exact cluster/type/name; SA namespace preserved | passed | `TestClusterIdentitiesDerivesSubjectsAndBindingProvenance`, including case/whitespace distinction |
| Binding counts, grant scopes, and source binding links correct | passed | Snapshot regression; real routed table/link interaction test; Playwright binding popover |
| Permission denial and pending sources never look like authoritative absence | passed | `TestClusterIdentitiesPermissionAndReadinessStayPartial`; production any-source admission regression |
| Search, type filter, sorting, and paging apply across all derived rows | passed | 130-subject backend query regression; multi-page source-revision regression; shared query suite; Playwright search and Group filter with HTTP fixtures |
| Create/update/completed delete refetch through production ingest signals | passed | `TestIdentitiesProductionIngestInvalidatesBeforeSignaling` exercises real REST LIST/watch, production subsystem, source projections, cache and subscriber; Kubernetes API replaced by HTTP object tracker |
| Cluster changes isolate rows, refresh, and persistence | passed | Foreign-cluster scope rejection; managed-domain reset regression; background-refresh cluster regression; shared `useTypedResourceQuery` no-cross-cluster-flash and table workspace-state tests |
| Navigation, populated/empty/error states and interaction render correctly | passed | Playwright on Wails server URL, fixture-backed populated/search/type-filter/empty cases; initial loading and error observed; screenshot inspected |
| Focused tests, affected coverage >=80%, local complexity <=12 | passed | Commands and measurements below |
| Prerelease gate and final diff inspection | passed | Final `qc:prerelease` exit 0 after source-revision regression; final worktree and `git diff --check` inspected |

## Validation evidence

- Red regressions were observed for missing sidebar/domain registration,
  absent source notifications, lost background refresh routing, whitespace
  merging distinct User subjects, and a missing raw source revision for multi-page
  exports, before their corresponding fixes.
- Focused Go tests passed for snapshot, system, resource stream, domain
  permissions, shared resource model, RoleBinding and ClusterRoleBinding packages.
- `mise exec -- wails3 task test:backend-coverage` passed. The final rerun passed after isolating the diagnostic failure below. The new
  snapshot file measured 91.8% statement coverage after the source-revision regression. Additional cross-package coverage using
  `go test -coverpkg=./backend/refresh/snapshot,./backend/refresh/resourcestream,./backend/resourcemodel`
  measured `ingestNotifySink` at 100%, `broadcastSignal` at 91.7%, and
  `rbacSubjectFacts` at 100%. These shared producers are exercised through their
  production consumers; same-package-only percentages omit that execution.
- `mise exec -- wails3 task test:frontend-coverage` passed: 529 files, 5,130 tests,
  89.84% overall statement coverage; `ClusterViewIdentities.tsx` measured 85%.
  The table interaction test was subsequently widened to render through
  `ClusterResourcesViews`, covering the new route branch, and passed with coverage.
  It replaces the query hook, kubeconfig context, panel dispatch and navigation;
  GridTable, Tooltip and ObjectPanelLink remain real.
- Pinned gocognit v1.2.1: new snapshot functions <=9; changed RBAC subject helper 8,
  stream selector 7, notification functions <=4. Biome with maximum complexity 12
  reported no changed-function findings. It also reported the untouched
  `BackgroundClusterRefresher.refreshCluster` (15); gocognit reported untouched
  `parsePodSelector` (13). Neither function was edited.
- The final `mise exec -- wails3 task qc:prerelease` passed after the source
  revision fix, including race tests, typecheck, 5,130 frontend tests, lint, docs
  and security checks. Documentation-only completion updates then passed
  `qc:docs` and `git diff --check`.

An intermediate coverage run failed the existing
`TestClusterPreflightPreservesExecDiagnostic/expired` assertion
(`expired-credentials` expected, `helper-failed` received). The isolated test
passed, and the subsequent full coverage task passed without changes to that
code. No cause for the intermittent diagnostic result was established.

## Rendered validation scope

`wails3 dev` found port 9245 occupied; a second run on 9246 built the app. The
supported `wails3 task run:server` served the UI at `http://localhost:8080/`.
Server mode's browser window name does not match the native workspace registry,
so native panel calls returned 422 and the cluster refresh services returned 503.
Those responses are not evidence about the new identity source implementation.

Playwright used browser-only window/lifecycle adapters and identity HTTP query
fixtures to exercise the actual routed table and query controller. Checked:
sidebar placement outside collapsed Resources, populated rows, plain User/Group
names, real-object link controls, binding source popover, search, type selection,
filtered empty, settled empty, and loading/error rendering. The screenshot in
`.playwright-mcp/identities-populated.png` was visually inspected. Browser fixtures
do not prove native window actions or live-cluster end-to-end behavior. Native
computer-use inspection separately timed out. Live source-to-snapshot behavior
is established by the production REST ingestion integration test above.

No native window lifetime or placement behavior is changed. Browser validation
proves rendered Wails content, not native window operations.

The extra development processes were stopped and Playwright fixture routes
removed after validation. The browser test workspace was returned to no open
clusters.

## ServiceAccount Kind badge interaction — 2026-09-25

Scope: make the ServiceAccount Kind badge open the existing object panel and
support standard Alt-click navigation. User and Group panels remain discussion
only; their badges remain non-interactive.

The backend's optional `serviceAccount` reference is the producer. The existing
`createKindColumn` and `useObjectLink` consume it; the existing panel and view
navigation hooks receive the complete reference. Interactivity depends on that
reference being present. No new refresh readiness, panel lifetime, or provider
ordering is introduced; dependencies remain from the table to existing shared
hooks. The regression uses a row from a different cluster than the selected
cluster to detect an accidental selected-cluster fallback.

| Outcome | Status | Evidence |
| --- | --- | --- |
| ServiceAccount badge opens the row's complete object reference | passed | New real-table interaction regression failed for the missing button, then passed; only panel dispatch, view navigation, query transport and provider contexts are mocked |
| Alt-click uses the same reference without also opening a panel | passed | Same regression, real Kind column and `useObjectLink` |
| User/Group badges offer no object action; existing name/binding links work | passed | New negative interaction assertions and existing identity-link regression |
| Browser mouse and keyboard activation dispatch the ServiceAccount reference | passed | Playwright mouse, focused Enter/Space and Alt-click checks on the actual component/shared table; query, panel dispatch, navigation and cluster/zoom contexts replaced with fixtures |
| Coverage and local complexity | passed | `test:frontend-coverage`: 529 files / 5,131 tests; focused coverage rerun after reference normalization: component statement coverage 88.46%; Biome maximum complexity 12 check and typecheck passed |
| Prerelease gate | passed | Final `qc:prerelease` exit 0 after test lint corrections and reference normalization; includes backend race checks, typecheck, 5,131 frontend tests, lint, docs and security checks |

The browser fixture captured the complete `cluster-b` ServiceAccount reference
for all four activations while the selected cluster context was `cluster-a`.
Keyboard checks focused the badge before each activation. A combined rapid
sequence under-counted activations; separate focused checks each delivered the
expected dispatch. Native panel rendering was not exercised. The screenshot
`.playwright-mcp/identities-clickable-kind.png` was inspected, and fixture routes
were removed after validation.

The browser mouse, focused keyboard and Alt-click checks were repeated after
reference normalization and delivered the same complete reference. Final worktree
inspection and `git diff --check` passed; the completion-record update also passed
`qc:docs`.

## User and Group panels

Implement the accepted read-only Details panel: exact identity and cluster,
direct binding count/scopes, source binding and role links, and partial visibility.
No YAML, mutation actions, inferred membership, or effective permissions.

The native tab protocol currently admits only object references. Add an explicit
identity target through the same registry, shared directory, local panel state,
snapshots, drag/restore, and docked/native renderers. Object references retain
their full GVK contract; subject targets carry cluster/type/exact name only.
Directory comparisons must distinguish subject type and exact name, and opening
an already-owned subject must focus its existing placement.

Data remains in the cluster-identities refresh domain. Extend its shared
projection with role references and an exact subject predicate, then lease that
domain through existing query/refresh hooks in each visible panel. Permission and
source readiness remain authoritative. Hidden panels release visible demand;
transfers restore identity and refetch data through the destination's runtime.

| Outcome | Status | Evidence |
| --- | --- | --- |
| Protocol preserves exact subjects and rejects mixed/foreign references | passed | New native protocol test first rejected the identity tab kind; identity snapshot and target tests now pass, preserving exact names without GVK |
| Shared ownership, restore, movement and close preserve identity | passed | `internal/panelwindow/identity_test.go`, shared panel state/opening tests, and native undock/redock observations below |
| Details show exact live bindings, role references and visibility | passed | Exact-subject backend query test initially returned three subjects, then passed with one; panel tests cover readiness, deletion, subject/cluster changes, partial coverage, errors, and role navigation |
| User/Group links open panels; ServiceAccount actions retain behavior | passed | New routed badge/name test first failed for the missing User button; final suite covers identity targets and ServiceAccount click/Alt-click/resource rendering |
| Rendered docked/native panel interactions | passed | Native accessibility observations and Playwright checks below |
| Focused tests, coverage and complexity | passed | Final frontend coverage: 531 files / 5,139 tests; backend coverage task passed; local Go/TypeScript scores at most 12 |
| Final prerelease gate and documentation checks | passed | `qc:prerelease` exited 0 after the embedded-table correction; final worktree inspection, `git diff --check`, and `qc:docs` passed |

### Native and rendered checks (2026-09-25)

`mise exec -- wails3 dev -port 9246` started the development app without stopping
the existing Vite process on port 9245. Native automation used bounded macOS
System Events calls against the `luxury-yacht` process. The selected cluster was
`fusionauth-sandbox`.

- Clicked the first Group badge: the panel showed Group
  `eks:kube-proxy-windows`, one direct binding, and Cluster-wide scope.
- Clicked **Undock panel to floating window**: a second native window appeared
  with the same Group identity, binding count, scope, and populated table.
- Clicked **Dock panel to right side**: the floating window was destroyed
  (window count returned to one) and the Group content returned to the dock.
- Clicked its `ClusterRole: system:node-proxier` link: the existing resource panel
  loaded ClusterRole details and rules.
- Selected the User tab `eks:authenticator`: Details showed one direct binding
  scoped to `kube-system`. After the layout correction, native accessibility
  reported the binding heading at y=496, height=26, and the binding table at
  y=618, height=41, so the table was below the heading.

The browser preview on the emitted Vite URL cannot call native Wails methods.
A Playwright-only harness rendered the real header, Details tab, overview fields,
ResourceInventoryTable, GridTable, and links, replacing query data, grid binding,
cluster/zoom context, and link dispatch with fixtures. It exercised populated,
partial, empty, loading, error, and role-link dispatch states. The first screenshot
exposed a missing `embedded` table flag; after adding it, the overview ended at
y=232.39 and the table began at y=297.67. Light and dark screenshots were inspected:
`.playwright-mcp/identity-panel-details-light.png` and
`.playwright-mcp/identity-panel-details-dark.png`. These preview fixtures do not
substitute for the native window observations above. macOS window image capture
returned `could not create image from window`; native geometry was checked through
accessibility instead.

### Validation measurements

- Backend coverage task passed. Directly affected files: cluster identities
  93.22%, native tab types 96.00%, workspace directory 81.25%, app-window workspace
  84.65% statement coverage.
- Final frontend coverage task passed with 5,139 tests; overall statement coverage
  89.86%. Every changed production frontend file measured at least 80%. Identity
  Details measured 87.50%, IdentityPanel 91.66%, its query hook 100%, target helpers
  95%, and the shared target renderer 100%.
- Pinned gocognit 1.2.1 reported no inspected Go function above 12. Biome's local
  cognitive-complexity check at threshold 12 reported no diagnostics for the 16
  changed production frontend files. These are local checks, not a remote Sonar
  analysis; no PR was created or pushed.
- The full frontend run caught the old lazy-import target assertion. It was
  updated to the shared target renderer; focused tests and final coverage passed.
- Logs: `/tmp/identity-panels-backend-coverage.log`,
  `/tmp/identity-panels-frontend-coverage-layout.log`,
  `/tmp/identity-panels-go-complexity.json`,
  `/tmp/identity-panels-ts-complexity.json`, and
  `/tmp/identity-panels-prerelease-final.log`.

Playwright fixture routes were removed and the browser was returned to
`about:blank`. The development app remains available on port 9246 for review.
The final gate applied no additional frontend formatting changes; the worktree
was inspected after it completed. No git state changes or PR operations were run.
