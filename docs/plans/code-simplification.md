# Simplification review follow-up

Current review baseline: `da08738e73fb881353322684c7ddad0651062ea1`.
First follow-up baseline: `81af9465f73218ac3992ce9ca08da850aba3be5a`.
Original systematic-review baseline: `6d93acb773ab245e79b9e5c932fc2e87e9d5a8c0`.

## Status and evidence limits

The reviewer found three regressions missed by the previous acceptance record.
Its blanket behavior-preservation and CSS-parity conclusions were too broad:
the earlier rendered comparison covered badges and boundaries, not parsed logs.
The corrections below are behavior fixes, not pure refactoring.
The second review also exposed two incomplete fixes: array-free table options
and a pre-initialized hook fixture did not exercise the failing consumers.
Those cases are replaced by inline-array persistence cases and an initially
unseeded, real DockablePanel initialization/eviction/remount test.

The historical per-file ledger and hash manifest are retired. Their inspection
history remains in git at the follow-up baseline; hashes do not prove runtime
correctness. Durable instructions remain in the
[systematic workflow](../workflows/code-simplification.md),
[completion gate](../workflows/completion.md), and owning architecture/UI docs.
This short record remains until the review corrections receive remote analysis.

PR [355](https://github.com/luxury-yacht/app/pull/355) now analyzes
`da08738e`, which contains the first follow-up. CodeQL and Sonar status checks
pass, but the all-rule Sonar audit reports one open new-code issue:
`css:S4666` / `AaC6mEDwxfo69GIqCOT2`, a duplicate parsed-log row selector.
This local follow-up consolidates that selector; remote closure remains pending.
The head/checks and audit were read on 2026-09-19 using
`gh pr view 355 --json headRefOid,statusCheckRollup,url` and
`npm run sonar:audit --prefix frontend -- --pull-request 355`.
The current edits remain uncommitted; no commit or push is authorized.

## Findings and disposition

| Finding | Disposition and retained contract |
| --- | --- |
| Service forwarding rejects controller EndpointSlices | Accept omitted or explicit core `v1` on a Pod target; reject foreign versions/kinds/namespaces, missing names, unready endpoints and unready Pods. Controller references are input to resolution; app object references remain fully versioned. |
| Named permissions restart on unrelated auth progress | Stabilize the admitted and waiting descriptor arrays. Actual descriptor/readiness changes still cancel stale results; auth-progress-only publications keep the in-flight batch. The regression uses the real workspace store and lifecycle provider, with only the permission RPC deferred. |
| Parsed JSON table styling removed | Restore header, row-border and hover rules on emitted GridTable classes. Compare the real ParsedLogTable against main's stylesheet in light/dark, including scrolling. Existing cell rules retain typography and padding. Use both table classes for specificity and consolidate the duplicate row selector flagged by Sonar. |
| YAML mutation duplicates timeout policy | Use `common.WithDefaultTimeout`; caller-owned deadlines remain caller-owned. Existing mutation/deadline tests cover this refactor. |
| Appearance storage exports | Remove save/clear wrappers and their sole test: production persistence belongs to `appPreferences`. Keep its bootstrap key and payload builder. |
| Shortcut context API | Remove `updateSurface` and its mock properties after searching all source references. `useKeyboardSurface` updates handler refs and re-registers changed surface options; it never calls this API. Retain the separate copy/select-all/cut/paste helpers and their consumers. |
| Column-file prototype | Remove the three QPC1 test-only files after reading every assertion and searching references. Production mmap/spill/lifetime tests remain in `querypage/spill_test.go`. Query-page coverage stays 86.3%. |
| Unread table effect dependencies | Remove row/key inputs through persistence callers and the namespace wrapper. Recursively compare nested arrays as well as objects in inline filter options. Live row arrivals no longer restart a preference-save debounce; schema, scope and actual preference changes still do. |
| Hidden diagnostics cost | Pause the root refresh subscription when closed and skip both resource-stream scans. A 100-write React probe previously produced 100 extra hidden renders; now it produces none and reopening immediately reads current state. This is a render-count result, not an app CPU benchmark. |
| Dockable snapshot recreates evicted layout | Initialize on hook identity changes and make snapshot checks read existing state. Retain the latest observed snapshot, scoped to store/panel identity, through eviction; a new mount gets fresh defaults. The real DockablePanel test covers unseeded mount, initialization, eviction, intervening render and fresh-default remount; native checks cover bottom-dock, close and right-dock reopen. |
| Stale ingestion documentation | Name `ingest.Manager` and client-go reflectors, matching current ownership. |
| Biome informational findings | Replace two literal-key accesses and one string concatenation; do not suppress or change rules. |
| Incomplete custom-resource menu identity | Report through the existing error handler with cluster/ref context and return no actions. A following valid row still offers actions. Both cluster and namespace views use this shared owner. |
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
- Browse inline arrays and namespace-summary cluster arrays → stable selection
  helper → shared persistence owner → serializer/cache. The helper also serves
  Browse catalog results and permission descriptor batches; their suites run.
  Its dependencies remain React-only, with no new dependency cycle. Row arrival does
  not change the serialized preferences. Namespace/cluster/schema changes still
  trigger hydration; preference changes still debounce and flush through the owner.
- Panel layout store → useSyncExternalStore snapshot → DockablePanel. The
  regression forces a render after eviction; snapshot reads must retain the
  initialized state until unmount without recreating the layout.
  Initial mounting and explicit layout actions retain their existing store owner.
  The fallback belongs to each store/panel-specific snapshot reader, so identity
  switches cannot reuse a previous cluster or panel snapshot.
- Custom-resource catalog ref → shared menu callback → canonical reference →
  object-action controller. Invalid references stop before action construction;
  error reporting reuses the controller's existing error-handler dependency.

## Acceptance evidence

Current-run artifacts are under `/tmp/luxury-yacht-rereview/`. Regression tests
are the durable evidence; temporary logs are not needed to run them again.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Table save during row updates | Passed | `useGridTablePersistence.test.tsx`: Browse nested arrays and namespace-summary cluster arrays rebuilt every render, real serializer, mocked persistence I/O, 100ms row arrivals across the 250ms debounce. Both failed before the fix and pass after it (`red.log`, `frontend-coverage.log`). |
| Changed options remain observable | Passed | `useStableSelectedValue.test.tsx`: equivalent nested options reuse the value; changed array order, length and contents publish the new selection. Full Browse and capabilities suites pass. |
| Dock eviction and fresh reopening | Passed | `DockablePanel.test.tsx`: real provider/component starts unseeded, initializes bottom/open, evicts, renders before unmount without recreating the entry, then remounts right/open. Failed before the fix. Zoom RPC and cluster selection are mocked; layout state and effects are real. Store/panel identity-switch regressions also pass. |
| Native dock lifecycle | Passed | Native Wails app: open node details, dock bottom (height resize control), close all tabs, reopen the same node right (width resize control), then close through the native tab menu. Restored original cluster Overview with no panels. This verifies interaction/reopening; the deterministic React test proves the eviction race. |
| Invalid custom-resource menu | Passed | `NsViewCustom.test.tsx`: missing version reports through errorHandler with cluster context, returns no actions, dispatches no mutation and opens no modal; a subsequent valid reference still offers Delete. Failed before the fix. The test captures GridTable props and mocks backend/error delivery; it uses the real menu callback and action controller. |
| Parsed logs and stylesheet order | Passed | Real ParsedLogTable/GridTable with 100 rows in Playwright: zero computed-property differences from main in light/dark; header stays at 30px after 350px scroll. Appending the real base table rule leaves both table widths at 1380px and border-collapse at collapse (`style-parity.txt`, `css-cascade.txt`, `parsed-logs.png`). |
| Shortcut API removal | Passed | Source search found only the context declaration/implementation/value and test mocks. `surfaces.ts` uses register/unregister plus current-handler refs. Surviving keyboard, table, menu and editor tests pass in the full suite. |
| Frontend coverage | Passed | `wails3 task test:frontend-coverage`: 5,046 tests / 523 files; 89.61% statements (`frontend-coverage.log`). |
| Local complexity | Passed | All 10 changed/new TypeScript functions have no local Biome finding above 12 (`/tmp/luxury-yacht-deep-complexity-audit.json`). No Go production functions changed. This does not establish remote Sonar closure. |
| Final prerelease gate | Passed | `wails3 task qc:prerelease` exited 0 across all eleven stages: backend race suite, 5,046 frontend tests, docs/bindings/vet/staticcheck/lint/typecheck/knip and Trivy (zero reported vulnerabilities). Biome applied no fixes. Post-gate worktree inspection and `git diff --check` passed (`prerelease.log`). |
| Remote analysis of current edits | Pending | PR head is `da08738e`; its open CSS duplication issue is corrected locally. A separately authorized commit/push and new Sonar analysis are required for remote closure. |

Directly affected statement coverage: stable-selection helper 100%, persistence
89.81%, dockable hook 95.45%, shortcut context 91.74%. The changed custom-resource
menu callback has 4/4 statements covered (`menu-coverage/coverage-final.json`); its entire file remains 73.58% because unrelated
navigation/render callbacks are uncovered. Tests were not added to pad that file.
Replacing the weak hook eviction test with the real component case preserves
identity-switch coverage; dockable-hook coverage changed from 95.34% to 95.45%.
Removing the unused shortcut API/mocks changed context coverage from 90.66% to
91.74%; no shortcut behavior tests were deleted.

## Retained evidence from the committed first follow-up

The second reviewer confirmed the Service, auth-progress and parsed-log blockers
in `da08738e`. Their regression cases remain in the suites. The first run's
artifacts under `/tmp/luxury-yacht-review/` record live OperationsCoordinator
Service forwarding (HTTP 200 through a controller-shaped EndpointSlice), auth
progress with a deferred permission RPC, hidden diagnostics subscription behavior,
and the first rendered/native checks. These live checks were not repeated for
unchanged backend/diagnostics code in this follow-up. Its backend coverage was
79.6% overall, resolver/endpoint helper 90.0%/92.3%, and YAML timeout wrapper 100%.
QPC1 prototype pruning preserved query-page coverage at 86.3%.

The original per-file ledger and manifest remain retired; the completed historical
review is recoverable from git. This record tracks the outstanding remote analysis and the concrete review
corrections. It does not claim that every possible simplification has been exhausted.

Verification cleanup: the browser fixture was removed, the Wails development
process exited, and coverage HTML/screenshots were moved outside the repository.
Only this evidence record changed after the final gate; `qc:docs` and
`git diff --check` were rerun for that documentation update.
