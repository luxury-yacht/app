# Wails v3 Migration Plan

Status: revised plan; no implementation has started
Created: 2026-08-11

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
  `@latest`. On 2026-08-11,
  `curl -fsSL https://proxy.golang.org/github.com/wailsapp/wails/v3/@v/list | sort -V | tail -n 20`
  ended at `v3.0.0-beta.7`; re-run this check and review intervening release
  notes immediately before changing dependencies.
- Accept the Wails v3 beta risk for this branch. Do not wait for an RC or GA and
  do not preserve v2 as a release fallback. Wails currently calls v3 a beta
  with a stable desktop API and advises thorough deployment testing in its
  [beta announcement](https://v3.wails.io/blog/wails-v3-beta/) and
  [status page](https://v3.wails.io/status/); the validation gates below are the
  mitigation for that accepted risk.
- Keep `backend.App` as one Wails service for the first runnable port, then use
  the service-decomposition track in Phase 5 to decide its final v3 shape and
  execute the split if promoted. Its generated v2 binding currently has 178
  exported methods
  (`rg -c '^export function ' frontend/wailsjs/go/backend/App.js` -> `178`).
  Do not change transport and service ownership in the same red/green step.
- Put Wails v3 application/window objects behind one backend desktop-runtime
  adapter and one frontend desktop-runtime adapter. Do not spread Wails manager
  calls or `@wailsio/runtime` imports through domain code.
- Remove **New Window** during the core port. Delete the process-spawning
  implementation (`backend/menu.go:41-55`), File-menu item, `Cmd/Ctrl+N`
  accelerator, tests, and documentation references; do not leave a disabled or
  placeholder command. Reintroduce the option only through the Phase 5 native
  v3 multi-window track after process, Kubernetes client, persistence, refresh,
  and teardown ownership are defined and tested.
- Make the pinned v3 CLI's generated project layout the product metadata and
  native-build source of truth. Confirm during the spike whether that release
  requires only `build/config.yml` or also a v3-formatted `wails.json`. Keep
  Mage as the repository-facing command layer for quality checks, release
  orchestration, signing coordination, and artifact collection, but remove
  Mage code that depends on v2-only CLI flags or v2 internal templates.
- Treat this branch as a one-way v3 cutover. V2 may be run only to record the
  pre-migration baseline before implementation starts. Git history is the only
  rollback boundary: do not keep dual runtime code, build modes, dependency
  pins, generated bindings, tests, or CI jobs.
- Use Wails v3's default GTK4 + WebKitGTK 6.0 backend as the only Linux target.
  Do not build, package, test, auto-detect, or document a `-tags gtk3` fallback.
  This deliberately drops distributions that only provide the legacy stack,
  including Ubuntu 22.04 LTS and Debian 12; the
  [installation guide](https://v3.wails.io/quick-start/installation/#build-tools-and-webkit)
  currently sets the default-stack floor at Ubuntu 24.04 or Debian 13. Recheck
  the pinned beta's requirements before implementation and update the product's
  supported-distro documentation as part of the cutover.

## Scope model

### Required target-design outcomes

- Make application, process, service, and window ownership explicit. Use named
  window references behind the desktop adapter; do not embed an implicit
  "current window" assumption in backend domain code.
- Produce a target service map for all 178 currently bound methods. The first
  runnable v3 port may register one `App` service, but each method must have an
  intended long-term service owner before the migration is considered planned.
- Leave one coherent v3-only build architecture. Required Taskfile, Mage, CI,
  packaging, metadata, and generated-binding cleanup is migration work, not
  unrelated cleanup.
- Evaluate mounting the private refresh API through a v3 service HTTP route. Use
  it only if a spike proves snapshot, manual-job, SSE, WebSocket, readiness,
  cancellation, correlation-ID, multi-cluster routing, and teardown parity; do
  not reduce this to a base-URL substitution.
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
- Legacy GTK3/WebKit2GTK 4.1 builds and Linux distributions that cannot provide
  the pinned Wails v3 release's GTK4/WebKitGTK 6.0 runtime dependencies.
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

## Current inventory

| Domain | Current evidence | Migration consequence |
| --- | --- | --- |
| Application composition | `main.go:57-160` creates the backend, menu, lifecycle callbacks, one window, embedded assets, and platform options in one `wails.Run`. | Create the v3 application first, create and retain a named main window, inject a desktop adapter, register the backend service, install lifecycle hooks, then call `app.Run()`. |
| Backend runtime lifecycle | `backend/app.go:25-35`, `backend/app.go:196-241`, and `backend/app_runtime.go:9-48` store a Wails context capability separately from the backend cancellation signal. | Retain the cancellation boundary from `ServiceStartup(ctx, ...)`, but replace context-bound runtime operations with an injected app/window adapter. |
| Startup and shutdown | `backend/app_lifecycle.go:41-63` performs UI and cluster startup; `backend/app_lifecycle.go:223-272` saves window state before close and tears down background systems at shutdown. | Split service readiness from webview readiness. Persist window state while the main window is alive, and run backend teardown from `ServiceShutdown`. |
| Refresh webview transport | `backend/app_refresh_setup.go:457-479` builds the aggregate HTTP mux and `backend/app_refresh_setup.go:522-543` binds it to a random loopback port. `backend/refresh/api/server.go:311-325` and `backend/refresh_stream_cors.go:5-30` own CORS, while `frontend/src/core/refresh/client.ts:47-55` and `frontend/src/core/refresh/client.ts:159-175` discover and retry the runtime base URL. | Spike a stable v3 service route against every HTTP and streaming contract. If it passes, mount the existing aggregate handler behind one stable same-origin route and remove only the transport-specific listener/base-URL/CORS machinery; do not change refresh domain semantics. |
| Native capabilities | Nine production Go files import Wails v2 (`rg -l 'github.com/wailsapp/wails/v2' --glob '*.go' .` classified by `_test.go` -> `9` production and `5` test files). Menus, events, dialogs, clipboard, window state, quit/hide, and window commands are represented in `main.go`, `backend/app_lifecycle.go`, `backend/app_settings.go`, `backend/app_data_management.go`, `backend/app_csv_export.go`, `backend/kubeconfigs.go`, and `backend/menu.go`. | Define the adapter around the needed capabilities and port each producer/consumer pair to v3 managers. Avoid a local wrapper per call site. |
| Menu contract | `backend/menu.go:14-38` owns the menu tree; `backend/menu.go:65-100`, `backend/menu.go:131-174`, `backend/menu.go:176-250`, and `backend/menu.go:295-347` connect native items to frontend events and window/app operations. | Rebuild the menu labels, accelerators, platform differences, callbacks, and dynamic visibility labels using the v3 menu manager, with **New Window** deliberately removed. |
| New Window removal | `backend/menu.go:41-55` respawns the executable; `backend/menu.go:74-80` exposes it as **New Window** with `Cmd/Ctrl+N`. `rg -n -i 'new window|spawnNewWindow' . --glob '!docs/plans/wails-v3-migration.md' --glob '!frontend/wailsjs/**'` finds no other implementation surface. | Remove the menu item, accelerator, callback, now-unused process imports, tests, and user/developer documentation during the core menu port. Assert the option is absent until Phase 5 implements native windows. |
| Process multiplicity | `rg -n 'SingleInstance|single instance|single-instance' main.go backend frontend/src mage .github` returns no match; process spawning is currently explicit only in the **New Window** implementation above. | Decide whether v3 should reject/funnel subsequent launches or continue allowing independent manual processes. If single-instance is enabled, second-launch handling restores/focuses the named main window and validates all incoming data. |
| Binding surface | `frontend/wailsjs/go/backend/App.js` exposes 178 methods, while `frontend/src/core/backend-api/index.ts:1-74` explicitly allows 67 of them into application code. | Generate v3 TypeScript bindings for one `App` service and repoint the explicit facade. Do not make the other generated methods reachable merely because v3 generated them. |
| Dynamic binding access | Eight production frontend files still inspect `window.go` (`rg -l 'window\.go' frontend/src --glob '*.{ts,tsx}'` classified by `.test.` -> `8` production and `3` test files). | Replace global availability probes and dynamic calls with typed facade/adapter functions; remove the v2 `Window.go` declaration. |
| Frontend runtime | Twenty-one production frontend files use `@wailsjs/runtime/runtime` or `window.runtime` (`rg -l '@wailsjs/runtime/runtime|window\.runtime' frontend/src --glob '*.{ts,tsx}'` classified by `.test.` -> `21` production and `27` test files). | Route events, browser URLs, clipboard, current-window actions, and environment checks through one frontend adapter backed by `@wailsio/runtime`. |
| Event payloads | Backend event producers include lifecycle/auth/health, app logs, menus, shell sessions, port forwards, runtime operations, and app updates (`rg -n 'emitEvent\(' backend`). Frontend consumers currently expect positional payload arguments, for example `frontend/src/hooks/useWailsRuntimeEvents.ts:43-53` and `frontend/src/hooks/useWailsRuntimeEvents.ts:117-123`. | Normalize the v3 `WailsEvent.data` envelope at the frontend adapter boundary and add payload contract tests for every event family. |
| Application/window events | `main.go:83-93` installs the v2 menu-update listener; `main.go:126-128` installs startup, before-close, and shutdown callbacks. Platform workarounds also depend on window/menu timing (`main.go:100-112`, `backend/app_ui.go:55-65`, `backend/menu.go:198-218`). | Map each behavior to a v3 application event, window event, cancellable hook, service lifecycle method, or explicit adapter action. Do not subscribe to unused events or duplicate one behavior across hook families. |
| Update flow | `backend/app_update.go:22-214` checks GitHub Releases, builds `UpdateInfo`, and emits `app-update`; `frontend/src/ui/status/UpdateStatus.tsx:75-104` owns the runtime subscription and download-link status. | Preserve this notification contract during the core port. In Phase 5, compare it explicitly with `app.Updater` download, verification, installation, restart, event, and UI behavior before replacing anything. |
| System tray | `rg -n -i 'system.?tray|systray|tray menu' backend frontend/src main.go --glob '*.{go,ts,tsx}'` finds only the forward-looking comment at `frontend/src/App.tsx:179-184`; no tray lifecycle or native menu is currently registered. | Treat tray adoption as a new app-shell workflow with explicit last-window and quit behavior, not as incidental menu porting. |
| Generated models | `frontend/wailsjs/go/models.ts` is 6,306 lines (`wc -l frontend/wailsjs/go/models.ts`), and 36 production plus 20 test files import it (`rg -l '@wailsjs/go/models' frontend/src --glob '*.{ts,tsx}'`, classified by `.test.`). Descriptor drift tests instantiate generated DTO classes as documented in `docs/frontend/component-structure.md`. | Generate v3 TypeScript classes into a scratch location first, compare JSON names/nullability/constructors, then update model imports. Do not select interface-only generation unless constructor-dependent consumers are redesigned first. |
| Window chrome | `main.go:114-151` sets size bounds, hidden startup, platform appearance, and the v2 drag-property mapping. Current CSS uses `--wails-draggable: true` and `none` in `frontend/src/ui/layout/AppHeader.css:1-43` and `frontend/styles/components/modals.css:16-24`. | Map window options explicitly and change drag values to the v3 `drag`/`no-drag` contract documented in [Frameless Windows](https://v3.wails.io/features/windows/frameless/). Verify controls remain clickable. |
| Window geometry | `backend/resources/types/types.go:27-33` persists X/Y/width/height/maximized; `backend/app_settings.go:642-684` saves and loads those fields; `backend/app_lifecycle.go:154-167` restores any positive size and only non-negative coordinates without checking current work areas. | Keep the persisted fields, validate the saved logical rectangle with the v3 screen manager, retain valid negative coordinates on left/upper monitors, and clamp or center when no current work area can display the window. |
| Platform workarounds | `main.go:100-112` carries Linux hidden-window and Wayland maximum-size workarounds; `backend/app_ui.go:55-65` suppresses Linux menu rebuilds; `backend/menu.go:198-218` works around Windows accelerator behavior. | Keep each workaround until its exact behavior is exercised on v3, then retain or remove it with a focused regression test and a comment tied to the observed v3 behavior. |
| Development/build | `mise.toml:1-13`, `go.mod:1-17`, `magefile.go:194-208`, and `mage/build-config.go:54-74` pin v2 and build through v2 commands/flags. | Pin the v3 module, CLI, and frontend runtime as one compatible set; port `mage dev`/`mage build` to the v3 task model. |
| Platform packaging | macOS builds append v2 `--platform` (`mage/macos.go:248-270`); Windows appends `-o`/`-nsis` and reads a v2 internal NSIS template (`mage/windows.go:13-24`, `mage/windows.go:66-97`, `mage/windows.go:157-176`); Linux detects WebKit2GTK and conditionally adds `webkit2_41` (`mage/linux.go:13-50`). | Port platform packaging to v3 Taskfiles/build assets. Use only the default GTK4/WebKitGTK 6.0 Linux backend and delete legacy WebKit detection/tags. The v3 build command no longer accepts the v2 flags; the [v3 build-system reference](https://v3.wails.io/concepts/build-system/) assigns platform builds, output paths, icons, and packaging to Taskfiles and `build/config.yml`. |
| Build directory ownership | `.gitignore:26-29` ignores all of `build/`, while existing Mage/Wails output already occupies `build/bin`, `build/darwin`, `build/artifacts`, and `build/packages` (`mage/build-config.go:54-74`, `mage/macos.go:12-13`, `mage/linux.go:142-169`). | Reserve tracked portions of `build/` for v3 configuration/platform assets and ignore only generated output paths. Decide output locations before generating v3 assets so configuration is not hidden by the current blanket ignore. |
| Release matrix | `.github/workflows/release.yml:35-58` builds macOS Intel/Apple Silicon, Windows amd64/arm64, and Linux amd64/arm64; `.github/actions/setup-toolchain/action.yaml:20-43` installs the v2 CLI and Linux WebKit2GTK 4.1 headers. | Update the shared action to install GTK4/WebKitGTK 6.0 and prove every existing architecture target and artifact path before cutover. Distro compatibility below the new GTK4 baseline is deliberately not preserved. |
| Product metadata | `wails.json:1-24` owns app/release metadata; `frontend/vite.config.ts:14-24`, `mage/utils.go:49-84`, `DEVELOPMENT.md:87-103`, and `RELEASE.md:75-81` consume it. | Move these consumers atomically to the pinned v3 metadata source (or a generated repository-owned view). Delete the v2 file if obsolete, or replace its contents with the v3 schema if the pinned CLI still requires that filename. |
| Test scaffolding | Storybook emulates `window.runtime` and `window.go` in `frontend/.storybook/preview.ts:4-17` and `frontend/.storybook/preview.ts:64-96`; frontend globals declare the same v2 shape in `frontend/src/types/global.d.ts:10-25`. | Mock the new frontend adapter and generated binding module instead of recreating v2 globals. Keep Storybook browser-only behavior available. |

## Target model and ordering

1. `main` creates `application.App` with embedded frontend assets and no backend
   service cycle.
2. `main` creates a named main `WebviewWindow`, initially hidden where the
   current platform behavior requires it, and registers that exact window in a
   window resolver. Window-scoped operations require an explicit window name or
   handle even while only one window exists.
3. `main` constructs a Wails v3 desktop adapter with the application and window
   resolver, constructs `backend.App` with that adapter, and initially registers
   `backend.App` as one process-scoped service.
4. `main` registers `WindowRuntimeReady` and quit hooks before `app.Run()`.
5. `backend.App.ServiceStartup` receives the application-lifetime cancellation
   context. It may initialize non-UI prerequisites, but the desktop adapter
   remains unable to emit frontend events or invoke interactive UI until the
   window runtime-ready callback advances it.
6. The runtime-ready callback advances the adapter exactly once, then runs the
   interactive startup sequence: beta-expiry dialog/quit gate, window restore,
   window show, cluster initialization, watcher startup, update check, and
   installation metric scheduling. The transition that marks the adapter ready
   must not itself depend on the ready gate.
7. A single idempotent pre-quit path waits for pending selection persistence and
   reads/saves main-window geometry before the window is closed. Test window
   close, native Quit/Exit, and programmatic `app.Quit()` paths.
8. `backend.App.ServiceShutdown` cancels and tears down auth recovery, runtime
   operations, kubeconfig watching, and refresh subsystems. It does not use a
   closed window or frontend runtime.

This ordering avoids a constructor cycle: the Wails application exists before
the backend service, while backend code receives only the adapter it needs.
The adapter distinguishes application-scoped operations from window-scoped
operations so Phase 5 can add native windows without reintroducing implicit
global window state. V3 services remain process-scoped and must not acquire a
window identity by guessing from focus.
It also addresses the v3 warning that Go-to-frontend events should wait for
`WindowRuntimeReady`; see the official
[Events API](https://v3.wails.io/reference/events/) and
[window events reference](https://v3.wails.io/features/windows/events/).

## Phased implementation checklist

### Phase 0: Reproducible spike and baseline

- [ ] Re-run the v3 version query, read the migration notes and release notes
      from v2.14.0 through the selected v3 beta, and record the selected module,
      CLI, and `@wailsio/runtime` versions in this plan.
- [ ] Generate a fresh v3 React/TypeScript project outside the repository with
      the pinned CLI. Inventory its `main.go`, binding command/output, runtime
      package version, `Taskfile.yml`, `build/config.yml`, and platform assets.
- [ ] Build an application/window event matrix from the pinned release. For each
      current startup, ready, focus, theme, menu-update, close, quit, shutdown,
      and platform-workaround behavior, record the v3 event/hook owner,
      cancellability, ordering, readiness, window identity, cleanup, and test.
- [ ] Spike the existing aggregate refresh mux as a v3 service HTTP route. Prove
      snapshots, ETags, permission errors, manual POST/jobs, telemetry, metrics,
      SSE resume/error behavior, WebSocket subscribe/replay/reset, correlation
      IDs, cancellation, multi-cluster handler replacement, and shutdown. Record
      request origin and whether CORS remains necessary.
- [ ] Refresh-route decision gate: prefer the stable v3 service route only if all
      transport and freshness contracts pass. Otherwise retain the v3-owned
      loopback transport with the failed contract and upstream limitation
      documented; do not ship two refresh transports.
- [ ] Exercise the pinned v3 single-instance callback before choosing process
      policy. Record behavior for a second launch before runtime-ready, after
      ready, while minimized/hidden, and during shutdown, including all incoming
      argument and working-directory trust boundaries.
- [ ] Verify v3 screen coordinates/work areas on macOS, Windows, X11, and Wayland
      use the logical coordinate contract expected by persisted window settings,
      including a monitor positioned left of or above the primary display.
- [ ] Resolve the documentation mismatch before editing repository config: the
      migration guide still illustrates a v3 `wails.json`, while the current
      [build-system reference](https://v3.wails.io/concepts/build-system/) says
      project metadata lives in `build/config.yml`. Follow the pinned CLI's
      generated project and record the result here.
- [ ] Run the current v2 focused lifecycle/menu/frontend runtime tests and
      `mise exec -- mage qc:prerelease`; record exact baseline failures, if any.
- [ ] Produce current unsigned artifacts on the available host and record the
      binary/app/installer names and internal metadata. Let CI provide the other
      platform baselines.
- [ ] Generate v3 bindings for the existing single `App` service into a scratch
      directory. Record unsupported methods/types, generated service path,
      model path structure, constructor behavior, enum behavior, and error
      mapping before changing frontend imports.
- [ ] Map all 178 bound methods and the 67-method frontend allowlist to candidate
      v3 service owners. Record shared dependencies, lifecycle ordering, event
      ownership, and methods that should cease to be bound.
- [ ] For each Phase 5 track, record `promoted on this branch` or `planned
      follow-up` with the product contract and evidence behind the decision. Do
      not silently treat an undecided track as complete.
- [ ] Exit gate: a minimal branch-only v3 composition starts, displays the
      frontend, calls one backend method, exchanges one event, opens one dialog,
      and produces one local development build without a dual runtime path.

### Phase 1: Backend desktop-runtime seam and lifecycle

- [ ] Red: add adapter tests proving UI/runtime operations fail or no-op before
      readiness while the explicit `MarkRuntimeReady` transition remains
      callable and enables subsequent operations.
- [ ] Red: add ordering tests for service startup, runtime-ready interactive
      startup, pre-quit persistence, service cancellation, and service shutdown.
- [ ] Define the narrow backend desktop contract needed by current consumers:
      event emission, menu replacement, dialogs, clipboard text, current-window
      state/actions, browser/application hide/quit, and readiness.
- [ ] Inject that contract through `NewApp`; keep Kubernetes and persistence
      code unaware of `application.App` and `WebviewWindow`.
- [ ] Replace `setRuntimeContext`/`runWithRuntimeContext` with an
      application-lifetime cancellation boundary plus the injected desktop
      capability. Preserve `CtxOrBackground` cancellation semantics used by
      refresh/auth/session work.
- [ ] Implement `ServiceStartup` and `ServiceShutdown` on the single App service
      using the exact lifecycle interface of the pinned v3 release.
- [ ] Split current `Startup` into non-UI service initialization and a once-only
      runtime-ready interactive startup path.
- [ ] Red: add refresh-transport contract tests proving an early request cannot
      read an unready handler while the initialization/replacement operation
      needed to publish the ready aggregate mux remains allowed.
- [ ] If the v3 service route passes Phase 0, register one stable route backed by
      an atomically replaceable aggregate handler. Preserve per-cluster
      initialization order, cluster-scoped routing, retained data, stream replay
      or reset, queued-job migration, diagnostics, and teardown.
- [ ] Move the frontend refresh client to the stable same-origin route only after
      every snapshot/job/SSE/WebSocket test passes. Then delete
      `GetRefreshBaseURL`, URL retry/cache state, the loopback listener/server
      fields, and CORS code proven unnecessary by the selected origin contract.
- [ ] If Phase 0 rejects the service route, port exactly one loopback transport
      to the v3 lifecycle and retain its exposure, CORS, readiness, and teardown
      tests. Record why it remains; do not keep service-route compatibility code.
- [ ] Make pre-quit persistence idempotent and cover pending selection mutation,
      missing runtime, window-state read failure, and repeated quit requests.
- [ ] Green/refactor: remove v2 runtime-context globals and tests only after the
      new adapter/lifecycle tests pass.

### Phase 2: Application, window, menus, and native capabilities

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
- [ ] Red if single-instance is enabled: prove second launch before readiness is
      queued safely, after readiness restores/focuses the main window, shutdown
      does not resurrect it, and arguments/working directory/additional data are
      ignored or validated as untrusted input. Do not embed a reusable secret in
      source solely to enable optional instance-message encryption.
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
      bring-to-front behavior through the backend adapter.
- [ ] Rebuild the native menu through the v3 menu manager. Preserve top-level
      order, labels, accelerators, platform-only items, asynchronous callbacks,
      frontend event names, dynamic panel/sidebar labels, and the development
      debug menu except for the explicitly removed **New Window** command.
- [ ] Replace the `update-menu` round trip with one explicit menu refresh method
      owned by the adapter. Test state change -> rebuilt menu -> installed menu.
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

- [ ] Add a generated-binding drift check that runs the pinned v3 generator and
      fails when committed bindings differ.
- [ ] Generate TypeScript class bindings for the single `App` service and
      compare all DTO field names, optional/null behavior, nested namespace
      exports, constructors, and error results used by current consumers.
- [ ] Replace the `@wailsjs` alias with a v3 `@bindings` alias and update the
      explicit `core/backend-api` allowlist to the generated App service path.
- [ ] Replace all production `window.go` reads with typed backend API or desktop
      availability helpers; then remove `Window.go` from `global.d.ts`.
- [ ] Add `@wailsio/runtime` at the version paired with the pinned v3 release and
      create one frontend desktop-runtime module for typed event subscription,
      browser URL open, clipboard text, current-window actions, and environment
      access.
- [ ] Normalize `Events.On` callbacks to deliver `event.data` to application
      handlers. Add table-driven tests for menu/paste, connection status,
      lifecycle/auth/health, app logs, shell output/status/list, port-forward
      status/list, runtime-operation list, update, appearance, and kubeconfig
      events.
- [ ] Migrate all 21 production v2 runtime consumers to the adapter; use returned
      unsubscribe functions instead of broad event-name removal when the v3 API
      permits it.
- [ ] Replace Storybook's `window.runtime`/`window.go` proxies and Vitest's v2
      runtime harness with adapter-level mocks. Keep browser-only URL behavior
      and generated-model mocks working.
- [ ] Update Vite, TypeScript, Biome boundary tests, Knip, Sonar exclusions, and
      editor settings from `frontend/wailsjs` to the v3 binding directory.
- [ ] Delete `frontend/wailsjs` only after repository search finds no production,
      test, build, lint, Storybook, or documentation consumer.

### Phase 4: Build, packaging, CI, and metadata

- [ ] Pin `github.com/wailsapp/wails/v3` and
      `github.com/wailsapp/wails/v3/cmd/wails3` to the same exact beta in
      `go.mod` and `mise.toml`; update the Mage compatibility test first.
- [ ] Generate v3 Taskfiles and platform assets into a reviewed layout. Change
      `.gitignore` from blanket `build/` exclusion to tracked config/assets plus
      explicit generated-output exclusions.
- [ ] Move product name, identifier, description, copyright, version, and beta
      expiry inputs to one authoritative metadata contract. Update Mage, Vite,
      development docs, release docs, and tests in the same phase.
- [ ] Make v3 Taskfiles own frontend build, binding generation, native resource
      generation, application build, and platform packaging. Make Mage invoke
      those tasks and collect/rename outputs for the existing release workflow.
- [ ] Port macOS per-architecture app builds, code signing, notarization, DMG
      staging, and existing artifact names. Do not switch to one universal DMG
      without a separate release decision.
- [ ] Port Windows amd64/arm64 binaries, icon/resource generation, numeric
      version normalization, EULA page, NSIS customization, and installer
      artifact names. Remove the code that reads v2's internal NSIS template.
- [ ] Port Linux builds to Wails v3's default GTK4 + WebKitGTK 6.0 backend.
      Delete WebKit version auto-detection and every `gtk3`, `webkit2_41`, and
      WebKit2GTK 4.1 build/dependency fallback; do not produce a legacy Linux
      artifact.
- [ ] Port Linux amd64/arm64 binary, DEB, and RPM output while preserving desktop
      file, icon, permissions, and release artifact names.
- [ ] Move Linux development and CI images to the pinned release's GTK4/WebKitGTK
      6.0 dependency set. Update README, development, release, and troubleshooting
      documentation to state the new minimum supported distributions and remove
      Ubuntu 22.04/WebKit2GTK 4.1 installation instructions.
- [ ] Update `mage dev`, `mage build`, `mage package:*`, the shared toolchain
      action, and release workflow. Verify that no removed v2 flags remain.
- [ ] Delete the v2-formatted `wails.json` (or replace it with the pinned v3
      schema if that CLI still requires the filename), all v2 module/CLI/runtime
      references, obsolete indirect dependencies, `frontend/wailsjs`, v2 global
      mocks, v2-only tests, and obsolete build assets after their consumers have
      moved and `go mod tidy` is clean. Do not retain compatibility shims.
- [ ] Phase exit gate: active source, tests, package manifests, lockfiles, build
      tasks, CI, agent instructions, and durable product documentation contain
      no Wails v2 import, module, command, runtime alias, global, generated file,
      or configuration path. The temporary migration plan and historical
      release notes may retain explanatory v2 references.

### Phase 5: Planned v3 follow-on tracks

The core v3 port must be green before these tracks change product behavior.
Planning and the promotion decision are required for every track. A promoted
track must finish before Phase 6; a deferred track must have a linked follow-up
plan with its target contract, dependencies, tests, and explicit non-goals.

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

- [ ] Phase exit gate: every track is marked promoted or deferred with evidence;
      every promoted track passes its focused tests and has no superseded
      implementation left in the branch.

### Phase 6: Validation and cutover

- [ ] Run focused backend lifecycle/runtime/menu/dialog/window tests and measure
      directly affected backend coverage with
      `mise exec -- mage test:backendCoverage`; target 80% statement coverage or
      record the measured gap for review.
- [ ] Run the selected refresh transport's snapshot, job, SSE, WebSocket,
      permission, readiness, recovery, teardown, and multi-cluster suites. Search
      for and remove the rejected transport's production code and tests.
- [ ] Run focused frontend binding/runtime/event/app-shell tests and measure
      directly affected frontend coverage with
      `mise exec -- mage test:frontendCoverage`; target 80% statement coverage or
      record the measured gap for review.
- [ ] Run `wails3 generate bindings` through the pinned tool and confirm the
      worktree remains unchanged.
- [ ] Run `mise exec -- mage qc:prerelease`, then inspect the worktree because
      the gate may format generated or handwritten files.
- [ ] Run `wails3 doctor` on each release operating system and retain its output
      with CI diagnostics.
- [ ] Use the standalone Wails app plus Playwright to exercise loading, error,
      empty, populated, navigation, and interaction states, including settings,
      modal focus, shortcuts, menus, draggable header, maximize/restore, browser
      links, clipboard paste, file/directory dialogs, shell, logs, port-forward,
      refresh diagnostics, auth failure/recovery, and multi-cluster switching.
- [ ] On the minimum supported Linux GTK4 environment, exercise every
      portal-backed import, export, CSV-save, and kubeconfig-directory dialog.
      Verify titles, default filenames/directories, filters, cancellation, and
      returned paths without relying on dialog options that the portal owns.
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

- Backend desktop adapter rejects event/dialog/window calls before ready, but
  the readiness transition itself succeeds and enables calls afterward.
- Backend window operations require explicit registered window identity; a
  focused-window lookup cannot silently choose the target.
- Saved window X/Y/width/height/maximized values round-trip unchanged when
  visible; restoration accepts valid negative coordinates and recovers an
  off-screen or oversized rectangle into a current logical work area.
- The event matrix has one tested owner per adopted application/window event or
  hook, including cancellation and readiness ordering; obsolete callback paths
  are absent.
- `ServiceStartup` cancellation propagates through `CtxOrBackground`; shutdown
  cancels refresh/auth/session work without a Wails context.
- No frontend event is emitted before `WindowRuntimeReady`; interactive startup
  runs once after readiness even if a callback repeats.
- All current Go event producers arrive at frontend handlers with the same
  application payload after the v3 event-envelope adapter.
- Pre-quit waits for selection persistence before reading window geometry and
  persists the same X/Y/width/height/maximized fields.
- Menu labels, top-level order, platform entries, accelerators, callbacks, and
  dynamic visibility labels match the current menu contract minus the explicitly
  removed **New Window** item and `Cmd/Ctrl+N` accelerator.
- Until native multi-window is promoted, menu, shortcut, command-palette, help,
  and callback registries contain no **New Window** entry or process-spawn path.
- Generated App facade exports exactly the intentional frontend allowlist; an
  added backend method is not automatically available through the facade.
- Representative generated DTOs preserve JSON field names, nullability,
  nested types, and class construction used by descriptor drift tests.
- Build metadata has one owner and Vite Sentry release, Go build manifest,
  package metadata, and release tag commands read the same version.
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
- The selected refresh transport preserves routes, methods, validators, typed
  errors, correlation identity, stream replay/reset, cancellation, readiness,
  multi-cluster isolation, handler replacement, and teardown without a second
  fallback transport.
- If single-instance is enabled, a subsequent process cannot start a second
  service/refresh lifecycle and can affect the main window only through the
  validated second-launch contract.

## Open decisions

1. **Generated model layout.** Decide only after inspecting pinned generator
   output. Preserve class constructors unless all constructor consumers and
   descriptor drift tests are deliberately redesigned.
2. **Quit-hook placement.** Confirm on the pinned beta whether `ShouldQuit`
   covers every current single-window quit route while the window remains
   queryable. If not, use one idempotent function from both the application quit
   hook and `WindowClosing`; do not duplicate persistence logic.
3. **Platform workarounds.** Each Linux/Wayland/menu and Windows accelerator
   workaround requires runtime evidence on v3 before removal or retention.
4. **Final service shape.** Decide whether service decomposition completes on
   this branch and approve the Phase 0 owner map before moving any method.
5. **Native-window workspace scope.** Decide which selection, navigation, modal,
   panel, and persistence state is window-scoped and which process resources are
   shared. Do not infer this from the current process-per-window behavior.
6. **Updater scope.** Decide whether v3 retains notification-only behavior or
   installs signed updates. Full installation changes the release-asset and
   security contracts and therefore requires explicit approval.
7. **Tray lifecycle.** Decide close-to-tray versus quit, platform availability,
   and whether tray adoption is required for the v3 cutover.
8. **Refresh route hosting.** Decide from the Phase 0 contract spike whether the
   aggregate refresh mux moves to a v3 service route or remains on one v3-owned
   loopback server. Prefer the service route only with full HTTP/stream parity.
9. **Process multiplicity.** Recommended while **New Window** is absent: enable
    single-instance behavior that restores/focuses the named main window. Decide
    explicitly if independently launched processes remain a supported workflow.

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
  `backend/AGENTS.md`, and `frontend/AGENTS.md` if refresh transport ownership,
  origin, readiness, or generation commands change.
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
