# Application Logs Contract

Application Logs are Luxury Yacht's own diagnostic log buffer. They are not
Kubernetes container logs or node logs.

## Agent Contract

- Keep Application Logs app-global.
- Cluster metadata may annotate entries, but the buffer is not cluster-scoped
  refresh data.
- Reads belong to `appStateAccess`, not `dataAccess`.
- Frontend diagnostic producers should use the app log client wrapper, not
  generated Wails bindings directly.
- Avoid feedback loops where reading logs writes more log entries.
- Clearing Application Logs clears the app diagnostic buffer only; it must not
  affect Kubernetes log viewers.
- Copying Application Logs uses the native clipboard through
  `frontend/src/core/desktop-runtime`; it does not depend on browser clipboard
  permissions.
- Keep source names and levels stable enough for filters and support workflows.
- Cluster, component, and level multiselects use explicit `all`, `some`, and
  `none` states. Deselecting the final option must show no entries; it must not
  revert to the unrestricted state. Dynamic cluster and component options keep
  `all` open-ended as new log sources appear.

## Ownership

- Process buffer, logger, frontend ingestion, sequence reads, clear operation,
  and typed event projection: `backend.AppLogService` in
  `backend/app_log_service.go` and `backend/app_log_service_commands.go`
- Error capture bridge: `backend/internal/errorcapture`
- Frontend app log client: `frontend/src/core/logging/appLogsClient.ts`
- Application Logs panel: `frontend/src/ui/panels/app-logs`
- App-state reads: `frontend/src/core/app-state-access`

`AppLogService` is composed once and remains alive until process teardown so
other owners can log through startup, update shutdown, cluster/runtime cleanup,
and refresh teardown. Factory Reset clears it after the other owner resets have
finished; the buffer is not recreated as cluster-scoped refresh state.

## Change Checklist

When changing Application Logs:

1. Check whether the entry is app-global or should be a Kubernetes log instead.
2. Preserve level, source, message, sequence, and optional cluster metadata.
3. Keep event subscriptions per-listener and cleaned up on unmount.
4. Avoid making filters depend on unstable message strings.
5. Test clear, incremental fetch, filtering, and event cleanup.

## Validation

Run backend app log/errorcapture tests and frontend app log client/panel tests.
