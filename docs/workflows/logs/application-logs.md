# Application Logs Contract

Application Logs are Luxury Yacht's own diagnostic log buffer, not Kubernetes
container or node logs.

## Agent Contract

- Keep Application Logs app-global. Cluster metadata may annotate entries, but
  the buffer is not cluster-scoped refresh data. Reads use `appStateAccess`, not
  `dataAccess`.
- Entries carry level, source, message, sequence, and optional cluster
  metadata. Keep source names and levels stable for filters and support
  workflows; filters must not depend on unstable message strings.
- Frontend diagnostic producers use the app log client wrapper, never generated
  Wails bindings directly.
- Reading logs must not write log entries (no feedback loops).
- Clearing empties only the app diagnostic buffer; it never affects Kubernetes
  log viewers.
- Event subscriptions are per-listener and cleaned up on unmount.
- `app-logs:added` is batched like container live batches: the first write
  opens a 250 ms window and the window sends one event with the newest sequence.
  The panel reads every entry after its last one, so a batch never drops a
  write; bursts cost one read per window, not one per write.
- Cluster, component, and level multiselects use explicit `all`, `some`, and
  `none` states. Deselecting the final option shows no entries; it never
  reverts to unrestricted. Dynamic cluster and component options keep `all`
  open-ended as new log sources appear.
- The panel behaves like a Logs tab, with the shared pieces
  ([overview.md](overview.md#shared-viewer-shell)):
  - Stop/Start auto-refresh (`R`) is local and starts on. Stopping unsubscribes
    from `app-logs:added`; starting catches up with one sequence read.
  - It follows new lines at the bottom. Scrolling up holds the shown lines,
    deferring the buffer cap; Resume scrolling follows again and restarts
    auto-refresh when it is stopped.
  - The backend buffer (`appLogsMaxEntries`, built by `NewApplicationLogs`) and
    the panel's rows keep a fixed 10,000 entries. It is not a setting and never
    follows the Logs tabs' Buffer size: troubleshooting the app can need more
    history than a pod's logs.
  - Rows are a GridTable through the shared `LogTable`, like the Logs tab's Table
    format: Time, Level, Source, Cluster, Message columns that size to content
    up to the Table format's 520px cap (so a docked panel does not scroll
    sideways) and can be resized (not persisted), the standard GridTable header, the
    Table format's cells with App Logs' own colours, and Enter or a click on a
    row to expand it and read long values in full.
  - Each column declares `measurementSampleKey`: GridTable re-measures auto-width
    columns as streamed rows change, and without keys that walks every row of
    the 10,000-line buffer each time.
- The panel's Download button is the shared log-view menu
  (`useLogDownloadMenu`): Copy to Clipboard, or Save to File as `.log`, with the
  shown entries as the text.
- `AppLogService` is composed once and lives until process teardown so other
  owners can log through startup and shutdown; Factory Reset clears it after
  the other owner resets finish, and it is never recreated as cluster-scoped
  refresh state ([application-lifecycle.md](../../architecture/application-lifecycle.md)).

## Ownership

- Process buffer, logger, frontend ingestion, sequence reads, clear, and typed
  event projection: `backend.AppLogService` (`backend/app_log_service.go`,
  `backend/app_log_service_commands.go`)
- Error capture bridge: `backend/internal/errorcapture`
- Frontend app log client: `frontend/src/core/logging/appLogsClient.ts`
- Panel: `frontend/src/ui/panels/app-logs`; app-state reads:
  `frontend/src/core/app-state-access`

## Validation

Run backend app log/errorcapture tests and frontend app log client/panel tests
covering clear, incremental fetch, filtering, and event cleanup.
