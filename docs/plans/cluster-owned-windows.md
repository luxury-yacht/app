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
- [ ] Native multiwindow interaction validation remains outstanding. The Wails
  browser preview cannot service native runtime calls (404), and native app
  automation timed out. Renderer/unit and registry tests do not substitute for
  exercising drag, focus, close, and quit across actual native windows.

Keep this temporary record until native interaction validation is performed;
the ownership contract already lives in the durable documents linked above.
