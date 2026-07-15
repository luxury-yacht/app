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
- Keep source names and levels stable enough for filters and support workflows.
- Cluster, component, and level multiselects use explicit `all`, `some`, and
  `none` states. Deselecting the final option must show no entries; it must not
  revert to the unrestricted state. Dynamic cluster and component options keep
  `all` open-ended as new log sources appear.

## Ownership

- Backend logger and Wails methods: `backend/logger.go`, `backend/app_logs.go`
- Error capture bridge: `backend/internal/errorcapture`
- Frontend app log client: `frontend/src/core/logging/appLogsClient.ts`
- Application Logs panel: `frontend/src/ui/panels/app-logs`
- App-state reads: `frontend/src/core/app-state-access`

## Change Checklist

When changing Application Logs:

1. Check whether the entry is app-global or should be a Kubernetes log instead.
2. Preserve level, source, message, sequence, and optional cluster metadata.
3. Keep event subscriptions per-listener and cleaned up on unmount.
4. Avoid making filters depend on unstable message strings.
5. Test clear, incremental fetch, filtering, and event cleanup.

## Validation

Run backend app log/errorcapture tests and frontend app log client/panel tests.
