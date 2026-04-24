# Application Logs Subsystem Review

This document reviews the Application Logs subsystem as it exists today across
the Go backend and React frontend. It is intentionally separate from the pod
and object log viewer.

## Scope

Application Logs are the app's own diagnostic log stream. They are shown in the
global "Application Logs" panel and are backed by `backend.Logger`.

They are not Kubernetes pod logs. Pod and object logs are fetched from the
Kubernetes logs APIs through `backend/resources/pods/logs.go`,
`backend/refresh/logstream`, and the object panel `LogViewer`. Those paths have
their own settings, stream limits, buffers, timestamp formatting, and UI.

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
- Timestamps are stored as `time.RFC3339Nano` strings.
- Levels are the enum values `DEBUG`, `INFO`, `WARN`, and `ERROR`.
- The default app logger is created in `NewApp()` with `NewLogger(1000)`.
- When the buffer exceeds `maxSize`, the oldest entries are copied out and
  discarded.
- `GetEntries()` returns a shallow copy of the slice.
- `Clear()` empties the slice but keeps capacity.
- Every write invokes the configured event emitter with `log-added`.

The Wails-exposed backend API is in `backend/app_logs.go`:

- `GetLogs()` returns the current in-memory entries.
- `ClearLogs()` clears the logger and then writes an `INFO` entry:
  `Application logs cleared`, source `App`.
- `LogFrontend(level, message, source)` lets frontend code append entries into
  the backend Application Logs buffer.

### Backend Ingestion Sources

Application Logs currently receive data from several backend sources:

- Direct app logging through `a.logger.Debug/Info/Warn/Error`.
- Standard-library `log` output via `stdLogBridge`, installed in `Startup()`.
- Captured stderr/klog output from Kubernetes libraries via
  `backend/internal/errorcapture`.
- Frontend diagnostic messages sent through `LogFrontend`.

Direct app logging is widely used across backend startup, kubeconfig discovery,
cluster connection/recovery, refresh setup, resource loaders, object catalog,
streaming handlers, shell sessions, port forwarding, settings changes, auth,
and update checks. Common sources include `App`, `KubernetesClient`,
`KubeconfigManager`, `KubeconfigWatcher`, `Refresh`, `ResourceLoader`,
`ObjectCatalog`, `Auth`, `Heartbeat`, `LogStream`, `ResourceStream`,
`EventStream`, `StreamMux`, `Settings`, `Pod`, and `PodLogs`.

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
- `frontend/src/core/logging/appLogClient.ts`
- `frontend/src/core/contexts/ModalStateContext.tsx`
- `frontend/src/App.tsx`
- `frontend/src/hooks/useWailsRuntimeEvents.ts`
- `frontend/src/ui/shortcuts/components/GlobalShortcuts.tsx`
- `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`

The panel is app-global, not cluster-scoped. `ModalStateContext` stores
`showAppLogs`, and `AppLayout` renders `AppLogsPanel` under a
`PanelErrorBoundary`.

Open/close entrypoints:

- Native menu item: `View > Show/Hide Application Logs`.
- Global shortcut: `Ctrl+Shift+L`.
- Command palette command: `Application Logs Panel`.
- Runtime event: `toggle-app-logs`.

When the panel opens:

- It calls `SetLogsPanelVisible(isOpen)` to sync backend menu state.
- It waits 300 ms, then reads all logs through `readAppLogs()` / `GetLogs()`.
  The Application Logs read path intentionally avoids `requestAppState()` so
  the log sink does not feed broker-read diagnostics back into itself.
- It subscribes to the Wails `log-added` event.
- On every `log-added`, it refetches the entire log buffer via `GetLogs()`.

The panel provides:

- Level filtering with default levels `info`, `warn`, and `error`.
- `debug` is available but hidden by default.
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

`frontend/src/core/logging/appLogClient.ts` wraps `window.go.backend.App.LogFrontend`
and exports:

- `logAppDebug`
- `logAppInfo`
- `logAppWarn`

Current frontend producers include:

- `BackgroundClusterRefresher`: logs background refresh start/stop.
- `RefreshOrchestrator`: logs refresh orchestration info and warnings.
- `ResourceStream`: logs resource stream info and warnings.
- `CatalogStream`: logs catalog stream fallback warnings.
- `useCatalogDiagnostics`: logs catalog update-rate diagnostics and warnings.

There is no `logAppError` helper today, although the backend supports an
`error` level through `LogFrontend`.

## Current User-Facing Behavior

The Application Logs panel is best understood as a global support/debug console
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

The codebase uses "logs" for at least three different features:

1. Application Logs: app diagnostics shown by `AppLogsPanel`.
2. Pod/object logs: Kubernetes pod log data shown by `LogViewer`.
3. Log settings: mostly pod/object log viewer settings.

The `Log Settings` modal is for pod/object log viewing, not Application Logs.
Examples:

- `Log buffer size` controls pod log viewer scrollback through
  `getLogBufferMaxSize()` and `LogViewer`.
- `Max containers` controls pod/container log target limits.
- `API Timestamps` controls Kubernetes API timestamps in pod/object log rows.

Backend settings names such as `SetLogBufferMaxSize` and
`LogBufferMaxSize` sound generic, but they do not resize the Application Logs
backend buffer. The Application Logs backend buffer is currently fixed at
`NewLogger(1000)`.

## Existing Test Coverage

Backend coverage:

- `backend/app_logs_test.go` covers nil logger handling, `GetLogs()`,
  structured cluster metadata, `ClearLogs()`, and `LogFrontend()` level/source
  normalization.
- `backend/app_ui_test.go` covers logs panel toggling, event emission, and menu
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
- Streaming manager tests mock frontend app-log producers.

Notably missing:

- No direct unit test for `appLogClient.ts`.
- No test asserting that Application Logs settings are independent from pod log
  settings.
- No integration test that exercises `log-added -> GetLogs -> render`.
- No test for multiple Wails listeners on the same event.

## Completed Work

- [x] Added structured `clusterId` and `clusterName` fields to Application Log
  entries.
- [x] Updated cluster lifecycle/auth/refresh/heartbeat/client log producers to
  populate cluster metadata through the existing logger methods.
- [x] Added Application Logs UI support for displaying, filtering, searching,
  and copying cluster metadata.
- [x] Moved logger `log-added` event emission outside the logger mutex.
- [x] Kept Application Logs reads out of `requestAppState()` to avoid a
  diagnostics/logging feedback loop.
- [x] Replaced custom App Logs select-all sentinel options with the shared
  `Dropdown` component's built-in bulk actions.
- [x] Fixed shared dropdown outside-click handling so sibling dropdowns close
  correctly even inside parents that stop `mousedown` bubbling.
- [x] Added focused backend/frontend tests for the completed Application Logs
  and dropdown behavior.

## Risks And Gaps

### Ranked Findings

1. High: Clear behavior is ambiguous. The backend records an
   `Application logs cleared` marker after clearing, while the frontend
   immediately renders an empty local list. Tests currently encode both
   expectations.
2. Medium-high: Application Logs and pod/object Logs boundaries are confusing.
   The visible Log Settings UI applies to pod/object logs, not Application
   Logs, while backend setting names such as `LogBufferMaxSize` sound generic.
3. Medium: Severity classification is inconsistent across direct logger calls,
   `stdLogBridge`, and `errorcapture`, which makes the log level less reliable
   as diagnostic signal.
4. Medium: The `log-added` event contains no payload, so the frontend refetches
   the full log buffer on every new entry.
5. Medium: Wails event unsubscription may be too broad if another future
   consumer also listens to `log-added`.
6. Medium-low: Application Logs have no persistence or file export path, which
   limits support workflows after restart or early startup failure.
7. Medium-low: The frontend logging helper is incomplete because it lacks
   `logAppError()` even though the backend supports error-level frontend logs.
8. Low: Source names are free-form and can drift, making component filtering
    less predictable.
9. Low: Debug entries are hidden by default, which is probably correct but
    needs better support/testing guidance.
10. Low: Rendering is not virtualized. This is fine for the fixed 1000-entry
    buffer, but becomes a concern if the buffer grows.
11. Low: Application Log timestamp formatting is hard-coded and intentionally
    separate from pod log timestamp preferences, but the distinction is not
    obvious.

Completed finding:

- Cluster-aware Application Log entries and UI filtering are complete.
- Event emission no longer happens while holding the logger mutex.

### Event Payload Is Too Thin

`Logger.Log()` emits only `log-added`; the frontend then refetches the entire
buffer. This is simple and safe for a 1000-entry buffer, but it is noisy under
bursts and makes every new log an RPC read of the full list.

A future incremental model could emit the new entry or a monotonic sequence
number. The panel could append entries and occasionally reconcile with
`GetLogs()`.

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

### Source Names Are Free-Form

The `source` field is an arbitrary string. That keeps call sites simple, but it
also creates drift. Examples include broad sources (`App`, `Refresh`), domain
sources (`ResourceStream`, `LogStream`), and resource-oriented sources
(`Pod`, `ResourceLoader`, `RBAC`).

There is no registry or guidance for choosing a source. This makes component
filtering less predictable.

### Level Classification Is Inconsistent Across Ingestion Paths

Direct logger calls choose levels explicitly. `stdLogBridge` and `errorcapture`
infer severity from strings.

There are edge cases:

- `errorcapture.emitToLogSink()` treats any line starting with `E` as `ERROR`
  even if it is not a klog severity prefix.
- `app_lifecycle.go` maps non-error/non-warning `ErrorCapture` lines to
  `DEBUG`, even though `errorcapture` classified `I...` as `info`.
- `stdLogBridge` uses broad substring checks such as `" error"` and `" warn"`.

These are pragmatic but should be documented or tightened before Application
Logs are treated as reliable severity telemetry.

### Debug Logs Are Hidden By Default

The panel default filter excludes `debug`. That keeps the view quiet, but it
also hides some important backend diagnostics, including most informational
`ErrorCapture` klog lines because they are written as `DEBUG` source
`ErrorCapture`.

This is probably the right default, but support/testing instructions should
explicitly say "include Debug" when investigating klog or refresh noise.

### Clear Behavior Is Ambiguous

`ClearLogs()` clears the backend buffer and then writes `Application logs
cleared`. The frontend clear handler then immediately sets local logs to an
empty list.

Backend tests assert that the marker entry exists after clear. Frontend tests
assert that the panel becomes empty. Runtime ordering depends on when the
`log-added` event is processed relative to the local `setLogs([])`.

Pick one user-facing behavior and align tests and implementation with it:

- Empty means truly empty, with no marker entry.
- Clear leaves one explicit marker row.

### Wails Event Unsubscription May Be Too Broad

`AppLogsPanel` calls `runtime.EventsOff('log-added')` during cleanup. If Wails'
event API removes all listeners for the event, another future consumer of
`log-added` could be disconnected when the panel closes.

This is harmless while `AppLogsPanel` is the only listener. It becomes risky if
additional listeners are added.

### Application Log Buffer Size Is Not Configurable

The app has user-visible "Log buffer size" settings, but those settings apply
to pod/object logs. Application Logs remain fixed at 1000 entries.

That may be enough, but it should be intentional and named clearly. If support
work often needs longer app history, add an Application Logs-specific buffer
setting or increase the fixed size.

### No Persistence Across Restart

Application Logs are memory-only. This is simple and appropriate for normal use,
but it limits debugging startup failures, early crashes, or issues discovered
after restart. There is also no "save to file" action, only copy-to-clipboard.

### Frontend Logging Has No Error Helper

`appLogClient.ts` exports debug/info/warn helpers but no error helper, even
though the backend accepts `error`. This encourages frontend code either to log
warnings for errors or to bypass the helper.

### Rendering Is Not Virtualized

Rendering up to 1000 rows is likely fine. If the Application Logs buffer becomes
configurable or much larger, `AppLogsPanel` should use the same virtualization
discipline as larger tabular/log surfaces.

### Timestamp Formatting Is Hard-Coded

Application Logs render local `HH:mm:ss.SSS` using `Intl.DateTimeFormat`. The
pod log timestamp settings do not apply. That is fine if intentional, but the
difference should be visible in naming and docs.

## Simplification Opportunities

### Separate Names For App Logs And Pod Logs

Use explicit names in settings and code comments:

- "Application Logs" for `backend.Logger` and `AppLogsPanel`.
- "Pod Logs" or "Object Logs" for Kubernetes container logs and `LogViewer`.

Concrete cleanup:

- Rename misleading comments such as "Keep backend log-stream visibility aligned
  with this panel's open state" in `AppLogsPanel`; `SetLogsPanelVisible` only
  tracks app panel/menu visibility.
- Clarify backend comments on `SetLogBufferMaxSize` as pod/object log viewer
  settings, not Application Logs settings.

### Introduce A Small App Log Contract

Create a shared backend interface or package-level convention for app log
entries instead of passing arbitrary source strings everywhere. This does not
need to be heavy:

- Define canonical source constants for common subsystems.
- Document the existing optional logger metadata arguments for cluster-scoped
  messages.
- Keep the existing `Logger` simple.

### Normalize Event Delivery

Completed: `Logger.Log()` now appends under lock, releases the lock, and then
emits `log-added`.

### Avoid Full Buffer Reads On Every Log

For now, full reads are acceptable. If Application Logs become noisy, a minimal
incremental improvement is:

- Add `sequence` to `LogEntry`.
- Add `GetLogsSince(sequence)`.
- Emit `log-added` with the newest sequence.
- Let the panel request only deltas.

### Remove Duplicate Filter Logic

`AppLogsPanel` duplicates the same filtering logic for rendering and copy. Move
that into a small local helper such as `filterLogEntries(logs, filters)`. This
would make future changes to filter semantics less error-prone.

### Add `logAppError`

Export `logAppError()` from `appLogClient.ts` and test level normalization. This
is a small, obvious API completion.

## Missing Capabilities

High-value missing capabilities:

- Complete object-reference metadata and filtering for object-specific
  messages.
- Source registry or canonical source names.
- Export/save logs to a file.
- Copy all logs regardless of active filters.
- "Include Debug" discoverability for support workflows.
- Direct test coverage for `appLogClient`.
- Clear, documented boundary between Application Logs and pod/object Logs
  settings.
- Optional persistent crash/startup log file for early startup failures.

Lower-priority capabilities:

- Per-source level thresholds.
- Pause/resume live updates.
- Search result count and next/previous match navigation.
- "Follow tail" semantics separate from auto-scroll checkbox.
- De-duplication or rate limiting for repeated noisy messages.
- Structured metadata display for cluster/object references.

## Recommended Backlog

1. Clarify naming and comments around Application Logs versus pod/object Logs.
   This is the cheapest fix and prevents future wrong assumptions.
2. Add tests for `appLogClient`, including an added `logAppError` helper.
3. Decide and normalize clear behavior: empty panel or marker row.
4. Add complete object-reference metadata to `LogEntry` for object-specific
   messages.
5. Add canonical source constants for common subsystems.
6. Consider a delta API only if full-buffer refetches show up in profiling.
7. Consider Application Logs export/persistence if support workflows need logs
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
10. Click Clear and verify the chosen clear behavior.
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

Pod log isolation test:

1. Open an object panel Logs tab for a pod/workload.
2. Stream or fetch pod logs.
3. Confirm container stdout/stderr appears in the pod/object Logs view, not as
   Application Logs entries unless the log subsystem itself emits a diagnostic.
