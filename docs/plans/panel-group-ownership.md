# Panel group ownership

## Scope and contract

Replace per-tab group leaders with group-owned chrome and geometry. Each tab
renders its own content into a group-owned DOM slot, preserving its originating
React context and error boundary. Keep the native placement directory,
publication, transfer acknowledgement, and rollback protocol.

Producers: ObjectPanel, AppLogsPanel, DiagnosticsPanel declare open tabs;
DockablePanelProvider owns group membership; PanelLayoutStore owns cluster-local
geometry. Consumers: the shared dock layer in AppLayout and PanelWindowApp,
resize/maximize, focus navigation, settings defaults, debug overlay, shell sizing,
and native workspace reconstruction/removal.

Reconstruction must install membership before content; registration must not
replace reconstructed placement. Provisional native sources remain registered
without a visible surface. Committed removal retains existing cache eviction
ordering. Use a separate context module to avoid a provider/group-renderer import
cycle. No React children registry or content-change notification channel.

The initial refactor's read-only line counts for the 14 changed/new production TS, TSX,
and CSS files (excluding tests) total 5,300 before and 4,821 after: 479 fewer
lines, including the new group renderer, context module, and group-state hook.

## Acceptance and evidence

Implementation and automated validation passed on 2026-09-21. Native destination
drop validation remains blocked; this task is not yet fully verified.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Draft and guard retention through sibling opening, clean first-tab close, merge into occupied group, reorder, and clean sibling departure | Passed | `DockablePanel.lifetime.test.tsx`: seven cases, including dirty close/move guards and content-error isolation. Before implementation, the initial four-case run failed three draft/guard retention cases; the reorder control passed. |
| Per-tab object context and error boundary | Passed | `ObjectPanel.groupContext.test.tsx` mounts the actual dock provider/layer with a different context at the layer. Lifetime suite checks that a sibling content error preserves the unaffected draft. |
| Resize/maximize, focus, keyboard close, group movement, controlled utility tabs, cluster-local geometry | Passed (automated) | Dockable behavior/store/hook suites, `PanelLayoutLifecycle.test.tsx`, and AppLogsPanel suite in the focused run below. |
| Native reconstruction, suppressed sources, transfer commit/cancellation/rollback, guards, publication | Passed (automated) | Existing `core/panel-windows` and `PanelWindowApp.test.tsx` suites in the focused run. Native calls are mocked here; these tests do not establish OS window behavior. |
| Native draft retention and dirty guards | Passed on macOS | Native Wails UI: added an unsaved annotation draft to Namespace `test`, opened Namespace `default`, switched back, and closed the clean sibling. The draft remained. Float and group close showed `UNSAVED YAML CHANGES` and retained both tabs. Cancelled the test draft afterward; no YAML was saved. |
| Native resize, maximize/restore, dock edges, float/dock-back, window destruction | Passed on macOS | Native Wails UI: dragged the right resize edge, maximized/restored, moved to bottom, floated, and docked back to right with the resized width retained. Separately floated `default` and closed its native titlebar; the main `test` panel remained. |
| Actual native tab drop and reorder | Blocked | Repeated native automation drags left placement/order unchanged, including bottom-to-right. This does not distinguish an automation limitation from an app defect. Asked for a manual drop; left clean `default` at bottom and `test` at right in the dev app. No successful destination drop has been observed. Cross-window drag acceptance is also unverified. |

The lifetime suite uses the real dock provider, group renderer, YAML transaction,
and lifecycle guard registry. It mocks backend/data reads and kubeconfig. The
object-context suite additionally mocks unrelated object-content dependencies.
These seams establish React identity and state retention, not backend mutation
or actual cross-window transfer.

## Validation runs

- Focused: `mise exec -- npm run test --prefix frontend -- src/ui/dockable
  src/core/panel-windows src/PanelWindowApp.test.tsx src/modules/object-panel
  src/ui/panels/app-logs/AppLogsPanel.test.tsx`: 116 files, 1,104 tests passed.
- Coverage: `mise exec -- wails3 task test:frontend-coverage`: 527 files, 5,060
  tests passed; overall statement coverage 89.71%. Log:
  `/private/tmp/panel-group-coverage.log`; report:
  `/private/tmp/panel-group-coverage/coverage-summary.json`.
- Complexity: Biome's `noExcessiveCognitiveComplexity` with an explicit limit of
  12 passed for all 13 changed/new production TypeScript files. Log:
  `/private/tmp/panel-group-complexity.log`. This is local analysis; no pushed
  revision or remote Sonar result exists for this work.
- Final production gate: `GOCACHE=/tmp/luxury-yacht-go-build
  STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task
  qc:prerelease` exited 0. Backend race tests, frontend 5,060 tests, docs, format,
  bindings, vet/staticcheck, lint, typecheck, knip, and Trivy passed. Log:
  `/private/tmp/panel-group-prerelease.log`. Inspected the resulting worktree;
  subsequent changes are confined to this completion record.
- Completion-record checks: `git diff --check` and
  `mise exec -- wails3 task qc:docs` passed. Docs log:
  `/private/tmp/panel-group-docs.log`.

Directly affected statement coverage:

| File | Statements |
| --- | --- |
| DockablePanel | 94.73% |
| DockablePanelContext | 83.33% |
| DockablePanelGroup | 93.53% |
| DockablePanelProvider | 89.34% |
| panelLayoutStore | 92.77% |
| useDockableGroupState | 100% |
| useDockablePanelState | 100% |
| useDockablePanelMaximize | 84.61% |
| ObjectPanel | 92.85% |
| ShellTab | 84.98% |

AppDebugOverlays is excluded from instrumentation. The barrel and types file have
no executable statements. Obsolete per-tab geometry/copy tests were replaced by
group geometry assertions; coverage did not require restoring those tests.

Native checks used `mise exec -- wails3 dev` and the macOS development app. The
standalone Playwright browser could not load the Wails runtime endpoint and was
not counted as native validation. A mass development hot reload during formatting
triggered a WorkspacePanelSync context error; reloading the application cleared
it, and subsequent native workflows above ran without that error. The hot-reload
root cause was not independently established. Windows/Linux UI checks were not
run on this macOS host.

## Boundaries

This work does not unify the complete workspace state model or add cross-window
draft transfer. Cluster-switch cache retention and native handoff policies retain
their existing owners. Native validation is separate from component and protocol
tests and must be reported explicitly if unavailable.

## Branch-review follow-up

Review base: `e36f9dd7`. The size-setting regression and floating-layout lifetime
are corrected at the cluster-local store. Settings still publish the preference
cache before the provider fans out defaults to every cluster store. Empty docks
now accept those defaults; occupied utility-only groups retain their geometry.
Membership is committed before layouts without a surviving group are pruned;
right and bottom groups remain present even when empty. No new provider or
dependency edge was introduced.

| Review item | Status | Evidence |
| --- | --- | --- |
| Empty docks ignore changed settings | Passed (focused) | Added right and bottom close/change-default/reopen regressions to `panelLayoutStore.test.ts`; both failed with 500/300 instead of 900/600 before the fix. |
| Retired floating layouts survive | Passed (focused) | Added final-tab close and move regressions; both recovered a stale width of 777 before the fix. Surviving floating and docked groups retain their sizes. |
| Hook-result identity churn | Implemented; focused suites passed | Both state hooks memoize their returned objects using their state and callback dependencies. |
| Unused forwarded refs and registration fields | Implemented; typecheck passed | Removed `DockablePanel.panelRef`, ObjectPanel's write-only ref, registration `panelRef`/`onPositionChange`, and obsolete mock forwarding. |
| Whole-group move remounting documentation | Updated | Durable dockable-panel guidance now covers single-tab and whole-group moves, including shell/log content. |
| Actual native drop/reorder, including cross-window drops | Blocked | The prior native validation gap remains. The review supplied no successful manual-drop evidence. |

The red store run had four failures and twelve passes; after the fix all sixteen
passed. The wider focused run passed 118 files / 1,140 tests, including dockable,
panel-window, object-panel, utility-panel, and settings suites. Logs:
`/private/tmp/tab-ownership-review-red.log`,
`/private/tmp/tab-ownership-review-green.log`, and
`/private/tmp/tab-ownership-review-focused.log`.
Typecheck passed (`/private/tmp/tab-ownership-review-types.log`). Local complexity
passed at limit 12 for all six changed production TypeScript files
(`/private/tmp/tab-ownership-review-complexity.log`). Full frontend coverage passed
527 files / 5,065 tests with 89.73% overall statement coverage. The changed store,
both state hooks, and DockablePanel measured 100%; ObjectPanel measured 92.77%.
The changed registration type has no executable statements. Coverage log and
report: `/private/tmp/tab-ownership-review-coverage.log` and
`/private/tmp/tab-ownership-review-coverage/coverage-summary.json`.
The follow-up `qc:prerelease` gate exited 0, including backend race tests and all
5,065 frontend tests (`/private/tmp/tab-ownership-review-prerelease.log`). Inspected
the final worktree; the formatter reported no fixes, and `git diff --check`
passed. The only subsequent edit records these results in this plan.

Retain this temporary record while native validation remains unresolved. Durable
ownership, default-setting, cleanup, and remounting guidance lives in
`docs/frontend/dockable-panels.md`; delete this plan before merge once the native
checks pass and the remaining evidence is recorded in the task or PR.

## Empty dock drop targets

Requested behavior: a compatible tab drag offers right and bottom destinations
in a workspace even when those docks have no visible panels. Occupied docks keep
their tab-strip targets; native panel windows keep their existing group target.

The shared tab source produces MIME kind/cluster markers before publishing its
local drag. Shared acceptance logic must drive both document-wide target
visibility and target admission without reading protected payload values. The
layer consumes that presence and visible membership, and each edge target calls
`dropDockableTab`, preserving local membership updates and the existing
acknowledged external transfer protocol. Sources remain until the destination
acknowledges reconstruction. New renderers import the separate dock context to
avoid a provider/renderer cycle. No backend contract or provider ordering changes.

| Criterion | Status | Evidence |
| --- | --- | --- |
| Local drops into either empty dock move the tab and render its content | Passed (component and browser) | `DockablePanelDropTargets.test.tsx` drives the real provider/layer. The initial run failed eight missing-target cases. Playwright pointer drops moved the actual renderer right → bottom → right with content present afterward. |
| External same-cluster protected drag reveals targets; wrong kinds/clusters do not | Passed (component) | Complete object snapshot reaches the existing external-transfer callback at index zero; membership stays unchanged pending acknowledgement. Protected events never read payload values; drop rechecks cluster identity. |
| Drop, cancellation, and leaving the window clear targets; occupied docks and native windows retain existing targets | Passed (component) | Fourteen new cases cover target visibility, source guards, cancellation, external admission, and native drop propagation. Existing native panel mode does not mount edge targets. |
| Existing reorder, guards, and transfer protocol remain covered | Passed (automated) | Final focused dockable/shared-tab/panel-window run: 28 files, 351 tests. |
| Targets stay reachable above a focused panel | Passed (browser) | Rendered hit-testing originally found panel content covering the right target. A sibling overlay layer now isolates target stacking from group focus z-indices. Hit-testing and pointer drop passed afterward; screenshot `/private/tmp/empty-dock-right-final.png`. |
| Actual native drops into empty right/bottom docks, including another workspace | Blocked | The existing Wails app was inspected and a Namespace detail tab opened, but both native drag attempts returned `noWindowsAvailable`. Manual right, bottom, and cross-workspace destination drops were requested; no result received yet. |

The browser fixture uses the actual dock components with fixed cluster identity
and static content because the browser cannot load the Wails backend runtime.
A synthetic dragstart reveals the destination before Playwright resolves it;
Playwright then performs a pointer drag and destination drop. This caught a real
event-order bug: a document capture listener removed the target before its drop
listener ran. A regression that flushes React between capture and target phases
failed before deferring cleanup until after event dispatch, then passed. Logs:
`/private/tmp/empty-dock-red.log`,
`/private/tmp/empty-dock-native-order-red.log`, and
`/private/tmp/empty-dock-green.log` (38 drag-related tests passed).

Full frontend coverage passed 528 files / 5,079 tests with 89.74% statement
coverage after the event-order fix. The subsequent stacking adjustment received
a fresh focused coverage run. Reports and logs:
`/private/tmp/empty-dock-coverage-final/coverage-summary.json`,
`/private/tmp/empty-dock-coverage-final.log`,
`/private/tmp/empty-dock-affected-coverage/coverage-summary.json`, and
`/private/tmp/empty-dock-affected-coverage.log`.
Final affected statement coverage: new target component and both new drag hooks
100%, shared drop target 96.34%, dock provider 89.38%.
Local complexity at limit 12 passed for all five changed/new production modules
with executable logic (`/private/tmp/empty-dock-complexity.log`). No new pushed
revision exists for remote Sonar analysis.

An earlier prerelease gate reached the event-order regression while its test was
red and failed that one test. The corrected worktree's `qc:prerelease` gate exited
0, including backend race tests, all 5,079 frontend tests, lint/typecheck, docs,
bindings, knip, and Trivy (`/private/tmp/empty-dock-prerelease-final.log`). The
formatter reported no fixes. Post-gate inspection found only the intended files;
`git diff --check` passed. The only subsequent edit records these results.
No new development server was started: the listener on port 9245 (PID 32425, beneath
Wails launcher PID 31812) already belonged to an existing shell before this work.

## Selected design: placement preview

The user selected option C. During a compatible drag, empty docks show subtle
edge rails. Hovering a rail reveals the destination panel footprint; leaving the
edge restores the rail. The preview remains pointer-transparent and the edge
hit area stays fixed, so it cannot take over the other dock's target or tab bar.

Geometry comes from the cluster-local group layout store. The existing group
initializer, renderer, and preview share size-default/clamping logic.
The preview reads that state without initializing or resizing a dock. A right
preview reserves the bottom dock's height only if visible tabs will remain after
the move and that dock is not maximized. Local metadata comes from the existing
drop hook's drag-enter callback;
external protected drags use destination geometry and a generic label. Native
transfer admission, source guards, and acknowledgement ordering remain owned by
the existing drop handler. There is no new provider or runtime dependency cycle.

Acceptance: compare preview dimensions with the resulting dock for both edges,
including remembered sizes and first-use utility defaults; check the final-tab
versus sibling-retained bottom offset; exercise fixed hit areas, hover/leave,
edge switching, and both themes in the rendered UI. Existing drag cancellation,
cluster rejection, guards, and external transfer tests remain required. Actual
native drops retain their existing unresolved validation requirement.

### Selected-design validation

| Outcome | Status | Evidence |
| --- | --- | --- |
| Remembered sizes and first-use utility sizes match the resulting dock without changing layout during hover | Passed | Five new geometry cases failed before implementation (`/private/tmp/dock-preview-red.log`). The focused suite now passes 28 files / 357 tests (`/private/tmp/dock-preview-focused-final.log`). |
| Right preview matches bottom occupancy, including a maximized sibling dock | Passed | The added maximized case first failed with an incorrect 600px offset (`/private/tmp/dock-preview-maximized-red.log`); the focused suite now passes and compares the preview offset with the resulting workspace offset. |
| Rendered preview matches actual destination bounds | Passed in browser | Playwright dragged the actual dock components right → bottom → right. Bottom preview and resulting panel both measured x=0, y=400, width=1440, height=600; right preview and panel both measured x=740, y=0, width=700, height=1000. Content remained present after each drop; targets and previews cleared. |
| Rails, preview styles, stable hit areas, switching edges, and leaving an edge | Passed in browser | Inspected light bottom and dark right previews (`/private/tmp/dock-preview-bottom-light.png`, `/private/tmp/dock-preview-right-dark.png`) and the dark rail. Hit-testing reached content through the preview and each edge through its own target. A protected incoming drag switched from right preview to bottom preview, then leaving the edge cleared the preview while both rails remained available. |
| Actual native destination drop | Blocked | After opening the Namespace `test` tab in the running Wails app, `dockApp.drag([762,54], [650,746])` returned `Computer Use server error -10005: noWindowsAvailable`. No successful native drop or manual result has been observed; cross-window native acceptance remains unverified. |

These browser checks used actual React dock components in an ephemeral fixture
with a fixed cluster identity. They do not exercise the Wails transfer handshake.
No production fixture was added. The local complexity check passed all seven
changed production files containing executable logic at the limit of 12
(`/private/tmp/dock-preview-complexity.log`). Sonar analysis of a pushed revision
has not been checked for this change.

The full frontend coverage task passed 528 files / 5,085 tests
(`/private/tmp/dock-preview-coverage-final.log`). Statement coverage in the
affected files: preview targets 97.61%, group renderer 93.47%, layout helpers
86.95%, provider 89.38%, shared drop target 96.34%, and drag admission/presence
hooks 100% (`/private/tmp/dock-preview-coverage-final/coverage-summary.json`).

The final prerelease gate exited 0 after removing the sizing constant's unused
export. It passed documentation, formatting, generated bindings, vet/staticcheck,
backend race tests, frontend lint/typecheck, all 5,085 frontend tests, knip, and
Trivy (`/private/tmp/dock-preview-prerelease-final.log`). Native drop verification
remains blocked as recorded above; this is not a full completion claim.
