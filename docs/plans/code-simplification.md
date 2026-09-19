# Simplification review follow-up

Baseline for this follow-up: `81af9465f73218ac3992ce9ca08da850aba3be5a`.
Original systematic-review baseline: `6d93acb773ab245e79b9e5c932fc2e87e9d5a8c0`.

## Status and evidence limits

The reviewer found three regressions missed by the previous acceptance record.
Its blanket behavior-preservation and CSS-parity conclusions were too broad:
the earlier rendered comparison covered badges and boundaries, not parsed logs.
The corrections below are behavior fixes, not pure refactoring.

The historical per-file ledger and hash manifest are retired. Their inspection
history remains in git at the follow-up baseline; hashes do not prove runtime
correctness. Durable instructions remain in the
[systematic workflow](../workflows/code-simplification.md),
[completion gate](../workflows/completion.md), and owning architecture/UI docs.
This short record remains until the review corrections receive remote analysis.

PR [355](https://github.com/luxury-yacht/app/pull/355) currently analyzes
`81af9465`: SonarCloud passed, its all-rule audit reports zero new-code issues,
and CodeQL passed. These results were checked on 2026-09-19 with
`gh pr view 355 --json headRefOid,statusCheckRollup,url` and
`npm run sonar:audit --prefix frontend -- --pull-request 355`.
They do not cover this uncommitted follow-up. No commit or push is authorized.

## Findings and disposition

| Finding | Disposition and retained contract |
| --- | --- |
| Service forwarding rejects controller EndpointSlices | Accept omitted or explicit core `v1` on a Pod target; reject foreign versions/kinds/namespaces, missing names, unready endpoints and unready Pods. Controller references are input to resolution; app object references remain fully versioned. |
| Named permissions restart on unrelated auth progress | Stabilize the admitted and waiting descriptor arrays. Actual descriptor/readiness changes still cancel stale results; auth-progress-only publications keep the in-flight batch. The regression uses the real workspace store and lifecycle provider, with only the permission RPC deferred. |
| Parsed JSON table styling removed | Restore header, row-border and hover rules on emitted GridTable classes. Compare the real ParsedLogTable against main's stylesheet in light/dark, including scrolling. Existing cell rules retain typography and padding. |
| YAML mutation duplicates timeout policy | Use `common.WithDefaultTimeout`; caller-owned deadlines remain caller-owned. Existing mutation/deadline tests cover this refactor. |
| Appearance storage exports | Remove save/clear wrappers and their sole test: production persistence belongs to `appPreferences`. Keep its bootstrap key and payload builder. |
| Shortcut exports | Retain: `deriveCopyText` serves TextContextMenu, YamlEditor and log selection; `applySelectAll` serves log selection. Cut/paste helpers run inside KeyboardProvider and expose meaningful selection-edit tests. The cited line 559 is the internal `updateSurface` callback in this revision. |
| Column-file prototype | Remove the three QPC1 test-only files after reading every assertion and searching references. Production mmap/spill/lifetime tests remain in `querypage/spill_test.go`. Query-page coverage stays 86.3%. |
| Unread table effect dependencies | Remove row/key inputs through persistence callers and the namespace wrapper. Stabilize equivalent inline filter options. Live row arrivals no longer restart a preference-save debounce; schema, scope and actual preference changes still do. |
| Hidden diagnostics cost | Pause the root refresh subscription when closed and skip both resource-stream scans. A 100-write React probe previously produced 100 extra hidden renders; now it produces none and reopening immediately reads current state. This is a render-count result, not an app CPU benchmark. |
| Dockable snapshot recreates evicted layout | Initialize on hook identity changes and make snapshot checks read existing state. Preserve the mounted observer's fallback through eviction; a new mount gets fresh defaults. Regression covers eviction, intervening render and remount; native checks cover bottom-dock, close and right-dock reopen. |
| Stale ingestion documentation | Name `ingest.Manager` and client-go reflectors, matching current ownership. |
| Biome informational findings | Replace two literal-key accesses and one string concatenation; do not suppress or change rules. |
| Missing release notes | Add user-visible fixes from this branch to [pending release notes](../release/pending.md). |
| IngressClass/GatewayClass Used by | Retain removal. IngressClass's main producer passed a nil ingress list; GatewayClass had no assignment to UsedBy. No populated production behavior is restored. |

## Contract trace

- EndpointSlice controller reference → Service resolver → OperationsCoordinator
  destination/permission checks → SPDY forwarding/session owner. Namespace and
  readiness checks remain before selection. No new dependency edge is introduced.
- Workspace auth-progress events → lifecycle context → named descriptor admission
  → permission RPC → object-panel capabilities. An unrelated cluster cannot cancel
  an admitted batch; changing that batch's identity/readiness still can.
- Refresh publishers → immutable root snapshots → DiagnosticsPanel. Only the
  diagnostics root subscription is gated; scoped resource consumers and producers
  retain their existing subscriptions. Reopening reads the current root directly.
- Table callers → shared persistence owner → serializer/cache. Row arrival does
  not change the serialized preferences. Namespace/cluster/schema changes still
  trigger hydration; preference changes still debounce and flush through the owner.
- Panel layout store → useSyncExternalStore snapshot → DockablePanel. Eviction
  precedes some closing renders, so consistency reads must not recreate layout.
  Initial mounting and explicit layout actions retain their existing store owner.

## Acceptance evidence

Evidence captured 2026-09-19. Temporary logs support this run; enduring regression
scenarios are in the checked-in tests, not those log paths.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Controller-shaped Service target | Passed | `backend/portforward_resolve_test.go`: omitted/explicit version plus identity/readiness rejection cases; red then green. |
| Actual Service forwarding | Passed | Disposable kind cluster `codex-review`; actual controller target had no apiVersion. Production OperationsCoordinator forwarded HTTP 200 with body `review`, then Stop removed the session. `/tmp/luxury-yacht-review/service-forward-live.log`. The coordinator harness supplies the cluster client; Kubernetes API, permissions, resolution and SPDY transport are real. |
| Permission action resolves through unrelated recovery | Passed | `ClusterLifecycleContext.test.tsx`: resolve the first delayed RPC after three other-cluster auth-progress updates; Edit YAML becomes enabled and one RPC was issued. Existing hook tests cover changed identities and readiness. |
| Parsed log visual restoration | Passed | Playwright mounts real ParsedLogTable/GridTable with 100 rows. Main/fixed computed header, row, hover, cell and table properties match in both themes; header top remains 30px after scrolling 350px. `/tmp/luxury-yacht-review/style-parity.json`. This is browser rendering, not native drag evidence. |
| Table save during row updates | Passed | `useGridTablePersistence.test.tsx` uses the real serializer, mocked persistence I/O and timed row arrivals; red then green. Scope/rehydration integration tests retained. |
| Dock eviction and reopening | Passed | `useDockablePanelState.test.tsx` red then green; native node panel moved bottom, closed, reopened right with same content, then closed through its tab menu. No Kubernetes mutation. |
| Diagnostics close/reopen | Passed | `store.test.ts`: hidden render count and immediate current snapshot; `DiagnosticsPanel.test.ts`: no closed stream scans. Native Cluster Data reopened on its retained tab with updated metrics counts (110 → 129). |
| Full frontend coverage | Passed | `wails3 task test:frontend-coverage`: 5,045 tests / 523 files, 89.60% statements. |
| Full backend coverage | Passed | `wails3 task test:backend-coverage`: all packages passed, 79.6% overall. Changed YAML timeout wrapper is 100%; consumer-instrumented Service resolver/endpoint helper are 90.0%/92.3%. |
| Pruning impact | Passed | Query-page statements 86.3% before/after removal of five prototype cases; surviving appearance payload functions 100% after removing one orphan-wrapper case. |
| Complexity | Passed | 22 changed/new TS functions have no local Biome score above 12; changed Go endpoint helper scores 10, YAML timeout wrapper 0. These are local signals, not remote analysis. |
| Latest prerelease gate and final diff | Passed | `wails3 task qc:prerelease` exited 0: race suite, 5,045 frontend tests / 523 files, docs/bindings/vet/staticcheck/typecheck/knip and Trivy. Biome reported no fixes, errors, warnings or infos; Trivy reported zero vulnerabilities. Final `git diff --check` passed. `/tmp/luxury-yacht-review/prerelease.log`. |
| Remote analysis of follow-up | Pending | Requires a separately authorized commit/push and completed analysis. Current remote success covers baseline `81af9465`. |

Changed behavior owners have statement coverage above 80%: capabilities 93.89%,
diagnostics 88.26%, refresh store 98.75%, persistence 89.81%, dockable hook 95.34%.
Two adjacent callers with argument-removal-only edits retain lower file totals:
GlobalViewClusters 78.94%, namespace persistence wrapper 76.47%. No new branches
were introduced there and no tests were added solely to inflate these percentages.

Verification cleanup: the disposable `codex-review` cluster and rendered browser
fixture were removed, the development process was stopped, and native navigation
was restored to the original cluster Overview with no panels open. Temporary
live-cluster test code and coverage HTML were moved outside the repository.
