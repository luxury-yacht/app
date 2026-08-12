# Application Lifecycle

Wails v3 application composition owns the native application, one named main
window, its persistent menu, service registration, and process-level hooks.
Backend domain code reaches native capabilities only through the `Desktop`
boundary.

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
desktop adapter; backend code must not rely on an implicit current window.
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

Requests received before window runtime readiness are coalesced and delivered
after readiness. Shutdown disables and discards queued focus requests so a late
launch cannot resurrect the window.

## Shutdown

The window-closing hook and application `ShouldQuit` call `PrepareQuit` while
the main window is still queryable. Persist window geometry there. Wails then
cancels the application context and calls `ServiceShutdown` for backend
teardown. Process shutdown also disables second-launch focus handling.

The refresh HTTP/SSE/WebSocket surface remains on the backend-owned loopback
server. Do not move it onto Wails' asset handler without revalidating streaming,
upgrade, cancellation, CORS, and Windows behavior.

## Starting points

- Composition and process hooks: `main.go`, `single_instance.go`
- Native adapter and named-window resolution: `desktop_adapter.go`
- Backend lifecycle: `backend/app_lifecycle.go`, `backend/app_runtime.go`
- Geometry validation: `backend/window_restore.go`
- Build identity: `build/config.yml`
