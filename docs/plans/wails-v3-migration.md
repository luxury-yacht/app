# Wails v3 Migration Plan

Status: implementation active; core v3-only cutover implemented, beta.8 native
refresh-stream migration and Phase 6 platform validation remain
Created: 2026-08-11
Last updated: 2026-08-12

## Implementation status

The branch now has the core Wails v3 cutover in place: beta.8 application and
service composition, the paired beta.7 frontend runtime, generated v3 bindings,
direct backend application injection, one frontend runtime adapter, one named
main window, persistent native menus, screen-aware
geometry restoration, framework-provided single-instance handling,
GTK4/WebKitGTK 6.0-only Linux support, and Taskfile-based v3 builds. **New
Window** is absent. The
repository prerelease gate regenerates interface bindings in isolation and
rejects drift. The Wails Taskfile owns development, builds, packaging, quality
checks, tests, cleanup, Storybook, and release publication; Mage has been
removed.

Phase 5 decisions for this migration are explicit:

| Track | Decision for this branch | Preserved contract |
| --- | --- | --- |
| Service decomposition | Planned follow-up | Keep one registered `App` service and the explicit frontend allowlist; do not add duplicate compatibility services. |
| Native multi-window | Planned follow-up | Keep **New Window**, `Cmd/Ctrl+N`, and process-spawn code absent until the window/workspace ownership contract below is implemented. |
| V3 updater | Planned follow-up | Keep the existing notification-only GitHub release check and release-page link; do not add install/restart behavior without the signing and rollback design below. |
| System tray | Planned follow-up | Keep the current close/quit lifecycle; do not introduce close-to-tray or a second action registry. |

Local macOS build and rendered app-shell validation are complete. Windows amd64
and arm64 GUI binaries also cross-compile and carry the target PE architecture;
native Windows execution and NSIS packaging still require a Windows release
host. The remaining cutover work is the Phase 6 release matrix: native Windows
and Linux smoke tests, the full packaged second-launch matrix, physical
multi-monitor/DPI checks, upgrade-over-existing-settings validation, and
installer/signature inspection. The detailed checklist below remains the
acceptance specification; the status paragraphs on each phase distinguish
implemented work from validation that still needs a release host or CI.

## Objective

Replace Wails v2 with Wails v3 on this branch while preserving current
backend/frontend contracts, app-shell behavior, persisted user data, and release
artifacts on macOS, Windows, and Linux. The first runnable v3 milestone is a
single-window application with the current process-spawning **New Window**
option removed, but its ownership boundaries must support a deliberate move to
native multi-window behavior. A completed migration contains no active v2
module, CLI, runtime, generated bindings, build configuration, tests,
documentation instructions, or compatibility path.

This is a real framework port rather than a dependency-only update. The Wails
team describes the same boundary changes in the official
[v2-to-v3 migration guide](https://v3.wails.io/migration/v2-to-v3/) and
[beta announcement](https://v3.wails.io/blog/wails-v3-beta/): explicit
application/window objects, services, manager-based runtime calls, regenerated
frontend bindings, and a visible Taskfile-based build system.

## Initial decisions

- Start with an integration spike against an exact Wails v3 beta, not
  `@latest`. On 2026-08-12,
  `curl -fsSL https://proxy.golang.org/github.com/wailsapp/wails/v3/@v/list | sort -V | tail -n 20`
  ended at `v3.0.0-beta.8`; re-run this check and review intervening release
  notes immediately before changing dependencies.
- Pin the frontend runtime version carried by the selected Wails source rather
  than assuming its suffix matches the Go module or accepting a template's
  `latest`. The `v3.0.0-beta.8` source manifest vendors
  `@wailsio/runtime@3.0.0-beta.7`
  (`internal/runtime/desktop/@wailsio/runtime/package.json:1-4`); re-read that
  manifest if the selected Wails beta changes.
- Accept the Wails v3 beta risk for this branch. Do not wait for an RC or GA and
  do not preserve v2 as a release fallback. Wails currently calls v3 a beta
  with a stable desktop API and advises thorough deployment testing in its
  [beta announcement](https://v3.wails.io/blog/wails-v3-beta/) and
  [status page](https://v3.wails.io/status/); the validation gates below are the
  mitigation for that accepted risk.
- Keep `backend.App` as one Wails service for the first runnable port, then use
  the service-decomposition track in Phase 5 to decide its final v3 shape and
  execute the split if promoted. The v2 baseline had 178 exported methods
  (`git show HEAD:frontend/wailsjs/go/backend/App.js | rg -c '^export function '`
  reports `178`); the v3 service generates 179 because `WindowRuntimeReady` is now
  an explicit lifecycle boundary.
  Do not change transport and service ownership in the same red/green step.
- Inject Wails v3's `*application.App` directly into `backend.App`, as documented
  for v3 services. Keep native manager calls in the small set of backend files
  that own menus, dialogs, window lifecycle, events, clipboard, and screens; do
  not duplicate Wails types behind a parallel backend adapter. Keep one frontend
  desktop-runtime adapter so `@wailsio/runtime` imports remain centralized.
- Remove **New Window** during the core port. Delete the process-spawning
  implementation (`backend/menu.go:41-55`), File-menu item, `Cmd/Ctrl+N`
  accelerator, tests, and documentation references; do not leave a disabled or
  placeholder command. Reintroduce the option only through the Phase 5 native
  v3 multi-window track after process, Kubernetes client, persistence, refresh,
  and teardown ownership are defined and tested.
- Make the pinned v3 CLI's generated `build/config.yml` and Taskfiles the product
  metadata and native-build source of truth. The beta.8 generated build assets
  contain no replacement project `wails.json`
  (`find internal/commands/build_assets -name wails.json` returns no file), and
  the NSIS task does not request one
  (`internal/commands/build_assets/windows/Taskfile.yml:118-135`). Delete the v2
  file after all repository consumers move. Keep the root Wails Taskfile as the
  repository-facing command layer, with ordinary Go helper commands for
  cross-platform or release logic that should not be embedded in YAML.
- Replace the loopback refresh transport with beta.8's framework-owned
  transports. Mount the non-streaming snapshot, manual-job, diagnostics, and
  metrics HTTP mux at a same-origin Wails service route. Register the resource
  and container-log protocols with `App.HandleStream`, and use the paired
  frontend runtime's `Stream`/`JSONStream` API. The framework models each
  `StreamConn` after a WebSocket, provides ordered receive and blocking or
  non-blocking backpressure (`pkg/application/stream.go:158-179` and
  `223-274`), and owns the desktop held-poll versus server WebSocket transport
  behind the same handler (`pkg/application/stream.go:164-167`). Delete the
  loopback listener, random base-URL binding/cache/retry path, CORS wrapper, raw
  browser `WebSocket`, and `EventSource`; do not retain them as fallbacks. The
  asset server's WebSocket rejection remains irrelevant because these streams
  use the dedicated framework endpoint rather than a service route.
- Build one persistent native-menu model before the main window starts. Refresh
  it through platform-specific ownership: mutate then `Menu.Update()` in place
  on GTK4 Linux, reset the application menu on macOS, and reinstall it on the
  named window on Windows. Do not rebuild and attempt to reattach a new Linux
  menu after window construction. In beta.8, Linux consumes the native menu in
  `webview_window_linux.go:338-356`, its later setter only changes stored fields
  at `webview_window_linux.go:304-311`, its application-menu platform setter is
  empty at `application_linux.go:110-114`, and `menu_linux.go:23-44` rerenders
  the existing native menu during `Menu.Update()`. macOS attaches an application
  menu in `application_darwin.go:303-312`; Windows stores the app-level menu in
  `application_windows.go:138-146` but attaches a menu to an existing window in
  `webview_window_windows.go:115-123`.
- Treat this branch as a one-way v3 cutover. V2 may be run only to record the
  pre-migration baseline before implementation starts. Git history is the only
  rollback boundary: do not keep dual runtime code, build modes, dependency
  pins, generated bindings, tests, or CI jobs.
- Use Wails v3's default GTK4 + WebKitGTK 6.0 backend as the only Linux target.
  Do not build, package, test, auto-detect, or document a `-tags gtk3` fallback.
  This deliberately drops distributions that only provide the legacy stack,
  including Ubuntu 22.04 LTS and Debian 12; the
  [installation guide](https://v3.wails.io/quick-start/installation/)
  currently sets the default-stack floor at Ubuntu 24.04 or Debian 13. Recheck
  the pinned beta's requirements before implementation and update the product's
  supported-distro documentation as part of the cutover.

## Scope model

### Required target-design outcomes

- Make application, process, service, and window ownership explicit. Use named
  window references resolved through the injected application's window manager;
  do not embed an implicit "current window" assumption in backend domain code.
- Produce a target service map for all 179 currently bound methods as the first
  deliverable of the deferred service-decomposition track. The core v3 cutover
  intentionally registers one `App` service; no method moves until its
  long-term owner and affected frontend facade are approved.
- Leave one coherent v3-only build architecture. Required Taskfile, CI,
  packaging, metadata, and generated-binding cleanup is migration work, not
  unrelated cleanup.
- Keep one framework-owned refresh API: same-origin Wails service routes for
  request/response operations and named Wails Streams for resource and
  container-log traffic. Preserve snapshot, manual-job, stream, readiness,
  cancellation, correlation-ID, multi-cluster routing, replay/reset,
  backpressure, and teardown behavior while deleting listener, base-URL, CORS,
  raw WebSocket, and SSE ownership from the application.
- Decide process multiplicity explicitly. With **New Window** removed, either
  enable v3 single-instance handling with a defined second-launch contract or
  document why independently launched processes remain supported.
- Restore windows through the v3 screen manager. Validate saved logical geometry
  against current work areas, preserve valid negative monitor coordinates, and
  recover visibly when the saved monitor or DPI arrangement no longer exists.
  Continue persisting the existing X/Y/width/height/maximized fields; screen
  information validates restoration and does not replace stored geometry.
- Produce an application/window event matrix covering event owner, platform,
  synchronous cancellation, runtime-readiness requirement, window identity,
  payload, ordering, cleanup, and the v2 callback/workaround it replaces.
- Preserve cluster-scoped data, complete Kubernetes object identity, refresh and
  permission behavior, persisted settings keys, and release artifact names
  unless a separately approved phase changes a contract with migration tests.

Core capability references are [Services](https://v3.wails.io/features/bindings/services/),
[Single Instance](https://v3.wails.io/guides/single-instance/),
[Screen Information](https://v3.wails.io/features/screens/info/), and
[Improved Events](https://v3.wails.io/whats-new/#improved-events).

### Planned v3 follow-on tracks

The following tracks are part of this plan. Their design and decision gates are
required; implementation becomes required when a track is promoted for this
branch before final validation:

- Decompose the broad `backend.App` binding surface into lifecycle-aware domain
  services using the v3 service model.
- Reintroduce **New Window** with native named windows only after process-scoped
  and window-scoped state ownership is defined and its complete workflow passes.
- Evaluate replacing the current release-notification flow with the v3 updater,
  including download verification, signing, packaging, restart, and UI behavior.
- Evaluate a system tray using the same action/menu sources and an explicit
  close, hide, last-window, and quit contract on each desktop platform.

Official references for these tracks are [Services](https://v3.wails.io/features/bindings/services/),
[Multiple Windows](https://v3.wails.io/features/windows/multiple/), the
[self-update tutorial](https://v3.wails.io/tutorials/04-self-update-a-wails-app/),
and [System Tray Menus](https://v3.wails.io/features/menus/systray/).

### Separate product initiatives (non-goals for this plan)

- Detachable tabs or shared cross-window React state beyond the native-window
  workspace contract selected in Phase 5.
- Reworking Kubernetes refresh, cluster lifecycle, permission, or object
  identity semantics beyond the lifecycle adaptation required by v3.
- Mobile targets or server builds.
- Legacy GTK3/WebKit2GTK 4.x builds and Linux distributions that cannot provide
  the pinned Wails v3 release's GTK4/WebKitGTK 6.0 runtime dependencies.
- New package formats such as MSIX; the current Windows release contract remains
  NSIS, so beta.8's separate MSIX configuration path does not justify retaining
  the v2 `wails.json`.
- Unrelated visual redesign.
- Persisted-settings schema/key changes or release artifact renames that are not
  required by a selected v3 feature or platform constraint.
- [Wails Markup Language](https://v3.wails.io/whats-new/#wails-markup-language-wml);
  this React application keeps one component, state, and event model rather than
  adding experimental HTML runtime directives.
- File associations, custom URL protocols, native file-drop workflows, and
  native notifications until an owning import/deep-link/background-notification
  product contract is approved.
- Autostart, system-wide global shortcuts, native context-menu replacement, and
  Dock/taskbar customization beyond a promoted tray workflow.

## Pre-migration inventory

| Domain | Current evidence | Migration consequence |
| --- | --- | --- |
| Application composition | `main.go:57-160` creates the backend, menu, lifecycle callbacks, one window, embedded assets, and platform options in one `wails.Run`. | Create the v3 application, inject it into the backend service, build the persistent native menu, create the named main window with that menu, install lifecycle hooks, then call `app.Run()`. |
| Backend runtime lifecycle | `backend/app.go:25-35`, `backend/app.go:196-241`, and `backend/app_runtime.go:9-48` store a Wails context capability separately from the backend cancellation signal. | Retain the cancellation boundary from `ServiceStartup(ctx, ...)`, but replace context-bound runtime operations with the injected v3 application and its managers. |
| Startup and shutdown | `backend/app_lifecycle.go:41-63` performs UI and cluster startup; `backend/app_lifecycle.go:223-272` saves window state before close and tears down background systems at shutdown. | Split synchronous service startup from webview readiness. `ServiceStartup` captures the application context and completes non-UI setup before native windows run; an error aborts `App.Run()`. Persist window state while the main window is alive, and run backend teardown from `ServiceShutdown`. |
| Refresh webview transport | `backend/app_refresh_setup.go:457-479` builds the aggregate HTTP mux and `backend/app_refresh_setup.go:522-543` binds it to a random loopback port. `backend/refresh/api/server.go:311-325` and `backend/refresh_stream_cors.go:5-30` own CORS, while `frontend/src/core/refresh/client.ts:47-55` and `frontend/src/core/refresh/client.ts:159-175` discover and retry the runtime base URL. The resource stream upgrades to WebSocket at `backend/refresh_aggregate_resourcestream.go:109-115`, and the log stream requires SSE flushing in `backend/refresh/containerlogsstream/handler.go:145-149`. | Mount request/response handlers at one same-origin service route and adapt both stream protocols to beta.8 named Streams. Delete the listener, base-URL discovery/cache/retry, CORS, WebSocket upgrade, and SSE framing after contract tests prove equivalent readiness, replay/reset, cancellation, errors, backpressure, topology replacement, and teardown. |
| Native capabilities | Nine production Go files import Wails v2 (`rg -l 'github.com/wailsapp/wails/v2' --glob '*.go' .` classified by `_test.go` -> `9` production and `5` test files). Menus, events, dialogs, clipboard, window state, quit/hide, and window commands are represented in `main.go`, `backend/app_lifecycle.go`, `backend/app_settings.go`, `backend/app_data_management.go`, `backend/app_csv_export.go`, `backend/kubeconfigs.go`, and `backend/menu.go`. | Inject the v3 application directly and port each producer/consumer pair to its managers. Reuse Wails menu and dialog types instead of maintaining parallel models. |
| Menu contract | `backend/menu.go:14-38` owns the menu tree; `backend/menu.go:65-100`, `backend/menu.go:131-174`, `backend/menu.go:176-250`, and `backend/menu.go:295-347` connect native items to frontend events and window/app operations. `main.go:80-92` currently rebuilds and reinstalls a new menu, while `backend/app_ui.go:55-65` disables that path on Linux. | Build a persistent v3 menu before the main window and preserve labels, accelerators, platform differences, callbacks, and dynamic visibility labels with **New Window** removed. On GTK4 Linux, window construction consumes the menu and later `SetMenu` does not reattach it, so mutate the installed model and call `Menu.Update()`; use macOS application-menu reset and Windows named-window reinstall for their native ownership. |
| New Window removal | `backend/menu.go:41-55` respawns the executable; `backend/menu.go:74-80` exposes it as **New Window** with `Cmd/Ctrl+N`. `rg -n -i 'new window|spawnNewWindow' . --glob '!docs/plans/wails-v3-migration.md' --glob '!frontend/wailsjs/**'` finds no other implementation surface. | Remove the menu item, accelerator, callback, now-unused process imports, tests, and user/developer documentation during the core menu port. Assert the option is absent until Phase 5 implements native windows. |
| Process multiplicity | `rg -n 'SingleInstance|single instance|single-instance' main.go backend frontend/src mage .github` returns no match; process spawning is currently explicit only in the **New Window** implementation above. | Decide whether v3 should reject/funnel subsequent launches or continue allowing independent manual processes. If single-instance is enabled, second-launch handling restores/focuses the named main window and validates all incoming data. |
| Binding surface | `frontend/wailsjs/go/backend/App.js` exposes 178 methods, while `frontend/src/core/backend-api/index.ts:1-74` explicitly allows 67 of them into application code. | Generate v3 TypeScript bindings for one `App` service and repoint the explicit facade. Do not make the other generated methods reachable merely because v3 generated them. |
| Dynamic binding access | Eight production frontend files still inspect `window.go` (`rg -l 'window\.go' frontend/src --glob '*.{ts,tsx}'` classified by `.test.` -> `8` production and `3` test files). | Replace global availability probes and dynamic calls with typed facade/adapter functions; remove the v2 `Window.go` declaration. |
| Frontend runtime | Twenty-one production frontend files use `@wailsjs/runtime/runtime` or `window.runtime` (`rg -l '@wailsjs/runtime/runtime|window\.runtime' frontend/src --glob '*.{ts,tsx}'` classified by `.test.` -> `21` production and `27` test files). | Route events, browser URLs, clipboard, current-window actions, and environment checks through one frontend adapter backed by `@wailsio/runtime`. |
| Event payloads | Backend event producers include lifecycle/auth/health, app logs, menus, shell sessions, port forwards, runtime operations, and app updates (`rg -n 'emitEvent\(' backend`). Frontend consumers currently expect positional payload arguments, for example `frontend/src/hooks/useWailsRuntimeEvents.ts:43-53` and `frontend/src/hooks/useWailsRuntimeEvents.ts:117-123`. | Normalize the v3 `WailsEvent.data` envelope at the frontend adapter boundary and add payload contract tests for every event family. |
| Application/window events | `main.go:83-93` installs the v2 menu-update listener; `main.go:126-128` installs startup, before-close, and shutdown callbacks. Platform workarounds also depend on window/menu timing (`main.go:100-112`, `backend/app_ui.go:55-65`, `backend/menu.go:198-218`). | Map each behavior to a v3 application event, window event, cancellable hook, service lifecycle method, or explicit adapter action. Do not subscribe to unused events or duplicate one behavior across hook families. |
| Update flow | `backend/app_update.go:22-214` checks GitHub Releases, builds `UpdateInfo`, and emits `app-update`; `frontend/src/ui/status/UpdateStatus.tsx:75-104` owns the runtime subscription and download-link status. | Preserve this notification contract during the core port. In Phase 5, compare it explicitly with `app.Updater` download, verification, installation, restart, event, and UI behavior before replacing anything. |
| System tray | `rg -n -i 'system.?tray|systray|tray menu' backend frontend/src main.go --glob '*.{go,ts,tsx}'` finds only the forward-looking comment at `frontend/src/App.tsx:179-184`; no tray lifecycle or native menu is currently registered. | Treat tray adoption as a new app-shell workflow with explicit last-window and quit behavior, not as incidental menu porting. |
| Generated models | `frontend/wailsjs/go/models.ts` is 6,306 lines (`wc -l frontend/wailsjs/go/models.ts`), and 36 production plus 20 test files import it (`rg -l '@wailsjs/go/models' frontend/src --glob '*.{ts,tsx}'`, classified by `.test.`). Descriptor drift tests instantiate generated DTO classes as documented in `docs/frontend/component-structure.md`. | Generate both v3 shapes in scratch, compare JSON names/nullability and existing constructor-dependent consumers, then select interface output and replace constructor use with ordinary typed values or test-only partial fixtures. Pin that choice with `-i` in generation and drift checks. |
| Window chrome | `main.go:114-151` sets size bounds, hidden startup, platform appearance, and the v2 drag-property mapping. Current CSS uses `--wails-draggable: true` and `none` in `frontend/src/ui/layout/AppHeader.css:1-43` and `frontend/styles/components/modals.css:16-24`. | Map window options explicitly and change drag values to the v3 `drag`/`no-drag` contract documented in [Frameless Windows](https://v3.wails.io/features/windows/frameless/). Verify controls remain clickable. |
| Window geometry | `backend/resources/types/types.go:27-33` persists X/Y/width/height/maximized; `backend/app_settings.go:642-684` saves and loads those fields; `backend/app_lifecycle.go:154-167` restores any positive size and only non-negative coordinates without checking current work areas. | Keep the persisted fields, validate the saved logical rectangle with the v3 screen manager, retain valid negative coordinates on left/upper monitors, and clamp or center when no current work area can display the window. |
| Platform workarounds | `main.go:100-112` carries Linux hidden-window and Wayland maximum-size workarounds; `backend/app_ui.go:55-65` suppresses Linux menu rebuilds; `backend/menu.go:198-218` works around Windows accelerator behavior. | Keep each workaround until its exact behavior is exercised on v3, then retain or remove it with a focused regression test and a comment tied to the observed v3 behavior. |
| Development/build | `mise.toml:1-13`, `go.mod:1-17`, `magefile.go:194-208`, and `mage/build-config.go:54-74` pin v2 and build through v2 commands/flags. | Pin the v3 module, CLI, and frontend runtime as one compatible set; make the generated Wails task graph own development and builds, and delete duplicate Mage targets. |
| Platform packaging | macOS builds append v2 `--platform` (`mage/macos.go:248-270`); Windows appends `-o`/`-nsis` and reads a v2 internal NSIS template (`mage/windows.go:13-24`, `mage/windows.go:66-97`, `mage/windows.go:157-176`); Linux detects WebKit2GTK and conditionally adds `webkit2_41` (`mage/linux.go:13-50`). | Port native application/resource builds, per-architecture macOS DMGs, Windows NSIS creation, and Linux DEB/RPM output to v3 Taskfiles/build assets. Delete Mage packaging implementations. Use only GTK4/WebKitGTK 6.0 and delete legacy WebKit detection/tags. |
| Build directory ownership | `.gitignore:26-29` ignores all of `build/`, while existing Mage/Wails output already occupies `build/bin`, `build/darwin`, `build/artifacts`, and `build/packages` (`mage/build-config.go:54-74`, `mage/macos.go:12-13`, `mage/linux.go:142-169`). | Reserve tracked portions of `build/` for v3 configuration/platform assets and ignore only generated output paths. Decide output locations before generating v3 assets so configuration is not hidden by the current blanket ignore. |
| Release matrix | `.github/workflows/release.yml:35-58` builds macOS Intel/Apple Silicon, Windows amd64/arm64, and Linux amd64/arm64; `.github/actions/setup-toolchain/action.yaml:20-43` installs the v2 CLI and Linux WebKit2GTK 4.1 headers. | Update the shared action to install GTK4/WebKitGTK 6.0 and prove every existing architecture target and artifact path before cutover. Distro compatibility below the new GTK4 baseline is deliberately not preserved. |
| Product metadata | `wails.json:1-24` owns app/release metadata; `frontend/vite.config.ts:14-24`, `mage/utils.go:49-84`, `DEVELOPMENT.md:87-103`, and `RELEASE.md:75-81` consume it. | Move these consumers atomically to `build/config.yml` or a generated repository-owned view and delete `wails.json`. The beta.8 NSIS build path does not require a v3 replacement file. |
| Test scaffolding | Storybook emulates `window.runtime` and `window.go` in `frontend/.storybook/preview.ts:4-17` and `frontend/.storybook/preview.ts:64-96`; frontend globals declare the same v2 shape in `frontend/src/types/global.d.ts:10-25`. | Mock the new frontend adapter and generated binding module instead of recreating v2 globals. Keep Storybook browser-only behavior available. |

## Target model and ordering

1. `main` creates `application.App` with embedded frontend assets and no backend
   service cycle.
2. `main` injects the Wails v3 application into `backend.App` and registers it as
   one process-scoped service. Backend window operations resolve the constant
   main-window name through `app.Window.GetByName`; do not add a parallel window
   registry or fall back to the focused window. Beta.8 provides this lookup in
   `pkg/application/window_manager.go:16-32`, keyed by
   `WebviewWindowOptions.Name` (`webview_window_options.go:80-83`).
3. `main` builds one persistent menu from backend actions, sets the application
   menu, and creates the named main `WebviewWindow`. Pass that
   same menu through the explicit Linux window options before `app.Run()`; use
   the application-menu option on Windows and the global application menu on
   macOS.
4. `main` registers `WindowRuntimeReady` and quit hooks before `app.Run()`.
5. `app.Run()` calls `backend.App.ServiceStartup` synchronously before it runs
   pending native windows. Startup captures the application-lifetime context and
   completes only bounded non-UI prerequisites; a non-nil error aborts
   `app.Run()` and triggers shutdown for services that already started. The
   backend readiness gate remains closed, so it cannot emit frontend events or
   invoke interactive UI at this point (`pkg/application/application.go:651-662` and
   `pkg/application/services.go:90-97`).
6. The pending main window starts with its initial native menu. Calls made before
   its platform implementation exists are dropped by Wails; after it exists,
   JavaScript and event delivery are queued until the frontend sends
   `wails:runtime:ready`.
7. The runtime-ready callback advances the backend readiness gate exactly once,
   then runs the
   interactive startup sequence: beta-expiry dialog/quit gate, window restore,
   window show, cluster initialization, watcher startup, update check, and
   installation metric scheduling. The transition that marks the runtime ready
   must not itself depend on the ready gate.
8. A single idempotent pre-quit path waits for pending selection persistence and
   reads/saves main-window geometry before the window is closed. Test window
   close, native Quit/Exit, and programmatic `app.Quit()` paths.
9. `backend.App.ServiceShutdown` cancels and tears down auth recovery, runtime
   operations, kubeconfig watching, and refresh subsystems. It does not use a
   closed window or frontend runtime.

This ordering avoids a constructor cycle: the Wails application exists before
the backend service and is injected directly into it. Application-scoped calls
use application managers; window-scoped calls resolve the explicitly named main
window. V3 services remain process-scoped and must not acquire a window identity
by guessing from focus.
The readiness gate reflects beta.8's actual delivery behavior: `ExecJS` and
event dispatch return while the window implementation is absent, then queue
JavaScript after native construction until `wails:runtime:ready` marks the
runtime loaded and flushes the queue
(`pkg/application/webview_window.go:651-665`, `825-837`, and `1426-1456`).
Waiting for `WindowRuntimeReady` prevents
startup work from depending on either silent early drops or queued delivery;
see the official
[Events API](https://v3.wails.io/reference/events/) and
[window events reference](https://v3.wails.io/features/windows/events/).

## Phased implementation checklist

### Phase 0: Reproducible spike and baseline

Execution status: the pinned-version, upstream-source, generated-asset,
binding-shape, and local runnable-spike work is complete. Packaged
single-instance scenarios and screen behavior on Windows/Linux remain Phase 6
release-host validation. The method-to-future-service owner map remains part of
the deferred service-decomposition track.

- [x] Re-run the v3 version query, read the migration notes and release notes
      from v2.14.0 through the selected v3 beta, and record the selected module,
      CLI, and `@wailsio/runtime` versions in this plan.
- [x] Generate a fresh v3 React/TypeScript project outside the repository with
      the pinned CLI. Inventory its `main.go`, binding command/output, runtime
      package version, `Taskfile.yml`, `build/config.yml`, and platform assets.
      For beta.8, confirm the source-carried runtime is
      `@wailsio/runtime@3.0.0-beta.7` even though the template requests `latest`,
      then pin the source-carried version rather than the floating template.
- [ ] Build an application/window event matrix from the pinned release. For each
      current startup, ready, focus, theme, menu-update, close, quit, shutdown,
      and platform-workaround behavior, record the v3 event/hook owner,
      cancellability, ordering, readiness, window identity, cleanup, and test.
- [x] Confirm beta.8 adds named, bidirectional Streams through
      `App.HandleStream` and the paired runtime's `Stream`/`JSONStream`, with a
      desktop held-poll transport and a real WebSocket only in server mode.
      Replace the beta.7 loopback decision; do not route raw WebSocket or SSE
      responses through the asset-service handler.
- [ ] Exercise the pinned v3 single-instance callback before choosing process
      policy. Record behavior for a second launch before runtime-ready, after
      ready, while minimized/hidden, and during shutdown, including all incoming
      argument and working-directory trust boundaries.
- [ ] Verify v3 screen coordinates/work areas on macOS, Windows, X11, and Wayland
      use the logical coordinate contract expected by persisted window settings,
      including a monitor positioned left of or above the primary display.
- [x] Generate and inventory beta.8's build assets to confirm
      `build/config.yml` plus Taskfiles own the current NSIS release path. Record
      the unused MSIX task's separate legacy JSON input without retaining
      `wails.json` in Luxury Yacht's supported build.
- [ ] Run the focused lifecycle/menu/frontend runtime tests and
      `mise exec -- wails3 task qc:prerelease`; record exact failures, if any.
- [ ] Produce current unsigned artifacts on the available host and record the
      binary/app/installer names and internal metadata. Let CI provide the other
      platform baselines.
- [x] Generate v3 bindings for the existing single `App` service into a scratch
      directory. Record unsupported methods/types, generated service path,
      model path structure, constructor behavior, enum behavior, and error
      mapping before changing frontend imports. Run explicit combinations for
      class versus interface output, `--time-type string|Date`, and call IDs
      versus `--names`; record the exact invocation selected for committed
      generation and drift checks. These are independent beta.8 generator flags
      (`internal/flags/bindings.go:10-27`), not consequences of the output path.
- [ ] Map all 179 bound methods and the current 83-method frontend allowlist to candidate
      v3 service owners. Record shared dependencies, lifecycle ordering, event
      ownership, and methods that should cease to be bound.
- [x] For each Phase 5 track, record `promoted on this branch` or `planned
      follow-up` with the product contract and evidence behind the decision. Do
      not silently treat an undecided track as complete.
- [x] Exit gate: a minimal branch-only v3 composition starts, displays the
      frontend, calls one backend method, exchanges one event, opens one dialog,
      and produces one local development build without a dual runtime path.

### Phase 1: Backend application injection and lifecycle

Execution status: application injection and lifecycle are implemented. The
branch uses v3 service startup/shutdown, a runtime-ready transition, and
idempotent pre-quit persistence. Replacing the existing backend-owned loopback
refresh transport with beta.8 service routes and Streams remains open.

- [x] Red: add tests proving UI/runtime operations fail or no-op before
      readiness while the explicit `MarkRuntimeReady` transition remains
      callable and enables subsequent operations.
- [ ] Red: add ordering tests for service startup, runtime-ready interactive
      startup, pre-quit persistence, service cancellation, and service shutdown.
- [x] Inject `*application.App` through `NewApp` and call v3 managers directly for
      event emission, platform-aware menu refresh, dialogs, clipboard text,
      named-window state/actions, application hide/quit, and screens. Keep the
      Wails-specific calls in the backend files that own those native behaviors.
- [x] Delete the broad backend desktop interface, its adapter package, duplicate
      menu/dialog models, and full-interface fakes. Retain only narrow function
      seams for native dialogs and live-window geometry in headless tests.
- [ ] Replace `setRuntimeContext`/`runWithRuntimeContext` with an
      application-lifetime cancellation boundary plus the injected Wails
      application. Preserve `CtxOrBackground` cancellation semantics used by
      refresh/auth/session work.
- [ ] Implement `ServiceStartup` and `ServiceShutdown` on the single App service
      using the exact lifecycle interface of the pinned v3 release. Keep startup
      bounded and non-UI because it runs inline before pending windows; add an
      error-path test proving a startup failure aborts `App.Run()` and shuts down
      services that already started.
- [ ] Split current `Startup` into non-UI service initialization and a once-only
      runtime-ready interactive startup path.
- [ ] Red: add refresh-transport contract tests proving an early request cannot
      read an unready handler while the initialization/replacement operation
      needed to publish the ready aggregate mux remains allowed.
- [ ] Make the backend service an atomically replaceable HTTP handler and mount
      its non-streaming refresh mux at one versioned Wails service route.
      Preserve per-cluster initialization order, cluster-scoped routing,
      retained data, snapshot and job behavior, queued-job migration,
      diagnostics, readiness, and teardown; use mount-relative mux paths rather
      than a prefix-restoring compatibility wrapper.
- [ ] Adapt the existing resource-stream protocol to one named Wails Stream.
      Preserve REQUEST/CANCEL, ACK/RESET/COMPLETE/update messages, resume
      sequence semantics, topology replacement, telemetry, subscriber limits,
      cancellation, and backpressure. Use `ReceiveJSON`/`SendJSON` in Go and
      `JSONStream` in TypeScript rather than a second application protocol.
- [ ] Adapt container logs to a second named Wails Stream. Send the current
      scope/container/filter request as the first client frame and preserve
      permission errors, reset/manual completion, reconnect, visibility,
      filtering, target limits, cancellation, and bounded buffering without SSE
      event framing.
- [ ] Make frontend request/response fetches same-origin and delete
      `GetRefreshBaseURL`, listener/server lifecycle, URL retry/cache
      invalidation, CORS wrappers, raw `WebSocket`, `EventSource`, and their
      tests. Add absence tests proving no loopback listener or fallback
      transport remains.
- [ ] Make pre-quit persistence idempotent and cover pending selection mutation,
      missing runtime, window-state read failure, and repeated quit requests.
- [ ] Green/refactor: remove v2 runtime-context globals and tests only after the
      new application-injection/lifecycle tests pass.

### Phase 2: Application, window, menus, and native capabilities

Execution status: implemented for the core single-window contract. Focused
composition, application-injection, readiness, menu, geometry, and framework-configuration
tests are in place; macOS rendered validation is complete. Platform-native
interaction and workaround checks remain in Phase 6.

- [ ] Red: add composition tests around an application factory so service,
      window, hooks, assets, and platform option mapping can be inspected without
      entering the native event loop.
- [ ] Port `main.go` to `application.New`, explicit service registration, a named
      main window, and `app.Run()` error reporting.
- [ ] Implement the approved event matrix with one owner per behavior. Register
      cancellable hooks and runtime-ready handlers before `app.Run()`; remove the
      corresponding v2 callback/workaround only after its focused test passes.
- [ ] Decide single-instance policy before finalizing application options.
      Recommended while **New Window** is absent: configure the product identifier
      as the unique ID and make a second launch restore/focus the named main
      window rather than start another application lifecycle.
- [ ] If single-instance is enabled, use Wails `SingleInstanceOptions` directly.
      In its callback, use the named window's documented show/restore/focus
      methods and ignore the arguments, working directory, and additional data
      as untrusted input. Do not add an application-owned launch coordinator or
      embed a reusable secret solely to enable optional instance-message
      encryption.
- [ ] Map title, initial/min/max size, background color/type, hidden state,
      macOS title-bar/transparency behavior, Windows theme/zoom behavior, and
      embedded assets field by field. Record any v2 option without a v3
      equivalent as an open decision rather than silently dropping it.
- [ ] Red: add table-driven geometry restoration tests for one monitor, valid
      negative coordinates, removed monitor, partially visible rectangle,
      oversized window, changed work area, and mixed DPI.
- [ ] Restore the persisted X/Y/width/height/maximized values through the named
      window after validating the logical rectangle against v3 screen work areas.
      Preserve visible saved geometry; clamp or center only when needed. Do not
      remove persisted geometry or add a screen-ID key unless native multi-window
      persistence later requires a schema decision.
- [ ] Port beta-expiry, open/save/directory dialogs, window geometry restore,
      window show/maximize/minimize/restore, app hide/quit, clipboard read, and
      bring-to-front behavior through the injected Wails application.
- [ ] Build one persistent native-menu model before constructing the main window.
      Preserve top-level order, labels, accelerators, platform-only items,
      asynchronous callbacks, frontend event names, dynamic panel/sidebar
      labels, and the development debug menu except for the explicitly removed
      **New Window** command. Pass the menu through the Linux window options so
      GTK4 constructs its native window with the menubar already attached.
- [ ] Replace the `update-menu` round trip with one backend-owned refresh that
      mutates the persistent model. On GTK4 Linux call `Menu.Update()` so Wails
      clears and rerenders the attached native menu in place; do not call the
      post-construction Linux `SetMenu`, which only changes stored fields. On
      macOS reset the application menu; on Windows reinstall the menu on the
      explicitly named main window rather than merely changing the app-level
      pointer.
- [ ] Red: add platform menu-lifecycle tests proving Linux receives the initial
      menu before window construction and retains the same menu object across a
      dynamic-label refresh, macOS refreshes the global application menu, and
      Windows refreshes the named window menu. In every case, invoke a refreshed
      callback to prove it remains connected.
- [ ] Update `--wails-draggable` values from `true`/`none` to
      `drag`/`no-drag`; verify the header and modal drag regions plus every
      interactive child.
- [ ] Exercise the three recorded platform workarounds on v3. Retain a
      workaround only when the v3 behavior still reproduces its failure mode.
- [ ] Red: add a menu-contract test proving the File menu has no **New Window**
      item or `Cmd/Ctrl+N` accelerator. Check the shortcut registry, command
      palette, help surfaces, and docs for equivalent entry points.
- [ ] Delete `spawnNewWindow`, the File-menu registration, now-unused process
      imports, and tests/docs that describe the process-spawning behavior. Do not
      add a disabled item, placeholder, feature flag, or hidden compatibility
      callback.
- [ ] Exit gate: repository searches find no active **New Window** label,
      accelerator, process-spawn callback, shortcut, palette entry, or user-facing
      documentation. Explanatory references may remain in this temporary plan.

### Phase 3: Generated bindings and frontend runtime

Execution status: implemented. The generator is pinned to TypeScript interface
output with string time values and named call IDs; a prerelease drift check,
explicit backend facade, desktop-runtime adapter, Storybook transport, and v3
runtime test harness replace the v2 surfaces.

- [x] Add a generated-binding drift check that runs the pinned v3 generator and
      fails when committed bindings differ. Put the full invocation in one
      repository task, including TypeScript/interface mode, output paths,
      `--time-type`, and the selected call-ID versus `--names` mode so generator
      defaults cannot drift silently.
- [x] Generate TypeScript interface bindings for the single `App` service and
      compare all DTO field names, optional/null behavior, nested namespace
      exports, constructors, `time.Time` representation, call identifiers, and
      error results used by current consumers.
- [x] Replace the `@wailsjs` alias with a v3 `@bindings` alias and update the
      explicit `core/backend-api` allowlist to the generated App service path.
- [x] Replace all production `window.go` reads with typed backend API or desktop
      availability helpers; then remove `Window.go` from `global.d.ts`.
- [x] Add the source-carried `@wailsio/runtime` version paired with the pinned v3
      release (`3.0.0-beta.7` for Wails `v3.0.0-beta.8`), not the template's
      floating `latest`, and create one frontend desktop-runtime module for typed
      event subscription, browser URL open, clipboard text, current-window
      actions, and environment access.
- [x] Normalize `Events.On` callbacks to deliver `event.data` to application
      handlers. Add table-driven tests for menu/paste, connection status,
      lifecycle/auth/health, app logs, shell output/status/list, port-forward
      status/list, runtime-operation list, update, appearance, and kubeconfig
      events.
- [x] Migrate all 21 production v2 runtime consumers to the adapter; use returned
      unsubscribe functions instead of broad event-name removal when the v3 API
      permits it.
- [x] Replace Storybook's `window.runtime`/`window.go` proxies and Vitest's v2
      runtime harness with adapter-level mocks. Keep browser-only URL behavior
      and generated-model mocks working.
- [x] Update Vite, TypeScript, Biome boundary tests, Knip, Sonar exclusions, and
      editor settings from `frontend/wailsjs` to the v3 binding directory.
- [x] Delete `frontend/wailsjs` only after repository search finds no production,
      test, build, lint, Storybook, or documentation consumer.

### Phase 4: Build, packaging, CI, and metadata

Execution status: implemented in source. The local macOS application build and
Windows amd64/arm64 cross-builds pass, and macOS/Windows target-task dry runs
select the requested architecture. The generated cross-build image is
normalized from Debian 12 to Debian 13 so its declared WebKitGTK 6 development
package exists. Native Windows and GTK4 Linux package builds, installation, and
signing/notarization inspection remain Phase 6 work on their release hosts.

- [x] Pin `github.com/wailsapp/wails/v3` and
      `github.com/wailsapp/wails/v3/cmd/wails3` to the same exact beta in
      `go.mod` and `mise.toml`; update the tool-version compatibility test first.
- [x] Generate v3 Taskfiles and platform assets into a reviewed layout. Change
      `.gitignore` from blanket `build/` exclusion to tracked config/assets plus
      explicit generated-output exclusions.
- [x] Move product name, identifier, description, copyright, version, and beta
      expiry inputs to `build/config.yml` plus a generated repository-owned view
      for consumers or custom fields that cannot read it directly. Update the
      project helper, Vite, development docs, release docs, and tests in the
      same phase.
- [x] Make v3 Taskfiles own frontend build, binding generation, native resource
      generation, native application build, and Windows NSIS creation. Make
      the root Taskfile own repository checks, tests, cleanup, Storybook, and
      release publication, then remove Mage entirely.
- [x] Port macOS per-architecture app builds, code signing, notarization, DMG
      staging, and existing artifact names. Do not switch to one universal DMG
      without a separate release decision.
- [x] Port Windows amd64/arm64 binaries, icon/resource generation, numeric
      version normalization, EULA page, NSIS customization, and installer
      artifact names. Remove the code that reads v2's internal NSIS template.
- [x] Port Linux builds to Wails v3's default GTK4 + WebKitGTK 6.0 backend.
      Delete WebKit version auto-detection and every `gtk3`, `webkit2_41`, and
      WebKit2GTK 4.x build/dependency fallback; do not produce a legacy Linux
      artifact.
- [x] Port Linux amd64/arm64 binary, DEB, and RPM output while preserving desktop
      file, icon, permissions, and release artifact names.
- [x] Move Linux development and CI images to the pinned release's GTK4/WebKitGTK
      6.0 dependency set. Update README, development, release, and troubleshooting
      documentation to state the new minimum supported distributions and remove
      WebKit2GTK 4.0/4.1 installation instructions, including Ubuntu 22.04.
- [x] Replace the complete Mage command surface with the Wails v3 task graph;
      update the shared toolchain action, release workflow, and contributor
      documentation, and remove the Mage dependency and source package. Verify
      that no removed v2 flags remain.
- [x] Delete the v2-formatted `wails.json` without creating a v3 replacement,
      all v2 module/CLI/runtime references, obsolete indirect dependencies,
      `frontend/wailsjs`, v2 global mocks, v2-only tests, and obsolete build
      assets after their consumers have moved and `go mod tidy` is clean. Do not
      retain compatibility shims or enable the out-of-scope MSIX task that still
      expects a separate JSON configuration in beta.8.
- [x] Phase exit gate: active source, tests, package manifests, lockfiles, build
      tasks, CI, agent instructions, and durable product documentation contain
      no Wails v2 import, module, command, runtime alias, global, generated file,
      or configuration path. The temporary migration plan and historical
      release notes may retain explanatory v2 references.

### Phase 5: Planned v3 follow-on tracks

The core v3 port must be green before these tracks change product behavior.
Planning and the promotion decision are required for every track. A promoted
track must finish before Phase 6; a deferred track keeps its follow-up contract,
dependencies, tests, and explicit non-goals in this section until it is moved to
a dedicated implementation plan. All four tracks are planned follow-ups for
this branch's core migration, as recorded in the implementation-status table.

#### 5A: Service decomposition

- [ ] Use the Phase 0 method map to define cohesive service candidates and one
      owner for every bound method, event, shared dependency, and lifecycle hook.
      Start from current domain ownership rather than arbitrary method counts.
- [ ] Keep process-wide Kubernetes clients, refresh infrastructure, persistence,
      and desktop capabilities composed outside the bound services; inject only
      what each service needs.
- [ ] Red: add binding-boundary tests proving each frontend facade exposes only
      its intentional service methods and that generated bindings cannot bypass
      those allowlists.
- [ ] If promoted, migrate one vertical slice at a time: register the new service,
      generate bindings, move its frontend facade and tests, then remove the old
      `App` methods. Never expose duplicate compatibility methods.
- [ ] Exit gate if promoted: no catch-all method remains without an intentional
      owner, service startup/shutdown order is tested, generated bindings are
      drift-checked, and repository searches find no removed App binding import.

#### 5B: Native multi-window

- [ ] Choose and document the product contract for reintroducing **New Window**:
      independent workspace state, intentionally shared process services, and
      the exact selection/navigation/settings state that is per-window versus
      shared.
- [ ] Require explicit window identity in window-scoped commands, events,
      readiness, menus, geometry persistence, and close hooks. Keep `clusterId`
      and complete Kubernetes object identity unchanged across every window.
- [ ] Red: prove two windows can become runtime-ready independently, closing one
      does not tear down process services, last-window behavior is correct per
      platform, and each window reads/writes only its own geometry/state key.
- [ ] If promoted, implement named `WebviewWindow` creation and route
      window-scoped menu actions through the invoking window. Add the menu item,
      `Cmd/Ctrl+N`, command-palette/help entries, and user documentation only
      after the native workflow and lifecycle tests pass.
- [ ] If deferred, keep **New Window** absent from every user-facing and internal
      command surface; do not retain dormant callback code for later use.
- [ ] Exercise two populated workspaces concurrently, including different
      clusters, auth recovery, events, dialogs, shell/log operations, and quit.

#### 5C: V3 updater

- [ ] Compare the current notification-only contract (`UpdateInfo`, `GetAppInfo`,
      `app-update`, status chip, About modal, dev-build suppression, and download
      URL) with the pinned v3 updater state machine and UI.
- [ ] Choose notification-only parity or full download/install/restart behavior.
      Record asset matching, current-version injection, skip/remind policy,
      network failure behavior, and ownership of release notes/UI.
- [ ] Before enabling installation, define release-asset digests, cryptographic
      signature verification, public-key rotation, CI secret ownership, macOS
      signing/notarization behavior, Windows signing behavior, and failure-safe
      rollback of a staged update.
- [ ] Red: add state-mapping and release-contract tests without live network
      calls. Test no update, available, download failure, verification failure,
      ready, restart, skipped version, and dev build.
- [ ] If promoted, move all update consumers atomically and delete the custom
      GitHub release client only after the v3 updater owns the complete contract.

#### 5D: System tray

- [ ] Define whether a tray is always present, opt-in, or platform-specific and
      whether closing the last window hides the app or quits it. Specify Dock,
      taskbar, notification-area, and unsupported-Linux behavior.
- [ ] Build tray items from the same command/action definitions as the app menu,
      shortcuts, and command palette so labels, enabled state, permissions, and
      callbacks cannot drift.
- [ ] Define icon assets for platform/theme variants and keep tray ownership in
      application composition rather than a React component or domain service.
- [ ] Red: test show/focus, settings, relevant quick actions, dynamic labels,
      explicit Quit, last-window close, startup, and shutdown behavior. Test a
      new-window tray action only if native multi-window is also promoted; keep
      it absent otherwise.
- [ ] If promoted, smoke-test presence and lifecycle behavior on every release
      OS; degrade to the window/menu workflow when a Linux tray is unavailable.

- [x] Phase exit gate: every track is marked promoted or deferred with evidence;
      every promoted track passes its focused tests and has no superseded
      implementation left in the branch.

### Phase 6: Validation and cutover

Execution status: in progress. Focused and full local tests, generated-binding
comparison, frontend/backend coverage measurement, the full prerelease gate,
rendered app-shell checks, and a local macOS build have run. The release-host,
physical-display, packaged-process, installer, and upgrade scenarios below
remain open. Frontend coverage is 81.05% statements. The top-level backend
package is 78.6%, 1.4 percentage points (134 statements) below the 80% target;
the gap is recorded for review rather than expanding this framework migration
into unrelated backend test work.

- [x] Run focused backend lifecycle/runtime/menu/dialog/window tests and measure
      directly affected backend coverage with
      `mise exec -- wails3 task test:backend-coverage`; target 80% statement coverage or
      record the measured gap for review.
- [ ] Run the framework-owned refresh transport's snapshot, job, named-stream,
      permission, readiness, recovery, backpressure, teardown, and multi-cluster
      suites. Assert that no loopback listener, base-URL bridge, raw WebSocket,
      SSE, CORS, or fallback transport remains.
- [x] Run focused frontend binding/runtime/event/app-shell tests and measure
      directly affected frontend coverage with
      `mise exec -- wails3 task test:frontend-coverage`; target 80% statement coverage or
      record the measured gap for review.
- [x] Run `wails3 generate bindings` through the pinned tool and confirm the
      worktree remains unchanged.
- [x] Run `mise exec -- wails3 task qc:prerelease`, then inspect the worktree because
      the gate may format generated or handwritten files.
- [ ] Run `wails3 doctor` on each release operating system and retain its output
      with CI diagnostics.
- [ ] Use the standalone Wails app plus Playwright to exercise loading, error,
      empty, populated, navigation, and interaction states, including settings,
      modal focus, shortcuts, menus, draggable header, maximize/restore, browser
      links, clipboard paste, file/directory dialogs, shell, logs, port-forward,
      refresh diagnostics, auth failure/recovery, and multi-cluster switching.
- [ ] On the minimum supported Linux GTK4 environment, exercise every import,
      export, CSV-save, and kubeconfig-directory flow through beta.8's
      `GtkFileDialog` implementation
      (`pkg/application/linux_cgo.go:1935-1990`). Verify titles, default
      filenames/directories, filters, cancellation, and returned paths in a
      normal desktop session. If the validation environment delegates the dialog
      through a desktop portal, repeat the same contract there.
- [ ] Exercise every promoted Phase 5 workflow in its required states. For native
      windows, include two concurrent windows; for updater, include signed staged
      update failure/recovery; for tray, include close/hide/reopen/quit behavior.
- [ ] Exercise restoration on available single/multi-monitor and mixed-DPI hosts,
      including monitor removal and a display left of the primary. Confirm the
      persisted X/Y/width/height/maximized fields remain sufficient.
- [ ] If single-instance is enabled, launch a second packaged process before
      readiness, after readiness, while minimized/hidden, and during shutdown;
      confirm only the intended lifecycle/window survives.
- [ ] Test quit from the window close button, File/Application Quit, shortcut,
      and programmatic beta-expiry path. Confirm selection persistence finishes,
      window state is saved once, and background operations shut down.
- [ ] Build and smoke-install the existing architecture matrix: macOS Intel and
      Apple Silicon; Windows amd64 and arm64; Linux amd64 and arm64. Run Linux
      smoke installation on the documented minimum GTK4/WebKitGTK 6.0 distro;
      legacy GTK3 distributions are outside the supported matrix.
- [ ] Inspect product version, icon, bundle/application identifier, signatures,
      notarization, installer license, desktop entry, and artifact filenames for
      parity with the recorded v2 baseline.
- [ ] Run an upgrade smoke test over an existing user settings directory and
      verify selected kubeconfigs, themes, window geometry, favorites, table
      persistence, and panel preferences remain readable without schema/key
      changes.
- [ ] Consider the migration complete only when the v3-only branch passes all
      required gates, the Phase 4 absence checks, and every promoted Phase 5
      track. If a framework defect
      blocks a supported target, keep this branch incomplete, reduce the defect
      to a reportable reproduction, and fix it or move to a later v3 release;
      do not restore a v2 path.

## Contract tests to add before behavior changes

- Backend native operations reject event/dialog/window calls before ready, but
  the readiness transition itself succeeds and enables calls afterward.
- Backend named-window operations resolve through `app.Window.GetByName`, fail
  explicitly when the name is absent, and never use a parallel registry or
  focused-window lookup.
- Saved window X/Y/width/height/maximized values round-trip unchanged when
  visible; restoration accepts valid negative coordinates and recovers an
  off-screen or oversized rectangle into a current logical work area.
- The event matrix has one tested owner per adopted application/window event or
  hook, including cancellation and readiness ordering; obsolete callback paths
  are absent.
- `ServiceStartup` runs before pending native windows, propagates its context
  through `CtxOrBackground`, and aborts `App.Run()` on error after shutting down
  already-started services; normal shutdown cancels refresh/auth/session work
  without a Wails context.
- No backend-owned frontend event or JavaScript call is attempted before
  `WindowRuntimeReady`; tests prove startup producers cannot reach Wails' early
  drop/queue paths and run exactly once after the ready transition.
- All current Go event producers arrive at frontend handlers with the same
  application payload after the v3 event-envelope adapter.
- Pre-quit waits for selection persistence before reading window geometry and
  persists the same X/Y/width/height/maximized fields.
- Menu labels, top-level order, platform entries, accelerators, callbacks, and
  dynamic visibility labels match the current menu contract minus the explicitly
  removed **New Window** item and `Cmd/Ctrl+N` accelerator.
- Linux menu refresh mutates and updates the same menu attached before window
  construction; macOS refreshes the global application menu; Windows reinstalls
  the menu on the named main window. Refreshed callbacks remain callable.
- Until native multi-window is promoted, menu, shortcut, command-palette, help,
  and callback registries contain no **New Window** entry or process-spawn path.
- Generated App facade exports exactly the intentional frontend allowlist; an
  added backend method is not automatically available through the facade.
- Representative generated DTOs preserve JSON field names, nullability,
  nested types, class construction, the selected `time.Time` representation,
  and the selected names-versus-call-ID mode used by descriptor drift tests.
- Build metadata has one owner and Vite Sentry release, Go build manifest,
  package metadata, and release tag commands read the same version.
- Supported build tasks and metadata consumers read `build/config.yml` or its
  generated view and contain no `wails.json` dependency.
- Packaging tests assert current artifact names and required platform metadata
  before CI uploads them.
- Linux build/configuration tests assert the GTK4/WebKitGTK 6.0 dependency set
  and reject legacy GTK3 tags, WebKit detection, dependencies, or artifacts.
- If service decomposition is promoted, each generated service facade exposes
  only its allowlist and process-scoped dependencies start and stop once.
- If native multi-window is promoted, readiness, events, geometry, close, and
  current-window actions remain isolated while cluster/object references retain
  complete identity.
- If updater or tray is promoted, their state machines and quit/restart paths
  are proven independently from the core window lifecycle.
- The framework-owned refresh transport preserves routes, methods, validators,
  typed errors, correlation identity, stream replay/reset, cancellation,
  readiness, backpressure, multi-cluster isolation, handler replacement, and
  teardown without a loopback listener, base-URL bridge, CORS layer, raw
  WebSocket, SSE, or fallback transport.
- If single-instance is enabled, a subsequent process cannot start a second
  service/refresh lifecycle and can affect the main window only through the
  validated second-launch contract.

## Decision register

1. **Generated binding shape — resolved.** Use TypeScript interface output
   (`-i`), `--time-type string`, and `--names`; the prerelease gate runs the
   exact pinned invocation and compares every generated path and byte. Existing
   constructor-dependent consumers use ordinary typed object values instead of
   preserving class-only compatibility behavior.
2. **Quit-hook placement — resolved.** Both application `ShouldQuit` and the
   named window's `WindowClosing` hook call the same idempotent `PrepareQuit`
   boundary while the window remains queryable.
3. **Platform workarounds — validation open.** Each Linux/Wayland/menu and
   Windows accelerator workaround still requires runtime evidence on its native
   release host before final cutover.
4. **Final service shape — planned follow-up.** Retain one `App` service and the
   explicit frontend allowlist for this migration. Produce and approve the
   complete owner map before moving any method; expose no duplicate bridge.
5. **Native-window workspace scope — planned follow-up.** Keep **New Window**
   absent until selection, navigation, modal, panel, geometry, close, and shared
   process-resource ownership are designed and tested.
6. **Updater scope — resolved for this migration.** Retain notification-only
   behavior. Full signed download/install/restart remains a separately promoted
   follow-up because it changes release and rollback contracts.
7. **Tray lifecycle — planned follow-up.** Do not add a tray or close-to-tray
   behavior in the migration. Define platform availability and last-window
   semantics before promotion.
8. **Process multiplicity — resolved.** Production uses Wails' built-in
   single-instance support directly. A second launch may only
   restore/show/focus the named main window; its arguments, working directory,
   and additional data are ignored as untrusted input. No application-owned
   second-launch queue is maintained.

## Documentation to update during implementation

- `AGENTS.md`, `backend/AGENTS.md`, and `frontend/AGENTS.md` for v3 service,
  binding, runtime-adapter, and generation commands.
- `DEVELOPMENT.md` for `wails3 doctor`, dev/build commands, dependencies, and
  metadata ownership.
- `RELEASE.md` for version changes and v3 artifact paths, plus the release
  workflow for updater asset matching, digests, signatures, and staged-update
  behavior if the updater track is promoted.
- `docs/architecture/error-reporting.md` for the new application run and
  lifecycle error boundaries.
- `docs/architecture/shared-contracts.md`, `docs/architecture/data-access.md`,
  and `docs/frontend/component-structure.md` for generated v3 binding/model
  ownership.
- `docs/architecture/data-freshness.md`, `docs/architecture/refresh-system.md`,
  `backend/AGENTS.md`, and `frontend/AGENTS.md` for Wails service-route and named
  Stream ownership, origin, readiness, and generation commands.
- `docs/frontend/keyboard.md` and any app-shell docs whose native menu or
  window-runtime references change.
- App-shell persistence documentation for screen-aware geometry restoration and
  the application lifecycle documentation for single-instance/event behavior.
- `docs/frontend/tabs.md`, `docs/frontend/modals.md`, and
  `docs/frontend/dockable-panels.md` for per-window ownership if native windows
  are promoted; app-shell menu/lifecycle guidance for tray adoption.
- `.agents` skills that instruct agents to regenerate Wails bindings or run
  Wails development builds.

Move lasting guidance into these owning documents before removing this
temporary plan.
