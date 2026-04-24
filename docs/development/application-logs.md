# Application Logs Subsystem Review

This document reviews the Application Logs subsystem as it exists today across
the Go backend and React frontend. It is intentionally separate from the Object
Panel Logs Tab and from Kubernetes container logs.

## Scope

Application Logs are the app's own diagnostic log buffer. They are shown in the
global Application Logs Panel and are backed by `backend.Logger`.

They are not Kubernetes container logs. Container Logs are fetched from the
Kubernetes logs APIs through `backend/resources/pods/logs.go`,
`backend/refresh/containerlogsstream`, and the Object Panel Logs Tab's `LogViewer`.
Those paths have their own settings, stream limits, buffers, timestamp
formatting, and UI.

## Current Architecture

### Backend Data Model

Core files:

- `backend/logger.go`
- `backend/app_logs.go`
- `backend/app_lifecycle.go`
- `backend/app_ui.go`
- `backend/internal/errorcapture/error_capture.go`

`backend.Logger` is a process-local, in-memory ring buffer:

- Each entry has `timestamp`, `level`, `message`, optional `source`, and
  optional structured cluster metadata (`clusterId`, `clusterName`).
- Each entry has a monotonic `sequence` value for incremental panel updates.
- Timestamps are stored as `time.RFC3339Nano` strings.
- Levels are the enum values `DEBUG`, `INFO`, `WARN`, and `ERROR`.
- The default app logger is created in `NewApp()` with `NewLogger(1000)`.
- When the buffer exceeds `maxSize`, the oldest entries are copied out and
  discarded.
- `GetEntries()` returns a shallow copy of the slice.
- `Clear()` empties the slice but keeps capacity.
- Every write invokes the configured event emitter with `app-logs:added` and
  the newest sequence.

The Wails-exposed backend API is in `backend/app_logs.go`:

- `GetAppLogs()` returns the current in-memory entries.
- `GetAppLogsSince(sequence)` returns retained entries newer than the provided
  sequence.
- `ClearAppLogs()` clears the logger; after clear, the backend buffer is empty.
- `LogAppLogsFromFrontend(level, message, source)` lets frontend code append entries into
  the backend Application Logs buffer.

### Backend Ingestion Sources

Application Logs currently receive data from several backend sources:

- Direct app logging through `a.logger.Debug/Info/Warn/Error`.
- Standard-library `log` output via `stdLogBridge`, installed in `Startup()`.
- Captured stderr/klog output from Kubernetes libraries via
  `backend/internal/errorcapture`.
- Frontend diagnostic messages sent through `LogAppLogsFromFrontend`.

Direct app logging is widely used across backend startup, kubeconfig discovery,
cluster connection/recovery, refresh setup, resource loaders, object catalog,
streaming handlers, shell sessions, port forwarding, settings changes, auth,
and update checks. Common sources include `App`, `KubernetesClient`,
`KubeconfigManager`, `KubeconfigWatcher`, `Refresh`, `ResourceLoader`,
`ObjectCatalog`, `Auth`, `Heartbeat`, `ContainerLogsStream`, `ResourceStream`,
`EventStream`, `StreamMux`, `Settings`, `Pod`, and `ContainerLogs`.

`stdLogBridge` classifies plain `log` output heuristically:

- Lines beginning with or containing error patterns become `ERROR`.
- Lines beginning with or containing warn patterns become `WARN`.
- Everything else becomes `INFO`.
- The source is `StdLog`.

`errorcapture` redirects `os.Stderr` to a pipe and is focused on stderr from
Kubernetes client libraries. It keeps a recent stderr buffer for error
enhancement and also forwards captured lines into Application Logs through a
log sink:

- `E...` and lines containing `error` become `ERROR`.
- `W...` and lines containing `warning` become `WARN`.
- `I...` becomes `INFO` internally, but `app_lifecycle.go` writes non-warning
  and non-error error-capture messages as `DEBUG` source `ErrorCapture`.
- Auth-related stderr is separately detected and can emit `backend-error`
  events for UI auth/error handling.
- When any cluster auth state is invalid, or the captured message matches known
  auth patterns, Application Logs suppress that `ErrorCapture` entry to avoid
  spam.

Concrete affected examples for `ErrorCapture` include Kubernetes klog lines
such as:

```text
I0102 19:05:24.494180   77320 reflector.go:446] "Caches populated" type="generators.external-secrets.io/v1alpha1, Resource=cloudsmithaccesstokens"
W1010 warning issued
E1010 10:00:00 error occurred
```

### Frontend Display Path

Core files:

- `frontend/src/ui/panels/app-logs/AppLogsPanel.tsx`
- `frontend/src/ui/panels/app-logs/AppLogsPanel.css`
- `frontend/src/core/app-state-access/readers.ts`
- `frontend/src/core/logging/appLogsClient.ts`
- `frontend/src/core/contexts/ModalStateContext.tsx`
- `frontend/src/App.tsx`
- `frontend/src/hooks/useWailsRuntimeEvents.ts`
- `frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx`
- `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`

The panel is app-global, not cluster-scoped. `ModalStateContext` stores
`showAppLogsPanel`, and `AppLayout` renders `AppLogsPanel` under a
`PanelErrorBoundary`.

Open/close entrypoints:

- Native menu item: `View > Show/Hide Application Logs`.
- Global shortcut: `Ctrl+Shift+L`.
- Command palette command: `Application Logs Panel`.
- Runtime event: `toggle-app-logs-panel`.

When the panel opens:

- It calls `SetAppLogsPanelVisible(isOpen)` to sync backend menu state.
- It waits 300 ms, then reads all logs through `readAppLogs()` / `GetAppLogs()`.
  The Application Logs read path intentionally avoids `requestAppState()` so
  the log sink does not feed broker-read diagnostics back into itself.
- It subscribes to the Wails `app-logs:added` event.
- On every `app-logs:added`, it requests deltas through `GetAppLogsSince()`.
- It uses the per-listener disposer returned by `EventsOn`, so cleanup does not
  remove other `app-logs:added` listeners.

The panel provides:

- Level filtering with all levels selected by default.
- Source/component filtering based on the `source` field.
- Cluster filtering based on `clusterId` / `clusterName` when present.
- Shared dropdown bulk actions for level, source/component, and cluster
  filters.
- Case-insensitive text filtering over message, source, cluster ID, and cluster
  name.
- Auto-scroll.
- Copy visible filtered logs to clipboard.
- Clear logs.
- Basic keyboard handling for `Escape`, `s` for auto-scroll, and `Shift+C`
  for clear.

### Frontend Log Producers

`frontend/src/core/logging/appLogsClient.ts` wraps `window.go.backend.App.LogAppLogsFromFrontend`
and exports:

- `logAppLogsDebug`
- `logAppLogsInfo`
- `logAppLogsWarn`

Current frontend producers include:

- `BackgroundClusterRefresher`: logs background refresh start/stop.
- `RefreshOrchestrator`: logs refresh orchestration info and warnings.
- `ResourceStream`: logs resource stream info and warnings.
- `CatalogStream`: logs catalog stream fallback warnings.
- `useCatalogDiagnostics`: logs catalog update-rate diagnostics and warnings.

There is no `logAppLogsError` helper today, although the backend supports an
`error` level through `LogAppLogsFromFrontend`.

## Current User-Facing Behavior

The Application Logs Panel is best understood as a global support/debug console
for the running app:

- It shows lifecycle events such as startup, shutdown, settings changes, cluster
  connection, kubeconfig discovery, and refresh setup.
- It shows backend operational warnings and errors from resource loaders,
  refresh streams, object catalog, auth, shell sessions, port forwards, and
  update checks.
- It can show selected frontend refresh diagnostics.
- It can show Kubernetes client-library stderr/klog noise captured by
  `errorcapture`.

It does not show the actual stdout/stderr stream from Kubernetes containers.
Those logs live in the object panel Logs tab and node log views.

## Confusing Boundaries

The codebase now uses the following names for the separate concepts:

1. Application Logs Panel: settings/config for the panel that shows
   Application Logs. Examples: `AppLogsPanel`, `SetAppLogsPanelVisible()`.
2. Application Logs: the app's own diagnostics. Examples: `GetAppLogs()`,
   `ClearAppLogs()`, `LogAppLogsFromFrontend()`, `app-logs:added`.
3. Object Panel Logs Tab: settings/config for the Object Panel tab that shows
   Container Logs. Examples: `ObjPanelLogsSettings`,
   `getObjPanelLogsBufferMaxSize()`, `settings:obj-panel-logs-buffer-size`.
4. Container Logs: the actual Kubernetes pod/container log data. Examples:
   `FetchContainerLogs()`, `ContainerLogsFetchRequest`,
   `ContainerLogsEntry`, the `container-logs` refresh domain.

The `Object Panel Logs Tab Settings` modal is for the Object Panel Logs Tab,
not Application Logs. Its buffer size controls Object Panel Logs Tab
scrollback for Container Logs. It does not resize the Application Logs backend
buffer, which is currently fixed at `NewLogger(1000)`.

## Existing Test Coverage

Backend coverage:

- `backend/app_logs_test.go` covers nil logger handling, `GetAppLogs()`,
  structured cluster metadata, `ClearAppLogs()`, and `LogAppLogsFromFrontend()` level/source
  normalization.
- `backend/app_ui_test.go` covers Application Logs Panel toggling, event emission, and menu
  state updates.
- `backend/app_lifecycle_test.go` covers `stdLogBridge` level classification.
- `backend/internal/errorcapture/error_capture_test.go` covers stderr capture,
  interesting auth-error extraction, log-sink level classification, and
  cluster-prefixed capture.

Frontend coverage:

- `frontend/src/ui/panels/app-logs/AppLogsPanel.test.tsx` covers visibility
  sync, loading, rendering, load errors, filters, cluster metadata, shared
  dropdown bulk-action wiring, keyboard focus routing, clearing, and clipboard
  failures.
- `frontend/src/shared/components/dropdowns/Dropdown/Dropdown.test.tsx` covers
  shared dropdown bulk actions and verifies that opening a sibling dropdown
  closes the previously open dropdown even when a parent stops `mousedown`
  bubbling.
- Shortcut and command-palette tests cover the general UI entrypoints.
- Streaming manager tests mock frontend Application Logs producers.

Notably missing:

- No test asserting that Application Logs settings are independent from container log
  settings.
- No end-to-end Wails integration test that exercises backend
  `app-logs:added` emission through the native runtime into the rendered panel.
- No direct unit test for multiple Wails listeners on the same event.

## Completed Work

- [x] Added structured `clusterId` and `clusterName` fields to Application Log
  entries.
- [x] Updated cluster lifecycle/auth/refresh/heartbeat/client log producers to
  populate cluster metadata through the existing logger methods.
- [x] Added Application Logs UI support for displaying, filtering, searching,
  and copying cluster metadata.
- [x] Moved logger `app-logs:added` event emission outside the logger mutex.
- [x] Kept Application Logs reads out of `requestAppState()` to avoid a
  diagnostics/logging feedback loop.
- [x] Replaced custom Application Logs select-all sentinel options with the shared
  `Dropdown` component's built-in bulk actions.
- [x] Fixed shared dropdown outside-click handling so sibling dropdowns close
  correctly even inside parents that stop `mousedown` bubbling.
- [x] Added focused backend/frontend tests for the completed Application Logs
  and dropdown behavior.

## Risks And Gaps

### Ranked Findings

1. Medium-low: Application Logs have no persistence or file export path, which
   limits support workflows after restart or early startup failure.
2. Low: Source names are still accepted as free-form values at API boundaries,
   so non-canonical or one-off sources can still drift.
3. Low: Rendering is not virtualized. This is fine for the fixed 1000-entry
    buffer, but becomes a concern if the buffer grows.
4. Low: Application Log timestamp formatting is hard-coded and intentionally
    separate from container log timestamp preferences, but the distinction is not
    obvious.

Completed finding:

- Cluster-aware Application Log entries and UI filtering are complete.
- Clear behavior is normalized: clearing Application Logs leaves the backend
  buffer and frontend panel empty, with no marker row.
- Application Logs, Application Logs Panel, Object Panel Logs Tab, and
  Container Logs naming is clarified through hard-renamed backend APIs,
  generated Wails bindings, frontend helper names, settings events, and UI
  copy.
- Event emission no longer happens while holding the logger mutex.
- Severity classification is centralized for indirect log ingestion:
  `stdLogBridge` and `errorcapture` both use the same klog-aware classifier.
  Klog prefixes are only interpreted when they match the standard
  `E1234` / `W1234` / `I1234` shape, and plain text uses word-boundary
  fallback matching.
- Application Logs now show all log levels by default, including `debug`.
- Application Logs live updates now use a small event contract: entries have a
  monotonic `sequence`, `app-logs:added` emits the newest sequence, the panel
  reads deltas through `GetAppLogsSince()`, and cleanup uses the per-listener
  disposer returned by Wails `EventsOn`.
- The frontend Application Logs helper now has debug/info/warn/error helpers
  and direct unit coverage for backend calls, defensive no-op behavior, and
  event subscription cleanup.
- Common backend Application Log sources now live in
  `backend/internal/logsources`, and common frontend producers use
  `APP_LOG_SOURCES` from `appLogsClient.ts`.

### Application Logs Are Not Structured Enough For Multi-Cluster Diagnosis

Entries have `source`, message text, and optional `clusterId` / `clusterName`.
Many cluster lifecycle paths now populate those fields, but object-level
diagnostics are still only free-form text.

Missing structured fields that would help:

- `domain` or subsystem
- `operation`
- optional Kubernetes object reference fields: group, version, kind, namespace,
  name

This matters because the app is multi-cluster. A global log panel is fine, but
object-specific messages should also be filterable without relying on free-form
text.

### Source Names Are Still Not Enforced

Common source names are now centralized as constants. That reduces drift in app
code, but the `source` field is still an arbitrary string. `LogAppLogsFromFrontend`
also accepts a source string from callers. That keeps the API simple, but custom
or one-off sources can still appear.

If stricter filtering becomes important, make `source` an enum-like type for
internal producers and keep only the Wails frontend API as a string boundary.

### Application Log Buffer Size Is Not Configurable

The app has user-visible "Object Panel Logs Tab buffer size" settings, but
those settings apply to the Object Panel Logs Tab's Container Logs display.
Application Logs remain fixed at 1000 entries.

That may be enough, but it should be intentional and named clearly. If support
work often needs longer app history, add an Application Logs-specific buffer
setting or increase the fixed size.

### No Persistence Across Restart

Application Logs are memory-only. This is simple and appropriate for normal use,
but it limits debugging startup failures, early crashes, or issues discovered
after restart. There is also no "save to file" action, only copy-to-clipboard.

### Rendering Is Not Virtualized

Rendering up to 1000 rows is likely fine. If the Application Logs buffer becomes
configurable or much larger, `AppLogsPanel` should use the same virtualization
discipline as larger tabular/log surfaces.

### Timestamp Formatting Is Hard-Coded

Application Logs render local `HH:mm:ss.SSS` using `Intl.DateTimeFormat`. The
container log timestamp settings do not apply. That is fine if intentional, but the
difference should be visible in naming and docs.

## Simplification Opportunities

### Separate Names For The Four Log Concepts

Completed: settings and comments now use explicit names:

- "Application Logs Panel" for the panel UI/config.
- "Application Logs" for `backend.Logger` entries.
- "Object Panel Logs Tab" for object-panel tab UI/settings.
- "Container Logs" for Kubernetes pod/container log rows.

### Introduce A Small App Log Contract

Partially complete: common source constants now exist for backend and frontend
Application Logs producers. Remaining structure that would help:

- Document the existing optional logger metadata arguments for cluster-scoped
  messages in the logger API.
- Add stronger types around internal source values if source drift continues.
- Keep the existing `Logger` simple.

### Normalize Event Delivery

Completed: `Logger.Log()` now appends under lock, releases the lock, and then
emits `app-logs:added`.

### Remove Duplicate Filter Logic

`AppLogsPanel` duplicates the same filtering logic for rendering and copy. Move
that into a small local helper such as `filterLogEntries(logs, filters)`. This
would make future changes to filter semantics less error-prone.

### Frontend Logging Helper Coverage

Completed: `appLogsClient.ts` exports debug/info/warn/error helpers and has
direct tests for level forwarding, message/source normalization, defensive
no-op behavior, and `app-logs:added` subscription cleanup.

## Missing Capabilities

High-value missing capabilities:

- Complete object-reference metadata and filtering for object-specific
  messages.
- Stronger enforcement for canonical source names.
- Export/save logs to a file.
- Copy all logs regardless of active filters.
- Optional persistent crash/startup log file for early startup failures.

Lower-priority capabilities:

- Per-source level thresholds.
- Pause/resume live updates.
- Search result count and next/previous match navigation.
- "Follow tail" semantics separate from auto-scroll checkbox.
- De-duplication or rate limiting for repeated noisy messages.
- Structured metadata display for cluster/object references.

## Recommended Backlog

1. Add complete object-reference metadata to `LogEntry` for object-specific
   messages.
2. Consider Application Logs export/persistence if support workflows need logs
   after restart.

## Manual Testing Checklist

Application Logs smoke test:

1. Run `mage dev`.
2. Open the app and select one or more clusters.
3. Open `View > Show Application Logs` or press `Ctrl+Shift+L`.
4. Confirm startup and cluster-selection messages appear.
5. Enable `Debug` in the log-level filter and confirm debug entries can appear.
6. Filter by a source such as `App`, `Refresh`, or `ResourceStream`.
7. Filter by a cluster when cluster-scoped entries are present.
8. Type text into the text filter and verify count changes.
9. Click Copy and verify the clipboard contains only visible filtered logs.
10. Click Clear and verify the panel is empty.
11. Close and reopen the panel and verify logs reload from the backend buffer.
12. Open one filter dropdown, then open another, and verify only one dropdown
    menu remains open.

Frontend producer test:

1. Trigger a refresh path that logs through `RefreshOrchestrator` or
   `ResourceStream`.
2. Open Application Logs.
3. Confirm entries use the expected source and level.

Kubernetes stderr/klog test:

1. Open Application Logs.
2. Include `Debug`.
3. Navigate resource views that start informers or resource streams.
4. Look for `ErrorCapture` entries such as Kubernetes reflector/cache messages
   or warnings/errors.

Container log isolation test:

1. Open an object panel Logs tab for a pod/workload.
2. Stream or fetch container logs.
3. Confirm container stdout/stderr appears in the Object Panel Logs Tab, not as
   Application Logs entries unless the log subsystem itself emits a diagnostic.
