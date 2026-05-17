# AGENTS.md (Backend)

Applies to Go code under `backend/`.

## Development Guidelines

- `backend/` hosts Kubernetes integrations.
  - `backend/refresh/snapshot` is the canonical source for refresh-domain
    list/table payloads. Add table/list data there, not in `backend/resources`.
    Follow `docs/architecture/refresh-system.md`.
  - `backend/resources` is the detail/action service layer for rich object
    details, logs/debug helpers, and imperative operations. Keep services
    request-shaped and pass cluster-scoped dependencies in from callers.
  - `backend/objectcatalog` is the discovery/catalog source of truth; use it for
    resource identity and browse/catalog listings. Follow
    `docs/architecture/catalog.md`.
  - `backend/resourcemodel` owns shared Kubernetes semantics. Before adding or
    changing resource status, relationship links, object references, capability
    integration, or fact slots, follow `docs/architecture/shared-resource-model.md`.
  - Resource handlers follow `resource_<Kind>.go` with adjacent `_test.go` suites (for example `kubeconfigs_test.go`).
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; avoid bespoke refresh/streaming code.

## Object Catalog

- Service lives in `backend/objectcatalog` (`Service`, `Summary`), started in `backend/app_object_catalog.go`.
- Browse snapshots are exposed through the `catalog` refresh domain in `backend/refresh/snapshot/catalog.go`.
- Catalog identity and typed-view boundaries are documented in
  `docs/architecture/catalog.md`.

## Refresh Subsystem Notes

- Domain checklist: add or update snapshot builders in `backend/refresh/snapshot/*.go`, register domains in `backend/refresh/system/registrations.go`, and keep permission gates aligned with `backend/refresh/system/permission_gate.go`.
- Permission-gated domains: use `RegisterPermissionDeniedDomain` in `backend/refresh/snapshot/permission.go` and surface `PermissionIssue` entries through the refresh system permission-gate paths.
- Manual refresh entrypoint: `/api/v2/refresh/{domain}` in `backend/refresh/api/server.go`, backed by `ManualQueue` in `backend/refresh/types.go`.
- Per-cluster stream endpoints are wired in `backend/refresh/system/streams.go`; aggregate stream routes are wired in `backend/app_refresh_setup.go`.
- Diagnostics/telemetry sources: refresh domain telemetry in `backend/refresh/telemetry/recorder.go`; catalog diagnostics in `backend/app_object_catalog.go`.
- Lifecycle: refresh subsystem setup in `backend/app_refresh_setup.go`, selection updates in `backend/app_refresh_update.go`, replacement helpers in `backend/app_refresh_subsystems.go`, teardown/rebuild in `backend/app_refresh_recovery.go`, base URL in `backend/app_refresh.go`.
- Client init: `backend/app_kubernetes_client.go` owns client setup and triggers refresh subsystem + object catalog start.
- Multi-cluster refresh behavior is documented in
  `docs/architecture/multi-cluster.md` and `docs/architecture/refresh-system.md`.
- Refresh permission gates and UI action permission rules are documented in
  `docs/architecture/permissions.md`.
- Per-cluster auth failure and recovery behavior is documented in
  `docs/architecture/auth.md`.

## Workflow Notes

- Container logs and node logs are documented under `docs/workflows/logs/`.
- Shell exec and debug container behavior is documented in
  `docs/workflows/shell-debug.md`.
- Object-map backend graph behavior is documented in
  `docs/workflows/object-map.md`.

## App Settings

- Persisted app preferences and runtime-enforced settings are backend-owned.
  Keep defaults, normalization, schema metadata, validation, Wails DTOs, and
  runtime side effects aligned in `backend/app_settings.go`.
- `UpdateAppPreferences` is the common mutation path for app preferences. It
  validates the whole batch before mutating in-memory settings, persists the
  normalized settings file before applying runtime side effects, and rejects the
  whole batch on validation or persistence failure.
- Existing one-off settings setters are compatibility wrappers around the
  common update path. Do not add new preference-specific Wails setters unless a
  separate workflow needs a distinct command contract.
- Defaults for persisted object panel position and layout belong in the backend
  settings contract, not frontend-only hydration fallbacks.

## HTTP Server (Refresh API)

- The loopback HTTP server (`backend/refresh/api/`) is consumed by a native Wails
  webview, not a browser. Browser security patterns (CORS, CSP, cookie flags) are
  irrelevant. The security boundary is loopback binding + the random port.

## Testing Guidelines

- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
