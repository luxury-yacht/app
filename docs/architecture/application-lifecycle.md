# Application Lifecycle

Wails v3 application composition owns the native application, one named main
window, its persistent menu, service registration, and process-level hooks.
The Wails application is injected directly into `backend.App`, following the v3
service-injection model. Backend native operations use its window, menu, dialog,
clipboard, event, and screen managers directly.

## Startup and readiness

`backend.App.ServiceStartup` runs synchronously before Wails creates a native
window. It may initialize process services and return an error to abort startup,
but it must not access the window or emit runtime events.

Interactive initialization starts from the main window's
`WindowRuntimeReady` event. That transition is once-only. It restores window
geometry, shows the window, starts selected clusters and background watchers,
and enables desktop event delivery. Keep native hooks registered before
`application.Run`.

## Application and window event matrix

This matrix is the ownership contract for the v3 application shell. “None” in
the Wails event column is deliberate: those behaviors have an explicit service,
callback, or frontend owner and must not gain a second event subscription.

| Behavior | Owner and Wails v3 surface | Cancellable | Readiness and ordering | Identity, cleanup, and proof |
| --- | --- | --- | --- | --- |
| Process startup | `backend.App.ServiceStartup` through the registered Wails service | By returning an error | Runs synchronously before pending windows; UI operations and event emission remain gated | Process-scoped. Wails cancels the service context and shuts down already-started services if startup aborts. Repository contract: `backend/app_lifecycle.go:28`; framework contract: `pkg/application/services.go:87-121`. |
| Interactive startup | Main window `events.Common.WindowRuntimeReady` listener calls `backend.App.WindowRuntimeReady` | No | Registered before `App.Run`; one successful transition enables desktop operations, then restores/shows the window and starts interactive work | Window name is `main`; repeated delivery is ignored by `markRuntimeReady`. Proof: `main.go:145-154`, `backend/app_runtime_test.go:29-46`, and `backend/app_lifecycle_test.go:321-354`. |
| Subsequent process launch and focus | `application.SingleInstanceOptions.OnSecondInstanceLaunch` | No | May arrive before the webview is ready; the callback uses only the already-created named window and does not start a second backend lifecycle | Shows, restores when minimized, and focuses `main`; ignores arguments, working directory, and additional data. Packaged timing is a release-matrix check. Proof: `main.go:118-132` and `cmd/project/wails_project_contract_test.go:208-220`. |
| Ordinary focus changes | Wails/default webview behavior; no application listener | No | No backend work depends on focus | No cleanup. A focus event must not become a refresh or cluster-selection trigger. Repository absence is checked when the migration ledger is reconciled. |
| System appearance changes | Browser `matchMedia('(prefers-color-scheme: dark)')`; persisted preference changes use the backend `appearance-mode-changed` custom event | No | Frontend subscription exists only after the runtime mounts; system changes apply only while the preference is `system` | Process preference, not cluster data. The React effect removes the media-query and Wails subscriptions on unmount. Proof: `frontend/src/core/contexts/AppearanceModeContext.tsx:67-109`. |
| Dynamic menu labels | `backend.App.UpdateMenu`; no Wails application event | No | Runs only after runtime-ready state changes such as sidebar or panel visibility | Mutates the one persistent menu. Linux updates it in place, macOS resets the application menu, and Windows reinstalls it on `main`. Proof: `backend/app_ui.go:55-86` and `backend/app_ui_test.go:106-168`; native behavior remains in the Phase 6 OS matrix. |
| Main-window close | `events.Common.WindowClosing` cancellable hook calls `PrepareQuit` | Yes | Hook is registered before `App.Run`; persistence runs while the named window is still queryable | `PrepareQuit` is process-idempotent and waits for selection persistence before reading geometry. Proof: `main.go:150-154` and `backend/app_lifecycle_test.go:356-433`. |
| Application quit | `application.Options.ShouldQuit` calls the same `PrepareQuit` owner | Yes | Covers menu, shortcut, programmatic, and OS quit requests without creating a second persistence path | Shares the same `sync.Once` as window close. Proof: `main.go:102-117` and `backend/app_lifecycle.go:219-237`; packaged quit paths remain in Phase 6. |
| Service cancellation and shutdown | Wails cancels the service context, then calls `backend.App.ServiceShutdown` | No | Occurs after quit is accepted and after pre-quit persistence | Process-scoped teardown stops auth recovery, runtime operations, kubeconfig watching, and refresh before clearing the application context. Proof: `backend/app_lifecycle.go:239-271` and the pinned framework ordering at `pkg/application/application.go:645-815`. |
| Initial hidden-window workaround | `mainWindowOptionsForPlatform`; no event | No | macOS/Windows start hidden until runtime-ready restoration; Linux starts visible because its native window/menu construction differs | Applies only to `main`. Option mapping proof: `main.go:67-96` and `main_test.go:117-164`; rendered platform behavior remains in Phase 6. |
| Native menu ownership workarounds | `backend.App.UpdateMenu`; no event | No | The persistent menu is created and attached before the window, then refreshed through the platform owner | Linux retains the same menu, macOS owns the application menu, Windows owns the named-window menu. Proof: `main.go:142-145` and `backend/app_ui.go:55-86`; native callbacks remain in Phase 6. |
| Windows zoom accelerators | Menu construction uses explicit labels instead of native accelerators on Windows; no event | No | The frontend zoom custom events remain the action owner | Process menu targeting `main`; no shutdown work. Proof: `backend/menu.go:129-147`; Windows-native exercise remains in Phase 6. |

## Window identity and restoration

The only supported window is named `main`. Resolve it by name through the
injected application's window manager; backend code must not rely on an implicit
current window.
**New Window** is intentionally absent until a native multi-window contract is
implemented.

Window persistence keeps logical `x`, `y`, `width`, `height`, and `maximized`
values. On startup, validate that rectangle against Wails v3 logical screen work
areas. Negative coordinates are valid when a current monitor occupies them.
Clamp inaccessible or oversized geometry, and center on the primary work area
when the saved monitor is gone. Do not persist screen IDs or physical-pixel
coordinates.

## Process multiplicity

Production composition enables Wails v3 single-instance handling with
`app.luxury-yacht.desktop`, which must match `build/config.yml`. A subsequent
launch may only request that the named main window be shown, restored if
minimized, and focused. Treat its arguments, working directory, and additional
data as untrusted and ignore them.

Wails owns the instance lock, inter-process notification, second-process exit,
and callback delivery. The callback uses Wails window methods directly and does
not maintain an application-owned launch queue.

## Shutdown

The window-closing hook and application `ShouldQuit` call `PrepareQuit` while
the main window is still queryable. Persist window geometry there. Wails then
cancels the application context and calls `ServiceShutdown` for backend
teardown.

The request/response refresh surface is published atomically at the same-origin
Wails service route `/api/v2`. Resource doorbells and container logs use named
Wails JSON streams. Backend teardown unpublishes the service handler and stops
the current per-cluster stream generation before releasing its producers.

## Starting points

- Composition and process hooks: `main.go`
- Native operations and named-window resolution: `backend/app_runtime.go`
- Backend lifecycle: `backend/app_lifecycle.go`, `backend/app_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build identity: `build/config.yml`
