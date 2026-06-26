---
name: refresh-subsystem
description: Guide for safely modifying the refresh/streaming subsystem — covers the full domain lifecycle, registration points, and known fragility areas
user-invocable: false
---

# Refresh Subsystem Guide

This subsystem is **fragile**. Changes historically break things. Read this
before touching any refresh, streaming, snapshot, or domain code. For metric
source clocks and utilization consumers, also read
`docs/architecture/resource-metrics.md`.

## Architecture Overview

The refresh subsystem manages how Kubernetes resource data flows from clusters to the UI. Each connected cluster gets its own independent subsystem (manager, registry, informers, permission checker). An aggregate layer multiplexes across clusters for the HTTP API.

```
Kubernetes API
    ↓ (informers / polling)
Per-Cluster Subsystem (manager, registry, informers, permissions)
    ↓ (snapshots, SSE, WebSocket)
Aggregate Mux (routes requests to correct cluster)
    ↓ (HTTP API on loopback)
Frontend RefreshManager + RefreshOrchestrator
    ↓ (per-cluster runtimes, stream managers, store writes)
React UI
```

The frontend has one global coordinator for app lifecycle concerns, with per-cluster runtimes underneath it. Each runtime owns enabled scopes, in-flight work, stream health, metrics freshness, and streaming cleanup for exactly one cluster. Refresh domains are single-cluster by contract; background cluster refresh fans out as separate per-cluster requests instead of using multi-cluster refresh scopes.

```
Global coordinator
    ↓
ClusterRefreshRuntime(cluster-a)  ClusterRefreshRuntime(cluster-b)
    ↓                             ↓
single-cluster snapshots/streams  single-cluster snapshots/streams
    ↓ (callbacks, store updates)
React UI
```

## Initialization Sequence

Order matters. Don't rearrange.

1. Create refresh context with cancel
2. Start heartbeat loop
3. **Per cluster:**
   a. Create informer factory + permission checker
   b. Prime permissions (preflight cache warming) — **BEFORE** domain registration
   c. Register domains (universal runtime check + gate logic) — **AFTER** preflight
   d. Create snapshot service, manual queue, stream managers
   e. Start manager (informers + metrics polling)
   f. Start permission revalidation loop
4. Build aggregate mux wiring all clusters
5. Start HTTP server on loopback

**Key files:**

- `backend/app_refresh_setup.go` — orchestrates steps 1-5
- `backend/app_refresh_update.go` — updates active per-cluster subsystems without restarting the HTTP server
- `backend/app_refresh_subsystems.go` — replaces aggregate subsystem state and shared handlers
- `backend/app_refresh_recovery.go` — teardown, auth recovery, transport rebuild
- `backend/refresh/system/manager.go` — per-cluster subsystem creation

## Domain Registration

### Backend

Domains are registered in a fixed order in `backend/refresh/system/registrations.go`. **Order matters** — some domains depend on others (e.g., `cluster-crds` before `cluster-custom`).

Three registration kinds:

| Kind        | Permission Gate                               | Fallback                   |
| ----------- | --------------------------------------------- | -------------------------- |
| `direct`    | None — always registers                       | None                       |
| `list`      | Checks list permission for required resources | Skips if denied            |
| `listWatch` | Checks list + watch permissions               | Can fall back to list-only |

**Two-layer permission checking:**

1. **Preflight** — bulk SSAR calls to warm the cache at startup
2. **Per-domain runtime check** — list/watch checks declared on each domain's registration config and evaluated by the `permissionGate` in `backend/refresh/system/permission_gate.go`

To register a new domain, add it to `domainRegistrations()` in `registrations.go`. Consider:

- What permissions does it need? Declare them on the domain's `listDomainConfig`/`listWatchDomainConfig` so the `permissionGate` checks them
- Does it need informers? Register them in `backend/refresh/informer/factory.go`
- What order? Place it after any domains it depends on

### Shared Domain Contract

Domain metadata is authored in
`backend/refresh/domain/refresh-domain-contract.json`. It owns domain category,
frontend refresher name, timing, diagnostics stream, orchestrator kind, backend
registration kind, permission policy, and resource-stream participation.

Keep behavior explicit in backend registration functions and frontend stream
managers. `frontend/src/core/refresh/domainRegistry.ts` imports the contract
directly and derives metadata maps from it; the contract removes duplicate
metadata, not real behavior.

### Frontend

Every backend domain has a frontend counterpart:

| File                                                | What to update                                    |
| --------------------------------------------------- | ------------------------------------------------- |
| `frontend/src/core/refresh/types.ts`                | Add to `RefreshDomain` union + `DomainPayloadMap` |
| `frontend/src/core/refresh/refresherTypes.ts`       | Add refresher name + map view to refresher        |
| `frontend/src/core/refresh/domainRegistrations.ts`  | Register the explicit orchestrator/stream wiring  |
| `backend/refresh/domain/refresh-domain-contract.json` | Add shared metadata consumed by backend tests and frontend registry |

**These must stay synchronized through the contract tests.** A backend domain
without a frontend mapping breaks diagnostics. A frontend refresher without a
backend domain gets empty snapshots.

Resource WebSocket domains also require:

| File                                                                      | What to update                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`            | Scope kind, row collection, row identity, sort, drift keys, metric preservation |
| `frontend/src/core/refresh/streaming/resourceStreamRows.ts`               | Pure row replacement, deletion, stable reuse, and metrics-preserving merge logic |
| `frontend/src/core/refresh/streaming/resourceStreamConnection.ts`         | WebSocket connection lifecycle, queued sends, reconnect, pause/resume           |
| `frontend/src/core/refresh/streaming/resourceStreamSubscriptions.ts`      | Single-cluster scope resolution, subscription state, unsubscribe debounce, resume tokens |
| `backend/kind/kindregistry/registry.go`                                   | Add the `Stream` facet so `StreamDescriptors()` projects the streamed kind      |
| `backend/refresh/resourcestream/stream_registration_*.go`                 | Bespoke informer registration and lister/indexer setup for kinds that need it   |
| `backend/refresh/resourcestream/update_helpers_test.go` and manager tests | Stream envelope metadata and row-shape parity                                   |

Resource stream descriptors describe row behavior only. Domain descriptors must
not reintroduce multi-cluster capability flags; cross-cluster UI should derive
from separate per-cluster domain state above the refresh store.

`ResourceStreamManager` should remain responsible for refresh-store mutation,
snapshot resync, drift detection, health, telemetry, and fallback decisions.
Keep connection lifecycle in `ResourceStreamConnection`, subscription mechanics
in `ResourceStreamSubscriptionStore`, and pure row math in
`resourceStreamRows.ts`. Ready/resync/error store status transitions should use
one domain-id path; do not add copied branches per streamed domain. Terminal
stream error notification should use `streamErrorNotifier.ts`.

Resource stream row updates and deletes carry identity only through the
top-level `ref` (`resourcemodel.ResourceRef`). Legacy top-level identity fields
(`uid`, `name`, `namespace`, `kind`, `apiGroup`, `apiVersion`) have been
removed from the wire payload; `clusterId` / `clusterName` remain as envelope
routing metadata. Do not add new key logic that guesses GVK from kind/name.
`COMPLETE` is scope-level resync, not targeted row invalidation — any `ref` on
COMPLETE is diagnostic context only.

Stream selectors are typed (`resourcestream.StreamSelector`). Validate and
canonicalize transport scope strings at the WebSocket boundary via
`ParseStreamSelector`; the canonical selector string remains the subscription
key. Convert selectors to concrete `ResourceRef` values only when resolving a
specific affected row.

Snapshot vs stream row parity is enforced by
`backend/refresh/snapshot/parity_test.go`. When you add a streamed domain you
must add a parity case (or, for COMPLETE-only contracts like
`namespace-helm`, an explicit excluded entry in
`TestSnapshotStreamRowParityCoversAllSupportedDomains`). When you add a field
to a `*Summary` struct, add an assertion in either an existing
`TestBuild*SummaryPopulatesAllFields` test or the parity case so a missed
population fails CI rather than silently dropping the field on stream rows.

Per-domain stream metadata (source clocks, scope kind, primary/related
resources, metrics dependency) is authored once in
`backend/refresh/domain/refresh-domain-contract.json`. Backend
(`TestResourceStreamDomainsMatchProjectionDescriptors`) and frontend
(`resource stream domain descriptors > matches the backend-authored projection
contract`) tests both lock that JSON to their respective descriptor tables.

Metric-bearing projectors accept the latest usage maps as parameters; they do
not reach into `metrics.Provider` themselves. Use
`Manager.podMetricsSnapshot()` / `Manager.nodeMetricsSnapshot()` at the call
site and pass the maps in, so per-row construction stays deterministic for
tests and parity comparisons.

## Snapshot Building

**File:** `backend/refresh/snapshot/service.go`

- Uses singleflight to deduplicate concurrent builds for the same cache key
- Cache bypass appends `:bypass` to key to isolate from normal requests
- **Caching rules:**
  - Truncated snapshots are NOT cached
  - Partial batches are NOT cached
  - Only final batches are cached

## Streaming

Three stream routes use the refresh HTTP server. Event and catalog liveness now
travels as source-specific doorbells on the resources WebSocket; their rows are
still fetched through snapshot/query domains.

| Stream         | Transport         | Backend                                      | Frontend                                                            |
| -------------- | ----------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| Resources, events, catalog | WebSocket         | `backend/refresh/resourcestream/` plus event/catalog producer bridges | `frontend/src/core/refresh/streaming/resourceStreamManager.ts`      |
| Container logs | SSE (EventSource) | `backend/refresh/containerlogsstream/`       | `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts` |

Frontend SSE managers share `frontend/src/core/refresh/streaming/sseStreamTransport.ts`
for EventSource URL creation and listener cleanup. Reconnect delay calculation
lives in `frontend/src/core/refresh/streaming/streamTiming.ts`, and visibility
suspend/resume lives in
`frontend/src/core/refresh/streaming/streamVisibilityController.ts`. Stream
error notification and kubeconfig-change suppression live in
`frontend/src/core/refresh/streaming/streamErrorNotifier.ts`. The resource
WebSocket manager also uses the shared timing, visibility, and terminal-error
notification helpers. Keep log reducers separate from doorbell reducers unless
tests prove their state semantics are identical.

**Event/catalog doorbells:** The event and catalog producers emit
`source=event` / `source=catalog` doorbells on `/api/v2/stream/resources`.
Missed event resume becomes a `RESET` doorbell so consumers re-snapshot rather
than keeping stale event rows.

**Source-version contract:** Resource-stream signals carry source-specific
refetch identity. Treat `Version` as an opaque equality token for the named
`Source`; `Sequence` is transport resume/high-water metadata only,
`streamRevision` is diagnostic/backward-compatible frontend state only, and
Kubernetes `resourceVersion` is reflector metadata only. Metric-only source
changes may refresh metric-backed pages but must not bump the object source
version.

**Resource stream resume:** Resource WebSocket subscriptions are keyed by a single cluster, domain, and normalized scope. The frontend sends resume tokens per subscription; expired buffers trigger `RESET` and a snapshot resync. Multi-cluster resource stream scopes are rejected on both the frontend subscription path and backend stream mux path, matching the broader single-cluster refresh-domain contract.

**Stream endpoints:**

- `/api/v2/stream/resources`
- `/api/v2/stream/container-logs`

## RefreshManager (Frontend)

**File:** `frontend/src/core/refresh/RefreshManager.ts`

Lifecycle per refresher: `idle → refreshing → cooldown → idle`

Key behaviors:

- Callbacks run via `Promise.allSettled` — one failure doesn't kill others, but the refresh is marked failed
- Exponential backoff on errors: `cooldown * 2^(errorCount-1)`, capped at 60s
- Context changes (namespace, cluster, view) abort affected refreshers then re-trigger
- Global pause blocks automatic refresh but not manual refresh
- Visibility: streams suspend on hidden tab, resume on visible

## Resource Stream Registration

Backend resource stream registration is split by behavior:

| File                              | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `stream_descriptor_dispatch.go`   | Generic `registerDescriptorStreams` that wires every plain object→row kind from `kindregistry.StreamDescriptors()` |
| `stream_registration_helpers.go`  | Permission checks and Add/Update/Delete event mapping                    |
| `stream_registration_direct.go`   | Bespoke handlers that still need a custom informer/related-object invalidation (configmap, secret, HPA) |
| `stream_registration_network.go`  | Network handlers that need a manager-level lister (service/endpointslice correlation) |
| `stream_registration_related.go`  | Pod/node/workload registrations that seed related-object lookup state    |

Plain object→row kinds are now projected from the descriptor registry; only kinds that need a custom handler or lister keep a hand-written registration. Keep permission checks before lazy informer creation. Do not replace the remaining bespoke files with a large descriptor table if the behavior-specific split is clearer.
Ordinary object updates may use shared `newObjectUpdate`/`newObjectRowUpdate`
helpers, but keep pods, endpoint slices, workloads, custom resources,
node-derived updates, and Helm resync signals explicit.
Do not assign `Update.Row` in stream handlers; add or reuse projection helpers
so snapshot and stream rows are built by the same canonical constructor path.
Resource-stream permission resources are declared as the primary/related
resources on each stream projection descriptor in
`backend/refresh/resourcestream/projection_descriptors.go` and are checked
against snapshot runtime permissions by
`TestDomainPermissionContractsJoinExpectedRequirementSources` in
`backend/refresh/system/registrations_test.go`.

## Known Fragility Points

### Things that break easily

1. **Permission gate ordering** — Preflight must run before domain registration. Domain registration order is fixed. Moving things around causes cascading failures where later domains can't find data from earlier ones.

2. **Metrics polling** — Can be disabled for two different reasons (permissions vs discovery) with different UI messages. Getting the disabled reason wrong makes diagnostics confusing.

3. **Multi-cluster add/remove** — Aggregate handlers must be updated via the update path, not just init. They route requests to per-cluster subsystems; they must not merge multiple clusters into one refresh-domain result.

4. **Refresh scope ownership** — Refresh domains must target exactly one cluster. Do not pass multi-cluster scopes to snapshot, manual refresh, or resource stream domains; fan out to per-cluster runtimes instead.

5. **Stream reconnection** — Event/resource buffer overflow means resume fails and the frontend must fall back to full re-snapshot. If this detection is wrong, the UI shows stale data with no indication.

6. **Rapid context changes** — Switching namespaces/clusters quickly can leave refreshers in undefined state. The abort→retrigger path has race conditions if context updates arrive faster than abort completes.

7. **Informer shutdown** — `Shutdown()` clears references but doesn't stop informers (context cancellation does that). If the context isn't cancelled before shutdown, informers leak.

### Before modifying this subsystem

- [ ] Read the specific file you're changing AND its callers
- [ ] Check if domain registration order is affected
- [ ] Check if permission checks need updating (both layers)
- [ ] Check if frontend mappings need updating (types, refresher config, diagnostics)
- [ ] For resource streams, check frontend descriptors, backend supported domains, registration files, and single-cluster scope tests
- [ ] Confirm new refresh-domain code builds one cluster scope at a time and derives any cross-cluster display above refresh state
- [ ] Confirm `namespaces` and `cluster-overview` remain ordinary per-cluster domains, not aggregate-domain exceptions
- [ ] Confirm backend aggregate handlers still route as a mux and do not merge snapshot/manual/event/resource results across clusters
- [ ] For streamed table rows, check descriptor parity tests for row identity, update identity, sorting, empty payloads, and drift keys
- [ ] Check if stream resume semantics are affected
- [ ] For metric-bearing domains, confirm metric-only changes use the metric
      source clock and do not re-project or re-store object rows
- [ ] Test with multiple clusters connected
- [ ] Test with a cluster that has restricted RBAC (not cluster-admin)
- [ ] Verify diagnostics panel still shows correct status
