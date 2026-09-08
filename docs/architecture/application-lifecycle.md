# Application Lifecycle

Wails v3 application composition owns the native application, a role-aware
registry of named workspace and panel windows, its persistent menu, service
registration, and process-level hooks.
The Wails application is injected directly during
`backend.NewApplicationRuntime` composition and retained by the concrete
`backend.DesktopShell` owner. `ApplicationRuntime` is a reference-only
composition result: it exposes component pointers for `internal/bootstrap` wiring but owns
no mutable state or methods, and internal owners never retain it. Production
registers only `backend.DesktopService` with Wails; that transport service
delegates commands, lifecycle, and HTTP behavior through owner-shaped
interfaces and never retains the composition root.
This preserves direct Wails native access without introducing a desktop adapter.
Native window, menu, dialog, clipboard, event, and screen work goes through that
concrete shell; there is no generic desktop adapter.

`main.go` contains only the embedded asset filesystem and the call to
`bootstrap.Run`. Startup orchestration and Wails composition live in
`internal/bootstrap`; window forwarding belongs to `internal/appwindow`, and
reporting setup belongs to `internal/sentry`. Tests live beside those owners.
Only bootstrap imports both the backend composition and native window registry;
the registry bridge must not depend on backend implementation types.

## Startup and readiness

`backend.DesktopService.ServiceStartup` runs synchronously before Wails creates
a native window and delegates to `backend.ApplicationLifecycle`. That owner
first installs process-wide Kubernetes stderr capture and unhandled-error
deduplication. Only then does it install the application cancellation signal,
start the single cluster-runtime intent consumer owned by
`WorkspaceCoordinator`, and initialize `ClusterRuntimeManager` lifecycle
projection hooks. This ordering prevents a client, watcher, or informer from
starting before its errors can be captured. `NewApplicationRuntime` itself does
not replace process stderr or mutate the process environment. The first selected
refresh setup starts the heartbeat under the refresh runtime context. Startup
may return an error to abort, but it must not access the window or emit runtime
events.

Interactive initialization starts from the first workspace window's
`WindowRuntimeReady` event. Process initialization is once-only; every workspace
still handles its own readiness event and becomes visible independently. Only
the initial workspace restores saved geometry. A panel window's runtime-ready
event marks only that webview ready to bootstrap its immutable descriptor; it
never initializes or releases a workspace, restores workspace geometry, or
participates in last-workspace quit accounting. Keep native hooks registered
before `application.Run`.

Before installing the application context or starting any runtime owner,
process startup asks the shared static-state cleaner to remove direct regular
files in the app config root that match the atomic writer's `.tmp-<digits>`
naming contract. At this boundary no app save can be active, and a subsequent
single-instance launch does not start another backend lifecycle. Canonical state,
nonmatching files, and directories are left untouched. Cleanup failures are
logged and do not prevent startup because these files are abandoned write
artifacts rather than recovery state.

Credential-wrapper invocations dispatch before app setup and retain their inherited
environment. Application-update staging requires a process-owned temp root; configure
it before Wails composition or updater child processes so Wails staging, helper logs,
and inherited children resolve the same root.
On Windows, create the root and marker with an explicit account owner
(`TOKEN_USER`) and a protected DACL granting inheritable full control only to
that user. Reused paths must have that exact user owner; paths owned by any
other account or group are rejected. Unix platforms continue to require the
current UID and owner-only permissions.
For an installable portable Linux target, derive the root's base from the
target's XDG data home rather than the system temporary directory; Wails'
Unix helper completes the swap with a same-filesystem rename. Package-managed
and unverified Linux targets continue to use the system temporary base.
`internal/bootstrap` passes that root through `ApplicationRuntimeOptions`, so the single
process update coordinator is fully initialized when `NewApplicationRuntime`
returns and before `application.Run`; only
the first runtime-ready window starts reconciliation, the initial silent check,
and the six-hour scheduler. Peer windows project and act on the same state.

## Service and runtime boundaries

The complete owner map and permitted dependency directions are maintained in
[backend-services.md](backend-services.md).

Production registers one `backend.DesktopService` at `/api/v2`. Its twelve
command interfaces match the target-owner table one-for-one; lifecycle and HTTP
are separate collaborators. Workspace commands are backed by
`WorkspaceCoordinator`, cluster-runtime commands by `ClusterRuntimeManager`,
HTTP and named stream handlers by `RefreshCoordinator`, and leaf commands by
their focused services. The service has no general backend interface or
implementation back-pointer.

Generated bindings are transport output, not a frontend permission surface:
application code imports DesktopService methods only through the explicit
allowlist in `frontend/src/core/backend-api`. `InitializeErrorReporting` remains
a package-level composition call before `application.Run` and is not a generated
frontend command.

Process-owned leaf state is split by responsibility: `PreferencesService` owns
`settings.json` and its coalesced lazy-load state; `FavoritesService` and
`UIStateStore` own their independent documents; `ClusterAttentionService` owns
live Attention rules and targets; `ErrorReportingService` owns reporter and
installation-registration state; `UpdateCoordinator` owns updater lifecycle;
`AppLogService` owns the process log buffer; and the injected
`nodemaintenance.Store` owns cluster-keyed drain state shared by resource
actions, refresh snapshots, and operation cleanup. None of these owners retains
the composition root.

`DesktopShell` owns the process-wide, unpersisted sidebar, diagnostics-panel,
and Application Logs panel visibility used by native macOS menu projection.
`UIStateStore` owns only persisted UI documents; it is not a second owner of
those live visibility flags.

Workspace and panel chrome is platform-adaptive. macOS retains Wails' native
frame and application menu with a transparent full-size titlebar. Windows and
Linux use frameless workspace and panel windows; `AppHeader` supplies the drag
surface and window controls, and workspace headers also render the application
menu bar. Windows leaves WebView2 non-client region support and composition
hosting disabled so pointer input reaches Wails' DOM resize-before-drag handler.
Composition installs Wails' global native menu only on macOS, so the Linux
constructor cannot inherit it alongside the
app-rendered menu. The native macOS menu and app-rendered desktop menu use the
same typed `ApplicationMenuCommand` dispatcher. Wails injects the calling window
into the desktop-service context; application-menu service calls without a sender
are rejected. Only native menu callbacks may resolve the current window. The
shell resolves and validates that sender's window identity through the native
window registry, keeps window-local commands in the sender, and routes workspace commands from a panel to an app window displaying the same
cluster, creating an app view when necessary. The panel renderer keeps its Windows/Linux application-menu accelerators
disabled until the panel's native ready acknowledgement.

The pinned beta.17 runtime supplies edge and corner hit testing and native
resize invocation for resizable Windows/Linux windows without a CSS resize
opt-in. Because that runtime collapses the eight hit regions to four axis cursors,
the custom-frame shell projects its result to the matching
directional cursor and keeps that cursor active over descendant controls.
Column drag cursors use a separate body class so Wails cannot restore an expired
inline column cursor after a window-edge interaction.
Transparent DOM edge surfaces keep native scrollbars from taking over a window
resize gesture. Their dimensions follow the runtime's platform handle sizes;
they are removed while the window is maximized. Wails remains responsible for
hit testing and invoking the native resize operation.
Application zoom scales the body, including portal content, while leaving the
root viewport unscaled. The body compensates its height for the zoom factor so
workspace and panel content still fit the window. Wails compares root client
dimensions with viewport mouse coordinates to exclude native scrollbars from
resize hit testing; scaling the root would break that comparison at 200% zoom.
Linux adds a theme-aware inset outline at the shared header boundary because
Wails removes GTK window decorations and exposes no Linux shadow option;
Windows and macOS retain their native decoration behavior. The pinned Wails
GTK3 and GTK4 `setTitle` implementations skip frameless windows, so configured
Linux workspace and panel titles do not currently reach the window manager;
this requires a Wails title-setter fix.
App-owned controls query the native maximise state on mount and after
maximise/restore actions; a debounced resize sync keeps the label and glyph
correct when a menu or window manager changes the state.

`PreferencesService.EnsureLoaded` coalesces concurrent normal callers. Startup
selection uses the same attempt through `EnsureLoadedForStartup`, which alone
may install a default snapshot after a load error. Normal errors install
nothing. A successful result is published only after the settings mutex is
released and both container-log policy limits and permission-fetch concurrency
have been pushed. Error reporting enables only for a successfully loaded
snapshot; startup-default provenance remains fail-closed.

Named refresh streams are registered explicitly in `internal/bootstrap/composition.go` after backend,
update, and service construction and before service registration/window
creation. `backend.NewApplicationRuntime` does not mutate the Wails stream
registry.

Native browser, clipboard, event, environment, and window calls go through
`frontend/src/core/desktop-runtime`. The refresh stream managers under
`frontend/src/core/refresh/streaming` separately own the Wails `JSONStream`
boundary. Do not add duplicate runtime adapters or compatibility services.

## Application and window event matrix

This matrix is the ownership contract for the v3 application shell. “None” in
the Wails event column is deliberate: those behaviors have an explicit service,
callback, or frontend owner and must not gain a second event subscription.

| Behavior | Owner and Wails v3 surface | Cancellable | Readiness and ordering | Identity, cleanup, and proof |
| --- | --- | --- | --- | --- |
| Process startup | `backend.DesktopService.ServiceStartup` delegates to the application-lifecycle collaborator | By returning an error | Runs synchronously before pending windows; UI operations and event emission remain gated | Process-scoped. Wails cancels the service context and shuts down already-started services if startup aborts. Repository contract: `backend/desktop_service.go`, `backend/application_lifecycle.go`; framework contract: `pkg/application/services.go`. |
| Interactive startup | Each workspace's `events.Common.WindowRuntimeReady` listener calls `backend.ApplicationLifecycle.WindowRuntimeReady(name, restoreGeometry)`; a panel listener only marks its descriptor bootstrappable | No | The first workspace delivery enables desktop operations, discovers kubeconfigs, restores the durable tab selection, and starts cluster connection work in the background. A panel stays hidden until its reconstructed group acknowledges readiness. Cluster connectivity never holds the native callback. | Workspace names are monotonic `workspace-N`; panel names and roles are process-local. Proof: `internal/appwindow/registry.go`, `internal/appwindow/panel.go`, `backend/application_lifecycle.go`, `backend/application_lifecycle_test.go`, and `internal/appwindow/lifecycle_test.go`. |
| Application updates | One `backend.UpdateCoordinator`, surfaced through the backend service and the process-wide `app-update` event | Checks/downloads are cancellable; restart becomes a quit handoff | First runtime-ready starts one scheduler. Automatic and manual checks never download; download and restart each require a separate user action. | State is process-scoped across all peers. Eligibility comes from the installed distribution; prepared and attempted helper state is durable. Proof: `backend/update_coordinator.go`, `backend/update_coordinator_config.go`, `backend/internal/appupdates/coordinator.go`, and `internal/updateidentity/eligibility.go`. |
| Subsequent process launch and focus | `application.SingleInstanceOptions.OnSecondInstanceLaunch` | No | May arrive before the webview is ready; it does not start a second backend lifecycle | Shows, restores when minimized, and focuses the most recently focused live peer; ignores launch arguments and additional data. Proof: `internal/bootstrap/composition.go`, `internal/appwindow/bridge.go`, `internal/appwindow/registry.go`, and `cmd/project/wails_project_contract_test.go`. |
| Ordinary focus changes | Peer `events.Common.WindowFocus` listener | No | Updates only the registry's most-recent ordering | Focus does not trigger refresh or cluster selection. It chooses the peer used by subsequent-launch focus and explicit application-quit geometry persistence. |
| System appearance changes | Browser `matchMedia('(prefers-color-scheme: dark)')`; persisted preference changes use the frontend settings event bus | No | The React subscription exists only after the runtime mounts; system changes apply only while the preference is `system` | Process preference, not cluster data. The React effect removes the media-query and settings-event subscriptions on unmount. Proof: `frontend/src/core/contexts/AppearanceModeContext.tsx`. |
| Dynamic native-menu labels | `backend.DesktopShell.UpdateMenu`; no Wails application event | No | Runs only after runtime-ready state changes such as sidebar or panel visibility | Rebuilds the persistent menu and resets the macOS application menu. Windows and Linux use neutral labels in the app-rendered menu and do not install the native menu on frameless windows. Proof: `backend/desktop_shell_ui.go`, `frontend/src/ui/layout/AppMenuBar.tsx`, and `backend/desktop_shell_ui_test.go`. |
| App-window close | `events.Common.WindowClosing` starts a renderer preflight | Yes | Guard and flush this app window’s docked panels, retain their shared entries, then release its cluster views and foreground demand. Floating panels remain live. | A denied preflight leaves the window open. Runtime selection includes both app views and shared panel references. See the cluster workspace contract below. |
| Cluster-tab close | `KubeconfigContext` preflight calls the registry's cluster-panel close transaction | Yes | Guard and flush local docked panels; for the final app view, collect every native panel's guard approval before closing any, then release the shared collection and remove the tab. A remaining app view keeps the shared panels. | Requests and acknowledgements carry cluster/window/transaction identity. Denial, cancellation, unavailable windows, or changed participants abort. App-window close and acknowledged tab movement retain their separate behavior. |
| Panel-window close | A cancellable native hook routes a guard request to that panel renderer | Yes | Guard the group, then close through the registry and remove its shared entries. Release the native reference and any unused shared-panel reference. | Failure leaves the native source available. See `PanelWindowShortcuts`, `Registry`, and the shared panel workspace contract below. |
| Application quit | `application.Options.ShouldQuit` asks every ready app and panel renderer to acknowledge one preflight | Yes | Guards freeze input before publication; approved renderers stay frozen through process shutdown. Unanimous approval requests Wails Quit, whose ShouldQuit reentry performs the once-only persistence flush before service teardown. Individual view-close hooks must not remove selected clusters during this handoff. | Denial, timeout, delivery failure, or rejected quit handoff cancels the preflight. Settlement reaches the original participant set, including earlier approvals, without holding the quit mutex. The most recently focused live app window supplies geometry. See `useApplicationQuitPreflight`, `WorkspacePanelLifecycle`, `PanelWindowShortcuts`, and `Registry`. |
| Service cancellation and shutdown | Wails cancels the service context, then calls `backend.DesktopService.ServiceShutdown`, which delegates to the lifecycle owner | No | Occurs after quit is accepted and after pre-quit persistence | Process-scoped teardown stops auth recovery, runtime operations, kubeconfig watching, and refresh before clearing the application context. Proof: `backend/desktop_service.go`, `backend/application_lifecycle.go`, and the pinned framework's `pkg/application/application.go`. |
| Initial hidden-window workaround | `windowOptionsForPlatform`; no event | No | macOS/Windows peers start hidden until runtime ready; Linux retains its existing visible-start contract | Applies equally to every `workspace-N` peer. Option mapping proof: `internal/appwindow/registry.go` and `internal/appwindow/registry_test.go`. |
| Platform window chrome and menus | `windowOptionsForPlatform`, `panelWindowOptionsForPlatform`, renderer application-menu command owners, and `backend.DesktopShell.ExecuteApplicationMenuCommand` | No | The native menu is created before windows for macOS. Windows/Linux windows are frameless and render controls in `AppHeader`; workspace windows additionally render `AppMenuBar`. The panel renderer keeps its Windows/Linux application-menu accelerators disabled until the panel's native ready acknowledgement. | macOS owns the application menu and native traffic lights. Windows/Linux install no native window menu. Renderer-owned UI commands execute locally, panel-to-workspace commands carry authenticated Wails sender identity through the typed workspace-command boundary, and process/native-window commands use the backend dispatcher. Proof: `internal/appwindow/registry.go`, `internal/panelwindow/workspace_command.go`, `backend/application_menu_commands.go`, `frontend/src/ui/layout/workspaceApplicationMenuCommands.ts`, `frontend/src/ui/shortcuts/components/panelApplicationMenuCommands.ts`, and their focused tests. |
| Window-local zoom accelerators | Native macOS menu accelerators and frontend Windows/Linux shortcuts both reach the renderer-local zoom owner | No | The frontend zoom context remains the action owner in each renderer | Windows/Linux dispatch directly to the focused renderer. Native macOS menu callbacks target the authenticated calling workspace or panel and emit the matching zoom event. Proof: `backend/menu.go`, `backend/application_menu_commands.go`, `frontend/src/ui/shortcuts/components/PanelWindowShortcuts.tsx`, and `frontend/src/core/contexts/ZoomContext.tsx`. |

## Cluster-owned panel workspaces

One cluster workspace owns its panel tabs and native panel windows. Each app
window hosts cluster tabs that reference these shared workspaces. The same
cluster may appear in several app windows. Navigation, namespace selection, and
table filters remain local to each app view.

A native panel window contains one same-cluster object-panel group. Its immutable
identity is `clusterId` and `groupId`; `sourceWindowName` identifies the sender
of a particular transfer. It is not a permanent parent relationship. Every panel
header must display its cluster name, falling back to cluster ID. Duplicate
names must include cluster ID so the label stays unambiguous.

`internal/panelwindow.WorkspaceDirectory` is the authority for the shared panel
collection and each tab’s physical placement: docked in an app window, rendered
in a panel window, or retained without a renderer. Each tab carries complete
object identity (`clusterId`, `group`, `version`, `kind`, `namespace`, `name`)
and its active view. The directory contains no object data, React state, drafts,
or mutation state. Opening an existing object focuses its existing placement.
The cluster tab’s context menu can open another app view, move the current view
to a new window, or close the clicked view. Opening another view preserves the
source and shared panel placements, using the same cluster selection admission
and seeded window factory as a move without committing source removal.

Float, dock-back, individual panel-tab moves, and cluster-tab moves must preserve
the source until the destination acknowledges reconstruction. Source guards and
publication flush precede transfer acceptance. A destination is provisional
until the registry commits; provisional publication cannot steal source tabs.
Window freezes block their renderer; cluster-close freezes block only that cluster,
leaving application menus and global navigation usable. Failure and
timeout remove provisional target content and preserve source placement.

Moving a cluster tab carries its docked panel groups and local view state.
An existing destination cluster tab is reused: its navigation wins, and incoming
panels append to its groups. A new app window is seeded with the transferred
cluster before its renderer starts. Floating panel windows retain their positions
and cluster identity. Closing the source app window does not close them.

Native renderers serialize live snapshots. App renderers serialize their docked
groups. A successful publication and an individual tab-transfer commit share one
directory mutation. Whole-group and cluster-view transfers validate their complete
source sets before changing locations. Readiness events for newly created app
windows wait for cluster hydration and coordinator subscriptions.

Registry/backend coordination must not enter the selection queue with the shared
workspace mutex held. Panel opens and publications reserve cluster demand before
waiting for the backend, then validate that admission again inside the directory
commit. Cluster removal invalidates these reservations. Cluster transfers keep
transaction serialization separate from the shared directory lock. Native close hooks can run synchronously; finish cluster-transfer
mutation and release its lock before closing an empty source or a cancelled
provisional target. `finishClusterTransferMutation` and
`TestCancellingNewClusterTargetAllowsSynchronousCloseHooks` preserve this ordering.

Closing an app window retains its docked panel identities for reopening; it releases
only that view’s runtime demand. Shared panel and native-window references retain
cluster runtime selection even when no app window displays the cluster. A panel
renderer projects only its own cluster and must never acquire unrelated app tabs.
Docking from a panel-only cluster can create a new app view for that cluster,
using the most recent app window's geometry (or app defaults when none remains).
Backend removal uses the same directory disposal boundary and schedules native
panel cleanup after the backend mutation, without synchronously reentering it.
Retained-panel notifications are coalesced while claims run; successful claims
mount even when a later claim fails. Close and transfer flushes retry the latest
failed publication once, and still reject if that retry fails.
Closing a native panel disposes its own local state and directory entries.
Explicit quit preflights all renderers before closing any of them.

Regression coverage belongs in `internal/panelwindow/workspace_test.go`,
`internal/appwindow/workspace_test.go`,
`internal/appwindow/cluster_tab_transfer_test.go`,
`internal/appwindow/cluster_panel_close_test.go`,
`internal/appwindow/application_quit_persistence_test.go`,
`backend/workspace_cluster_transfer_test.go`, `backend/workspace_panel_lifetime_test.go`,
and the frontend panel-window coordinator suites. The authenticated desktop
boundary is covered by `backend/desktop_service_panel_workspace_test.go`.

## Window identity and restoration

Every workspace window is a peer named `workspace-N`; no name is privileged.
Creation, focus ordering, readiness, and close accounting belong to
`appwindow.Registry`. Native macOS menu actions and dialogs use Wails' current
window. App-rendered Windows/Linux menu actions, lifecycle operations, and
persistence operations resolve an explicit window name.

The frontend reads its Wails window name before starting refresh work. Cluster
workspace commands include that identity. Backend foreground demand is a map
from window name to cluster ID, while cluster-tab ownership is a map from
window name to that peer's complete selected kubeconfig set. Consequently,
clusters displayed in different peers all remain Foreground, and a shared
cluster remains connected while any app view or panel reference retains it. Process events
remain broadcasts; window-targeted menu events include Wails sender identity
and other peers filter them at the desktop-runtime boundary.

Window persistence keeps logical `x`, `y`, `width`, `height`, and `maximized`
values. On startup, validate that rectangle against Wails v3 logical screen work
areas. Negative coordinates are valid when a current monitor occupies them.
Clamp inaccessible or oversized geometry, and center on the primary work area
when the saved monitor is gone. Do not persist screen IDs or physical-pixel
coordinates.

After startup, a new peer copies the live size and maximized state of the most
recently focused peer. It targets that peer's current screen and cascades its
screen-relative position by 24 logical pixels, reversing or clamping the offset
when necessary to keep the new peer inside the work area. This is creation-only
geometry inheritance; it does not make the source peer a lifecycle owner or
persist per-window geometry.

## Process multiplicity

Production composition enables Wails v3 single-instance handling with
`app.luxury-yacht.desktop`, which must match `build/config.yml`. A subsequent
launch may only request that the most recently focused live peer be shown,
restored if minimized, and focused. Treat its arguments, working directory, and additional
data as untrusted and ignore them.

Wails owns the instance lock, inter-process notification, second-process exit,
and callback delivery. The callback uses Wails window methods directly and does
not maintain an application-owned launch queue.

## Shutdown

Every app-window close preflights and flushes its local docked panels. Closing
retains those panels and releases only the app view’s foreground demand and
cluster tabs. Floating panels remain independent. Runtime selection is the union
of app views and panel references. Only the final native-window close or an
approved application quit proceeds through the once-only persistence flush and
`ServiceShutdown`. The final app view’s selection remains available for restart
even when panel windows keep the process alive. Save the last app window's
geometry before native destruction, and retain the saved selection as its runtime
references drain. An explicit cluster-tab close still updates restart selection.
Explicit Quit retains the full process
selection from every app view for restart. It does not close views one at a time:
those close hooks intentionally relinquish each view’s cluster selection.
`application_quit_persistence_test.go` exercises the real workspace and persisted
preferences with two different clusters, then reloads them from disk; only native
event delivery and process Quit are replaced by test callbacks.

The request/response refresh surface is published atomically through
`DesktopService.ServeHTTP` at the same-origin Wails service route `/api/v2`.
Resource doorbells and container logs use named Wails JSON streams registered by
application composition. Backend teardown unpublishes the service handler and
stops the current per-cluster stream generation before releasing its producers.

`ServiceShutdown` also stops the update coordinator, cancels an in-flight
check or download, and removes prepared staging that has not entered a helper
attempt. An explicit update restart first persists the attempt handoff, then
invokes Wails restart so the detached helper owns replacement and relaunch.
The next process reconciles the recorded source/target version and helper log;
it reports success, restored-source failure, or a superseding manual install.

Leaf shutdown ordering is explicit: the update owner stops first; the typed
cluster-runtime intent consumer stops before auth callbacks can publish more
work; auth recovery stops; runtime operations shut down; the kubeconfig watcher
stops; and `RefreshCoordinator` unpublishes and tears down refresh/catalog
producers. The application log remains available through those steps and the
application context is cleared last.

## Factory Reset

`DataManagementCoordinator` orchestrates the live reset through owner-shaped
collaborators. It quiesces installation registration, clears cluster/runtime
state, asks the update owner to validate and remove its dynamic artifacts,
resets favorites, UI state, preferences and caches, retargets kubeconfig
discovery under the workspace mutation boundary, clears Attention and shell
ephemeral state, pushes defaults through all six settings-effect routes, and
clears Application Logs. Independent failures are aggregated. The command
returns success only after every owner completes; only then does the frontend
clear browser storage and reload. A reset does not promise a native relaunch.

`internal/appstate.Manifest` is the shared, side-effect-free inventory for the
static config and cache roots, including settings, favorites, UI persistence,
and update-state paths. Live reset first delegates deletion and in-memory
cleanup to the corresponding owners, then removes both app-owned roots as a
final sweep only after every owner succeeds. This also removes obsolete or
unrecognized app state, including abandoned atomic-write temp files, without
discarding recovery data during a partial failure. Offline reset removes those
same static roots.
Updater staging, attempt, cleanup, protected, and helper-log paths are dynamic:
only `UpdateCoordinator` resolves and validates them under the configured state
path and temp root. Resolving a missing artifact must not create directories.

## Starting points

- Asset embedding and process entry point: `main.go`
- Composition, service/stream registration, and process setup: `internal/bootstrap`
- Deferred native registry binding and window command forwarding: `internal/appwindow/bridge.go`
- Startup reporting and panic capture: `internal/sentry/startup.go`
- Wails command/lifecycle/HTTP boundary: `backend/desktop_service.go`
- Peer creation and close accounting: `internal/appwindow/registry.go`, `internal/appwindow/lifecycle.go`
- Native shell operations and process-wide ephemeral visibility:
  `backend/desktop_shell.go`, `backend/desktop_shell_ui.go`, `backend/menu.go`
- Backend lifecycle: `backend/application_lifecycle.go`, `backend/desktop_shell_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build and update identity: `build/config.yml`, `internal/updateidentity`
- Update composition and durable handoff: `backend/update_coordinator_config.go`, `backend/internal/appupdates`, `internal/updatestate`, `internal/updatetemp`
