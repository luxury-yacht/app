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
