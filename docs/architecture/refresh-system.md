# Refresh System

Luxury Yacht refreshes Kubernetes data through backend snapshot builders,
streaming endpoints, and a frontend orchestrator that scopes every request to
exactly one relevant cluster.

See [README.md](README.md) for the architecture doc map.
checks before releases or after high-risk refresh subsystem changes.

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
in `backend/app_refresh_setup.go` route snapshot, manual queue, resource stream,
event stream, log stream, and catalog stream requests to the correct cluster
subsystem. Cross-cluster UI summaries are derived above refresh state from
separate per-cluster domain results.

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

| Term                 | Meaning                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend subsystem    | Per-cluster refresh services: domain registry, snapshot service, manual queue, streams, telemetry, informers, and permission gates.                      |
| Refresh domain       | A named data set such as `cluster-overview`, `namespace-workloads`, `object-details`, `object-map`, or `catalog`.                                        |
| Scope                | The requested slice of a domain. In this app it must be cluster-prefixed before crossing the API boundary.                                               |
| Snapshot             | A point-in-time response for one domain and scope, including payload, version, checksum, timestamps, and stats.                                          |
| Stream               | A long-lived WebSocket or SSE connection that pushes updates instead of relying only on polling.                                                         |
| Refresher            | Frontend timer configuration for a domain: interval, cooldown, and timeout.                                                                              |
| Refresh manager      | Frontend scheduler. It decides when refresh callbacks should run.                                                                                        |
| Refresh orchestrator | Frontend executor. It normalizes scopes, fetches snapshots, starts/stops streams, and writes store state.                                                |
| Refresh store        | Frontend in-memory state keyed by domain and full scope, including status, data, stats, errors, and ETags.                                               |
| Cluster scope        | A scope prefix such as `clusterId\|...`. Refresh domains target one cluster; legacy multi-cluster selectors are parsed only to return validation errors. |

## Domains And Scopes

Refresh domain names and payload contracts live in:

- `backend/refresh/domain/refresh-domain-contract.json`
- `frontend/src/core/refresh/types.ts`
- `frontend/src/core/refresh/refresherTypes.ts`
- `frontend/src/core/refresh/domainRegistry.ts`

Frontend domain registrations live in
`frontend/src/core/refresh/domainRegistrations.ts` and are applied by
`frontend/src/core/refresh/orchestrator.ts`. Backend registrations live in
`backend/refresh/system/registrations.go`; stream routes are registered in
`backend/refresh/system/streams.go`.

`backend/refresh/domain/refresh-domain-contract.json` is the authored metadata
contract for domain category, frontend refresher name, timing, diagnostics
stream, orchestrator kind, backend registration kind, runtime permission policy,
resource-stream participation, and `domainInventory` behavior metadata.
`domainInventory` is keyed by the same domain id as `domains[]` and names each
domain's behavior class, scope contract, cache policy, stream semantics,
payload owner, and coverage contract. `frontend/src/core/refresh/domainRegistry.ts`
imports that contract directly and derives the frontend descriptor maps from it.
Backend and frontend refresh-domain tests validate that explicit registration
and behavior code still matches the contract.

The domain id is the join key across all refresh contract homes. Do not add
parallel aliases for renamed domains. If a domain or behavior class changes,
rename it through the JSON, backend/frontend registrations, and tests in one
change so stale names fail contract checks.

Behavior classes describe correctness rules, not implementation inheritance:

- `snapshot-table` and `aggregate-snapshot` are whole-payload snapshot domains.
  `namespaces` is a snapshot-table projection over namespace objects; it carries
  a full namespace `ref` so typed namespace UI can stay compatible with the
  object catalog's canonical identity and existence model.
  `cluster-overview` is an aggregate snapshot; its payload preserves the
  cluster-prefixed request scope and includes full involved-object links for
  recent warning event drill-downs when Kubernetes supplies enough identity.
- `resource-stream-table` domains use snapshot baselines plus row
  update/delete and scope-level COMPLETE stream semantics.
- `complete-resync-stream` domains, currently `namespace-helm`, share the
  resource stream transport but use COMPLETE as a scope-level change detector
  instead of row updates. The frontend treats any row-style message for these
  domains as a resync signal and does not apply targeted row mutations.
- `catalog-stream`, `event-stream`, and `log-stream` use stream-specific
  reducers on top of catalog/event/log transports.
- `catalog-snapshot`, `event-snapshot`, `detail-payload`,
  `helm-content-payload`, `graph-payload`, and `operation-state` are scoped
  snapshot payloads with class-specific payload and cache rules.

Keep shared lifecycle plumbing consolidated where behavior allows it, but do
not collapse class-specific reducers into a generic stream or snapshot handler
when their identity, merge, cache, or recovery semantics differ.

Current frontend domains are fully scoped and single-cluster by contract. The
orchestrator normalizes every scope with `buildClusterScope` from
`frontend/src/core/refresh/clusterScope.ts` before a network request or store
write. The HTTP API enforces this: `/api/v2/snapshots/{domain}` and
`/api/v2/refresh/{domain}` return `400` when no cluster scope is present or
when the scope names more than one cluster.

Scope rules:

- Single cluster: `clusterId|<scope>`
- Cluster-wide with empty tail: `clusterId|`
- Namespace scopes use the `namespace:<name>` tail and then receive the cluster
  prefix.
- Existing cluster-prefixed scopes are preserved so enable/disable calls do not
  rewrite historical store keys after selection changes.

Each refresh domain normally has one active scope per cluster runtime. Domains
with multiple concurrent consumers opt into multiple active scopes explicitly;
the opt-in still applies inside one cluster runtime, not across clusters.
`namespaces` and `cluster-overview` are ordinary single-cluster domains. Views
that need a cross-cluster display read multiple per-cluster entries and derive
that display outside the refresh store.

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

Partial or truncated snapshots are not cached.

`object-maintenance` is live app-managed drain state. It bypasses both snapshot
caching and snapshot singleflight coalescing so long-running drain status stays
current and a refresh triggered after `StartDrainNode` cannot reuse an older
in-flight empty snapshot.

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

The orchestrator is one global coordinator with per-cluster runtimes beneath it.
The coordinator owns app-wide lifecycle concerns such as active cluster,
connected/background clusters, settings, visibility, kubeconfig lifecycle, auth
pause/recovery, and diagnostics aggregation. Cluster data state belongs in
`ClusterRefreshRuntime` instances. Each runtime owns enabled scopes, in-flight
requests, stream startup/cleanup bookkeeping, stream health, blocked-stream
state, metrics freshness, and scoped store writes for exactly one `clusterId`.
Do not add aggregate-domain exception lists to the coordinator; domains that
need several visible scopes should opt into multiple active scopes inside each
cluster runtime.

Refreshers are disabled by default (`DEFAULT_AUTO_START = false`). Views and
hooks enable the scopes they need, then trigger startup or manual refreshes. This
keeps unused domains from polling or streaming at app startup.

UI code reads state through hooks such as:

- `useRefreshScopedDomain`
- `useRefreshScopedDomainStates`
- `useRefreshScopedDomainEntries`
- `useRefreshState`

Context updates come from active view changes, namespace changes, cluster tab
changes, object panel state, and settings. `selectedClusterId` and
`selectedClusterIds` describe the foreground tab selection. `allConnectedClusterIds`
describes the open cluster set used for runtime retention/disposal, and
`refreshBackgroundClustersEnabled` controls whether inactive open tabs do
background work. Background refresh fans out as separate single-cluster work in
each cluster runtime; it does not build one multi-cluster refresh scope.

Open cluster tabs are retained workspaces. Only one cluster tab is foregrounded,
but inactive open tabs still own their last-viewed navigation state and scoped
refresh snapshots. Switching `active -> background` must preserve scoped state;
switching `background -> active` should render the retained snapshot immediately
and then revalidate or reconnect as needed. Clearing scoped state belongs to
disposal paths such as cluster tab close, cluster removal/disconnect, kubeconfig
change, auth/runtime reset, permission invalidation, or explicit view reset.
Disabling background refresh stops background work, but it must not clear the
last loaded data for open inactive tabs.

Namespace and overview state follow the same rule. `namespaces` and
`cluster-overview` store per-cluster scoped entries; namespace selection remains
per cluster tab, and the active namespace list is derived from the active
cluster's `namespaces` payload. If a future UI needs an all-cluster summary, it
should read multiple per-cluster entries and derive that display outside the
refresh store.

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
  refresh through separate per-cluster requests instead of one multi-cluster
  scope.
- `pods`, `namespace-workloads`, and `nodes` use resource streams for rows and
  continue metrics-only snapshot refreshes for usage fields.
- `catalog` uses SSE snapshots from the object catalog and also supports normal
  snapshot fetches for startup, filtering, pagination, and manual requests.
- `cluster-events` and `namespace-events` use SSE and keep an in-memory sorted
  event list with merge-by-UID behavior. Event SSE payloads use monotonic
  per-scope sequence IDs; reconnects send `since=<sequence>` and the backend
  replays buffered events when the token is still inside the resume window. If
  the token is older than the buffer, the handler falls back to a fresh
  snapshot reset.
- `object-events` is a snapshot-only event payload for one fully identified
  object scope. It carries event identity (`name`, `uid`, `resourceVersion`),
  display fields for the involved object, and a separate openable
  `involvedObject` `ResourceLink` when Kubernetes supplied enough GVK identity.
  It does not use event SSE resume semantics.
- `container-logs` is a stream-only log domain for object-panel scopes. Its
  scope is the cluster-prefixed, namespaced object scope
  `<cluster>|<namespace>:<group>/<version>:<kind>:<name>` plus log query
  filters such as container and selected pod/container targets. The backend
  sends an empty `reset=true` connection frame, then a timestamp-sorted initial
  tail, then line append frames. Reconnect dedupe is server-side using
  Kubernetes `SinceTime` plus the set of lines seen at the last timestamp; the
  frontend keeps its buffer across empty reset frames and uses fallback polling
  through `FetchContainerLogs` only when streaming is unavailable. Log rows do
  not join resource-stream table contracts.

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

Frontend SSE streams share transport primitives in
`frontend/src/core/refresh/streaming/sseStreamTransport.ts`. Event, catalog, and
container-log managers use that helper for EventSource URL creation and
listener cleanup. They share reconnect delay calculation through
`streamTiming.ts` and visibility suspend/resume through
`streamVisibilityController.ts`. The resource WebSocket path uses the same
reconnect timing helper and visibility controller for
pause/resume and resync after the app becomes visible again. Stream error
notification and short kubeconfig-change suppression are centralized in
`streamErrorNotifier.ts`; the resource WebSocket path uses the same notifier for
terminal stream errors. Keep reducers separate: event streams own
ordering/dedupe/resume tokens, catalog streams own snapshot-shaped
merge/fallback behavior, log streams own line buffers, warnings, filters, and
fallback polling, and resource streams own row update/delete/COMPLETE resync
semantics.

Resource stream safety rules:

- Descriptors in `resourceStreamDomains.ts` describe row behavior only: scope
  kind, row collection access, row identity, drift keys, sorting, and metrics
  preservation. They must not encode multi-cluster capability flags.
- `ResourceStreamManager` applies ready/resync/error store status transitions
  through one domain-id path. Do not reintroduce copied branches for each
  resource-stream domain; per-domain differences belong in descriptors,
  snapshot builders, or row projectors.
- Row updates and row deletes carry a top-level `ref` with the full
  `resourcemodel.ResourceRef` identity. Row identity flows only through `ref`;
  the legacy top-level fields (`uid`, `name`, `namespace`, `kind`, `apiGroup`,
  `apiVersion`) have been removed from the wire payload. `clusterId` /
  `clusterName` remain on the envelope as routing metadata that applies to
  every message type (including control messages without a row `ref`).
  Frontend row update/delete keys are built only from `ref`; an update without
  a complete row `ref` is ignored instead of being guessed from row fields.
- `COMPLETE` remains a scope-level control message that triggers a full
  subscription resync. Any identity carried on `COMPLETE` is diagnostic context,
  not a targeted row invalidation contract. CRD signature changes and Helm
  release identity churn both fan out as scope-level `COMPLETE` messages and
  attach the originating object's `ref` for diagnostic visibility only.
- Stream selectors are typed: `resourcestream.StreamSelector` carries
  `ClusterID`, `Domain`, `ScopeKind` and the scope-kind-specific fields
  (`Namespace`, `Node`, or full-GVK `Workload`). Transport scope strings are
  validated and canonicalized at the WebSocket boundary via
  `ParseStreamSelector`; the canonical selector string remains the subscription
  key. Selectors become a concrete `ResourceRef` only when resolving a specific
  affected row.
- Snapshot vs stream row parity is enforced by
  `backend/refresh/snapshot/parity_test.go`. For every domain returned by
  `resourcestream.SupportedDomains()` the harness runs the canonical snapshot
  builder and the per-row `Build*Summary` projector against the same fixture
  inputs and asserts byte-equality on the JSON. The sister test
  `TestSnapshotStreamRowParityCoversAllSupportedDomains` locks the harness to
  the registry so a new domain cannot ship without a parity case (or an
  explicit, documented exclusion — `namespace-helm` is the only excluded
  domain because its stream contract is scope-level COMPLETE only).
- Per-domain stream projection metadata (scope kind, primary/related
  resources, metrics dependency, complete-is-scope-level) is authored in the
  `resourceStream.domains` block of
  `backend/refresh/domain/refresh-domain-contract.json`. The backend test
  `TestResourceStreamDomainsMatchProjectionDescriptors` locks the JSON to
  `resourcestream.ProjectionDescriptors()`; the frontend test
  `resource stream domain descriptors > matches the backend-authored projection
contract` locks `resourceStreamDomainDescriptors.scopeKind` /
  `.preserveMetrics` / `.isClusterScoped` to the same JSON.
- Metric-bearing projectors (`BuildPodSummary`, `BuildWorkloadSummary`,
  `BuildNodeSummary`) accept the latest usage snapshot as parameters rather
  than reading from a `metrics.Provider` internally. Stream handlers fetch
  usage once per event via `Manager.podMetricsSnapshot()` /
  `Manager.nodeMetricsSnapshot()` and pass it in, so parity tests can drive
  both the snapshot and stream paths with the same fixture.
- Keep implementation ownership split: `resourceStreamRows.ts` owns pure row
  math; `ResourceStreamManager` owns store mutation, resync, drift, health,
  telemetry, and fallback decisions; `ResourceStreamConnection` owns WebSocket
  lifecycle; `ResourceStreamSubscriptionStore` owns subscription state, scope
  resolution, debounce, messages, and resume tokens.
- Backend supported domains live in `backend/refresh/resourcestream/domains.go`
  and behavior-specific registration files under
  `backend/refresh/resourcestream/stream_registration_*.go`. Keep permission
  checks, direct object handlers, network/Gateway API handlers, and
  related-object handlers explicit when a generic table would hide behavior.
- Resource-stream permission resources live in the `Stream` side of
  `backend/refresh/domainpermissions/spec.go` and are checked against
  projection descriptors by `TestProjectionDescriptorsStayAlignedWithSupportedDomains`
  and the authored domain contract by
  `TestDomainPermissionContractsJoinExpectedRequirementSources`. When adding a
  resource-streamed domain or resource family, update the shared permission
  contract with the resources the stream may wire.
- Each domain/scope stream must deliver monotonic `resourceVersion` values.
  Missing or regressing versions trigger snapshot resync and temporarily block
  the stream for that scope.
- Resource WebSocket streams reject multi-cluster scopes. Background refresh is
  fanout across cluster runtimes, not a multi-cluster subscription or snapshot.
- Backend sends `RESET` at subscription start and `COMPLETE` when a subscriber
  is dropped or a resync is required. Per-subscriber backpressure drops slow
  subscribers and forces snapshot resync.
- The frontend coalesces update bursts and ignores deltas while a resync is in
  flight. Drift detection compares sampled stream updates against snapshot data;
  large divergence emits `refresh:resource-stream-drift`, stops streaming for
  that domain/scope, and falls back to polling.

## Catalog Integration

The object catalog owns discovery, canonical object identity, object existence,
namespace and cluster listing metadata, and browse query semantics. See
[catalog.md](catalog.md) for service lifecycle, lookup/query APIs, freshness,
and Browse ownership. Refresh domains that need to answer "what objects exist?"
or "which namespaces/clusters can be browsed?" must query or project from the
catalog instead of rebuilding those inventories locally.

Refresh-specific integration points:

- The `catalog` refresh domain is backed by
  `backend/refresh/snapshot/catalog.go`.
- The catalog SSE stream handler is
  `backend/refresh/snapshot/catalog_stream.go`.
- Catalog stream events are snapshot-shaped and apply through the refresh store.
- Manual/filter/pagination requests still use snapshot fetches; SSE is not a
  replacement for query-specific fetches.
- The `catalog-diff` domain reuses the catalog snapshot/query payload for object
  diff workflows through the snapshot orchestrator. It does not participate in
  catalog stream diagnostics, resume, or stream-health contracts.
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

Resource stream handlers must not construct row payloads by assigning `Row`
directly. The backend guardrail in
`backend/refresh/resourcestream/update_guardrail_test.go` allows row assignment
only inside shared update/projection helpers, so stream handlers resolve changed
objects and call the canonical snapshot projection helper instead of building a
parallel DTO.

Exceptions still have one constructor path:

- `PodSummary` delegates through the internal `buildPodSummary`.
- `WorkloadSummary` is built by `NamespaceWorkloadsBuilder` helpers that the
  streaming helper also uses.
- `NodeSummary` goes through `BuildNodeSnapshot`.

## Lifecycle Edge Cases

Kubeconfig changes are a full refresh lifecycle reset:

- `kubeconfig:changing` cancels in-flight requests, stops streams, disables
  scopes, clears store state, invalidates the refresh base URL, and suppresses
  transient network errors.
- `kubeconfig:changed` and `kubeconfig:selection-changed` invalidate the base URL
  and let normal context updates re-enable required scopes.

`cluster-overview` is an active-cluster snapshot domain. Backend registration
uses an informer-based builder when nodes/pods/namespaces list/watch permissions
exist and falls back to list-only behavior when required.

Object-panel refresh scopes must use canonical identity for the payload they
load. `object-details`, `object-events`, and `object-yaml` use cluster-prefixed
full object scopes parsed by `ParseObjectScope`. Helm manifest/value domains use
cluster-prefixed Helm release scopes in `namespace:name` form and keep rendered
manifest resource links as full `ResourceLink` values when the target kind is
openable. `object-map` uses cluster-prefixed object-map scopes and must return
nodes and edges whose ids resolve to full object references. `object-maintenance`
uses cluster-prefixed `aggregate` or `node:<name>` scopes, bypasses the snapshot
cache/singleflight path, and filters drain state by `clusterId`. Logs use
`container-logs` streaming with fallback polling in the log viewer.

Polling snapshot merge reuse is centralized in
`frontend/src/core/refresh/snapshotMerge.ts` as a domain-keyed descriptor table.
A domain may opt in only when it can name a collection field and a stable
full-identity key without hiding payload-specific semantics. Current opt-ins are
`namespaces`, `catalog-diff`, and `object-maintenance`.

## Adding Or Updating Domains

Domain changes must keep these surfaces synchronized:

| Surface           | Required updates                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| Contract metadata | `backend/refresh/domain/refresh-domain-contract.json`                                                 |
| Frontend domain   | `types.ts`, `DomainPayloadMap`, `refresherTypes.ts`, and explicit orchestrator registration           |
| Backend domain    | Snapshot builder, `backend/refresh/system/registrations.go`, permission checks, tests                 |
| Streaming domain  | `streams.go`, frontend stream manager wiring, SSE handler or resource-stream registration/descriptors |
| Table row payload | Shared Go row helper, matching `TestBuild*SummaryPopulatesAllFields`, TypeScript type, UI mapping     |

For resource-stream domains, also prove row identity, update identity, sorting,
drift keys, empty payloads, single-cluster subscription rejection, and background
refresh fanout behavior.

Always include cluster metadata in snapshot payloads and use full object
references (`clusterId`, `group`, `version`, `kind`, and `namespace`/`name` for
specific objects) across refresh, cache, event, navigation, and action
boundaries.
