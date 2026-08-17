# Application Lifecycle

Wails v3 application composition owns the native application, a registry of
named peer workspace windows, its persistent menu, service registration, and
process-level hooks.
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
installs the
application cancellation signal, starts the single cluster-runtime intent
consumer owned by `WorkspaceCoordinator`, and initializes
`ClusterRuntimeManager` lifecycle projection hooks. The first selected refresh
setup starts the heartbeat under the refresh runtime context. Startup may return
an error to abort, but it must not access the window or emit runtime events.

Interactive initialization starts from the first workspace window's
`WindowRuntimeReady` event. Process initialization is once-only; every peer
still handles its own readiness event and becomes visible independently. Only
the initial window restores saved geometry. Keep native hooks registered before
`application.Run`.

Application-update staging requires a process-owned temp root. Configure that
root before exec-wrapper dispatch, Wails composition, or any child process so
Wails staging, helper logs, and inherited children resolve the same root. The
single process update coordinator is composed before `application.Run`; only
the first runtime-ready window starts reconciliation, the initial silent check,
and the six-hour scheduler. Peer windows project and act on the same state.

## Service and runtime boundaries

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
and `AppLogService` owns the process log buffer. None of these owners retains
the composition root.

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
| Process startup | `backend.DesktopService.ServiceStartup` delegates to the application-lifecycle collaborator | By returning an error | Runs synchronously before pending windows; UI operations and event emission remain gated | Process-scoped. Wails cancels the service context and shuts down already-started services if startup aborts. Repository contract: `backend/desktop_service.go`, `backend/app_lifecycle.go`; framework contract: `pkg/application/services.go`. |
| Interactive startup | Every peer's `events.Common.WindowRuntimeReady` listener calls `backend.ApplicationLifecycle.WindowRuntimeReady(name, restoreGeometry)` | No | Registered when the window is created; the first delivery enables desktop operations and starts interactive process work, while every delivery shows that peer | Names are monotonic `workspace-N`; only process startup is ignored after `markRuntimeReady`. Proof: `internal/appwindow/registry.go`, `backend/app_lifecycle.go`, and `internal/appwindow/lifecycle_test.go`. |
| Application updates | One `backend.UpdateCoordinator`, surfaced through the backend service and the process-wide `app-update` event | Checks/downloads are cancellable; restart becomes a quit handoff | First runtime-ready starts one scheduler. Automatic and manual checks never download; download and restart each require a separate user action. | State is process-scoped across all peers. Eligibility comes from the installed distribution; prepared and attempted helper state is durable. Proof: `backend/update_coordinator.go`, `backend/app_updates_config.go`, `backend/internal/appupdates/coordinator.go`, and `internal/updateidentity/eligibility.go`. |
| Subsequent process launch and focus | `application.SingleInstanceOptions.OnSecondInstanceLaunch` | No | May arrive before the webview is ready; it does not start a second backend lifecycle | Shows, restores when minimized, and focuses the most recently focused live peer; ignores launch arguments and additional data. Proof: `main.go`, `internal/appwindow/registry.go`, and `cmd/project/wails_project_contract_test.go`. |
| Ordinary focus changes | Peer `events.Common.WindowFocus` listener | No | Updates only the registry's most-recent ordering | Focus does not trigger refresh or cluster selection. It chooses the peer used by subsequent-launch focus and explicit application-quit geometry persistence. |
| System appearance changes | Browser `matchMedia('(prefers-color-scheme: dark)')`; persisted preference changes use the backend `appearance-mode-changed` custom event | No | Frontend subscription exists only after the runtime mounts; system changes apply only while the preference is `system` | Process preference, not cluster data. The React effect removes the media-query and Wails subscriptions on unmount. Proof: `frontend/src/core/contexts/AppearanceModeContext.tsx:67-109`. |
| Dynamic menu labels | `backend.DesktopShell.UpdateMenu`; no Wails application event | No | Runs only after runtime-ready state changes such as sidebar or panel visibility | Mutates the persistent menu. Linux updates it in place, macOS resets the application menu, and Windows reinstalls it on every peer. Proof: `backend/app_ui.go` and `backend/app_ui_test.go`. |
| Peer-window close | Every peer's `events.Common.WindowClosing` cancellable hook decrements the workspace-window lifecycle | Yes | Non-last closes release that window's foreground demand and cluster-tab ownership; shared cluster teardown occurs only when no remaining peer owns the selection. Zero remaining windows enter the process quit flush while the closing peer remains queryable | There is no privileged close hook or main window. The last peer keeps its tab union for next-start persistence; a cancelled last-close restores the peer to the registry. Proof: `internal/appwindow/registry.go`, `backend/cluster_workspace.go`, `backend/cluster_workspace_test.go`, and `internal/appwindow/lifecycle_test.go`. |
| Application quit | `application.Options.ShouldQuit` asks the peer registry to prepare application quit | Yes | Covers menu, shortcut, programmatic, and OS quit requests without creating a second persistence path | The most recently focused live peer supplies geometry. The backend flush shares the same `sync.Once` as last-window close. Proof: `main.go`, `internal/appwindow/registry.go`, and `backend/app_lifecycle.go`. |
| Service cancellation and shutdown | Wails cancels the service context, then calls `backend.DesktopService.ServiceShutdown`, which delegates to the lifecycle owner | No | Occurs after quit is accepted and after pre-quit persistence | Process-scoped teardown stops auth recovery, runtime operations, kubeconfig watching, and refresh before clearing the application context. Proof: `backend/desktop_service.go`, `backend/app_lifecycle.go`, and the pinned framework's `pkg/application/application.go`. |
| Initial hidden-window workaround | `windowOptionsForPlatform`; no event | No | macOS/Windows peers start hidden until runtime ready; Linux starts visible because its native window/menu construction differs | Applies equally to every `workspace-N` peer. Option mapping proof: `internal/appwindow/registry.go` and `internal/appwindow/registry_test.go`. |
| Native menu ownership workarounds | `backend.DesktopShell.UpdateMenu`; no event | No | The persistent menu is created and attached before the window, then refreshed through the platform owner | Linux retains the same menu, macOS owns the application menu, Windows installs the menu on every peer. Proof: `main.go`, `internal/appwindow/registry.go`, and `backend/app_ui.go`. |
| Windows zoom accelerators | Menu construction uses explicit labels instead of native accelerators on Windows; no event | No | The frontend zoom custom events remain the action owner | Commands target the current peer and carry Wails sender identity; no shutdown work. Proof: `backend/menu.go` and `frontend/src/core/desktop-runtime/index.ts`. |

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

Every window-closing hook first removes that peer from explicit lifecycle
accounting. Non-last closes release their window-scoped foreground demand and
tab ownership, reconciling the shared cluster runtime against the remaining
windows' union. The zero-remaining transition and application `ShouldQuit`
share the once-only quit flush, preserve the last peer's selection for restart,
persist geometry from a named live/closing peer, and then allow Wails to cancel
the application context and call `ServiceShutdown`.

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

## Starting points

- Composition, service/stream registration, and process hooks: `main.go`
- Wails command/lifecycle/HTTP boundary: `backend/desktop_service.go`
- Peer creation and close accounting: `internal/appwindow/registry.go`, `internal/appwindow/lifecycle.go`
- Native shell operations and process-wide ephemeral visibility:
  `backend/desktop_shell.go`, `backend/app_ui.go`, `backend/menu.go`
- Backend lifecycle: `backend/app_lifecycle.go`, `backend/app_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build and update identity: `build/config.yml`, `internal/updateidentity`
- Update composition and durable handoff: `backend/app_updates_config.go`, `backend/internal/appupdates`, `internal/updatestate`, `internal/updatetemp`
