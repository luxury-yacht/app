# Refresh Domain Contract Coverage Plan

## Purpose

Make refresh-domain behavior explicit, testable, and complete without forcing
all domains into one abstraction. The goal is a single domain inventory with
class-specific contracts and validation, so every snapshot, stream, and refresh
domain has a clear owner, scope model, permission policy, cache behavior, and
coverage expectation.

This is a temporary implementation plan. When complete, durable rules should be
moved into `docs/architecture/refresh-system.md`, related workflow docs, and
the refresh subsystem skill before this plan is removed.

## Current State

The resource-stream row contract is now substantially stronger:

- Resource stream row identity flows through `ref` as a full
  `resourcemodel.ResourceRef`.
- Resource stream selectors are parsed and canonicalized by
  `resourcestream.StreamSelector`.
- Snapshot vs stream row parity is tested for streamed row domains.
- Resource-stream domain metadata is authored in
  `backend/refresh/domain/refresh-domain-contract.json` and checked by backend
  and frontend tests.

That does not yet mean every refresh domain has equivalent coverage. Catalog,
events, logs, object details, object map, object YAML, object maintenance, and
other non-row domains have different lifecycle and correctness contracts.

## Principles

- Keep canonical ownership split by concern.
- Do not create one generic refresh-domain abstraction that hides real domain
  differences.
- Every domain must declare its behavior class and required contracts.
- Every behavior class must have class-specific tests or an explicit documented
  exclusion.
- Cluster data must remain single-cluster at refresh boundaries and carry
  `clusterId`.
- Object references crossing boundaries must include full identity:
  `clusterId`, `group`, `version`, `kind`, plus `namespace` and `name` for
  concrete objects.

## Non-Goals

- Do not replace the existing backend registration table or frontend
  orchestrator-specific registration code with a generic dispatcher.
- Do not introduce multi-cluster refresh-domain scopes; fan-out remains above
  the single-cluster refresh boundary.
- Do not change runtime behavior in Phase 1 beyond adding contract metadata and
  tests.
- Do not automate the runtime smoke checklist in this plan unless a later phase
  explicitly promotes a documented check into CI.

## Affected Systems

- `backend/refresh/domain/refresh-domain-contract.json`
- `backend/refresh/system`, including registration ordering, permission gates,
  optional skips, and stream endpoint wiring
- `backend/refresh/snapshot`, `backend/refresh/resourcestream`,
  `backend/refresh/eventstream`, and `backend/refresh/containerlogsstream`
- `backend/objectcatalog` and catalog snapshot/stream builders
- `frontend/src/core/refresh`, including domain registry, orchestrator, stream
  managers, snapshot merge, diagnostics, and scope builders
- Object panel, log viewer, catalog/browse, object diff, and node maintenance
  UI tests that exercise scoped refresh domains
- `docs/architecture/refresh-system.md`, workflow docs, and
  `.agents/skills/refresh-subsystem/SKILL.md`

## Canonical Owners

| Concern                                                                      | Canonical Owner                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Domain metadata and registration inventory                                   | `backend/refresh/domain/refresh-domain-contract.json`                                                       |
| Kubernetes identity, status, facts, links                                    | `backend/resourcemodel`                                                                                     |
| Discovery, browse identity, object existence, namespace and cluster listings | `backend/objectcatalog`                                                                                     |
| Runtime permission requirement resources                                     | `backend/refresh/snapshot/permission_checks.go` and `backend/refresh/resourcestream/permission_contract.go` |
| Table/list snapshot payloads                                                 | `backend/refresh/snapshot`                                                                                  |
| Resource row stream delivery                                                 | `backend/refresh/resourcestream` and `frontend/src/core/refresh/streaming`                                  |
| Event stream ordering/resume/merge behavior                                  | `backend/refresh/eventstream` and `eventStreamManager.ts`                                                   |
| Catalog streaming and browse snapshots                                       | `backend/objectcatalog`, `backend/refresh/snapshot/catalog*`, and `catalogStreamManager.ts`                 |
| Container log stream lifecycle                                               | `backend/refresh/containerlogsstream` and `containerLogsStreamManager.ts`                                   |
| Operation state                                                              | Operation-specific backend services plus their refresh snapshot domain                                      |
| Frontend refresh scheduling and store writes                                 | `frontend/src/core/refresh`                                                                                 |

## Contract Shape

Keep the existing contract homes intact:

- `domains[]` remains the backend/frontend registration and timing list.
- `resourceStream.domains` remains resource-stream-specific metadata.
- Existing stream-specific sections remain owned by their stream type.

Add one new top-level map, tentatively named `domainInventory`, keyed by domain
id:

```json
{
  "domainInventory": {
    "pods": {
      "behaviorClass": "resource-stream-table",
      "scopeContract": {
        "kind": "resource-stream-selector",
        "clusterPrefix": "required",
        "parser": "backend/refresh/resourcestream.StreamSelector",
        "frontendBuilder": "frontend/src/core/refresh/clusterScope.buildClusterScope",
        "acceptedEncodings": [
          "namespace:<namespace>",
          "node:<node>",
          "workload:<namespace>:<group>:<version>:<kind>:<name>"
        ]
      },
      "cachePolicy": "snapshot-cache",
      "coverageContract": "resource-stream-row-parity",
      "coverageStatus": "enforced"
    }
  }
}
```

The domain id is the join key across all contract sections and code
registrations. A domain id must be stable and must not be renamed by adding a
parallel alias. If a class name or domain id changes during implementation,
rename it by search-and-replace and keep contract tests enforcing that no old
alias remains.

Phase 1 added backend and frontend tests that assert:

- `domainInventory` keys equal the ids in `domains[]`.
- Frontend `RefreshDomain` / domain registry ids equal the contract ids.
- `resourceStream.domains` keys are exactly the subset of inventory entries
  whose backend contract sets `resourceStream: true`.
- Backend registration coverage is checked by registration kind: snapshot
  domains against `domainRegistrations()` with full test dependencies,
  stream-only domains such as `container-logs` against stream endpoint wiring,
  and optional skip domains against explicit skip/require tests.
- Every behavior-class-specific nested home joins by the same domain id.

## Domain Behavior Classes

Extend the shared domain contract so every domain declares one behavior class.
Initial classes:

| Class                    | Examples                                                                  | Contract Shape                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot-table`         | `namespaces` and simple list/table snapshot-only domains                  | Snapshot payload only; no stream parity requirement unless it has row projectors                                                                        |
| `aggregate-snapshot`     | `cluster-overview`                                                        | Snapshot payload assembled from multiple resource families, metrics, and permission-aware fallbacks                                                     |
| `resource-stream-table`  | `pods`, `nodes`, `namespace-workloads`, namespace/cluster resource tables | Snapshot row projection plus resource-stream row/update/delete parity                                                                                   |
| `complete-resync-stream` | `namespace-helm`                                                          | Stream emits scope-level `COMPLETE`; no row-update contract                                                                                             |
| `catalog-stream`         | `catalog`                                                                 | Object catalog snapshot/stream consistency, discovery identity, pagination/filter behavior, stream health diagnostics                                   |
| `catalog-snapshot`       | `catalog-diff`                                                            | Object catalog query snapshot for diff workflows; pagination/filter identity and snapshot merge behavior without stream diagnostics or resume semantics |
| `event-stream`           | `cluster-events`, `namespace-events`                                      | SSE event identity, ordering, dedupe, resume, involved-object identity                                                                                  |
| `event-snapshot`         | `object-events`                                                           | Snapshot payload for one fully identified object; event identity and involved-object refs without SSE resume semantics                                  |
| `log-stream`             | `container-logs`                                                          | Line ordering, reconnect/fallback, cluster/object/container scoping                                                                                     |
| `detail-payload`         | `object-details`, `object-yaml`                                           | Full object reference input, cache/invalidation behavior, payload shape tests                                                                           |
| `helm-content-payload`   | `object-helm-manifest`, `object-helm-values`                              | Helm release namespace/name input, rendered content shape, related resource links, cache/invalidation behavior                                          |
| `graph-payload`          | `object-map`                                                              | Node/edge identity, relationship refs, layout/debug snapshot behavior                                                                                   |
| `operation-state`        | `object-maintenance`                                                      | State transitions, cache bypass, lifecycle cleanup, long-running operation behavior                                                                     |

Class names may change during implementation, but every domain must map to
exactly one class.

## Domain Reconciliation Matrix

This matrix is the explanatory backstop for the plan. The authoritative
per-domain mapping now lives in `domainInventory`, with backend and frontend
tests enforcing that every domain joins the expected contract homes by domain
id. Keep this table aligned with the contract when the plan changes, but do not
treat it as a separate source of truth.

| Domain                  | Class                    | Backend Path                                      | Frontend Path                      | Scope Contract                                              | Cache / Stream Contract                                          | Coverage                                 | Phase |
| ----------------------- | ------------------------ | ------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- | ----- |
| `namespaces`            | `snapshot-table`         | `direct` snapshot                                 | snapshot orchestrator              | cluster-prefixed empty or namespace scope                   | snapshot cache plus frontend snapshot merge reuse                | `snapshot-table-payload`                 | 2     |
| `cluster-overview`      | `aggregate-snapshot`     | `listWatch` with list fallback                    | snapshot orchestrator              | cluster-prefixed empty scope                                | snapshot cache; metrics and permission-aware fallbacks           | `aggregate-snapshot-permission-fallback` | 2     |
| `catalog`               | `catalog-stream`         | service-gated direct snapshot plus catalog SSE    | catalog stream orchestrator        | cluster-prefixed catalog query scope                        | object catalog canonical cache plus catalog stream updates       | `catalog-consistency`                    | 5     |
| `catalog-diff`          | `catalog-snapshot`       | service-gated direct snapshot                     | snapshot orchestrator              | cluster-prefixed catalog query scope                        | object catalog query snapshot plus frontend snapshot merge reuse | `catalog-snapshot-query`                 | 5     |
| `nodes`                 | `resource-stream-table`  | `listWatch` with list fallback                    | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `cluster-config`        | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `cluster-crds`          | `resource-stream-table`  | `listWatch`                                       | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `cluster-custom`        | `resource-stream-table`  | `list` with dynamic client requirement            | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and CRD-triggered COMPLETE | `resource-stream-row-parity`             | 3     |
| `cluster-events`        | `event-stream`           | direct event snapshot registration plus event SSE | event stream orchestrator          | cluster event stream scope                                  | append/merge SSE with ordering, dedupe, and resume               | `event-resume-merge`                     | 6     |
| `cluster-rbac`          | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `cluster-storage`       | `resource-stream-table`  | `listWatch`                                       | resource stream orchestrator       | cluster resource-stream selector                            | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-workloads`   | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-autoscaling` | `resource-stream-table`  | `direct` snapshot                                 | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-config`      | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-custom`      | `resource-stream-table`  | `list` with dynamic client requirement            | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and CRD-triggered COMPLETE | `resource-stream-row-parity`             | 3     |
| `namespace-events`      | `event-stream`           | direct event snapshot registration plus event SSE | event stream orchestrator          | namespace event stream scope                                | append/merge SSE with ordering, dedupe, and resume               | `event-resume-merge`                     | 6     |
| `namespace-helm`        | `complete-resync-stream` | `direct` snapshot                                 | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus scope-level COMPLETE only                    | `complete-resync-only`                   | 4     |
| `namespace-network`     | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-quotas`      | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-rbac`        | `resource-stream-table`  | `list` with partial resource permissions          | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `namespace-storage`     | `resource-stream-table`  | `direct` snapshot                                 | resource stream orchestrator       | namespace resource-stream selector                          | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `pods`                  | `resource-stream-table`  | `direct` snapshot                                 | resource stream orchestrator       | namespace, node, or workload resource-stream selector       | snapshot cache plus row update/delete and scope COMPLETE         | `resource-stream-row-parity`             | 3     |
| `object-details`        | `detail-payload`         | `direct` snapshot                                 | snapshot orchestrator              | cluster-prefixed full object scope via `ParseObjectScope`   | snapshot cache and object-details provider cache/invalidation    | `detail-payload-shape`                   | 8     |
| `object-yaml`           | `detail-payload`         | provider-gated direct snapshot                    | snapshot orchestrator              | cluster-prefixed full object scope via `ParseObjectScope`   | snapshot cache and YAML provider cache/invalidation              | `detail-payload-shape`                   | 8     |
| `object-helm-manifest`  | `helm-content-payload`   | provider-gated direct snapshot                    | snapshot orchestrator              | cluster-prefixed Helm `namespace:name` scope                | snapshot cache plus Helm content provider cache/invalidation     | `helm-content-shape`                     | 8     |
| `object-helm-values`    | `helm-content-payload`   | provider-gated direct snapshot                    | snapshot orchestrator              | cluster-prefixed Helm `namespace:name` scope                | snapshot cache plus Helm content provider cache/invalidation     | `helm-content-shape`                     | 8     |
| `object-events`         | `event-snapshot`         | `direct` snapshot                                 | snapshot orchestrator              | cluster-prefixed full object scope via `ParseObjectScope`   | snapshot cache; event payload without SSE resume                 | `event-snapshot-payload`                 | 6     |
| `object-map`            | `graph-payload`          | `direct` snapshot                                 | snapshot orchestrator              | cluster-prefixed object-map scope via `parseObjectMapScope` | snapshot cache; graph/debug payload                              | `graph-payload-identity`                 | 8     |
| `object-maintenance`    | `operation-state`        | `direct` snapshot                                 | snapshot orchestrator              | cluster-prefixed aggregate or `node:<name>` scope           | cache and singleflight bypass; frontend snapshot merge reuse     | `operation-state-transitions`            | 8     |
| `container-logs`        | `log-stream`             | stream-only `/api/v2/stream/container-logs`       | container logs stream orchestrator | cluster-prefixed full object scope plus log query filters   | line stream with fallback polling; no snapshot-domain cache      | `log-stream-lifecycle`                   | 7     |

The matrix must remain exhaustive: it has 30 rows, matching the 30 domain ids in
`refresh-domain-contract.json`.

## Consolidation Opportunities

The matrix should not be read as approval for 30 bespoke implementations. Keep
the domain inventory exhaustive, but look for consolidation at shared
infrastructure boundaries.

High-value consolidation targets:

- Frontend transport lifecycle: `event-stream`, `catalog-stream`, and
  `container-logs-stream` are all SSE-based. They should be evaluated for a
  shared EventSource transport layer that owns connection setup, reconnect,
  permission-error parsing, health telemetry, visibility pause/resume, and
  cleanup. Keep event, catalog, and log payload reducers separate unless their
  state semantics actually match.
- Frontend scoped-domain plumbing: snapshot domains should use one shared path
  for scope enablement, refresh requests, cache-bypass/manual refresh behavior,
  error handling, and diagnostics rows. Domain-specific code should start at
  payload interpretation, not at lifecycle wiring.
- Frontend snapshot merge reuse: `namespaces`, `catalog-diff`, and
  `object-maintenance` already have keyed merge reuse behavior. Move that to a
  small domain-configured helper if the inventory can name the collection field
  and stable key without hiding payload-specific behavior.
- Backend registration gates: `list`, `listWatch`, list fallback,
  provider/service-gated direct registrations, and dynamic-client requirements
  should remain distinct behavior, but their metadata and compatibility tests
  should be generated from a common registration inventory instead of local
  conventions.
- Permission compatibility: snapshot runtime requirements, resource-stream
  requirements, stream-specific permissions, and explicit exemptions should be
  reconciled through one test helper keyed by domain id.
- Scope normalization: cluster-prefix handling, object-scope construction,
  resource-stream selector parsing, catalog query scopes, Helm release scopes,
  and node-maintenance scopes should each have named parser/builder owners in
  `scopeContract`. Reuse shared cluster-prefix helpers everywhere instead of
  reimplementing prefix handling.
- Coverage proof plumbing: many domains share the same coverage family. The
  enforcement registry should prove membership by behavior class and domain id
  instead of repeating one-off assertions per row.

Do not consolidate by erasing behavior differences. The following reducers and
contracts should stay separate unless implementation work proves they can share
code without weakening correctness:

- resource table row update/delete/COMPLETE handling
- event append/order/dedupe/resume handling
- catalog discovery/readiness/pagination/stale-delete handling
- log line buffering, filtering, target limits, and fallback polling
- whole-payload snapshot replacement and payload-specific merge reuse

## Desired End-State Matrix

The desired end state is fewer infrastructure paths than behavior classes. The
inventory remains exhaustive per domain, but runtime code should converge on
shared backend registration helpers, shared frontend lifecycle transports, and
thin behavior adapters.

| Target Group                   | Domains                                                                                                                                                                                                                                                                        | Backend End State                                                                                                  | Frontend End State                                                                                         | Behavior Adapter That Remains                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Snapshot payload domains       | `namespaces`, `object-details`, `object-yaml`, `object-helm-manifest`, `object-helm-values`, `object-events`, `object-map`, `object-maintenance`, `catalog-diff`                                                                                                               | shared snapshot registration metadata plus optional provider/service gates                                         | shared scoped snapshot lifecycle, diagnostics, cache-bypass/manual refresh, and optional keyed merge reuse | payload builder/validator per class: table, detail, Helm content, event snapshot, graph, operation state, catalog query |
| Aggregate snapshot domains     | `cluster-overview`                                                                                                                                                                                                                                                             | shared `listWatch` registration with declarative list fallback metadata                                            | shared scoped snapshot lifecycle                                                                           | aggregate builder with metrics/resource fallback and partial-permission semantics                                       |
| Resource row stream domains    | `pods`, `nodes`, `cluster-config`, `cluster-crds`, `cluster-custom`, `cluster-rbac`, `cluster-storage`, `namespace-workloads`, `namespace-autoscaling`, `namespace-config`, `namespace-custom`, `namespace-network`, `namespace-quotas`, `namespace-rbac`, `namespace-storage` | shared resource-stream registration, permission compatibility, selector parsing, and snapshot/stream parity proofs | shared WebSocket subscription lifecycle and row-store mutation helpers                                     | per-domain row projector, related-resource mapping, metrics handling, and custom-domain COMPLETE triggers               |
| Complete-resync stream domains | `namespace-helm`                                                                                                                                                                                                                                                               | shared resource-stream registration with `rowProjection: scope-level-complete-only` contract                       | shared WebSocket subscription lifecycle with COMPLETE-only adapter                                         | Helm release snapshot builder and COMPLETE-only resync behavior                                                         |
| SSE append/merge streams       | `cluster-events`, `namespace-events`                                                                                                                                                                                                                                           | shared event stream endpoint and permission requirements                                                           | shared SSE transport lifecycle plus event reducer adapter                                                  | event ordering, dedupe, resume-token, and involved-object identity                                                      |
| SSE catalog stream             | `catalog`                                                                                                                                                                                                                                                                      | shared catalog snapshot builder plus catalog SSE endpoint metadata                                                 | shared SSE transport lifecycle plus catalog reducer adapter                                                | catalog readiness, pagination/filter identity, stale/delete handling                                                    |
| SSE log stream                 | `container-logs`                                                                                                                                                                                                                                                               | stream-only endpoint metadata with stream-specific permission contract                                             | shared SSE transport lifecycle plus log reducer/fallback adapter                                           | line buffering, target selection, log filters, warnings, and fallback polling                                           |

Phase 1 kept these target groups derived from `behaviorClass`, backend
registration, and frontend orchestrator fields instead of duplicating
orchestrator, diagnostics, registration, permission, or resource-stream row
metadata in `domainInventory`. The tests prove a domain joins the intended
shared infrastructure group by domain id.

## Required Contract Fields

Add inventory metadata for every domain:

- `behaviorClass`
- `scopeContract`, including accepted encodings, cluster-prefix requirement,
  parser/canonicalizer owner, frontend builder owner, and whether the scope is
  a cluster, namespace, object, Helm release, resource-stream selector, query
  string, or stream-only selector
- `singleCluster` boolean, expected to be true for refresh domains
- `payloadOwner`
- `cachePolicy`, using a fixed enum owned by Phase 1. Initial values should at
  least distinguish normal snapshot cache, cache bypass, stream-only/no
  snapshot cache, external canonical cache such as object catalog, and frontend
  snapshot merge reuse.
- `streamSemantics` as a list, because some domains combine a primary behavior
  with secondary resync or merge behavior. Allowed values start as
  `row-update`, `complete-resync`, `append-merge`, `snapshot-replace`,
  `line-stream`, and `none`.
- `coverageContract`, naming the required test family for that class

Do not copy metadata that already has an authoritative home. Frontend
orchestrator, diagnostics stream, timing, category, backend registration, and
permission policy stay in `domains[]`. Resource-stream row scope kind, primary
resources, related resources, and metric dependency stay in
`resourceStream.domains`. Inventory tests should join to those homes by domain
id and assert the behavior class is compatible with them instead of duplicating
the same values.

Do not add a second permission vocabulary in the inventory. Reuse
`domains[].backend.permission`, whose current vocabulary is `runtime`, `exempt`,
and `stream-specific`. If another permission mode is required, extend that
existing field and its tests instead of adding a parallel `permissionPolicy`.
Runtime-permission domains must join to concrete requirements in
`snapshot.RuntimePermissionRequirements()`, resource-stream domains must join to
`resourcestream.PermissionRequirementsByDomain()`, and permission-denied
placeholder domains must preserve the same domain id and behavior class.

Keep the contract declarative. It should describe behavior and required
coverage, not replace behavior-specific registration code.

## Coverage Contract Enforcement

`coverageContract` is a test-enforced enum, not just prose. Phase 1 added a
small coverage registry in backend and frontend tests that maps each coverage
contract to a proof function or an explicit temporary `planned` status.

Examples:

- `snapshot-table-payload` proves snapshot scope parsing, payload identity,
  permission-denied behavior, and frontend snapshot merge reuse.
- `resource-stream-row-parity` proves the domain is covered by
  `TestSnapshotStreamRowParityCoversAllSupportedDomains`.
- `complete-resync-only` proves the domain has tests that assert COMPLETE causes
  resync and no targeted row mutation.
- `catalog-consistency` proves catalog snapshot/stream identity consistency.
- `catalog-snapshot-query` proves catalog-diff query scope parsing,
  pagination/filter identity, cluster scoping, and snapshot merge reuse without
  catalog stream diagnostics or resume expectations.
- `event-resume-merge` proves event ordering, dedupe, and resume behavior.
- `event-snapshot-payload` proves object-event snapshot scope parsing, event
  identity, and involved-object identity completeness without SSE resume
  expectations.
- `log-stream-lifecycle` proves log ordering, reconnect/fallback, and scope
  identity.
- `detail-payload-shape` proves object ref input, cache invalidation, and
  payload shape.
- `helm-content-shape` proves Helm release scope input, rendered manifest/values
  shape, related resource-link identity, and cache invalidation.
- `graph-payload-identity` proves object-map node/edge identity and relationship
  refs.
- `operation-state-transitions` proves operation lifecycle, cache bypass, and
  cleanup behavior.
- `aggregate-snapshot-permission-fallback` proves aggregate snapshots handle
  partial permissions and metrics/resource fallbacks.

During migration, classes not yet reached may use `coverageStatus: "planned"`.
Completion requires removing all planned statuses, so future domains fail closed
unless they supply an enforced coverage contract.

## Phase 1: Inventory And Guardrails

- [x] Add `domainInventory` to `refresh-domain-contract.json` for every current
      domain, leaving existing nested homes intact.
- [x] Make the inventory exhaustive in the JSON itself. Tables in this plan are
      explanatory examples; the contract must contain the exact class and
      coverage mapping for every current domain.
- [x] Update frontend contract types in `domainRegistry.ts`.
- [x] Add backend and frontend domain-id parity tests for contract ids, backend
      domain registrations, frontend domain registry ids, and resource-stream
      subset ids.
- [x] Account for registration paths explicitly: normal snapshot domains,
      resource-stream domains, event/catalog/container-log stream endpoints,
      and service/provider-gated domains such as catalog, object YAML, and Helm
      content.
- [x] Add backend and frontend contract tests that fail when a domain lacks
      inventory metadata, accepted scope contract, cache policy, stream
      semantics, or coverage contract.
- [x] Lock the enum vocabulary for `scopeContract.kind`, `cachePolicy`, and
      `streamSemantics`; do not allow free-form per-domain strings.
- [x] Assert each `scopeContract` points to a real backend parser/canonicalizer
      and frontend builder/normalizer when one exists.
- [x] Add compatibility tests that derive frontend orchestrator, diagnostics
      stream, registration kind, permission policy, and resource-stream row
      metadata from their existing homes rather than duplicating them in
      `domainInventory`.
- [x] Add permission compatibility tests that prove `runtime`, `exempt`, and
      `stream-specific` domains join to the existing requirement maps or
      explicit exemption paths, including permission-denied placeholder behavior.
- [x] Add the coverage-contract enforcement registry, with `planned` status only
      for classes scheduled for later phases.
- [x] Add a consolidation assessment for shared frontend SSE transport,
      snapshot-domain plumbing, backend registration gates, permission
      compatibility helpers, and scope normalization helpers. Phase 1 identified
      the shared seams; later phases should only consolidate when tests already
      prove behavior parity.
- [x] Edit the existing architecture sections in
      `docs/architecture/refresh-system.md` to explain behavior classes and
      canonical owners. Do not append a competing section that forks the current
      architecture doc.
- [x] Keep runtime behavior unchanged.

Validation:

- `go test ./backend/refresh/domain ./backend/refresh/system ./backend/refresh/snapshot`
- `npm run test --prefix frontend -- domainContract domainRegistry`
- `git diff --check`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 2: Snapshot And Aggregate Domains

- [ ] Define the `snapshot-table` contract for `namespaces`, including scope
      encoding, cluster-prefixed refresh keys, payload shape, object identity,
      frontend snapshot merge reuse, and permission-denied behavior.
- [ ] Resolve the namespace-listing canonical-source contract: namespace
      existence must come from `objectcatalog` or the namespace snapshot must be
      tested as a projection that stays compatible with the object catalog
      source of truth.
- [ ] Define the `aggregate-snapshot` contract for `cluster-overview`,
      including list-watch registration, list-only fallback, metrics fallback,
      partial-permission behavior, and object-reference identity in drill-down
      data.
- [ ] Add coverage proofs for both classes before later phases remove
      `coverageStatus: "planned"`.

Validation:

- `go test ./backend/refresh/snapshot ./backend/objectcatalog`
- `npm run test --prefix frontend -- ClusterOverview orchestrator backgroundClusterRefresher`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 3: Resource Row Domains

- [ ] Confirm every `resource-stream-table` domain is covered by
      snapshot/stream row parity.
- [ ] Expand parity cases where row fields still rely on fixture-light coverage.
- [ ] Add guardrails that row-update/delete keys are derived from `ref`, not
      legacy top-level identity or kind/name guessing.
- [ ] Confirm COMPLETE messages remain scope-level only.
- [ ] Keep mixed domains such as `namespace-custom` classified as
      `resource-stream-table` when they have ordinary row updates, even if some
      related-resource changes also trigger scope-level COMPLETE resyncs.
- [ ] Cover CRD signature churn for `namespace-custom` and `cluster-custom` as
      secondary `complete-resync` behavior on otherwise row-oriented domains.

Validation:

- `go test ./backend/refresh/resourcestream ./backend/refresh/snapshot`
- `npm run test --prefix frontend -- resourceStreamDomains resourceStreamManager resourceStreamRows`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 4: Complete-Resync Domains

- [ ] Encode COMPLETE-only domains as their own behavior class.
- [ ] Test that COMPLETE messages trigger full resync and do not attempt
      targeted row mutation.
- [ ] Cover Helm release identity churn as the explicit COMPLETE-only resync
      case for `namespace-helm`.

Validation:

- `go test ./backend/refresh/resourcestream ./backend/refresh/snapshot`
- `npm run test --prefix frontend -- resourceStreamManager`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 5: Catalog Domains

- [ ] Document object catalog as the canonical owner for discovery, browse
      identity, object existence, and namespace/cluster listings.
- [ ] Add catalog snapshot/stream consistency tests for identity, cluster
      scoping, pagination/filter inputs, and stale/delete behavior.
- [ ] Cover `catalog-diff` separately as a `catalog-snapshot` domain: same
      catalog payload/query owner, snapshot orchestrator, scoped diff workflow,
      and frontend snapshot merge reuse, but no catalog stream diagnostics or
      resume contract.
- [ ] Verify diagnostics expose catalog stream degradation distinctly from
      resource stream degradation.

Validation:

- `go test ./backend/objectcatalog ./backend/refresh/snapshot`
- `npm run test --prefix frontend -- catalogStreamManager browse ObjectDiffModal DiagnosticsPanel`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 6: Event Domains

- [ ] Define event identity and merge keys per event domain.
- [ ] Test ordering, dedupe, resume-token behavior, buffer overflow fallback,
      and involved-object identity completeness for SSE event-stream domains.
- [ ] Test `object-events` as a snapshot event payload: full object scope input,
      event identity, involved-object identity completeness, and no SSE resume
      expectations.
- [ ] Keep display-only involved objects separate from openable full refs.

Validation:

- `go test ./backend/refresh/eventstream ./backend/refresh/snapshot`
- `npm run test --prefix frontend -- eventStreamManager EventsTab`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 7: Log Domains

- [ ] Define log stream contracts for line ordering, timestamps, reconnect,
      fallback, and scope identity.
- [ ] Test cluster/object/container scoping and permission-denied diagnostics.
- [ ] Confirm log workflows do not leak rows into resource-table contracts.

Validation:

- `go test ./backend/refresh/containerlogsstream ./backend/resources/pods`
- `npm run test --prefix frontend -- containerLogsStreamManager LogViewer`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 8: Detail, Graph, And Operation Domains

- [ ] Define detail-payload contracts for `object-details` and `object-yaml`
      using full object reference scopes.
- [ ] Define Helm content contracts for `object-helm-manifest` and
      `object-helm-values` using the current Helm release `namespace:name`
      scope, rendered content shape, and related resource-link identity.
- [ ] Define graph-payload contracts for `object-map`, including node/edge
      identity and relationship refs.
- [ ] Define operation-state contracts for `object-maintenance`, including
      cache bypass, lifecycle cleanup, and long-running state transitions.
- [ ] Include object-maintenance scope parsing (`node:<name>` and aggregate
      scope) and multi-cluster drain-job isolation in the operation-state
      coverage.
- [ ] Add or expand tests at the closest useful level for each class.

Validation:

- `go test ./backend/resources/... ./backend/refresh/snapshot ./backend/nodemaintenance`
- `npm run test --prefix frontend -- ObjectPanel objectMap useNodeMaintenanceActions`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 9: Infrastructure Consolidation

Do this only after Phases 2-8 have enforced the relevant behavior contracts.
The goal is fewer lifecycle and registration paths, not fewer correctness
models. Each consolidation must keep the behavior adapters named in the desired
end-state matrix and must delete the duplicated local path it replaces.

- [ ] Consolidate shared frontend SSE transport lifecycle for event, catalog,
      and log streams: EventSource creation, reconnect/backoff, permission-error
      parsing, health telemetry, visibility pause/resume, and cleanup. Keep
      event, catalog, and log reducers separate unless tests prove identical
      state semantics.
- [ ] Consolidate frontend scoped snapshot lifecycle for snapshot payload
      domains: scope enablement, refresh requests, cache-bypass/manual refresh,
      error handling, diagnostics rows, and optional keyed merge reuse.
- [ ] Extract keyed snapshot merge reuse for domains that can declare a
      collection field and stable key without hiding payload-specific behavior.
      Initial candidates are `namespaces`, `catalog-diff`, and
      `object-maintenance`.
- [ ] Consolidate backend registration metadata/helpers for `list`,
      `listWatch`, list fallback, provider/service-gated direct registrations,
      and dynamic-client requirements while preserving distinct registration
      behavior.
- [ ] Replace separate permission compatibility assertions with one domain-id
      keyed helper covering snapshot runtime requirements, resource-stream
      requirements, stream-specific permissions, and explicit exemptions.
- [ ] Reuse shared cluster-prefix normalization helpers across scope builders
      and parsers while keeping object, resource-stream, catalog, Helm, and
      node-maintenance scope parsers explicit.
- [ ] Keep coverage proof plumbing behavior-class-driven so future domains fail
      closed through the inventory instead of requiring one-off assertions.
- [ ] Remove any superseded duplicate lifecycle, registration, permission, or
      merge helpers in the touched paths.

Validation:

- `go test ./backend/refresh/... ./backend/objectcatalog ./backend/nodemaintenance`
- `npm run test --prefix frontend -- refresh streaming domainContract domainRegistry`
- `npm run typecheck --prefix frontend`
- `mage qc:prerelease` before reporting the implementation phase complete

## Phase 10: Runtime Smoke Checklist

- [ ] Write `docs/workflows/refresh-smoke.md` as a manual pre-release checklist
      for multi-cluster stream reconnects, restricted-RBAC partial access,
      cluster add/remove/rebuild while streams are active, and informer
      cold-start/recovery.
- [ ] Link the checklist from `docs/README.md` and
      `docs/architecture/refresh-system.md`.
- [ ] Defer automation to a follow-up plan only after the manual checklist is
      clear and repeatable.

Validation:

- `git diff --check` for documentation-only checklist work.
- `mage qc:prerelease` only if this phase is reported as part of a broader
  non-documentation implementation closeout.

## Completion Criteria

- Every refresh domain in `refresh-domain-contract.json` declares a behavior
  class and required contract metadata.
- Contract tests fail when a domain is added without class-specific coverage.
- All temporary `coverageStatus: "planned"` entries have been removed or
  converted to enforced coverage.
- Consolidation opportunities identified in Phase 1 are either implemented in
  Phase 9 or deliberately deferred to a named follow-up with the behavior tests
  that make the deferral safe.
- All open questions that affect class assignment, coverage enforcement, or
  scope encoding are resolved in the implementation or moved to a separate
  non-blocking follow-up with an explicit compatibility test.
- Fields subsumed by the new inventory model are removed or retained only where
  they remain behavior-specific; do not leave duplicate metadata behind.
- Durable behavior-class guidance is moved into architecture/workflow docs and
  `.agents/skills/refresh-subsystem/SKILL.md`.
- This temporary plan is deleted after durable guidance exists.

## Open Questions

- Should `object-yaml` remain under detail-payload long term, or receive a
  separate mutation/read contract because apply flows are adjacent?
- Should Helm release content scopes migrate from `namespace:name` to a
  synthetic full `helm.sh/v3:HelmRelease` object ref, or should Helm release
  identity remain a separate contract?
- Which runtime smoke checks should be automated in CI versus documented for
  manual pre-release validation?
