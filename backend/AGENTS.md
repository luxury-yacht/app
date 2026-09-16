# AGENTS.md (Backend)

Applies to Go code under `backend/`.

## Development Guidelines

- `backend/` hosts Kubernetes integrations.
  - `backend/refresh/snapshot` is the canonical source for refresh-domain
    list/table payloads. Add table/list data there, not in `backend/resources`.
    Use the refresh skill's routes below for domain mechanics and
    `docs/architecture/data-freshness.md` for timing or visibility changes.
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
  - The implementation-only `ResourceGateway.Get<Kind>` detail methods and the
    object-panel detail-fetcher dispatch map are generated from each kind's
    `appbinding.Spec`; run
    `mise exec -- go generate ./backend` after adding or changing a kind, and never hand-edit
    `resource_details_generated.go` / `object_detail_fetchers_generated.go`.
- Manual refreshes and streaming domains belong to the backend refresh registry + ManualQueue; avoid bespoke refresh/streaming code.

## Task Guidance

Read the matching route only when that contract changes:

| Change | Start here |
| --- | --- |
| Catalog ownership, identity resolution, discovery or Browse | [catalog](../docs/architecture/catalog.md) |
| Refresh registration, generated payloads, streams, diagnostics | [refresh skill](../.agents/skills/refresh-subsystem/SKILL.md) |
| Cluster clients, selection, auth or recovery | [cluster/auth skill](../.agents/skills/cluster-auth-lifecycle/SKILL.md) |
| Settings schema, preferences, persistence or runtime effects | [app preferences](../docs/architecture/app-preferences.md) |
| Permission gates or action availability | [permissions](../docs/architecture/permissions.md) |
| Logs, shell/debug, port-forward, drain or operation cleanup | [operations skill](../.agents/skills/operations-workflows/SKILL.md) |
| Object-map graph data | [object map](../docs/workflows/object-map.md) |
| Startup, native windows or shutdown | [application lifecycle](../docs/architecture/application-lifecycle.md) |
| Views wedged loading or suspected deadlock | [goroutine dump](../docs/workflows/goroutine-dump.md); capture before hypothesizing |

Refresh transport uses Wails' same-origin `/api/v2` route and named JSON streams.
Do not introduce a loopback listener or alternative transport. For handler,
stream, publication, or teardown changes, read the
[transport boundary](../docs/architecture/refresh-system.md#transport-boundary).

## Testing Guidelines

- Apply the [testing standard](../docs/workflows/testing.md). Assert returned
  data, typed errors, side effects, lifecycle ordering, and boundary contracts.
  Do not pin prose in logs, errors, or menu labels when the contract is the
  error category, command dispatch, or retained diagnostic data. Keep checks for
  redaction, error identity, wire formats, and parsing behavior.
- For behavior changes, practice red/green/refactor TDD: write the failing
  `_test.go` case first, run `mise exec -- go test` to watch it fail for the right
  reason, then write the minimum to make it pass, then refactor under green.
- Backend tests stay adjacent to their targets with `_test.go` suffixes and `TestXxx` functions.
