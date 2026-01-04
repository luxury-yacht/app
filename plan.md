# Comparison with Headlamp

## Purpose

Review Headlamp’s implementation for loading, refreshing, and managing Kubernetes data (resources, metrics, events), compare it to Luxury Yacht, and capture stability/performance takeaways with evidence.

## Scope

- Data fetch layer (API client, request scheduling)
- Watch/stream handlers (resource/event watches, reconnect logic)
- Store/cache (local state, invalidation, derived views)
- Metrics collection (scrape/stream setup, update cadence)
- Events ingestion (filters, retention, UI delivery)

## Evaluation Criteria

- Watch reliability (reconnect/backoff, resync strategy)
- Throttling/backpressure (rate limits, queueing, batching)
- Cache correctness (invalidation rules, stale data handling)
- Memory growth (retention policies, pruning)
- UI update cadence (debounce/throttle, render frequency)
- Error visibility (user-facing errors, logging)

## Doc Map (for follow-up passes)

1. Resource data fetch (API client, request scheduling)
2. Watch/streaming & refresh strategy (resource refresh + resync)
3. Store/cache & invalidation
4. Metrics pipeline
5. Events ingestion
6. Cross-cutting: error handling/backoff
7. Cross-cutting: performance considerations
8. Streaming coverage (polling-only domains)
9. Recommendations & status

## Plan Summary

The plan compares Headlamp and Luxury Yacht across data loading, refresh/watch strategy, caching/state, metrics/events pipelines, error handling, and performance. It traces resource, metrics, and event flows end-to-end with evidence and highlights where Luxury Yacht relied on interval snapshots and SSE, with resource streaming and snapshot caching now closing key gaps while Headlamp continues to lean on watch-driven incremental updates, backend response caching, and per-request authorization checks. The evaluation also calls out stability risks (polling load, backpressure, permission drift) and performance opportunities (watch-based updates, caching, multiplexing), with specific line references for both apps.

## Confidence Boosters (evaluation hygiene)

- Anchor every subsystem finding to at least 3 concrete line references per app (done and expanded below).
- Cross-check numeric thresholds (timeouts, intervals, limits, subscriber caps) against constants files to avoid inference (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; frontend/src/core/refresh/refresherConfig.ts:24; backend/refresh/snapshot/event_limits.go:3; backend/refresh/eventstream/manager.go:18).
- Trace request scheduling end-to-end for resources, metrics, events and call out where work is frontend vs backend.
- Validate streaming reconnection/backoff behavior and resume-token coverage (Headlamp multiplexer does not implement resume tokens; Luxury Yacht events use SSE resume IDs) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:132; frontend/src/core/refresh/streaming/eventStreamManager.ts:104; backend/refresh/eventstream/handler.go:73).

## 1. Resource Data Fetch (API client, request scheduling)

### Headlamp

- Resource lists flow through React Query `kubeObjectListQuery` -> `clusterFetch` -> backend proxy; items are mapped into KubeObject instances per cluster/namespace (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75).
- Cluster requests use `clusterRequest` with AbortController + default 2-minute timeout and cluster headers (KUBECONFIG/X-HEADLAMP-USER-ID) when needed (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Backend cluster proxy requests are wrapped by `CacheMiddleWare` when cache is enabled, which generates a cache key, performs SSAR authorization, serves cached responses, and stores fresh responses (headlamp/backend/cmd/server.go:183; headlamp/backend/cmd/server.go:214; headlamp/backend/cmd/server.go:225; headlamp/backend/cmd/server.go:239).

### Luxury Yacht

- Frontend loads snapshots via `fetchSnapshot` from the refresh server, with ETag support and retry logic for network errors (frontend/src/core/refresh/client.ts:119; frontend/src/core/refresh/client.ts:142; backend/refresh/api/server.go:77).
- Backend builds snapshots from informers across registered domains (namespace/cluster/object/etc.) via the refresh subsystem and registry (backend/refresh/system/manager.go:92; backend/refresh/informer/factory.go:101).
- Manual refresh jobs execute with retry/backoff and enforce a request timeout (backend/refresh/types.go:242; backend/refresh/types.go:245; backend/refresh/types.go:281).

### Key differences

- Headlamp: frontend talks to the backend cluster proxy per request, with timeouts and per-request cluster headers (headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Luxury Yacht: frontend uses a refresh snapshot API backed by informer caches instead of direct cluster proxy calls (frontend/src/core/refresh/client.ts:119; backend/refresh/system/manager.go:90).

### Comparison table

| Aspect               | Headlamp                                                    | Luxury Yacht                                        | Evidence                                                                                                                 |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Primary request path | Frontend `clusterFetch` / `clusterRequest` to backend proxy | Frontend `fetchSnapshot` to refresh server          | headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75; frontend/src/core/refresh/client.ts:119                                |
| Response shaping     | React Query list mapping to KubeObject                      | Backend snapshot payloads                           | headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; backend/refresh/system/manager.go:90                       |
| Cache signal         | Response cache TTL (10 min, when enabled)                   | Snapshot ETag/Checksum + short-lived snapshot cache | headlamp/backend/pkg/k8cache/cacheStore.go:203; backend/refresh/api/server.go:77; backend/refresh/snapshot/service.go:72 |

### Data flow trace (resources)

Headlamp:

1. UI `KubeObject.useList` -> `useKubeObjectList` (React Query list) -> `clusterFetch` -> backend `/clusters/{cluster}/...` proxy -> Kubernetes API list -> React Query cache update (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75).
2. Watch path -> WebSocket multiplexer `/wsMultiplexer` -> cluster watch socket -> updates applied via `KubeList.applyUpdate` (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; headlamp/backend/cmd/multiplexer.go:592; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

Luxury Yacht:

1. UI RefreshOrchestrator -> `fetchSnapshot` -> refresh server `/api/v2/snapshots/{domain}` -> snapshot service built from informer caches -> snapshot payload -> refresh store update (frontend/src/core/refresh/client.ts:119; backend/refresh/api/server.go:53; backend/refresh/system/manager.go:90; frontend/src/core/refresh/store.ts:13).
2. UI ResourceStreamManager -> WebSocket `/api/v2/stream/resources` -> resource stream multiplexer -> backend resource stream manager -> incremental updates merged into refresh store with resync on RESET/COMPLETE (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1094; backend/refresh/system/manager.go:543; backend/refresh/resourcestream/handler.go:13).

## 2. Watch/Streaming & Refresh Strategy (resources)

### Headlamp

- `useKubeObjectList` starts watches only when `refetchInterval` is unset; it uses list resourceVersions and avoids re-establishing watches when list updates (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:400).
- Frontend WebSocket multiplexer uses one connection, debounces unsubscribe, tracks COMPLETE messages, and only resubscribes after a future successful connect (no automatic reconnect loop) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:77; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:261; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:275).
- Backend multiplexer maintains per-cluster watch connections with heartbeat pings and reconnects on failure; sends COMPLETE when resourceVersion changes (headlamp/backend/cmd/multiplexer.go:389; headlamp/backend/cmd/multiplexer.go:639).

### Luxury Yacht

- RefreshManager schedules per-domain intervals with manual interruption, timeouts, and exponential backoff cooldown on errors (frontend/src/core/refresh/RefreshManager.ts:381; frontend/src/core/refresh/RefreshManager.ts:597; frontend/src/core/refresh/RefreshManager.ts:815).
- Domain refresh intervals are configured (2-15 seconds) per refresher (frontend/src/core/refresh/refresherConfig.ts:24).
- Resource list domains stream over the WS multiplexer with per-cluster subscriptions, resync on RESET/COMPLETE, and polling paused while streaming is healthy for domains configured with pauseRefresherWhenStreaming (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1182; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1094; frontend/src/core/refresh/orchestrator.ts:1038; backend/refresh/resourcestream/manager.go:1885).
- Informer factories resync at a configured interval and block on cache sync (backend/refresh/informer/factory.go:101; backend/refresh/informer/factory.go:191).

### Key differences

- Headlamp: resource lists update via watch streams over a WebSocket multiplexer with resourceVersion gating and COMPLETE signals (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:124; headlamp/backend/cmd/multiplexer.go:639).
- Luxury Yacht: resource list domains stream over a WS multiplexer with per-cluster subscriptions and resync on RESET/COMPLETE; polling pauses while streams are healthy for domains configured to pause (backend/refresh/resourcestream/handler.go:13; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1094; frontend/src/core/refresh/orchestrator.ts:1038).

### Comparison table

| Aspect             | Headlamp                           | Luxury Yacht                                                                    | Evidence                                                                                                                                                                  |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch transport    | WebSocket multiplexer (single WS)  | Resource stream WS multiplexer for lists + SSE for events/logs                  | headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; backend/refresh/resourcestream/handler.go:13                                                                      |
| Update model       | ResourceVersion-gated list updates | Streamed incremental updates with resync + polling pause for configured domains | headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1094; frontend/src/core/refresh/orchestrator.ts:1038    |
| Reconnect strategy | Heartbeat ping + reconnect         | Resource stream resync on RESET/COMPLETE + SSE reconnect with backoff           | headlamp/backend/cmd/multiplexer.go:389; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1094; frontend/src/core/refresh/streaming/eventStreamManager.ts:163 |

## 3. Store/Cache & Invalidation

### Headlamp

- Backend caches GET responses with a 10-minute TTL when cache is enabled, skipping failures and selfsubjectrulesreviews (headlamp/backend/pkg/k8cache/cacheStore.go:175; headlamp/backend/pkg/k8cache/cacheStore.go:203).
- Cache invalidation purges on mutating requests and refreshes from the API; watch invalidation runs through dynamic informers (headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; headlamp/backend/pkg/k8cache/cacheInvalidation.go:164).
- Permissions are checked via SSAR with cached clientsets (10-minute TTL) keyed by token (headlamp/backend/pkg/k8cache/authorization.go:40; headlamp/backend/pkg/k8cache/authorization.go:119).
- React Query caches lists; watch updates are applied with resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).
- Cache invalidation skips Event/Lease resources and filters out initial sync noise by only invalidating objects created in the last minute (headlamp/backend/pkg/k8cache/cacheInvalidation.go:106; headlamp/backend/pkg/k8cache/cacheInvalidation.go:248).

### Luxury Yacht

- Snapshot API uses checksum-based ETag; frontend uses If-None-Match and caches refresh base URL, and backend serves short-lived cached snapshots to avoid rebuilds (backend/refresh/api/server.go:77; frontend/src/core/refresh/client.ts:44; frontend/src/core/refresh/client.ts:131; backend/refresh/snapshot/service.go:72).
- Refresh store maintains per-domain snapshot state (version/checksum/etag, timestamps, errors) and scoped entries (frontend/src/core/refresh/store.ts:13).
- Object catalog supports pagination/batching and an SSE stream; browse now consumes SSE with debounced, merge-queued updates plus snapshot fallback on gaps/drops to avoid update-depth issues (backend/refresh/snapshot/catalog.go:165; backend/refresh/snapshot/catalog_stream.go:126; frontend/src/core/refresh/streaming/catalogStreamManager.ts:255; frontend/src/core/refresh/streaming/catalogStreamManager.ts:330).
- Response cache stores short-lived detail/YAML/helm GET payloads and is invalidated by informer updates (backend/response_cache.go:11; backend/response_cache_invalidation.go:22).
- Snapshot builds are deduplicated with singleflight and cached with a short TTL (backend/refresh/snapshot/service.go:20; backend/refresh/snapshot/service.go:72).
- Per-request SSAR gating now applies to snapshot builds to avoid permission drift (backend/refresh/snapshot/service.go:79; backend/refresh/snapshot/permission_checks.go:110).

### Key differences

- Headlamp: backend response cache (TTL + watch invalidation) plus React Query list caches (headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242).
- Luxury Yacht: snapshot store + ETag/Checksum + short-lived snapshot cache, plus detail/YAML/helm response cache with informer-driven invalidation; object catalog caches and SSE stream (frontend/src/core/refresh/store.ts:13; backend/refresh/snapshot/service.go:72; backend/response_cache.go:11; backend/response_cache_invalidation.go:22; backend/refresh/snapshot/catalog_stream.go:126).

### Comparison table

| Aspect            | Headlamp                                      | Luxury Yacht                                                                         | Evidence                                                                                                                                                                           |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend cache     | HTTP response cache (TTL + invalidation)      | Snapshot ETag + short-lived snapshot cache + store + detail/YAML/helm response cache | headlamp/backend/pkg/k8cache/cacheStore.go:203; backend/refresh/snapshot/service.go:72; backend/response_cache.go:11; frontend/src/core/refresh/store.ts:13                        |
| Invalidation      | Dynamic informer invalidation + non-GET purge | Refresh intervals + manual refresh + response cache invalidation on informer updates | headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; frontend/src/core/refresh/refresherConfig.ts:24; backend/response_cache_invalidation.go:22                                   |
| Permission gating | SSAR per request with cached clientsets       | Runtime SSAR checks for informers + per-request SSAR gating for snapshot builds      | headlamp/backend/pkg/k8cache/authorization.go:119; backend/refresh/system/manager.go:93; backend/refresh/snapshot/service.go:79; backend/refresh/snapshot/permission_checks.go:110 |

## 4. Metrics Pipeline

### Headlamp

- Metrics polling is UI-driven on a fixed 10s interval without built-in backoff or rate limiting (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:33; headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:39).
- Requests use the same 2-minute timeout as other cluster requests (headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:134; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:157).

### Luxury Yacht

- Backend poller rate-limits via a token bucket and retries with exponential backoff + jitter (backend/refresh/metrics/poller.go:74; backend/refresh/metrics/poller.go:111; backend/refresh/metrics/poller.go:285).
- Poller metadata tracks consecutive failures and success/failure counts (backend/refresh/metrics/poller.go:36; backend/refresh/metrics/poller.go:138; backend/refresh/metrics/poller.go:342).
- Metrics polling is disabled with an explicit reason when metrics API or permissions are missing (backend/refresh/system/manager.go:153; backend/refresh/system/manager.go:166; backend/refresh/system/manager.go:178).

### Key differences

- Headlamp: metrics polling is frontend-driven (10s) via clusterRequest (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23).
- Luxury Yacht: backend metrics poller with rate limiting + backoff feeds snapshots (backend/refresh/metrics/poller.go:74; backend/refresh/system/manager.go:153).

### Comparison table

| Aspect              | Headlamp                      | Luxury Yacht                       | Evidence                                                                                     |
| ------------------- | ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Collection location | Frontend poller (10s)         | Backend poller + provider          | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/metrics/poller.go:74  |
| Backoff/rate limit  | None (beyond request timeout) | Rate-limited + exponential backoff | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/metrics/poller.go:181 |
| Delivery            | Direct callback to UI         | Snapshot payloads                  | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/system/manager.go:153 |

### Data flow trace (metrics)

Headlamp:

1. UI calls `metrics()` -> setInterval(10s) -> `clusterRequest` -> backend proxy -> metrics API -> callback with metrics items (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).

Luxury Yacht:

1. Backend metrics poller -> list node/pod metrics -> store in provider -> snapshot builders read provider -> frontend `fetchSnapshot` delivers metrics in payload (backend/refresh/metrics/poller.go:181; backend/refresh/system/manager.go:153; frontend/src/core/refresh/client.ts:119).

## 5. Events Ingestion

### Headlamp

- Events are fetched with a configurable max limit (default 2000); object events use fieldSelector + limit (headlamp/frontend/src/lib/k8s/event.ts:51; headlamp/frontend/src/lib/k8s/event.ts:147; headlamp/frontend/src/lib/k8s/event.ts:164).
- Watch updates apply through `KubeList.applyUpdate` with resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:52).

### Luxury Yacht

- Cluster/namespace events are sorted by timestamp, limited to 500, and include warnings on truncation (backend/refresh/snapshot/event_limits.go:3; backend/refresh/snapshot/cluster_events.go:71; backend/refresh/snapshot/cluster_events.go:111; backend/refresh/snapshot/namespace_events.go:117).
- Object events use fieldSelector filtering and limit to 500 (backend/refresh/snapshot/object_events.go:73; backend/refresh/snapshot/object_events.go:94; backend/refresh/snapshot/event_limits.go:5).
- Event pipeline is informer -> eventstream manager -> SSE handler with initial snapshot + incremental updates (backend/refresh/eventstream/manager.go:34; backend/refresh/eventstream/handler.go:71).
- Event stream manager caps to 500 items, dedupes by composite key, and uses exponential reconnect backoff on the frontend (frontend/src/core/refresh/streaming/eventStreamManager.ts:93; frontend/src/core/refresh/streaming/eventStreamManager.ts:231; frontend/src/core/refresh/streaming/eventStreamManager.ts:163).

### Key differences

- Headlamp: events are KubeObjects with list+watch and a 2000 item limit; object events use fieldSelector (headlamp/frontend/src/lib/k8s/event.ts:44; headlamp/frontend/src/lib/k8s/event.ts:141).
- Luxury Yacht: events stream over SSE with initial snapshot + incremental entries and a 500 item cap (backend/refresh/eventstream/handler.go:71; frontend/src/core/refresh/streaming/eventStreamManager.ts:93).

### Comparison table

| Aspect   | Headlamp                            | Luxury Yacht                   | Evidence                                                                                                           |
| -------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Source   | K8s Event list + watch              | Informer + SSE stream          | headlamp/frontend/src/lib/k8s/event.ts:44; backend/refresh/eventstream/handler.go:71                               |
| Limits   | Max 2000 events                     | Max 500 events (frontend cap)  | headlamp/frontend/src/lib/k8s/event.ts:51; frontend/src/core/refresh/streaming/eventStreamManager.ts:93            |
| Delivery | Watch updates applied to list cache | SSE payloads merged into store | headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43; frontend/src/core/refresh/streaming/eventStreamManager.ts:407 |

### Data flow trace (events)

Headlamp:

1. UI uses `Event.useList` -> list request + watch updates via `useKubeObjectList` -> watch data applied to list cache (headlamp/frontend/src/lib/k8s/event.ts:206; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:124; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

Luxury Yacht:

1. Frontend `EventStreamManager` opens EventSource -> `/api/v2/stream/events` -> backend builds initial snapshot + subscribes to informer events -> SSE payloads -> frontend merges and caps events (backend/refresh/eventstream/handler.go:71; backend/refresh/eventstream/manager.go:34; frontend/src/core/refresh/streaming/eventStreamManager.ts:407).

## 6. Cross-cutting: Error Handling & Backoff

### Headlamp

- Cluster requests time out via AbortController (default 2 minutes) and can trigger logout on auth errors (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Streaming reconnection uses a fixed 3-second delay in v1; multiplexer uses heartbeat pings + reconnect (headlamp/frontend/src/lib/k8s/api/v1/streamingApi.ts:333; headlamp/backend/cmd/multiplexer.go:389).
- WebSocket multiplexer connect uses polling without timeout; resubscribe happens only after a later successful connect (no auto-reconnect loop) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:77; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:261).
- Unauthorized responses can be synthesized by the cache layer (headlamp/backend/pkg/k8cache/authErrResp.go:23; headlamp/backend/pkg/k8cache/authorization.go:119).

### Luxury Yacht

- Snapshot fetch retries network errors with exponential delay and invalidates base URL after failures (frontend/src/core/refresh/client.ts:142; frontend/src/core/refresh/client.ts:166).
- RefreshManager enforces timeouts, aborts, and exponential backoff cooldown on errors (frontend/src/core/refresh/RefreshManager.ts:644; frontend/src/core/refresh/RefreshManager.ts:815).
- Event stream reconnects with exponential backoff and error thresholds for notifications (frontend/src/core/refresh/streaming/eventStreamManager.ts:163; frontend/src/core/refresh/streaming/eventStreamManager.ts:444).
- Metrics poller uses rate limiting and exponential backoff with jitter (backend/refresh/metrics/poller.go:181; backend/refresh/metrics/poller.go:260).

## 7. Cross-cutting: Performance Considerations

### Headlamp

- Backend response cache + watch invalidation reduces redundant API calls when cache is enabled (headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/backend/pkg/k8cache/cacheInvalidation.go:164).
- WebSocket multiplexer reduces watch connection count and debounces unsubscribe (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:221).
- React Query list cache receives incremental watch updates instead of full reloads (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

### Luxury Yacht

- Snapshot API includes batch/latency stats and ETag, enabling cache-aware clients (backend/refresh/api/server.go:77; backend/refresh/snapshot/catalog.go:142).
- Catalog SSE drives browse updates with debounced application and snapshot fallback to avoid update-depth risks (backend/refresh/snapshot/catalog_stream.go:126; frontend/src/core/refresh/streaming/catalogStreamManager.ts:255; frontend/src/core/refresh/streaming/catalogStreamManager.ts:330).
- Event stream caps events (500) per scope to prevent memory growth (frontend/src/core/refresh/streaming/eventStreamManager.ts:93).
- Several refreshers run at 2-3 second intervals; resource streaming now pauses refreshers for non-metrics list domains while healthy, reducing interval load (events, namespaces, and metrics-only domains still poll) (frontend/src/core/refresh/refresherConfig.ts:24; frontend/src/core/refresh/orchestrator.ts:1038).

## 8. Streaming Coverage (polling-only domains)

With the current backend, none of the polling-only domains can use streaming without adding new stream sources or changing semantics.

Evidence: the only SSE endpoints wired are /api/v2/stream/resources, /api/v2/stream/events, /api/v2/stream/logs, and /api/v2/stream/catalog (backend/refresh/system/manager.go:516). The orchestrator only attaches streaming for domains backed by those endpoints (frontend/src/core/refresh/orchestrator.ts:2267; frontend/src/core/refresh/orchestrator.ts:2341; frontend/src/core/refresh/orchestrator.ts:2354; frontend/src/core/refresh/orchestrator.ts:2453).

Per polling-only domain:

- namespaces: no resource stream support for namespaces today; would require adding namespaces to the resource stream backend and frontend.
- cluster-overview: derived/aggregated payload; would require a new aggregator from node/pod streams or a new stream endpoint.
- node-maintenance: snapshot is sourced from the local store; no stream endpoint.
- object-details, object-yaml, object-helm-manifest, object-helm-values: per-object GETs; no stream endpoint and no list/watch semantics today.
- object-events: could theoretically be derived from the existing event stream, but event stream entries are raw events without the snapshot’s aggregation fields (counts, timestamps), so it would be a behavioral change (backend/refresh/eventstream/types.go:23).
- catalog-diff: kept on snapshot/manual refresh flow (no streaming registration) (frontend/src/core/refresh/orchestrator.ts:2370).

## 9. Recommendations & Status

### Recommendations for Luxury Yacht (stability/perf)

1. ✅ Data fetch layer: add permission-aware gating for cached detail/YAML/helm responses so cached data does not outlive RBAC changes, mirroring Headlamp's SSAR-before-cache behavior (headlamp/backend/cmd/server.go:214; headlamp/backend/pkg/k8cache/authorization.go:119; backend/object_detail_provider.go:94; backend/refresh/permissions/checker.go:57).

   - Work items:
     - Add a permission check before serving cached detail/YAML/helm entries and evict on deny (backend/object_detail_provider.go:94; backend/response_cache.go:39; backend/refresh/permissions/checker.go:115).
     - Reuse the permission checker used by snapshot builds, or wire a checker into the detail provider context (backend/refresh/snapshot/service.go:151; backend/refresh/permissions/checker.go:57).
     - Add tests that simulate permission revocation and ensure cached responses are not served (backend/response_cache_invalidation_test.go:13).
   - Effort: Medium.
   - Risk: Medium.

2. ✅ Watch/stream handlers: debounce or linger stream unsubscribe operations to reduce churn during rapid view changes, similar to Headlamp's multiplexer debounce (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:240; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1052).

   - Work items:
     - Add a short unsubscribe debounce in the resource stream manager, keyed by domain/scope, to coalesce rapid stop/start cycles (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1052).
     - Track pending unsubscribes and cancel if a resubscribe arrives within the debounce window (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:240).
     - Add telemetry or logging for churn to validate impact (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1120).
   - Effort: Low to Medium.
   - Risk: Low.

3. ✅ Store/cache and invalidation: add an initial-sync guard or age filter for response cache invalidation to avoid evicting caches during informer warm-up, mirroring Headlamp's 1-minute age filter/skip list (headlamp/backend/pkg/k8cache/cacheInvalidation.go:106; headlamp/backend/pkg/k8cache/cacheInvalidation.go:248; backend/response_cache_invalidation.go:130).

   - Work items:
     - Gate invalidation handlers on informer sync readiness or object age to avoid early churn (backend/response_cache_invalidation.go:130; backend/refresh/informer/factory.go:191).
     - Add a skip list for resources that should not invalidate cached detail/YAML (headlamp/backend/pkg/k8cache/cacheInvalidation.go:106).
     - Add tests for warm-up and skip behavior (backend/response_cache_invalidation_test.go:13).
   - Effort: Medium.
   - Risk: Medium.

4. ✅ Metrics pipeline: make metrics polling demand-driven (start/stop based on active views) to reduce background load, similar to Headlamp's per-call polling loop, instead of always-on backend polling (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:33; backend/refresh/types.go:137; backend/refresh/types.go:158).

   - Work items:
     - Track active metrics consumers in the refresh manager and call start/stop on the backend poller based on usage (frontend/src/core/refresh/RefreshManager.ts:554; backend/refresh/types.go:137).
     - Keep the backoff/rate limit logic but gate Start on active demand (backend/refresh/metrics/poller.go:74; backend/refresh/types.go:158).
     - Surface poller metadata in telemetry so UI can show active vs idle status (backend/refresh/metrics/poller.go:138; backend/refresh/telemetry/recorder.go:49).
   - Effort: Medium.
   - Risk: Medium.

5. Events ingestion: make event limits configurable (per user/cluster) like Headlamp's adjustable Event.maxLimit, instead of fixed constants (headlamp/frontend/src/lib/k8s/event.ts:51; headlamp/frontend/src/lib/k8s/event.ts:60; backend/refresh/snapshot/event_limits.go:3).

   - Work items:
     - Add config-driven limits for cluster/namespace/object event snapshots (backend/refresh/snapshot/event_limits.go:3).
     - Thread limits through snapshot builders and stream managers (backend/refresh/snapshot/cluster_events.go:77; frontend/src/core/refresh/streaming/eventStreamManager.ts:93).
     - Add tests to validate limit overrides (backend/refresh/snapshot/cluster_events_test.go).
   - Effort: Low to Medium.
   - Risk: Low.

6. ✅ Error handling/backoff: return structured permission-denied error payloads (Status-like) for snapshot/stream responses to improve UI diagnostics, similar to Headlamp's AuthErrResponse, instead of plain string errors (headlamp/backend/pkg/k8cache/authErrResp.go:23; backend/refresh/errors.go:5).

   - Work items:
     - Define a response shape for permission errors in the refresh API and SSE payloads (backend/refresh/errors.go:5; backend/refresh/api/server.go:71).
     - Update frontend error handling to surface structured details where available (frontend/src/core/refresh/client.ts:180).
     - Add tests for permission-denied responses (backend/refresh/errors_test.go:5).
   - Effort: Medium.
   - Risk: Medium.

7. Performance considerations: evaluate consolidating resource stream connections into a single multiplexed WebSocket to reduce socket count, similar to Headlamp's single multiplexer socket vs per-cluster connections in Luxury Yacht (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1266).

   - Work items:
     - Prototype a single-connection stream mux for resource streams using the existing streammux handler (backend/refresh/streammux/handler.go:315).
     - Update ResourceStreamManager to reuse one socket across clusters and domains (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1266).
     - Add telemetry for connection counts and backlog resets to compare before/after (backend/refresh/streammux/handler.go:323).
   - Effort: High.
   - Risk: High.

8. Streaming coverage: add streaming for namespaces and cluster-overview using list/watch-style sources, similar to Headlamp's watch-driven list updates, to reduce polling-only domains (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:492; frontend/src/core/refresh/orchestrator.ts:2246; frontend/src/core/refresh/orchestrator.ts:2254).
   - Work items:
     - Add namespaces to the resource stream domains and register streaming in the orchestrator (backend/refresh/resourcestream/manager.go:52; frontend/src/core/refresh/orchestrator.ts:2246).
     - Derive cluster-overview updates from node/pod stream updates or add a dedicated stream endpoint (frontend/src/core/refresh/orchestrator.ts:2254; backend/refresh/system/manager.go:533).
     - Add diagnostics for stream health and fallback behavior (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1019).
   - Effort: High.
   - Risk: Medium.

### Prioritization matrix (impact vs effort)

| Recommendation                            | Impact         | Effort | Risk   | Priority |
| ----------------------------------------- | -------------- | ------ | ------ | -------- |
| 1) Permission-aware response cache gating | High           | Medium | Medium | P1       |
| 2) Debounced stream unsubscribe           | Medium         | Low    | Low    | P2       |
| 3) Response cache invalidation guard      | Medium         | Medium | Medium | P2       |
| 4) Demand-driven metrics polling          | Medium         | Medium | Medium | P2       |
| 5) Configurable event limits              | Low to Medium  | Low    | Low    | P3       |
| 6) Structured permission-denied payloads  | Medium         | Medium | Medium | P2       |
| 7) Consolidated stream connections        | Medium to High | High   | High   | P3       |
| 8) Streaming for namespaces/overview      | Medium         | High   | Medium | P3       |
