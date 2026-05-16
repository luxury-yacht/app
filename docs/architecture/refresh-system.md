# Refresh System

Luxury Yacht refreshes Kubernetes data through backend snapshot builders,
streaming endpoints, and a frontend orchestrator that scopes every request to
the relevant cluster or cluster list.

See [README.md](README.md) for the architecture doc map.

## Quick Model

The refresh system has three layers:

- Backend refresh subsystem(s) build snapshots and serve streams per cluster.
- A lightweight HTTP API serves snapshots, manual refresh jobs, telemetry, and
  stream endpoints.
- The frontend refresh manager and orchestrator schedule refreshes, normalize
  cluster-aware scopes, route single-cluster work through per-cluster runtimes,
  start and stop streams, and store results for UI hooks.

Multi-cluster support uses one frontend orchestrator with per-cluster runtimes
and one backend refresh subsystem per active cluster. Aggregate backend services
in `backend/app_refresh_setup.go` fan out snapshot, manual queue, resource
stream, event stream, log stream, and catalog stream requests to the correct
cluster subsystem(s).

Backend resource responsibilities are intentionally split:

- `backend/refresh/snapshot` is the canonical source for refresh-domain
  list/table payloads and snapshot baselines.
- `backend/refresh/resourcestream` owns live row updates for streaming
  list/table domains and must emit the same row shape as the snapshot path.
- `backend/resources` owns rich object detail payloads, logs/debug helpers, and
  imperative operations reached through Wails wrappers or object-detail
  providers. Do not add new list/table refresh paths there.
- `backend/objectcatalog` owns discovery and browse/catalog identity. Use it for
  resource discovery and catalog rows, not rich object detail payloads.

## Terms

| Term                 | Meaning                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Backend subsystem    | Per-cluster refresh services: domain registry, snapshot service, manual queue, streams, telemetry, informers, and permission gates. |
| Refresh domain       | A named data set such as `cluster-overview`, `namespace-workloads`, `object-details`, `object-map`, or `catalog`.                   |
| Scope                | The requested slice of a domain. In this app it must be cluster-prefixed before crossing the API boundary.                          |
| Snapshot             | A point-in-time response for one domain and scope, including payload, version, checksum, timestamps, and stats.                     |
| Stream               | A long-lived WebSocket or SSE connection that pushes updates instead of relying only on polling.                                    |
| Refresher            | Frontend timer configuration for a domain: interval, cooldown, and timeout.                                                         |
| Refresh manager      | Frontend scheduler. It decides when refresh callbacks should run.                                                                   |
| Refresh orchestrator | Frontend executor. It normalizes scopes, fetches snapshots, starts/stops streams, and writes store state.                           |
| Refresh store        | Frontend in-memory state keyed by domain and full scope, including status, data, stats, errors, and ETags.                          |
| Cluster scope        | A scope prefix such as `clusterId\|...` or `clusters=id1,id2\|...`.                                                                 |

## Domains And Scopes

Refresh domain names and payload contracts live in:

- `frontend/src/core/refresh/types.ts`
- `frontend/src/core/refresh/refresherTypes.ts`
- `frontend/src/core/refresh/refresherConfig.ts`

Frontend domain registrations live in
`frontend/src/core/refresh/orchestrator.ts`. Backend registrations live in
`backend/refresh/system/registrations.go`; stream routes are registered in
`backend/refresh/system/streams.go`.

Current frontend domains are fully scoped. The orchestrator normalizes every
scope with `buildClusterScope` or `buildClusterScopeList` from
`frontend/src/core/refresh/clusterScope.ts` before a network request or store
write. The HTTP API enforces this: `/api/v2/snapshots/{domain}` and
`/api/v2/refresh/{domain}` return `400` when no cluster scope is present.

Scope rules:

- Single cluster: `clusterId|<scope>`
- Multi-cluster: `clusters=id1,id2|<scope>`
- Cluster-wide with empty tail: `clusterId|` or `clusters=id1,id2|`
- Namespace scopes use the `namespace:<name>` tail and then receive the cluster
  prefix.
- Existing cluster-prefixed scopes are preserved so enable/disable calls do not
  rewrite historical store keys after selection changes.

`namespaces` and `cluster-overview` are single-active-scope domains in the
orchestrator. Enabling a new scope for either disables stale scopes so closed
tabs and old active-cluster selections do not keep refreshing.

## Snapshot Path

Snapshots are served by `backend/refresh/api/server.go`:

- `GET /api/v2/snapshots/{domain}?scope=...`
- `POST /api/v2/refresh/{domain}` for manual refresh jobs
- `GET /api/v2/jobs/{id}` for job status
- `GET /api/v2/telemetry/summary`
- `POST /api/v2/metrics/active`

The frontend fetches snapshots through
`frontend/src/core/refresh/client.ts`. It sends `If-None-Match` when a previous
ETag is known and treats `304 Not Modified` as a successful refresh without new
payload data.

The backend snapshot service (`backend/refresh/snapshot/service.go`) wraps
registered builders with:

- Runtime permission checks before each build.
- Singleflight deduplication for concurrent domain+scope builds.
- A short in-memory snapshot cache (`SnapshotCacheTTL = 5s`).
- Checksums used as ETags.
- Telemetry recording.

Partial or truncated snapshots are not cached, and `object-maintenance` bypasses
snapshot caching so long-running drain status stays current.

## Frontend Architecture

`RefreshManager` (`frontend/src/core/refresh/RefreshManager.ts`) owns scheduling:

- Registering refreshers.
- Running interval loops with cooldowns and timeouts.
- Triggering manual refreshes for context changes.
- Cancelling or stopping loops when the kubeconfig changes.
- Emitting refresh state events.

It does not fetch data.

`RefreshOrchestrator` (`frontend/src/core/refresh/orchestrator.ts`) owns
execution:

- Registering domains and optional streaming behavior.
- Normalizing every scope with selected cluster IDs.
- Fetching snapshots through `fetchSnapshot`.
- Applying snapshots into `frontend/src/core/refresh/store.ts`.
- Starting and stopping streaming managers.
- Cancelling in-flight requests when refresh context changes.
- Invalidating the cached refresh base URL and suppressing transient network
  errors while backend refresh services rebuild.

Refreshers are disabled by default (`DEFAULT_AUTO_START = false`). Views and
hooks enable the scopes they need, then trigger startup or manual refreshes. This
keeps unused domains from polling or streaming at app startup.

UI code reads state through hooks such as:

- `useRefreshScopedDomain`
- `useRefreshScopedDomainStates`
- `useRefreshScopedDomainEntries`
- `useRefreshState`

Context updates come from active view changes, namespace changes, cluster tab
changes, object panel state, and settings. The background refresh setting
(`refreshBackgroundClustersEnabled`) controls whether `selectedClusterIds`
contains all active clusters or only the active tab cluster. Resource WebSocket
domains still run as one subscription per cluster; multi-cluster `clusters=...`
scopes are reserved for aggregate snapshot behavior.

## Backend Architecture

`backend/app_refresh_setup.go` builds refresh services for each active cluster.
Each subsystem includes:

- Shared informer factory (`backend/refresh/informer/factory.go`) with
  list/watch SSAR gating.
- Domain registry (`backend/refresh/domain`).
- Snapshot builders (`backend/refresh/snapshot/*.go`).
- Snapshot service and manual refresh queue.
- Stream handlers/managers for resources, events, container logs, and catalog.
- Telemetry recorder (`backend/refresh/telemetry`).

Domain registration is table-driven in
`backend/refresh/system/registrations.go`. The table declares whether a domain
uses direct registration, list-only registration, or list/watch registration,
and it centralizes preflight/runtime permission requirements. Missing
permissions register permission-denied placeholder domains so diagnostics can
surface the issue consistently.

Informers are backend-only shared watchers with local caches. They are used by
the object catalog, resource stream manager, event stream manager, cache
invalidation, and snapshot builders that can read from informer listers instead
of direct API lists.

The response cache (`backend/response_cache.go`) is separate from refresh
snapshot caching. It caches object detail, YAML, and Helm content for the object
panel (`ResponseCacheTTL = 10s`) and is invalidated by informer callbacks in
`backend/response_cache_invalidation.go`. Do not use it for refresh-domain
list/table payloads.

## Streaming

Stream endpoints are registered in `backend/refresh/system/streams.go`:

| Stream                | Transport | Domains                                                                                                                                                   | Frontend manager             | Backend endpoint                |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------- |
| Resource stream       | WebSocket | `pods`, `nodes`, `namespace-workloads`, namespace config/network/RBAC/storage/autoscaling/quotas/custom/helm, and cluster RBAC/storage/config/CRDs/custom | `resourceStreamManager`      | `/api/v2/stream/resources`      |
| Catalog stream        | SSE       | `catalog`                                                                                                                                                 | `catalogStreamManager`       | `/api/v2/stream/catalog`        |
| Event stream          | SSE       | `cluster-events`, `namespace-events`                                                                                                                      | `eventStreamManager`         | `/api/v2/stream/events`         |
| Container logs stream | SSE       | `container-logs`                                                                                                                                          | `containerLogsStreamManager` | `/api/v2/stream/container-logs` |

Streaming behavior is registered per domain in the orchestrator:

- Resource-stream domains are view-gated. They only start when their matching
  view is active, and every resource stream subscription targets exactly one
  cluster. When multiple cluster tabs are open, active and background clusters
  refresh through separate per-cluster requests instead of one `clusters=...`
  resource stream scope.
- `pods`, `namespace-workloads`, and `nodes` use resource streams for rows and
  continue metrics-only snapshot refreshes for usage fields.
- `catalog` uses SSE snapshots from the object catalog and also supports normal
  snapshot fetches for startup, filtering, pagination, and manual requests.
- `cluster-events` and `namespace-events` use SSE and keep an in-memory sorted
  event list with merge-by-UID behavior.
- `container-logs` streams object-panel log lines and has a log-viewer fallback
  path when streaming is unavailable.

`fetchScopedDomain` behavior for streaming domains:

- Manual fetches for active resource-stream domains call
  `refreshStreamingDomainOnce` so the WebSocket can deliver immediate deltas.
- Manual fetches for SSE domains fall through to normal snapshot fetches. For
  catalog this is important because filter and pagination requests need the
  snapshot endpoint rather than a stream restart.
- Auto refresh starts the stream when the scope is enabled and current context
  allows streaming.
- If a non-metrics stream is healthy, auto snapshot polling is skipped.
- Metrics-only streaming domains still perform metrics-only snapshots while the
  row stream is healthy, throttled by the configured metrics interval.
- If a stream is inactive, unhealthy, blocked by drift detection, or disabled by
  the current view/context, snapshot polling remains the fallback.

Resource stream safety rules:

- Frontend resource stream descriptors live in
  `frontend/src/core/refresh/streaming/resourceStreamDomains.ts`. Each
  descriptor must declare scope kind, cluster-scoped behavior, row collection
  accessors, row identity, snapshot drift-key construction, row sorting, and
  whether metrics should be preserved across row updates.
- Backend resource stream supported domains live in
  `backend/refresh/resourcestream/domains.go`. Keep them aligned with backend
  refresh domain registrations and the frontend descriptors.
- Each domain/scope stream must deliver monotonic `resourceVersion` values.
  Missing or regressing versions trigger a snapshot resync and temporarily block
  the stream for that scope.
- Resource WebSocket streams reject multi-cluster scopes. Background refresh is
  implemented as fanout across cluster runtimes, not as a multi-cluster stream
  subscription.
- Backend sends `RESET` at subscription start and `COMPLETE` when a subscriber
  is dropped or a resync is required.
- Per-subscriber backpressure drops slow subscribers and forces snapshot resync.
- The frontend coalesces update bursts and ignores deltas while a resync is in
  flight.
- Drift detection compares sampled stream updates against snapshot data. Large
  divergence emits `refresh:resource-stream-drift`, stops streaming for that
  domain/scope, and falls back to polling.

## Catalog Integration

The object catalog owns discovery, canonical object identity, namespace
metadata, and browse query semantics. See [catalog.md](catalog.md) for service
lifecycle, lookup/query APIs, freshness, and Browse ownership.

Refresh-specific integration points:

- The `catalog` refresh domain is backed by
  `backend/refresh/snapshot/catalog.go`.
- The catalog SSE stream handler is
  `backend/refresh/snapshot/catalog_stream.go`.
- Catalog stream events are snapshot-shaped and apply through the refresh store.
- Manual/filter/pagination requests still use snapshot fetches; SSE is not a
  replacement for query-specific fetches.
- `snapshotMode: full|partial` describes backend batching of snapshot payloads,
  not a separate UI pagination model.

## Row Builder Single Source Of Truth

Every row type that appears in a snapshot payload (`PodSummary`,
`ConfigSummary`, `NetworkSummary`, `ClusterCRDEntry`, `AutoscalingSummary`,
`ClusterCustomSummary`, `NamespaceCustomSummary`, and similar types) must have
one constructor path. For most row types this is a `Build*Summary` helper in
`backend/refresh/snapshot/streaming_helpers.go`.

The rule: any new row field must be populated by the shared helper. Snapshot
builders and streaming code must call that helper instead of constructing rows
with separate struct literals.

Why this matters: snapshots and streams are independent entry points that emit
the same frontend row type. If they build rows independently, one path can omit a
new field and later overwrite good data from the other path with a zero value.
That is how bug classes like "CRD version disappears after refresh" or "HPA
scale target apiVersion drops on status update" happen.

Regression guards live in
`backend/refresh/snapshot/streaming_helpers_test.go`. When adding a field, add or
extend the matching `TestBuild*SummaryPopulatesAllFields` assertion.

Exceptions still have one constructor path:

- `PodSummary` delegates through the internal `buildPodSummary`.
- `WorkloadSummary` is built by `NamespaceWorkloadsBuilder` helpers that the
  streaming helper also uses.
- `NodeSummary` goes through `BuildNodeSnapshot`.

## Common Flows

Cluster overview:

- Frontend enables `cluster-overview` for the active cluster only and fetches a
  snapshot.
- Backend registers the informer-based builder when nodes/pods/namespaces
  list/watch permissions exist, otherwise it falls back to a list-only builder.
- The payload is assembled in `backend/refresh/snapshot/cluster_overview.go` and
  includes overview totals, metrics, version, and recent events.

Nodes:

- The Nodes tab enables the `nodes` scope through
  `ClusterResourcesContext`.
- The resource stream supplies live row changes through `/api/v2/stream/resources`.
- Metrics-only snapshots update usage fields while the stream remains healthy.
- Snapshot fetches provide the baseline and fallback/resync path.

Object panel:

- Opening the panel updates refresh context with canonical object identity.
- `object-details`, `object-events`, `object-yaml`, Helm manifest/value domains,
  and `object-map` use cluster-prefixed object scopes.
- Logs use `container-logs` streaming with fallback polling in the log viewer.

Kubeconfig changes:

- `kubeconfig:changing` cancels in-flight requests, stops streams, disables
  scopes, clears store state, invalidates the refresh base URL, and suppresses
  transient network errors.
- `kubeconfig:changed` and `kubeconfig:selection-changed` invalidate the base URL
  and let normal context updates re-enable required scopes.

## Adding Or Updating Domains

When adding a domain, update:

1. `frontend/src/core/refresh/types.ts` and `DomainPayloadMap`.
2. `frontend/src/core/refresh/refresherTypes.ts` and `refresherConfig.ts`.
3. `frontend/src/core/refresh/orchestrator.ts` domain registration, scope
   behavior, and streaming behavior if any.
4. `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`.
5. Backend snapshot builders in `backend/refresh/snapshot`.
6. Backend registration in `backend/refresh/system/registrations.go`.
7. Shared row construction in `backend/refresh/snapshot/streaming_helpers.go`
   and matching tests in `streaming_helpers_test.go` when the domain emits table
   rows.

When adding a streaming domain:

1. Register the endpoint in `backend/refresh/system/streams.go`.
2. For resource-stream domains, add event handlers in
   `backend/refresh/resourcestream/stream_registration_*.go` and add the domain
   to `backend/refresh/resourcestream/domains.go`.
3. For SSE domains, implement a handler similar to
   `backend/refresh/snapshot/catalog_stream.go` or
   `backend/refresh/eventstream/handler.go`.
4. Wire the frontend manager in `frontend/src/core/refresh/orchestrator.ts`.
5. For resource-stream domains, add a descriptor in
   `frontend/src/core/refresh/streaming/resourceStreamDomains.ts` and extend
   the descriptor parity tests.

When adding a field to an existing row type:

- Add it to the Go struct in `backend/refresh/snapshot/*.go`.
- Populate it in the shared row helper, not in a separate inline struct literal.
- Extend the matching `TestBuild*SummaryPopulatesAllFields` test.
- Add it to the matching TypeScript interface in
  `frontend/src/core/refresh/types.ts`.
- Thread it through any frontend mapping in resource contexts.

Always include cluster metadata in snapshot payloads and use full object
references (`clusterId`, `group`, `version`, `kind`, and `namespace`/`name` for
specific objects) across refresh, cache, event, navigation, and action
boundaries.
