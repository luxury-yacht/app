# Application Lifecycle

Wails v3 application composition owns the native application, a registry of
named peer workspace windows, its persistent menu, service registration, and
process-level hooks.
The Wails application is injected directly into `backend.App`, following the v3
service-injection model. Backend native operations use its window, menu, dialog,
clipboard, event, and screen managers directly.

## Startup and readiness

`backend.App.ServiceStartup` runs synchronously before Wails creates a native
window. It may initialize process services and return an error to abort startup,
but it must not access the window or emit runtime events.

Interactive initialization starts from the first workspace window's
`WindowRuntimeReady` event. Process initialization is once-only; every peer
still handles its own readiness event and becomes visible independently. Only
the initial window restores saved geometry. Keep native hooks registered before
`application.Run`.

## Service and runtime boundaries

Production registers one `backend.App` Wails service. Generated bindings are
transport output, not a frontend permission surface: application code imports
backend methods only through the explicit allowlist in
`frontend/src/core/backend-api`. Adding a generated method does not make it an
approved frontend dependency. Any service split belongs to the
[deferred service-decomposition track](../plans/deferred/wails-v3-follow-up-tracks.md#service-decomposition).

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
| Process startup | `backend.App.ServiceStartup` through the registered Wails service | By returning an error | Runs synchronously before pending windows; UI operations and event emission remain gated | Process-scoped. Wails cancels the service context and shuts down already-started services if startup aborts. Repository contract: `backend/app_lifecycle.go`; framework contract: `pkg/application/services.go`. |
| Interactive startup | Every peer's `events.Common.WindowRuntimeReady` listener calls `backend.App.WindowRuntimeReady(name, restoreGeometry)` | No | Registered when the window is created; the first delivery enables desktop operations and starts interactive process work, while every delivery shows that peer | Names are monotonic `workspace-N`; only process startup is ignored after `markRuntimeReady`. Proof: `internal/appwindow/registry.go`, `backend/app_lifecycle.go`, and `internal/appwindow/lifecycle_test.go`. |
| Subsequent process launch and focus | `application.SingleInstanceOptions.OnSecondInstanceLaunch` | No | May arrive before the webview is ready; it does not start a second backend lifecycle | Shows, restores when minimized, and focuses the most recently focused live peer; ignores launch arguments and additional data. Proof: `main.go`, `internal/appwindow/registry.go`, and `cmd/project/wails_project_contract_test.go`. |
| Ordinary focus changes | Peer `events.Common.WindowFocus` listener | No | Updates only the registry's most-recent ordering | Focus does not trigger refresh or cluster selection. It chooses the peer used by subsequent-launch focus and explicit application-quit geometry persistence. |
| System appearance changes | Browser `matchMedia('(prefers-color-scheme: dark)')`; persisted preference changes use the backend `appearance-mode-changed` custom event | No | Frontend subscription exists only after the runtime mounts; system changes apply only while the preference is `system` | Process preference, not cluster data. The React effect removes the media-query and Wails subscriptions on unmount. Proof: `frontend/src/core/contexts/AppearanceModeContext.tsx:67-109`. |
| Dynamic menu labels | `backend.App.UpdateMenu`; no Wails application event | No | Runs only after runtime-ready state changes such as sidebar or panel visibility | Mutates the persistent menu. Linux updates it in place, macOS resets the application menu, and Windows reinstalls it on every peer. Proof: `backend/app_ui.go` and `backend/app_ui_test.go`. |
| Peer-window close | Every peer's `events.Common.WindowClosing` cancellable hook decrements the workspace-window lifecycle | Yes | Non-last closes release that window's foreground demand and cluster-tab ownership; shared cluster teardown occurs only when no remaining peer owns the selection. Zero remaining windows enter the process quit flush while the closing peer remains queryable | There is no privileged close hook or main window. The last peer keeps its tab union for next-start persistence; a cancelled last-close restores the peer to the registry. Proof: `internal/appwindow/registry.go`, `backend/cluster_workspace.go`, `backend/cluster_workspace_test.go`, and `internal/appwindow/lifecycle_test.go`. |
| Application quit | `application.Options.ShouldQuit` asks the peer registry to prepare application quit | Yes | Covers menu, shortcut, programmatic, and OS quit requests without creating a second persistence path | The most recently focused live peer supplies geometry. The backend flush shares the same `sync.Once` as last-window close. Proof: `main.go`, `internal/appwindow/registry.go`, and `backend/app_lifecycle.go`. |
| Service cancellation and shutdown | Wails cancels the service context, then calls `backend.App.ServiceShutdown` | No | Occurs after quit is accepted and after pre-quit persistence | Process-scoped teardown stops auth recovery, runtime operations, kubeconfig watching, and refresh before clearing the application context. Proof: `backend/app_lifecycle.go` and the pinned framework's `pkg/application/application.go`. |
| Initial hidden-window workaround | `windowOptionsForPlatform`; no event | No | macOS/Windows peers start hidden until runtime ready; Linux starts visible because its native window/menu construction differs | Applies equally to every `workspace-N` peer. Option mapping proof: `internal/appwindow/registry.go` and `internal/appwindow/registry_test.go`. |
| Native menu ownership workarounds | `backend.App.UpdateMenu`; no event | No | The persistent menu is created and attached before the window, then refreshed through the platform owner | Linux retains the same menu, macOS owns the application menu, Windows installs the menu on every peer. Proof: `main.go`, `internal/appwindow/registry.go`, and `backend/app_ui.go`. |
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

The request/response refresh surface is published atomically at the same-origin
Wails service route `/api/v2`. Resource doorbells and container logs use named
Wails JSON streams. Backend teardown unpublishes the service handler and stops
the current per-cluster stream generation before releasing its producers.

## Starting points

- Composition and process hooks: `main.go`
- Peer creation and close accounting: `internal/appwindow/registry.go`, `internal/appwindow/lifecycle.go`
- Native operations and named-window resolution: `backend/app_runtime.go`
- Backend lifecycle: `backend/app_lifecycle.go`, `backend/app_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build identity: `build/config.yml`
