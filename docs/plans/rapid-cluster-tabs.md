# Rapid cluster tab lifecycle

## Backend retirement follow-up

The September 24 native observation showed one open tab but three K8s API rows.
The two closed clusters retained zero and two total requests for over eight
minutes; Cluster Data showed only the surviving cluster. The earlier native
checks below established visible tab convergence, not complete backend retirement.

The new regression uses real client construction against a local HTTP server.
Before the fix, both connecting-tab cases failed to cancel discovery and retained
API diagnostics after close; closing the last connected tab also retained its
diagnostics (`/tmp/cluster-retirement-red.log`).

Producer and consumers: client configuration registers metrics before installation;
the diagnostics RPC and polling panel consume that registry directly. Workspace
state retirement is shared by selection reconciliation, final-tab clearing, and
kubeconfig pruning. Metrics removal belongs at that shared retirement boundary,
including canceled builds without installed clients. The serialized selection
mutation drains old connection work before retirement or reopen. Gateway discovery
must propagate that mutation's context to client-go. The change preserves partial
discovery results, peer ownership, and the existing Workspace-to-Runtime dependency
direction; it introduces no callback or reverse dependency.

The native pointer-close burst then exposed another retained namespace scope in
Cluster Data despite correct K8s API retirement. Queued stream startup and pending
startup resolution/rejection recreated removed runtimes or published stale state.
Three new orchestrator regressions failed (`/tmp/cluster-retirement-stream-red.log`).
Async stream and fetch continuations now check the original runtime's identity
without allocating a replacement. Late subscriptions are disposed, late failures
are discarded, and explicit reopen may create and use a fresh runtime. Store
consumers, including namespace data and diagnostics, keep the same ownership path.

- Passed focused backend tests and five repetitions under the race detector,
  including discovery/preflight cancellation with and without a surviving sibling,
  connected cleanup, peer retention, and pruning
  (`/tmp/cluster-retirement-green.log`, `/tmp/cluster-retirement-race.log`).
- Passed full backend coverage; affected functions measure 83.3–100% statement
  coverage, with 80.0% overall (`/tmp/cluster-retirement-coverage.log`,
  `/tmp/cluster-retirement-affected-coverage.txt`).
- Passed local Go complexity: changed functions score 0–7
  (`/tmp/cluster-retirement-complexity.json`).
- Passed frontend stream lifecycle regressions: 143 tests in two files
  (`/tmp/cluster-retirement-stream-green.log`).
- Passed an initial prerelease gate before the additional frontend fix
  (`/tmp/cluster-retirement-prerelease.log`); this does not prove the final worktree.

- Passed full frontend coverage: 5,112 tests across 528 files; orchestrator
  statement coverage is 85.8%, overall 89.84%
  (`/tmp/cluster-retirement-frontend-coverage.log`, detailed reports preserved at
  `/tmp/cluster-retirement-frontend-report`). Local Biome complexity passed at
  maximum 12 (`/tmp/cluster-retirement-ts-complexity.log`).
- Passed native interaction on the rebuilt app: repeated four-cluster opens,
  rapid three-tab closes, explicit foreground switches, keyboard closes, and
  pointer close controls. After polling settled, K8s API showed only
  `fusionauth-dev-us-east-1`; Cluster Data showed one cluster, three domains,
  three scopes, zero issues, and zero pending work. The final pointer burst at
  approximately 10:47 MDT also converged to those counts. No close-related
  error toast or reappearing tab was observed.
- Passed native close-all and reopen: closing the final tab showed "No active
  clusters"; reopening the original cluster reached Ready. The diagnostics panel
  is not rendered in the empty workspace, so the zero API-registry assertion
  comes from the real-client backend regression. The app was restored to the
  original cluster with K8s API diagnostics open. Testing reused the user's
  existing development watcher rather than starting another app instance.
- The first final gate rejected a new test fixture's synchronous undefined
  stream-start return (`TS2322`). It now returns a promise as required by the
  registration contract, and the 143 focused stream tests pass again.

- Passed final `mise exec -- wails3 task qc:prerelease` (exit 0): Go race suite,
  5,112 frontend tests across 528 files, bindings, formatting, lint, typecheck,
  dependency checks, and vulnerability scan
  (`/tmp/cluster-retirement-final-prerelease.log`). The gate formatted the new
  runtime-identity helper; post-gate diff inspection and `git diff --check` passed.
- Passed documentation links (`/tmp/cluster-retirement-docs.log`). Process
  inspection found the original `wails3 dev` watcher (PID 59037) and its one app
  instance (PID 72230), with no additional development instance
  (`/tmp/cluster-retirement-processes.log`).

## Reappearing tabs follow-up

The latest report was reproduced across the real KubeconfigProvider,
WorkspacePanelLifecycle, panel guard registry, and DockablePanelProvider. Closing
three tabs removed them immediately, but all three returned when the native
responses settled (`/tmp/reappearing-tabs-red.log`). The native RPC stub enforced
membership and removed a view before returning, unlike the earlier preflight stub.

The close owner iterated a live Set across an await. Foreground changes replace
the dock provider's focus callback, causing the lifecycle consumer to replace its
registered close preflight. The pending iterator then visited that replacement,
attempted a second native close, and rolled back after the already-removed view
was rejected. Each transaction now captures its participants before awaiting.

Native testing additionally reproduced a panel directory read before open
admission (`/tmp/reappearing-tabs-native.log`, 09:53). WorkspacePanelSync now
intersects visible tabs with confirmed selections from ClusterWorkspaceStore
before reads and opens, and defers publication containing unadmitted groups.
Admission remains owned by KubeconfigProvider and the backend workspace owner;
the consumer gate does not block the command that makes membership ready and
does not require connection readiness. No reverse dependency is introduced.

- Passed red/green: the real lifecycle registration path for already-admitted
  tabs and tabs with pending open acknowledgements; the accepted closes remain
  removed in both renderer and native membership, with one native close per tab
  (`/tmp/reappearing-tabs-red.log`, `/tmp/reappearing-tabs-stress.log`).
- Passed: the existing 25-cycle burst regression now uses the real panel lifecycle
  and dock providers, with native membership enforcement at the RPC stub. It
  covers overlapping opens, closes, reopens, and foreground switches.
- Passed red/green: a real workspace-store publication blocks premature panel
  reads, opens, and publication, then resumes them on admission
  (`/tmp/reappearing-tabs-admission-red.log`,
  `/tmp/reappearing-tabs-admission-green.log`).
- Passed focused: 101 tests across selection, workspace store, panel lifecycle,
  and panel synchronization (`/tmp/reappearing-tabs-final-focused.log`).
- Passed: typecheck and local Biome complexity at maximum 12 for both production
  files changed in this follow-up (`/tmp/reappearing-tabs-final-types.log`,
  `/tmp/reappearing-tabs-final-complexity.log`).
- Passed: full frontend coverage, 5,109 tests across 528 files. Statement
  coverage is 93.53% for KubeconfigContext and 97.82% for WorkspacePanelSync
  (`/tmp/reappearing-tabs-final-coverage.log`; detailed reports moved to
  `/tmp/reappearing-tabs-coverage-report` before the final gate).
- Passed: `mise exec -- wails3 task qc:prerelease` with the required cache
  variables exited 0, including Go race tests, 5,109 frontend tests, generated
  bindings, lint, typecheck, dependency checks, and the vulnerability scan
  (`/tmp/reappearing-tabs-prerelease.log`). The gate reordered imports in the new
  regression test. Post-gate worktree inspection and `git diff --check` passed.
- Passed: native interaction, final idle check, and cleanup. Native automation exercised
  rapid three-tab opening, foreground changes, pointer close controls, and
  keyboard closes. The observed tab counts after successive keyboard closes were
  2, 1, 0. Explicit reopens requested during pending closes eventually opened;
  these were then closed, returning to the original empty workspace. A later
  native screenshot and accessibility state still showed no active clusters,
  with no error toast. The native log has no repeated-close rejection and no
  membership-read errors after the admission fix. The browser preview separately
  returned Wails RPC 404s; it did not substitute for these native checks.
  The test app was quit and development session 22802 was interrupted (exit 0).
  Process inspection found only the inspection command itself, and `lsof -nP
  -iTCP:9245 -sTCP:LISTEN` returned no listener.

## Immediate close follow-up

The user reported that the visible close still waited on asynchronous work.
The earlier validation established eventual convergence, not immediate visual
removal. The new acceptance criterion is removal of the tab and activation of
its neighbor (or the empty workspace) before open admission, panel publication,
or native close completes. Managed state must remain until acceptance; denial
or failure must restore retained state without stealing a later foreground
choice.

- Passed red: three provider tests held native close or the open acknowledgement
  pending and observed that the tab remained visible
  (`/tmp/immediate-close-red.log`).
- Passed focused: 193 tests across the provider, navigation, namespace, object
  panel, dock layout, panel publication, and lifecycle owners
  (`/tmp/immediate-close-owners-final.log`).
- Passed red/green: hiding a tab previously discarded Global navigation before
  acceptance; the new navigation tests distinguish accepted and denied closes
  (`/tmp/immediate-close-navigation-red.log` and
  `/tmp/immediate-close-navigation-green.log`).
- Passed: close guards freeze local panels immediately while the native call
  waits for admission; retained panel publication remains paused while the tab
  is hidden (`/tmp/immediate-close-retention.log`).
- Passed red/green: a denied close used to restore its tab at the end of the tab
  bar. Tab-order persistence now retains managed selections until acceptance
  (`/tmp/immediate-close-order-red.log`, `/tmp/immediate-close-order-green.log`).
- Passed final focused coverage: 225 tests across 11 files;
  changed statement blocks are 219/223 (98.2%), including 10/10 in the navigation
  owner (`/tmp/immediate-close-affected-coverage.log`). The full frontend coverage
  task passed 5,105 tests before the additional navigation-retention test;
  KubeconfigContext is 93.53%, panel lifecycle 95.65%, and panel publication
  97.72% (`/tmp/immediate-close-coverage-final.log`). Whole-file navigation
  coverage in that run was 74.67%; the directly changed blocks meet the target.
- Passed: typecheck and local Biome complexity at maximum 12 for all nine
  production files changed in this follow-up
  (`/tmp/immediate-close-types-final.log`,
  `/tmp/immediate-close-complexity-final.log`).
- Passed final repository gate: `mise exec -- wails3 task qc:prerelease` with the
  required Go/staticcheck cache variables exited 0, including 5,106 frontend
  tests, the Go race suite, bindings, formatting, lint, typecheck, and security
  checks (`/tmp/immediate-close-prerelease.log`). Worktree inspection and
  `git diff --check` passed after the gate.
- Initially blocked: native automation reported that the Mac was locked on both
  attempts. The native checks in the reappearing-tabs follow-up above supersede
  this blocker; the earlier native evidence below remains historical.

## Contract and owners

The requested outcome is that rapid open, close, reopen, and foreground switches
converge to the user's final tab set without leaving stale managed clusters or
blocking on connection work. Closing must not report errors from retired catalog
requests. KubeconfigContext owns renderer intent; ClusterWorkspaceStore owns
lifecycle/readiness; WorkspaceCoordinator owns per-window membership and the
process union; RefreshCoordinator owns published producers. Panel close guards
must settle before membership is removed. Accepted membership precedes connection
work; runtime publication and cleanup retain the serialized mutation and shutdown
drain. Foreground intent remains independent. Dependencies continue from Workspace
to Runtime and Refresh, without callbacks into Workspace under their locks.

## Evidence record

- Passed red: three provider regressions reproduced overwritten foreground,
  lost reopen, and frontend/backend membership disagreement (Vitest, September 24).
- Passed red: provider close preflight remained serviceable, permitting requests
  during native teardown.
- Passed red: backend open acknowledgement blocked on a held connection builder.
- Passed red: canceled open left a connecting lifecycle entry; failed connection
  left an admitted tab connecting indefinitely.
- Passed red: delayed acknowledgement discarded a ready event; a delayed switch
  restored foreground demand after clearing all tabs; a delayed reopen replaced a
  newer foreground switch; a queued reopen survived a newer close request.
- Passed red: `TestWorkspaceCatalogReconciliationPreservesRetainedClusterCatalog`
  demonstrated that selection reconciliation replaced a surviving cluster's
  catalog. This matched the native `object catalog service unavailable` toast
  from the surviving cluster immediately after closing its sibling.
- Passed focused: provider, workspace store, and refresh orchestrator suites
  (`/tmp/rapid-tabs-final-focused.log`: 197 tests); backend workspace, close,
  selection, retained-peer authentication, and catalog reconciliation suites.
  The final provider-only run passed 36 tests, including full-set replacement
  superseding a pending reopen (`/tmp/rapid-tabs-provider-final.log`).
- Passed: the provider stress test performs 25 overlapping open/open/close/reopen/
  switch cycles, checking both renderer membership and the mock backend's final
  membership and foreground, followed by concurrent sibling closes each cycle.
  Separate regressions cover denied close, failed follow-up RPC, late catalog
  errors, cancellation of a stalled connection, and failed connection diagnostics.
- Passed native (September 24 UTC): reproduced the reported catalog toast before
  the catalog retention fix. After the fix, four open/switch/close/reopen bursts
  settled with both clusters Ready and no catalog toast. Closing the final tab
  reached “No active clusters”; reopening the original cluster progressed through
  Connecting and initial data loading to Ready. The original single-tab state was
  restored. The last-tab close used pointer coordinates after AX clicking only
  focused the tab; the resulting empty state was observed directly.
  On the final frontend build, opening, switching, closing, reopening, and closing
  the secondary cluster during Connecting returned to the surviving Ready tab
  without a toast.
- Passed local complexity: changed TypeScript files pass Biome with maximum 12;
  changed Go functions and new helpers score at most 10 with gocognit v1.2.1.
  This is local evidence, not Sonar analysis of a pushed revision.
- Passed coverage: `wails3 task test:backend-coverage` and
  `wails3 task test:frontend-coverage` via Mise on the final production code
  (`/tmp/rapid-tabs-backend-coverage-final.log` and
  `/tmp/rapid-tabs-frontend-coverage-final.log`). The frontend suite passed 5,096
  tests across 528 files. Statement coverage is 91.89% for KubeconfigContext and
  96.66% for ClusterWorkspaceStore. Go coverage blocks overlapping changed lines,
  including the entire new acceptance owner, cover 81/87 statements (93.1%);
  each affected file's changed blocks exceed 80%. Whole-file workspace_state
  coverage is 75.3%, including the unchanged windowless synchronous path.
- Passed final gate: `GOCACHE=/tmp/luxury-yacht-go-build
  STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task
  qc:prerelease` exited 0 on the final production/test worktree
  (`/tmp/rapid-tabs-prerelease-final.log`). This includes Go race tests, frontend
  tests, generated bindings, formatting, lint, typecheck, and security checks.
  Post-gate inspection found only the intended lifecycle code, regression tests,
  and documentation changes; `git diff --check` passed. No git commits or PRs
  were created.

The provider suites mock Wails RPC and refresh-context updates. The catalog error
regression runs the real refresh orchestrator and store with mocked snapshot I/O.
The backend responsiveness test runs the real workspace owner and client install
boundary with a held external client builder. These do not substitute for native
interaction. Playwright at the emitted Vite URL returned Wails RPC 404s (browser
preview only); native Wails interaction was exercised with native app automation.
