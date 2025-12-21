# AGENTS.md (Backend)

Applies to Go code under `backend/`.

## Development Guidelines

- `backend/` hosts Kubernetes integrations.
  - Resource handlers follow `resource_<Kind>.go` with adjacent `_test.go` suites (for example `kubeconfigs_test.go`).
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; avoid bespoke refresh/streaming code.

## Object Catalog

- Service lives in `backend/objectcatalog` (`Service`, `Summary`), started in `backend/app_object_catalog.go`.
- Browse snapshots are exposed through the `catalog` refresh domain in `backend/refresh/snapshot/catalog.go`.

## Refresh Subsystem Notes

- Domain checklist: add or update snapshot builders in `backend/refresh/snapshot/*.go`, register domains and permission gates in `backend/refresh/system/manager.go`.
- Permission-gated domains: use `RegisterPermissionDeniedDomain` in `backend/refresh/snapshot/permission.go` and surface `PermissionIssue` entries from `backend/refresh/system/manager.go`.
- Manual refresh entrypoint: `/api/v2/refresh/{domain}` in `backend/refresh/api/server.go`, backed by `ManualQueue` in `backend/refresh/types.go`.
- Streaming endpoints: wired in `backend/refresh/system/manager.go` (`/api/v2/stream/logs`, `/api/v2/stream/events`, `/api/v2/stream/catalog`); catalog SSE lives in `backend/refresh/snapshot/catalog_stream.go`.
- Diagnostics/telemetry sources: refresh domain telemetry in `backend/refresh/telemetry/recorder.go`; catalog diagnostics in `backend/app_object_catalog.go`.
- Lifecycle: refresh subsystem setup in `backend/app_refresh_setup.go`, teardown/rebuild in `backend/app_refresh_recovery.go`, base URL in `backend/app_refresh.go`.
- Client init: `backend/app_kubernetes_client.go` owns client setup and triggers refresh subsystem + object catalog start.

## Testing Guidelines

- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
