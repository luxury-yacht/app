# Application Lifecycle

Wails v3 application composition owns the native application, a role-aware
registry of named workspace and panel windows, its persistent menu, service
registration, and process-level hooks.
The Wails application is injected directly during
`backend.NewApplicationRuntime` composition and retained by the concrete
`backend.DesktopShell` owner. `ApplicationRuntime` is a reference-only
composition result: it exposes component pointers for `main.go` wiring but owns
no mutable state or methods, and internal owners never retain it. Production
registers only `backend.DesktopService` with Wails; that transport service
delegates commands, lifecycle, and HTTP behavior through owner-shaped
interfaces and never retains the composition root.
This preserves direct Wails native access without introducing a desktop adapter.
Native window, menu, dialog, clipboard, event, and screen work goes through that
concrete shell; there is no generic desktop adapter.

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

Application-update staging requires a process-owned temp root. Configure that
root before exec-wrapper dispatch, Wails composition, or any child process so
Wails staging, helper logs, and inherited children resolve the same root.
On Windows, create the root and marker with an explicit account owner
(`TOKEN_USER`) and a protected DACL granting inheritable full control only to
that user. Reused paths must have that exact user owner; paths owned by any
other account or group are rejected. Unix platforms continue to require the
current UID and owner-only permissions.
For an installable portable Linux target, derive the root's base from the
target's XDG data home rather than the system temporary directory; Wails'
Unix helper completes the swap with a same-filesystem rename. Package-managed
and unverified Linux targets continue to use the system temporary base.
`main.go` passes that root through `ApplicationRuntimeOptions`, so the single
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
and Application Logs panel visibility used by native menu projection.
`UIStateStore` owns only persisted UI documents; it is not a second owner of
those live visibility flags.

`PreferencesService.EnsureLoaded` coalesces concurrent normal callers. Startup
selection uses the same attempt through `EnsureLoadedForStartup`, which alone
may install a default snapshot after a load error. Normal errors install
nothing. A successful result is published only after the settings mutex is
released and both container-log policy limits and permission-fetch concurrency
have been pushed. Error reporting enables only for a successfully loaded
snapshot; startup-default provenance remains fail-closed.

Named refresh streams are registered explicitly in `main.go` after backend,
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
| Subsequent process launch and focus | `application.SingleInstanceOptions.OnSecondInstanceLaunch` | No | May arrive before the webview is ready; it does not start a second backend lifecycle | Shows, restores when minimized, and focuses the most recently focused live peer; ignores launch arguments and additional data. Proof: `main.go`, `internal/appwindow/registry.go`, and `cmd/project/wails_project_contract_test.go`. |
| Ordinary focus changes | Peer `events.Common.WindowFocus` listener | No | Updates only the registry's most-recent ordering | Focus does not trigger refresh or cluster selection. It chooses the peer used by subsequent-launch focus and explicit application-quit geometry persistence. |
| System appearance changes | Browser `matchMedia('(prefers-color-scheme: dark)')`; persisted preference changes use the frontend settings event bus | No | The React subscription exists only after the runtime mounts; system changes apply only while the preference is `system` | Process preference, not cluster data. The React effect removes the media-query and settings-event subscriptions on unmount. Proof: `frontend/src/core/contexts/AppearanceModeContext.tsx`. |
| Dynamic menu labels | `backend.DesktopShell.UpdateMenu`; no Wails application event | No | Runs only after runtime-ready state changes such as sidebar or panel visibility | Mutates the persistent menu. Linux updates it in place, macOS resets the application menu, and Windows reinstalls it on workspace peers; native panel windows suppress Windows menu installation. Proof: `backend/desktop_shell_ui.go`, `internal/appwindow/registry.go`, and `backend/desktop_shell_ui_test.go`. |
| Workspace-window close | Every workspace's `events.Common.WindowClosing` cancellable hook starts an asynchronous owner preflight | Yes | The owner guards docked panels and every owned child before the registry authorizes a second close. Children close before foreground demand and cluster-tab ownership are released. Shared cluster teardown occurs only when no remaining workspace owns the selection. | The owner relationship is immutable. A denial or timeout leaves owner and children live. The last workspace keeps its tab union for next-start persistence. Proof: `internal/appwindow/registry.go`, `internal/appwindow/panel.go`, `frontend/src/core/panel-windows/WorkspacePanelCoordinator.tsx`, and `internal/appwindow/lifecycle_test.go`. |
| Panel-window close | A panel's cancellable native close hook routes a guard request to its child renderer and immutable owner | Yes | The child guards every tab and preserves its state until a registry-authorized second close succeeds. The owner removes the group only from the closed event. Failed opening transfers publish the same terminal owner outcome even when the native target has already disappeared. | Panel close never releases a workspace or cluster-tab owner. A denial, failed native close, or timeout leaves the panel and owner directory unchanged. Proof: `internal/appwindow/registry.go`, `internal/appwindow/panel.go`, `internal/appwindow/panel_transfer.go`, and `frontend/src/ui/shortcuts/components/PanelWindowShortcuts.tsx`. |
| Application quit | `application.Options.ShouldQuit` asks every ready workspace to acknowledge one two-phase preflight | Yes | No workspace closes until all ready workspaces have guarded their docked and child panels. Only unanimous approval authorizes normal owner close transactions and the existing once-only persistence flush. | A denial, stale response, or timeout cancels the transaction without partially closing another owner. The most recently focused live workspace supplies geometry. Proof: `main.go`, `internal/appwindow/registry.go`, `frontend/src/core/panel-windows/WorkspacePanelCoordinator.tsx`, and `backend/application_lifecycle.go`. |
| Service cancellation and shutdown | Wails cancels the service context, then calls `backend.DesktopService.ServiceShutdown`, which delegates to the lifecycle owner | No | Occurs after quit is accepted and after pre-quit persistence | Process-scoped teardown stops auth recovery, runtime operations, kubeconfig watching, and refresh before clearing the application context. Proof: `backend/desktop_service.go`, `backend/application_lifecycle.go`, and the pinned framework's `pkg/application/application.go`. |
| Initial hidden-window workaround | `windowOptionsForPlatform`; no event | No | macOS/Windows peers start hidden until runtime ready; Linux starts visible because its native window/menu construction differs | Applies equally to every `workspace-N` peer. Option mapping proof: `internal/appwindow/registry.go` and `internal/appwindow/registry_test.go`. |
| Native menu ownership workarounds | `backend.DesktopShell.UpdateMenu`; no event | No | The persistent menu is created before workspace windows and refreshed through the platform owner. Windows workspace peers use Wails' solid window background so the native menu remains opaque; macOS and Linux retain the transparent workspace background. Native panel windows keep OS frame controls but suppress menu installation on Windows and hide Wails' inherited GTK menu widget on Linux before they are shown. | Linux workspaces retain the same menu, macOS owns the application menu, and Windows installs the menu on workspace peers. Native panel windows on Windows and Linux expose neither that menu nor native title text. Proof: `main.go`, `internal/appwindow/registry.go`, `internal/appwindow/panel_chrome_linux.go`, `internal/appwindow/registry_test.go`, and `backend/desktop_shell_ui.go`. |
| Windows zoom accelerators | Menu construction uses explicit labels instead of native accelerators on Windows; no event | No | The frontend zoom custom events remain the action owner | Commands target the current peer and carry Wails sender identity; no shutdown work. Proof: `backend/menu.go` and `frontend/src/core/desktop-runtime/index.ts`. |

## Native panel-window ownership and transfers

A native panel window represents one object-panel tab group. Its registry role
contains an immutable `ownerWindowName`, `clusterId`, and `groupId`. The owner is
an application lifecycle relationship rather than an OS-modal parent: the child
can focus, resize, minimize, and restore independently, but closing the owner or
the owning cluster tab closes the child after the shared guards allow it.
Switching the owner's active cluster has no lifecycle effect on the child.

Panel descriptors and snapshots are process-local and versioned. Every object
tab carries complete identity: `clusterId`, `group`, `version`, `kind`,
`namespace`, and `name`. The registry validates that every tab's cluster equals
the immutable group cluster. It routes snapshots and acknowledgements but never
owns object data, React state, drafts, or mutation state.

Each default-Floating open receives an isolated one-tab source group. The child
is the single live-snapshot producer and serializes its writes. The owner commits
child tab additions, non-final removals, and active-view changes only from those
snapshots; a final-tab or whole-window close commits from the registry's closed
event.

Float and dock-back are acknowledged transfers. The source remains mounted
until the target has reconstructed the full group and acknowledged readiness.
Only then does the owner commit the new location and unmount the source. Failed,
stale, or timed-out transfers fail closed and keep the source live. Native panel
geometry is used only for initial placement and is not persisted or restored
after relaunch.

Dragging a tab between workspace and panel windows, between panel windows, or
out of a workspace or multi-tab panel window to a new panel window is a separate
one-tab transaction. Dragging the only tab out of a native panel window does not
start a transaction and leaves the existing window unchanged. For accepted
transfers, the registry validates immutable owner and cluster identity, reserves
one source tab per pending transfer, and commits only after the destination
publishes the exact tab or acknowledges native-window readiness. The source
removes only that tab after commit and closes only when it becomes empty. Failure
and timeout events roll back provisional target state while retaining the source.
A tear-off uses the configured floating dimensions and selects/constrains against
the monitor containing the drag pointer.

Native close hooks are synchronous while YAML and mutation guards cross
webviews. The first close is therefore cancelled and converted into an
asynchronous transaction. Guarded state includes unsaved YAML, a YAML save, and
other in-flight mutations. The same protocol protects float, dock, tab close,
panel titlebar close, cluster-tab close, owner close, and application quit.
Timeouts fail closed.

## Window identity and restoration

Every workspace window is a peer named `workspace-N`; no name is privileged.
Creation, focus ordering, readiness, and close accounting belong to
`appwindow.Registry`. Native menu actions and dialogs use Wails' current
window, while lifecycle and persistence operations resolve an explicit name.

The frontend reads its Wails window name before starting refresh work. Cluster
workspace commands include that identity. Backend foreground demand is a map
from window name to cluster ID, while cluster-tab ownership is a map from
window name to that peer's complete selected kubeconfig set. Consequently,
clusters displayed in different peers all remain Foreground, and a shared
cluster remains connected until its final tab owner closes it. Process events
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

Every workspace close first completes its asynchronous panel preflight and
closes its owned children. The authorized workspace close then releases its
window-scoped foreground demand and tab ownership, reconciling the shared
cluster runtime against the remaining workspaces' union. Panel roles never
enter that accounting. The zero-workspace transition and application
`ShouldQuit` share the once-only quit flush, preserve the last workspace's
selection for restart, persist geometry from a named live/closing workspace,
and then allow Wails to cancel the application context and call
`ServiceShutdown`.

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

- Composition, service/stream registration, and process hooks: `main.go`
- Wails command/lifecycle/HTTP boundary: `backend/desktop_service.go`
- Peer creation and close accounting: `internal/appwindow/registry.go`, `internal/appwindow/lifecycle.go`
- Native shell operations and process-wide ephemeral visibility:
  `backend/desktop_shell.go`, `backend/desktop_shell_ui.go`, `backend/menu.go`
- Backend lifecycle: `backend/application_lifecycle.go`, `backend/desktop_shell_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build and update identity: `build/config.yml`, `internal/updateidentity`
- Update composition and durable handoff: `backend/update_coordinator_config.go`, `backend/internal/appupdates`, `internal/updatestate`, `internal/updatetemp`
