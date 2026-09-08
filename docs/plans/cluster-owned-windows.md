# Cluster-owned windows

## Approved product contract

- One shared workspace per cluster. App windows host cluster tabs referencing it.
- A cluster owns its panel windows and object panel tabs. A panel window holds
  one same-cluster tab group; app windows can host docked groups.
- Every app window displaying the cluster can find, focus, and move its panels.
- Move cluster tabs between app windows, including a destination already showing
  that cluster. Carry source docked panels; reuse an existing destination tab.
- Floating panel windows retain their positions and cluster identity when a
  cluster tab moves or its originating app window closes.
- Show the owning cluster name in each panel window's visible header.

Implementation defaults: opening an already-open object focuses its existing
location. Navigation stays local to each app window. Existing destination
navigation wins when moving into an already-open cluster. Closing an app view
retains its docked panels in the shared directory for reopening. Unsaved drafts
and in-flight mutations guard renderer disposal. Explicit quit preflights every
renderer before disposing any of them.

## Cross-layer contract map

- Native registry (`internal/appwindow`) produces authoritative panel locations
  and acknowledged transfer events. `internal/panelwindow` owns wire identities.
- `DesktopShell`, the authenticated `DesktopService` boundary, and `main.go`
  registry bindings transport commands; frontend app reads use appStateAccess.
- Workspace/Panel renderers and the object-panel context consume the directory;
  dockable groups and shared drag coordinator consume placement transactions.
- `WorkspaceCoordinator` combines app-view selections with retained panel
  references before changing cluster runtime selection. Cluster tab moves must
  never create a transient zero-owner interval.
- Native panel commands target the actual source/destination renderer. They do
  not require a permanent originating app window.
- Source guards run before transfer. Source content remains mounted until the
  destination acknowledges reconstruction. Failure, stale acknowledgements,
  and timeout preserve source ownership and remove provisional destinations.
- Registry/backend coordination must not call back across a held selection or
  registry mutex. Runtime/refresh retain their existing one-way dependencies.

## Implementation and regression evidence

- [x] Visible owning-cluster header, with a full-name tooltip and truncation:
  `frontend/src/ui/layout/AppHeader.tsx:153` and
  `frontend/src/ui/layout/AppHeader.css:47`.
- [x] Shared directory, independent native lifetime, app-to-app panel transfer,
  and all-renderer quit preflight: regression cases in
  `internal/appwindow/workspace_test.go:11`, `:73`, `:97`, and `:125`.
- [x] Panel references retain cluster runtime after the last app view closes;
  panel renderers receive only their own cluster projection:
  `backend/workspace_panel_lifetime_test.go:10` and `:49`.
- [x] Acknowledged cluster transfers, existing-destination rollback, cancelled
  queued work, and destination seeding before renderer creation:
  `internal/appwindow/cluster_tab_transfer_test.go:11`, `:31`, `:60`, and `:97`.
- [x] Native close and quit reject a provisional incoming transfer:
  `frontend/src/ui/shortcuts/components/PanelWindowShortcuts.test.tsx:539`.
- [x] Durable guidance is in
  [application lifecycle](../architecture/application-lifecycle.md#cluster-owned-panel-workspaces),
  [multi-cluster](../architecture/multi-cluster.md),
  [dockable panels](../frontend/dockable-panels.md), and
  [tabs](../frontend/tabs.md#shared-cluster-tabs-across-app-windows).

## Validation record

### Follow-up acceptance record

This record combines native observations, the user's manual drop checks, and
automated regressions. All required acceptance items below have passed.

| Outcome | Status | Required evidence |
| --- | --- | --- |
| Close guards prevent edits throughout publication and final disposal | passed | `WorkspacePanelLifecycle.test.tsx` uses the real guard provider and click input with publication held open; rejection, publication failure, quit settlement and late events covered. Native dirty YAML blocked panel close, final cluster close and quit on 2026-09-07. |
| Final cluster close removes its panels; another app view retains them | passed | Native checks on 2026-09-07: final clean cluster close removed its floating pod window; closing one duplicate view retained the same shared window. Closing its last app window retained the floating panel; docking from that panel created a new app view. Registry cases remain in `cluster_panel_close_test.go`. |
| Cluster and panel tear-offs retain identity, suppress the phantom return, and use the drop position | passed | Native cluster traces recorded pointer-to-window placement and AppKit return animation disabled. Panel drops `(2054,986)` and `(1814,1213)` produced origins `(1934,962)` and `(1694,1189)`; both reported return animation `0`. The pod identity and selected YAML view survived. `/tmp/close-guard-dev.log`. |
| Transfers to existing windows, duplicate cluster views, and empty source cleanup preserve content | passed | On 2026-09-07 the user performed both existing-window drops and confirmed content preservation and empty-source closure. Native traces recorded `workspace-2 → workspace-1` and `panel-2 → panel-1`, with both sources absent afterward. CUA showed both pod tabs in the receiving panel window. `/tmp/unlocked-native-relaunch.log`. |
| App/window close and quit preserve unsaved work and recover from denial or timeout | passed | Dirty native YAML refused Quit; the other app window remained navigable after denial. Cancel Edit discarded the local draft without saving. Clean Quit with two distinct clusters in two app windows and two native panel windows terminated the process. Relaunch restored both cluster selections. Disk-persistence, rejection, timeout, and repeated native-close regressions cover the asynchronous boundaries. |
| Restored and newly opened clusters expose invalidated SSO credentials and recover correctly | passed | Native `fusionauth-sandbox` checks showed an actionable missing-token failure on restored startup and fresh tab open, then automatic recovery to Ready with namespaces, 10 pods and metrics after the user refreshed SSO. Actual AWS stderr said the token did not exist. Both expired and removed-token subprocess/startup/recovery regressions pass (`/tmp/missing-sso-green.log`). |
| Native startup and panel transfer run without the observed readiness or render-phase errors | passed | The clean 21:12 native relaunch restored both clusters to Ready with no new 503. Floating a sandbox pod and docking it back retained its identity and selected YAML view without repeating the render-phase warning. HTTP/lifecycle, deferred-fetch, and StrictMode eviction regressions failed before correction and pass afterward. `/tmp/native-complete-relaunch.log`, `/tmp/native-final-dev.log`, CUA observations. |
| Final worktree passes repository validation without altering user Biome settings | passed | Final `qc:prerelease` exited 0: backend race tests, 513 frontend files / 4,793 tests, formatting, bindings, vet/staticcheck, lint, typecheck, Knip and Trivy. `/tmp/cluster-workspace-final-gate.log`. Both Biome hashes match (`/tmp/cluster-workspace-final-biome-check.log`); post-gate diff check passed. |

Native follow-up observations (2026-09-07, macOS / Wails development app):

- Existing-window drops were performed by the user after automation delivered
  hover but no drop. The native registry recorded both destination transfers and
  removed both empty sources; the user independently confirmed both results.
  Panel tear-offs also preserved the selected YAML view, followed the recorded
  drop positions, and used AppKit return animation `0`. Temporary instrumentation
  was removed after collecting the evidence.
- The multi-cluster restart exposed two premature refresh paths. The new
  `refresh_publication_lifecycle_test.go` drives the real HTTP consumer from
  lifecycle events and covers server-owned readiness without frontend reads.
  The unknown-lifecycle dispatch regression proves a deferred request resumes
  on the first `loading` event. Native fresh-open and clean restored startup
  then reached Ready without repeating the early 503. Red/green logs:
  `/tmp/refresh-publication-red.log`, `/tmp/refresh-publication-green.log`,
  `/tmp/unknown-refresh-dispatch-red.log`, `/tmp/unknown-readiness-green.log`.
  A final review also reproduced deferred requests missing a readiness snapshot;
  event and snapshot paths now share publication notifications. The four focused
  suites passed 177 tests, followed by native new-window hydration to Ready
  (`/tmp/snapshot-readiness-red.log`, `/tmp/snapshot-readiness-green.log`).
  The final scoped coverage run measured `clusterWorkspaceStore` at 80.07%
  statements (`/tmp/snapshot-readiness-coverage.log`); local complexity passed
  with a maximum of 12. The additional test window and sibling cluster tab were
  closed, leaving `fusionauth-sandbox` Ready with 9 namespaces and 10 pods.
- Floating a panel exposed shared-cache notifications during React rendering.
  StrictMode tests reproduced this for transfer, individual close, group close,
  and cluster removal. The committed-state eviction path passed those cases and
  the transfer suites (`/tmp/panel-eviction-red.log`,
  `/tmp/panel-eviction-green.log`). Native float/dock retained pod identity and
  YAML selection without the warning after the correction.
- The backend suite inherited real application directories. A subprocess probe
  demonstrated writes into an inherited fixture home, then passed after process
  isolation (`/tmp/backend-isolation-red.log`, `/tmp/backend-isolation-green.log`).
  The full isolated backend coverage run left the real settings hash unchanged.
  Changed refresh files measured 84.47–91.39% statement coverage; the backend
  package overall remains 79.7%. Frontend coverage measured 86.52% overall,
  `ObjectPanelStateContext` 92.22%, and `clusterWorkspaceStore` 92.83% before the
  final publication refinement measured separately above; all touched frontend
  modules measured at least 80%. Logs:
  `/tmp/native-isolated-backend-coverage.log`,
  `/tmp/native-complete-frontend-coverage.log`.

- The real-backend Quit regression selected different clusters in two windows.
  Sequential view closure persisted only the second cluster
  (`/tmp/quit-persistence-red.log`). The correction requests process Quit after
  all renderer approvals, preserving the selection through persistence and
  service teardown. Focused persistence and failure/timeout settlement cases
  passed, including reload from disk (`/tmp/quit-process-green.log`). A rejected
  final-window shutdown also lost its renderer-ready guard state; the repeated
  close regression failed before moving cleanup to accepted-close paths
  (`/tmp/native-close-guard-red.log`, `/tmp/native-close-guard-green.log`).
  Native multi-window Quit and relaunch were subsequently exercised after unlock;
  both distinct cluster selections restored.
  The latest full backend coverage passed with `internal/appwindow` at 84.9%;
  native close measured 82.1%, Quit acknowledgment 84.4%, and settlement and
  persistence handoff 100% (`/tmp/quit-process-final-backend-coverage.log`,
  `/tmp/quit-process-final-coverage-functions.log`). Changed Go functions remain
  at or below complexity 12 (`/tmp/quit-process-final-go-complexity.json`).

- After the user invalidated SSO, a read-only `fusionauth-sandbox` version probe
  captured `Error loading SSO Token: Token for fusionauth does not exist`
  (`/tmp/fusionauth-sso-probe.stderr`). The app initially used the generic
  helper-failed diagnosis. New subprocess/startup tests reproduced this gap
  (`/tmp/missing-sso-red.log`); the missing-credentials classification and refresh
  guidance passed the backend and UI reruns (`/tmp/missing-sso-green.log` and
  `/tmp/missing-sso-ui-green.log`). Classifier statement coverage measured 93.2%
  in the full backend coverage run; the auth overlay measured 100%
  (`/tmp/sso-native-backend-coverage.log`, `/tmp/sso-overlay-coverage.log`). Local
  complexity passed: changed Go classifier functions at most 4, overlay below 12.
- The native startup and fresh-tab overlays both identified missing SSO
  credentials and instructed a refresh. After the user restored credentials,
  the open failed tab recovered without clicking Retry Now: Ready, namespaces,
  10 pods, and metrics were visible. These observations exercise the user's
  removed-token condition; exact expiry remains covered by the real subprocess
  regression rather than a claim that the live token was expired.
- A docked pod YAML label was edited locally. Native app-window close and Quit
  both refused disposal and preserved the draft. Cancel Edit restored the
  original label; Save YAML was never clicked. Clean Quit then returned the
  native tool's `App quit` result, and relaunch restored `fusionauth-sandbox`.
- Additional native tracing confirmed a cluster drop at `(374,757)` produced
  native origin `(254,733)`, with screen-edge clamping on a later right-edge
  drop. The real AppKit callback reported `return=0 cluster=1 panel=0`.
  Completed source windows subsequently returned `exists=false` from Wails'
  native window registry. Trace: `/tmp/close-guard-dev.log`.
- A single native pod tab tore into another panel window while preserving its
  pod identity and selected YAML view. Existing-window synthetic drops still
  arrived without a destination; receiver-event and pointer-targeting diagnosis
  was in progress when the Mac locked again. These attempts are not recorded as
  successful cross-window drops or as a proven application defect.
- The `dev-cluster` and `prod-cluster` names were visible in their respective
  floating panel headers. Opening a duplicate development cluster view listed
  and focused the existing floating pod panel.
- Cluster tear-off moved a tab from a two-cluster app view. A later last-tab
  tear-off carried a docked pod panel into the destination. Temporary drag
  diagnostics recorded the complete cluster/object identity and the accepted
  source snapshot at 20:34:11 UTC in `/tmp/close-guard-dev.log`.
- A missing-panel observation was invalidated: the test sequence pressed Escape,
  which closes the focused object panel. It is not counted as a transfer failure.
  Synthetic gestures without a drag-end event are also excluded.
- Native panel tear-off exposed an old single-tab prohibition in
  `PanelWindowApp.tsx`. The updated regression failed with zero transfer requests
  (`/tmp/last-native-tab-red.log`) before removing that prohibition. The focused
  rerun passed 37 tests; statement coverage is 80% for `PanelWindowApp.tsx` and
  90.12% for `PanelWindowShortcuts.tsx` (`/tmp/last-native-tab-green.log`). Native
  transfer of the single pod tab was subsequently observed; its placement and
  animation checks remain pending.
- The final full follow-up gate passed 513 frontend files / 4,786 tests,
  backend race tests, lint, typecheck, bindings, static analysis, Knip and Trivy
  (`/tmp/close-guard-final-prerelease-rerun.log`). This rerun includes the
  single-panel-tab correction and three added source-transfer tests. Final
  diff inspection found no whitespace errors or Biome configuration changes.
- Full follow-up coverage passed. The new quit hook has 100% statement coverage,
  workspace close lifecycle 94.73%, and the shared guard module 97.84%.
  `internal/appwindow` measured 83.4%; quit-settlement notification measured 100%.
  Reports: `/tmp/close-guard-frontend-coverage/coverage-summary.json` and
  `build/coverage/backend.coverage.out`.
- Local cognitive-complexity checks passed at the threshold of 12 for the six
  changed close/transfer modules and `PanelWindowApp.tsx`. Changed Go quit
  functions measured at most 8. `gh pr view` reported no PR for
  `windows-ownership-refactor`, so there is no current PR Sonar result to claim.
- Temporary diagnostics for native coordinates, callback policy, window removal
  and receiving drag events were removed after comparing each instrumented file
  against its saved pre-instrumentation version. No diagnostic markers or Biome
  configuration changes remain. The Mac locked again, and a new unlock request
  is pending. Final local complexity checks passed for all eight changed frontend
  production modules and the changed Go registry/classifier functions
  (`/tmp/sso-final-ts-complexity.log`, `/tmp/sso-final-go-complexity.json`).

### Earlier implementation checks

- `mise exec -- wails3 task qc:prerelease` exited 0: Go race tests, bindings,
  formatting, static analysis, frontend lint/typecheck, all 511 frontend test
  files / 4,747 tests, Knip, and Trivy passed. Trivy reported no findings at the
  requested high/critical severity.
- `mise exec -- wails3 task test:frontend-coverage` passed all 4,747 tests and
  reported 86.41% overall statement coverage. Aggregating changed production
  files from `frontend/coverage/coverage-summary.json` gives 2,927 / 3,511
  statements (83.37%); new files give 342 / 407 (84.03%).
- `mise exec -- wails3 task test:backend-coverage` passed. Aggregating changed
  production files from `build/coverage/backend.coverage.out` gives 2,211 /
  2,741 statements (80.66%); new files give 609 / 732 (83.20%).
- The local gocognit and Biome cognitive-complexity audits found no changed
  production function above 12. The audited files contain two unchanged
  functions above that threshold: `initializeStartupClusters` (14) and
  `movePanelBetweenGroups` (15); their bodies have no worktree diff.
- The long-name panel-header Storybook preview was inspected at 380px width:
  the cluster name truncates, its title retains the full name, and the document
  does not overflow horizontally.
- [ ] Native multiwindow validation remains unfinished. Automation initially
  timed out, then became usable after macOS permissions were enabled. The
  follow-up acceptance record above distinguishes completed observations from
  the checks still blocked by the locked Mac. The SSO path and credentials were
  supplied, and that native failure/recovery check has passed.

Keep this temporary record until native interaction validation is performed;
the ownership contract already lives in the durable documents linked above.

## PR #339 Sonar follow-up

The all-rule PR audit reported eight findings at local revision
`b45202b07ffbe9f014b13ad2055ec7373535ddd8` (`/tmp/pr339-sonar-before.log`).
These edits preserve transfer ordering, rollback, cluster/object identity, and
guard timing; no runtime protocol or dependency changes are intended.

| Sonar key | Rule | Local correction |
| --- | --- | --- |
| `AaB_G072NkZFg8_cyI7B` | `godre:S8159` | Factor the cgo imports, keeping the native preamble attached to `C`. |
| `AaB_G01nNkZFg8_cyI66` | `typescript:S7778` | Append each panel's header and Show action in one push. |
| `AaB_G06PNkZFg8_cyI68` | `typescript:S6754` | Name the revision setter `setRevision`. |
| `AaB_G06PNkZFg8_cyI69` | `typescript:S7718` | Use `error_` for the nested catch parameter. |
| `AaB_G06tNkZFg8_cyI6_` | `typescript:S6582` | Use optional chaining for the pending dock transfer identity. |
| `AaB_G06GNkZFg8_cyI67` | `typescript:S7765` | Use includes for navigation-view membership. |
| `AaB_G068NkZFg8_cyI7A` | `typescript:S6819` | Use native output semantics for the transfer status, retaining its CSS class. |
| `AaB_G06dNkZFg8_cyI6-` | `typescript:S6582` | Use optional chaining for the panel-tab kind guard. |

- Passed: the same 112 focused frontend tests before and after the edits, plus
  the native drag callback tests (`/tmp/pr339-focused-before.log`,
  `/tmp/pr339-focused-after.log`, `/tmp/pr339-appwindow-coverage.log`).
- Passed: full frontend coverage; each changed frontend file measures at least
  80%, with 565/635 statements covered together (88.98%). Native Go drag wrappers
  measure 100%; their package measures 84.9%
  (`/tmp/pr339-frontend-coverage-report/coverage-summary.json`,
  `/tmp/pr339-appwindow-coverage.out`).
- Passed: local TypeScript complexity check at 12 and Go gocognit check;
  no complexity suppressions or configuration changes
  (`/tmp/pr339-complexity-12.log`, `/tmp/pr339-go-complexity.json`).
- Pending: final prerelease gate and post-gate diff/configuration inspection.
- Pending: explicitly authorized commit/push followed by Sonar analysis of
  that revision and the all-rule PR audit. Local checks do not establish remote
  closure.
