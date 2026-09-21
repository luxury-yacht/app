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

Read-only line counts against `HEAD` for the 14 changed/new production TS, TSX,
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
