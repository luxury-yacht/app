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
  immutable descriptor; the panel stays hidden until its reconstructed group
  acknowledges readiness. It never initializes or releases a workspace,
  restores workspace geometry, or counts toward last-workspace quit.
- `windowOptionsForPlatform`: macOS/Windows peers start hidden until runtime
  ready; Linux starts visible.

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
  the settings event bus after mount, applies system changes only while the
  preference is `system`, and unsubscribes on unmount.

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
- A successful publication and an individual tab-transfer commit share one
  directory mutation. Whole-group and cluster-view transfers validate complete
  source sets before moving anything. The registry commits placement only after
  the destination acknowledges reconstruction
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

| Close | Wails surface | Backend contract |
| --- | --- | --- |
| App window | Cancellable `events.Common.WindowClosing` starts a renderer preflight | Denial keeps it open. Releases only that view's cluster tabs and foreground demand; docked panel identities stay in the directory; floating panels stay live. |
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
