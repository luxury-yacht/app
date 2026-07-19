# AGENTS.md (Backend)

Applies to Go code under `backend/`.

## Development Guidelines

- `backend/` hosts Kubernetes integrations.
  - `backend/refresh/snapshot` is the canonical source for refresh-domain
    list/table payloads. Add table/list data there, not in `backend/resources`.
    Follow `docs/architecture/data-freshness.md` and
    `docs/architecture/refresh-system.md`.
  - `backend/resources` is the detail/action service layer for rich object
    details, logs/debug helpers, and imperative operations. Each built-in kind
    lives in its own package `backend/resources/<kind>/` (`identity.go`,
    `descriptor.go`, `model.go`, `facts.go`, `dto.go`, `details.go`, `actions.go`,
    and object-map files) and is registered with one entry in
    `backend/kind/kindregistry`; subsystems loop that registry and filter by facet
    instead of naming kinds. Keep services request-shaped and pass cluster-scoped
    dependencies in from callers. Follow
    `docs/architecture/resource-kind-registry.md`.
  - `backend/objectcatalog` is the discovery/catalog source of truth; use it for
    resource identity and browse/catalog listings. Follow
    `docs/architecture/catalog.md`.
  - `backend/resourcemodel` owns the *shared* Kubernetes semantics primitives
    (status presentation, facts, `ResourceLink` constructors, and the
    relationship index) that the per-kind models build on; per-kind
    status/facts/DTOs live in `backend/resources/<kind>/`. Before adding or
    changing resource status, relationship links, object references, capability
    integration, or fact slots, follow `docs/architecture/shared-resource-model.md`.
  - The `App.Get<Kind>` detail bindings and the object-panel detail-fetcher
    dispatch map are generated from each kind's `appbinding.Spec`; run
    `go generate ./backend` after adding or changing a kind, and never hand-edit
    `resource_details_generated.go` / `object_detail_fetchers_generated.go`.
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; avoid bespoke refresh/streaming code.

## Object Catalog

- Service lives in `backend/objectcatalog` (`Service`, `Summary`), started in `backend/app_object_catalog.go`.
- Browse snapshots are exposed through the `catalog` refresh domain in `backend/refresh/snapshot/catalog.go`.
- Resource identity resolution is owned by `backend/objectcatalog/identity.go`.
  `backend/resources/common/resource_identity.go` contains only the shared
  resolver interface/result contract; do not add parallel GVK/GVR resolver
  tables or kind-only fallbacks outside the catalog.
- Catalog identity and typed-view boundaries are documented in
  `docs/architecture/catalog.md`.

## Refresh Subsystem Notes

- Domain checklist: add or update snapshot builders in `backend/refresh/snapshot/*.go`, register domains in `backend/refresh/system/registrations.go`, and keep permission gates aligned with `backend/refresh/system/permission_gate.go`.
- Refresh HTTP and stream DTOs are generated into
  `frontend/src/core/refresh/types.generated.ts` from
	`backend/internal/genrefreshcontracts`; register new DTO and enum types there,
	set each domain's `refreshPayloadType` in
	`backend/refresh/domain/refresh-domain-contract.json`, then run
	`go generate ./backend`.
- Permission-gated domains: use `RegisterPermissionDeniedDomain` in `backend/refresh/snapshot/permission.go` and surface `PermissionIssue` entries through the refresh system permission-gate paths.
- Manual refresh entrypoint: `/api/v2/refresh/{domain}` in `backend/refresh/api/server.go`, backed by `ManualQueue` in `backend/refresh/types.go`.
- Per-cluster stream endpoints are wired in `backend/refresh/system/streams.go`; aggregate stream routes are wired in `backend/app_refresh_setup.go`.
- Diagnostics/telemetry sources: refresh domain telemetry in `backend/refresh/telemetry/recorder.go`; catalog diagnostics in `backend/app_object_catalog.go`.
- Wedged backend (views stuck loading, suspected deadlock): capture a SIGUSR1
  goroutine dump before hypothesizing — opt in with
  `ENABLE_GOROUTINE_DUMP=true` at launch; see `docs/workflows/goroutine-dump.md`;
  handler in `backend/app_diagnostic_dump.go`.
- Lifecycle: refresh subsystem setup in `backend/app_refresh_setup.go`, selection updates in `backend/app_refresh_update.go`, replacement helpers in `backend/app_refresh_subsystems.go`, teardown/rebuild in `backend/app_refresh_recovery.go`, base URL in `backend/app_refresh.go`.
- Client init: `backend/app_kubernetes_client.go` owns client setup and triggers refresh subsystem + object catalog start.
- Multi-cluster refresh behavior is documented in
  `docs/architecture/multi-cluster.md`, `docs/architecture/data-freshness.md`,
  and `docs/architecture/refresh-system.md`.
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
- `GetAppSettingsSchema` is the source of truth for backend-owned preference
  defaults, current values, bounds, enum values, validation hints, and
  runtime-side-effect flags. Keep schema coverage tests aligned with every
  preference accepted by `UpdateAppPreferences`.
- `UpdateAppPreferences` is the common mutation path for app preferences. It
  validates the whole batch before mutating in-memory settings, persists the
  normalized settings file before applying runtime side effects, and rejects the
  whole batch on validation or persistence failure.
- Existing one-off settings setters are compatibility wrappers around the
  common update path. Do not add new preference-specific Wails setters unless a
  separate workflow needs a distinct command contract.
- Defaults for persisted object panel position and layout belong in the backend
  settings contract, not frontend-only hydration fallbacks.
- Regenerate Wails bindings when settings DTOs, schema fields, or response
  shapes change.

## HTTP Server (Refresh API)

- The loopback HTTP server (`backend/refresh/api/`) is consumed by a native Wails
  webview, not a browser. Browser security patterns (CORS, CSP, cookie flags) are
  irrelevant. The security boundary is loopback binding + the random port.

## Testing Guidelines

- Practice red/green/refactor TDD (see root `AGENTS.md` Critical Rules): write the failing `_test.go` case first, run `go test` to watch it fail for the right reason, then write the minimum to make it pass, then refactor under green.
- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
