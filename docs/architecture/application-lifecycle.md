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
