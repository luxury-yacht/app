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
- Cluster, component, and level multiselects use explicit `all`, `some`, and
  `none` states. Deselecting the final option shows no entries; it never
  reverts to unrestricted. Dynamic cluster and component options keep `all`
  open-ended as new log sources appear.
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
