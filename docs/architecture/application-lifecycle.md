# Application Lifecycle

Owns process composition and startup, the native window registry, chrome and
menus, close/quit/shutdown, Factory Reset orchestration, and the backend
panel-workspace directory. Owner map and dependency directions:
[backend-services.md](backend-services.md). Renderer placement, handoffs, and
close sequences: [dockable-panels.md](../frontend/dockable-panels.md).

## Composition

- `main.go` holds only the embedded asset filesystem and `bootstrap.Run`.
  `internal/bootstrap` owns startup orchestration and Wails composition,
  `internal/appwindow` window forwarding, `internal/sentry` reporting setup.
- Only bootstrap imports both backend composition and the native window
  registry; the registry bridge must not depend on backend implementation types.
- The Wails application is injected into `backend.NewApplicationRuntime` and
  retained by `backend.DesktopShell`. Bootstrap calls the non-Wails
  `InitializeErrorReporting` before `application.Run`
  ([error reporting](error-reporting.md)).
- `internal/bootstrap/composition.go` registers named refresh streams after
  backend, update, and service construction and before service registration and
  window creation; `NewApplicationRuntime` never touches the stream registry.
- Register native hooks before `application.Run`. Behaviors owned by a service,
  callback, or frontend owner (startup, shutdown, second launch, menu labels,
  appearance, zoom, hidden start) must not gain a second Wails event
  subscription.

## Startup and readiness

- `DesktopService.ServiceStartup` runs synchronously before any native window
  and delegates to `backend.ApplicationLifecycle`. Returning an error aborts
  (Wails cancels the service context and shuts down started services); it must
  not access a window or emit events.
- It installs process-wide Kubernetes stderr capture and unhandled-error dedup
  first, so no client, watcher, or informer starts before its errors can be
  captured; then the cancellation signal, `WorkspaceCoordinator`'s single
  cluster-runtime intent consumer, and `ClusterRuntimeManager` lifecycle
  projection hooks. `NewApplicationRuntime` never replaces stderr or mutates the
  environment. The first selected refresh setup starts the heartbeat under the
  refresh runtime context.
- Before the application context or any runtime owner starts, the static-state
  cleaner deletes direct regular files in the config root matching the atomic
  writer's `.tmp-<digits>` name (no save can be active; a second launch starts no
  backend). Other files and directories are untouched; failures are only logged.
- Credential-wrapper invocations dispatch before app setup and keep their
  inherited environment.
- The updater temp root
  ([updates](../workflows/application-updates.md#staging-restart-and-recovery))
  is configured before Wails composition or any updater child process so Wails
  staging, helper logs, and children share it. Bootstrap passes it through
  `ApplicationRuntimeOptions`, so `UpdateCoordinator` is complete before
  `application.Run`.
- Each workspace's `events.Common.WindowRuntimeReady` listener calls
  `ApplicationLifecycle.WindowRuntimeReady(name, restoreGeometry)`. The first
  delivery (once per process) enables desktop operations, discovers
  kubeconfigs, restores the durable tab selection, and starts cluster
  connection in the background; connectivity never holds the native callback.
  Each workspace becomes visible independently; only the initial one restores
  saved geometry. New app windows' readiness waits for cluster hydration and
  coordinator subscriptions.
- A panel window's runtime-ready event only lets that webview bootstrap its
  descriptor (identity plus the group the directory moves into it); the panel
  stays hidden until its reconstructed group acknowledges readiness. A panel
  window that reloads is already live and acknowledges with no transfer. It
  never initializes or releases a workspace, restores workspace geometry, or
  counts toward last-workspace quit.
- `windowOptionsForPlatform`: macOS/Windows peers start hidden until runtime
  ready; Linux starts visible.
- A window that a workspace switch is restoring is the exception to both: it
  starts hidden on every platform, and its runtime-ready listener does not call
  `WindowRuntimeReady`, because the switch shows it once it has loaded and been
  placed. Hidden creation of an app window has not been run on Linux.

## Process multiplicity and focus

- Single-instance ID `app.luxury-yacht.desktop` must match `build/config.yml`.
  Wails owns the lock, IPC, second-process exit, and callback delivery; there is
  no app-owned launch queue.
- `OnSecondInstanceLaunch` may arrive before any webview is ready and starts no
  second backend. Via Wails window methods it only shows, unminimizes, and
  focuses the most recently focused live peer; its arguments, working directory,
  and data are untrusted and ignored.
- Peer `events.Common.WindowFocus` only updates the registry's recency order
  (second-launch focus, quit geometry, new-peer geometry); it never triggers
  refresh or cluster selection.

## Window identity and geometry

- Workspace windows are peers named monotonic `workspace-N`; none is
  privileged. `appwindow.Registry` owns creation, focus order, readiness, and
  close accounting. Panel window names and roles are process-local.
- The frontend reads its Wails window name before starting refresh work, and
  cluster workspace commands carry it. Foreground demand maps window name to
  cluster ID; cluster-tab ownership maps window name to that peer's selected
  kubeconfig set, so clusters shown in different peers are all Foreground.
  The governor's startup seed picks a default Foreground only while no window
  has reported; after a report it would be a second Foreground nothing clears.
- Process events are broadcasts; window-targeted menu events carry Wails sender
  identity and other peers filter them at the desktop-runtime boundary.
- Persist only logical `x`, `y`, `width`, `height`, `maximized`; never screen
  IDs or physical pixels. On startup validate against Wails logical work areas:
  negative coordinates are valid on a current monitor; clamp inaccessible or
  oversized geometry; center on the primary work area if the monitor is gone.
- A peer created after startup copies the most recently focused peer's live
  size and maximized state on that peer's screen, cascaded 24 logical pixels
  (reversed or clamped to stay in the work area). Creation-only: no ownership or
  per-window persistence. Docking from a panel-only cluster may create an app
  view with the most recent app window's geometry, or defaults if none remains.

## Window chrome and menus

- macOS keeps Wails' native frame, transparent full-size titlebar, traffic
  lights, and application menu. The global native menu is created before
  windows and only on macOS, so Linux cannot inherit it beside the app menu.
- Windows/Linux workspace and panel windows are frameless with no native menu;
  `WindowHeader` supplies the drag surface and window controls. Workspace
  `AppHeader` adds `AppMenuBar`, status indicators, favorites, and the command
  palette; panel renderers import the shared chrome directly so they never load
  workspace-only controls.
- Windows disables WebView2 non-client regions and composition hosting so
  pointer input reaches Wails' DOM resize-before-drag handler.
- Pinned Wails beta.17 hit-tests edges and invokes native resize on
  Windows/Linux without a CSS opt-in, but collapses eight regions into four
  axis cursors; the shell projects the matching directional cursor, including
  over descendant controls. Column drag cursors use a separate body class so
  Wails cannot restore an expired inline cursor.
- Transparent DOM edge surfaces (platform handle sizes, removed while
  maximized) stop native scrollbars from taking resize gestures.
- Zoom scales the body (including portals), never the root viewport, and
  compensates body height: Wails compares root client size with viewport mouse
  coordinates to exclude scrollbars, which breaks at 200% if the root scales.
- Linux draws a theme-aware inset outline at the header boundary (Wails removes
  GTK decorations and has no shadow option). Linux panel windows clear the
  framework's initial internal-name title. Known gap: pinned Wails GTK
  `setTitle` skips frameless windows, so configured Linux titles never reach
  the window manager until Wails is fixed.
- Maximize controls query native state on mount and after maximize/restore,
  plus a debounced resize sync for menu or window-manager changes.
- Native macOS and app-rendered menus share the typed `ApplicationMenuCommand`
  dispatcher (`DesktopShell.ExecuteApplicationMenuCommand`). Wails injects the
  caller into the service context and sender-less menu calls are rejected. Only
  native macOS menu callbacks and dialogs may use Wails' current window;
  app-rendered menu, lifecycle, and persistence calls name the window.
- The shell validates the sender through the registry and runs window-local
  commands there. Workspace commands from a panel (authenticated sender, typed
  workspace-command boundary) route to an app window showing the same cluster,
  creating one if needed. Renderer UI commands run locally; process and
  native-window commands use the backend dispatcher.
- Panel renderers keep Windows/Linux menu accelerators disabled until the
  panel's native ready acknowledgement.
- Each renderer's `ZoomContext` owns zoom. Windows/Linux shortcuts dispatch to
  the focused renderer; macOS accelerators target the authenticated calling
  workspace or panel and emit the zoom event.
- `DesktopShell.UpdateMenu` (no Wails event) rebuilds the persistent menu and
  resets the macOS menu after runtime-ready state changes such as sidebar or
  panel visibility. Windows/Linux use neutral labels.
- `AppearanceModeContext` subscribes to the dark-scheme `matchMedia` query and
  the `appearanceMode` preference after mount, applies system changes only while
  the preference is `system`, and unsubscribes on unmount.

## Frontend runtime boundary

- Native browser, clipboard, event, environment, and window calls go through
  `frontend/src/core/desktop-runtime`; `frontend/src/core/refresh/streaming`
  owns the Wails `JSONStream` boundary. No duplicate runtime adapters or
  compatibility services.
- Copy with `writeClipboardText`: the WebView refuses click-initiated browser
  clipboard writes, so `navigator.clipboard` fails from a button or menu but
  works from a shortcut. The `no-direct-clipboard-write` Biome plugin enforces it.
- Paste with `readClipboardText`: the WebView gates `navigator.clipboard`
  reads behind a "Paste" callout the user must click. The
  `no-direct-clipboard-read` Biome plugin enforces it.

## Cluster-owned panel workspaces

- One cluster workspace owns that cluster's panel tabs and native panel
  windows. Each app window's cluster tab is a view of it; one cluster may appear
  in several app windows
  ([tab UI](../frontend/tabs.md#shared-cluster-tabs-across-app-windows)).
  Navigation, namespace selection, and table filters are per view.
- A native panel window holds one same-cluster group with immutable `clusterId`
  and `groupId`; `sourceWindowName` names only a transfer's sender, never a
  parent.
- `internal/panelwindow.WorkspaceDirectory` is the authority for the shared
  panel collection and each tab's placement (docked in an app window, rendered
  in a panel window, or retained without a renderer). Tabs carry complete
  object identity and active view; the directory holds no object data, React
  state, drafts, or mutation state.
- Panel-lifetime state owners (such as the panel metrics buffer) register a
  removal handler and drop state when a panel leaves every window; moves and
  retained placements are not removals.
- Publications report only a renderer's own arrangement; they never open,
  close, claim, or move a panel. A renderer closes a panel with an explicit
  intent (`ClosePanelWorkspaceObject`), which removes it only if the directory
  still places it in that renderer and is not moving it. Whole-group Float and dock-back and single panel-tab
  moves record a pending move in the directory (`BeginGroupTransfer`); a
  cluster-view transfer records one for every docked panel the directory places
  in the source view (`BeginViewTransfer`). Publications and `Open` cannot
  change a pending move, and the owning transfer's terminal cancels it unless
  it committed. The registry commits placement only after the destination
  acknowledges reconstruction (`AcknowledgePanelTransfer`, or the cluster-view
  handoff, whose commit runs inside the selection mutation)
  ([renderer protocol](../frontend/dockable-panels.md#acknowledged-handoffs)).
- Opening another app view of a cluster uses the move's cluster-selection
  admission and seeded window factory without committing source removal.
- Runtime selection is the union of app views and panel references; panel and
  native-window references keep a cluster selected and connected with no app
  view. A panel renderer projects only its own cluster and never acquires
  unrelated app tabs.
- Backend removal uses the same directory disposal boundary and schedules native
  panel cleanup after the backend mutation, never reentering it synchronously.

Lock ordering:

- Never enter the selection queue while holding the shared workspace mutex.
- Panel opens and publications reserve cluster demand before waiting on the
  backend and revalidate it inside the directory commit; cluster removal
  invalidates reservations.
- Cluster transfers keep transaction serialization separate from the directory
  lock. Native close hooks can run synchronously, so release the transfer lock
  before closing an empty source or cancelled provisional target
  (`finishClusterTransferMutation`,
  `TestCancellingNewClusterTargetAllowsSynchronousCloseHooks`).

## Close, quit, and shutdown

Opening a named workspace closes the current windows and then loads the saved
ones. It is not a transaction: once the current windows start closing, nothing
is rolled back.

1. What can be restored is decided first. Saved clusters that are no longer
   available are dropped, and a workspace with nothing left is refused.
2. Every current app and panel renderer runs its close guards through the quit
   preflight. A denial or a cancelled request leaves everything as it was. Once
   every window approves, the registry replaces the collected preflight, so a
   late collection timeout cannot release the frozen windows, and ending a
   preflight checks and claims it in one hold of the quit mutex.
3. One selection claims every saved cluster, so a cluster both workspaces show
   stays connected. The claim does not change what the next launch opens.
4. The registry clears the panel directory at the revision it read after the
   windows approved. This is the last step that can refuse: the directory
   rejects it if anything changed since, a removed cluster included, and the
   claim on the saved clusters is then given up.
5. The saved windows are created hidden, as ordinary windows: each gets its
   cluster tabs and its panels in the live directory before it loads. They are
   created before the current windows close because Windows and Linux end the
   process the moment no window is left; macOS asks `ShouldQuit`, which refuses
   while a switch holds its preflight.
6. The current windows close. The registry detaches each one itself instead of
   going through the window's own close, because closing the last app view
   there means quitting.
7. The saved windows get a bounded time to load their views, then are shown and
   placed. An app window that has not loaded is shown as it is. A panel window
   that has not loaded is closed: it has no working close button, and it would
   keep every later save and switch waiting for it. Fullscreen is entered last and one window at a time: on macOS a
   window maximized during another's fullscreen transition is left part-way,
   and a fullscreen request made during a transition is dropped.
8. The preflight ends. What the closed windows held in the backend is released
   only now, because those releases can queue behind cluster connections the
   saved workspace started. The restart selection is written once, last.

Anything that fails after step 4 becomes a warning: a saved window that could
not be created or did not load its view, a previous window that did not close,
a window that did not return to fullscreen, a saved cluster that is
unavailable. The warnings go to one window of the new workspace in a single
`named-workspace:warnings` event, since the window that asked is closed. The
registry picks the window the user is most likely looking at (the last to enter
fullscreen, otherwise one not reopened minimized), preferring one whose
renderer has answered. The command returns an error only when closing a
previous window failed.

One case is not a warning. If no saved window can be created at all, closing
the current windows would leave the app with none, so they stay and the command
fails. The panel directory was cleared in step 4, so the registry puts back what
it cleared (`RestoreClearedWorkspace`): the current windows keep their docked
and floating panels, and what was recorded for those panels (their metrics
history). The owner of that state hears that panels closed only once a saved
window exists (`CloseClearedWorkspace`), and only for the panels the saved
workspace did not open again.

Because the saved windows are ordinary windows from step 5, the user can close
them all before the switch has finished. The switch then requests the quit that
closing a last window means, since a quit asked for while the preflight was held
was refused. File > New Window is refused while a switch runs: a new window
takes every selected cluster, and that selection is being replaced.

Saved geometry uses the same logical work-area rules as startup. A window is
saved with the bounds it returns to and with its maximized, fullscreen, and
minimized state, and both are applied when it reopens.

Saving a workspace asks every ready app and panel window for one reply: its
view, or the reason it has none. A failure reply ends the capture at once with
that reason, and so does a window that closes before answering; nothing is
written.

A window is ready only while its renderer has announced readiness since its
last page load:

- A renderer announces with `AcknowledgePanelWorkspaceReady` once the handlers
  that answer these requests are subscribed. An app window does so after its
  first kubeconfig load, a panel window after its transfer acknowledgement has
  returned. `useRendererReadiness` is the one caller for both.
- A runtime-ready event is a page load, and a hook on it clears the window's
  readiness, so a reloading window is not asked until it announces again.
- When the tree that owns the handlers unmounts (the crash screen), the
  renderer calls `WithdrawRendererReady`. Recovering in the same page announces
  again. A window's readiness calls are sent in the order it made them.
- A window that loses readiness after it was asked ends the request at once
  instead of at its deadline: a save fails, and a quit or switch preflight is
  cancelled and its windows released.

Save and switch only start when every app and panel window is ready and no
cluster view is moving between windows; a save checks the move again before it
writes. A window that cannot answer therefore blocks save and switch until it
is reloaded, recovered, or closed. The quit preflight asks the ready windows
and leaves the others out, since a renderer that cannot answer has no close
guard to run.

After a switch the clusters the new workspace holds become the selection the
next launch opens (`PersistRestartSelection`), including when the workspace is
made of floating panel windows alone. With nothing open, the previous selection
is kept.

Each saved workspace has a revision, assigned when it is saved. The dialogs
list name and revision, and replace, rename, delete, and open are refused when
the snapshot under that name is no longer the one listed. Snapshots saved
before revisions existed get one the first time they are listed.

| Close | Wails surface | Backend contract |
| --- | --- | --- |
| App window | Cancellable `events.Common.WindowClosing` starts a renderer preflight | Denial keeps it open. Releases only that view's cluster tabs and foreground demand; docked panel identities stay in the directory; floating panels stay live. Cancels the transfers it takes part in and declines every directory move addressed to it. |
| Cluster tab | `KubeconfigContext` preflight calls the registry's cluster-panel close transaction | Requests and acknowledgements carry cluster, window, and transaction identity; denial, cancellation, unavailable windows, or changed participants abort. |
| Panel window | Cancellable native hook sends a guard request to that renderer | Closes through the registry, removes its shared entries, releases the native and any unused shared-panel reference; failure keeps the source. |
| Application quit | `application.Options.ShouldQuit` asks every ready app and panel renderer to acknowledge one preflight | Unanimous approval requests Wails Quit; its `ShouldQuit` reentry runs the once-only persistence flush before teardown. Denial, timeout, delivery failure, or rejected handoff cancels; settlement reaches the original participants without holding the quit mutex. |

Renderer guard and flush sequences:
[dockable-panels close ordering](../frontend/dockable-panels.md#close-ordering).

- Only the final native-window close or an approved quit runs the once-only
  persistence flush and `ServiceShutdown`. Save the last app window's geometry
  before native destruction (quit uses the most recently focused live app
  window). The final app view's selection stays saved for restart while panel
  windows keep the process alive.
- An explicit cluster-tab close updates restart selection. Quit keeps every app
  view's selection and must not close views one at a time, since per-view close
  hooks relinquish selection
  (`internal/appwindow/application_quit_persistence_test.go` reloads two
  clusters from disk; only native events and Quit are stubbed).
- After quit acceptance and pre-quit persistence, Wails cancels the service
  context and calls `ServiceShutdown`, delegated to the lifecycle owner, in
  order: `UpdateCoordinator` stops
  ([updates](../workflows/application-updates.md#staging-restart-and-recovery));
  the cluster-runtime intent consumer stops before auth callbacks can publish
  more work; auth recovery stops; runtime operations shut down; the kubeconfig
  watcher stops; `RefreshCoordinator` unpublishes and tears down refresh/catalog
  producers ([refresh-system](refresh-system.md)). The application log stays
  available throughout; the application context is cleared last.

## Factory Reset

- `DataManagementCoordinator` sequences owner-shaped collaborators: quiesce
  installation registration; clear cluster/runtime state; `UpdateCoordinator`
  removes its validated dynamic artifacts
  ([updates](../workflows/application-updates.md#factory-reset)); reset
  favorites, UI state, preferences, and caches; retarget kubeconfig discovery
  under the workspace mutation boundary; clear Attention and shell ephemeral
  state; push defaults through all six settings-effect routes; clear Application
  Logs.
- Failures are aggregated. Success requires every owner to complete; only then
  does the frontend clear browser storage and reload. No native relaunch.
- `internal/appstate.Manifest` is the side-effect-free inventory of the static
  config and cache roots (settings, favorites, UI persistence, update-state
  paths). Only after every owner succeeds does live reset delete both roots,
  sweeping obsolete or unknown state and atomic-write temp files; a partial
  failure keeps recovery data. Offline reset deletes the same roots. Dynamic
  updater paths are not in the manifest.

## Development Inspector on macOS

- `DEV=true` macOS builds opt in to Wails' `private_mac_apis` so the Inspector
  command can open Web Inspector; release builds never add the tag. The public
  Safari-inspection setting alone does not restore Inspect Element.
- The shared window factory registers the setup for workspace,
  transferred-cluster, and panel windows. After `WindowRuntimeReady` it invokes
  Wails' developer-extras bridge on the main thread, takes the native handle
  inside that dispatch, and skips destroyed windows. It never affects backend
  readiness or publication order.
- Validate Inspect Element and the Inspector command in all three window kinds
  after the final rebuild and confirm release builds exclude the opt-in;
  browser previews prove nothing here.

## Starting points

- Wails boundary and lifecycle: `backend/desktop_service.go`,
  `backend/application_lifecycle.go`, `backend/desktop_shell_runtime.go`;
  framework: pinned Wails `pkg/application/{services,application}.go`
- Native shell and menus: `backend/desktop_shell.go`,
  `backend/desktop_shell_ui.go`, `backend/menu.go`,
  `backend/application_menu_commands.go`, `frontend/src/ui/layout/AppMenuBar.tsx`
- Registry and factory: `internal/appwindow/{registry,lifecycle,panel,bridge}.go`,
  `internal/panelwindow/workspace_command.go`
- Renderer close/quit and menu owners:
  `frontend/src/core/panel-windows/{useApplicationQuitPreflight.ts,WorkspacePanelLifecycle.tsx}`,
  `frontend/src/ui/shortcuts/components/{PanelWindowShortcuts.tsx,panelApplicationMenuCommands.ts}`,
  `frontend/src/ui/layout/workspaceApplicationMenuCommands.ts`,
  `frontend/src/core/contexts/{ZoomContext,AppearanceModeContext}.tsx`
- Startup reporting and panic capture: `internal/sentry/startup.go`
- Geometry: `backend/window_restore.go`; identity: `internal/updateidentity`
- Contract tests: `internal/panelwindow/workspace_test.go`;
  `internal/appwindow/{workspace,cluster_tab_transfer,cluster_panel_close,application_quit_persistence,lifecycle,registry}_test.go`;
  `backend/{application_lifecycle,workspace_cluster_transfer,workspace_panel_lifetime,desktop_service_panel_workspace,desktop_shell_ui}_test.go`;
  `cmd/project/wails_project_contract_test.go`
