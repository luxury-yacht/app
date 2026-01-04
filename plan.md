# Comparison with Headlamp

This is a large but extremely important task. It is critical that you are thorough and meticulous.

I have cloned a copy of headlamp into the `headlamp` directory. Headlamp is a CNCF project that is very similar to this app in its scope and purpose.

I want you to:

- review the headlamp code, particularly how it loads, refreshes, and manages data (resources, metrics, and events) from the kubernetes API.
- capture what you have learned in this document using the sections below.
- compare how it is different from how this app in the specific subsystems listed below.
- determine what we can learn from headlamp to improve this app's stability and performance.

I cannot stress this enough, so please pay attention: this will be a complex task but it is CRITICALLY IMPORTANT that you do it well, and do not miss anything that we could learn from headlamp.

If you have suggestions on how to do your job better for this task, let me know.

## Output Structure

- Data loading (resources, metrics, events)
- Refresh/watch strategy (polling intervals, watch reconnection, resync)
- Caching/state management (in-memory stores, invalidation, persistence)
- Metrics/events pipeline (collection, aggregation, streaming)
- Error handling/backoff (rate limits, retries, failure recovery)
- Performance considerations (pagination, batching, UI update frequency)
- Differences vs Luxury Yacht (per subsystem)
- Recommendations for Luxury Yacht (stability/perf)
- Comparison tables per subsystem with evidence bullets (file paths/line references)
- Data flow traces (resources, metrics, events) for both apps

## Comparison Scope

- Data fetch layer (API client, request scheduling)
- Watch handlers (resource/event watches, reconnect logic)
- Store/cache (local state, selectors, derived views)
- Metrics collection (scrape/stream setup, update cadence)
- Events ingestion (filters, retention, UI delivery)

## Evaluation Criteria

- Watch reliability (reconnect/backoff, resync strategy)
- Throttling/backpressure (rate limits, queueing, batching)
- Cache correctness (invalidation rules, stale data handling)
- Memory growth (retention policies, pruning)
- UI update cadence (debounce/throttle, render frequency)
- Error visibility (user-facing errors, logging)

### Plan Summary

The plan compares Headlamp and Luxury Yacht across data loading, refresh/watch strategy, caching/state, metrics/events pipelines, error handling, and performance. It traces resource, metrics, and event flows end-to-end with evidence and highlights where Luxury Yacht relied on interval snapshots and SSE, with resource streaming and snapshot caching now closing key gaps while Headlamp continues to lean on watch-driven incremental updates, backend response caching, and per-request authorization checks. The evaluation also calls out stability risks (polling load, backpressure, permission drift) and performance opportunities (watch-based updates, caching, multiplexing), with specific line references for both apps.

## Confidence Boosters (evaluation hygiene)

- Anchor every subsystem finding to at least 3 concrete line references per app (done and expanded below).
- Cross-check numeric thresholds (timeouts, intervals, limits, subscriber caps) against constants files to avoid inference (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; frontend/src/core/refresh/refresherConfig.ts:24; backend/refresh/snapshot/event_limits.go:3; backend/refresh/eventstream/manager.go:18).
- Trace request scheduling end-to-end for resources, metrics, events (see Deep Analysis + Data Flow Traces sections) and call out where work is frontend vs backend.
- Validate streaming reconnection/backoff behavior and resume-token coverage (Headlamp multiplexer does not implement resume tokens; Luxury Yacht events use SSE resume IDs) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:275; frontend/src/core/refresh/streaming/eventStreamManager.ts:94; backend/refresh/eventstream/handler.go:73).
- Confirm object catalog remains source of truth for namespace/cluster listings and browse snapshots (backend/app_object_catalog.go:148; backend/refresh/snapshot/catalog.go:99).

## Data Loading (resources, metrics, events)

### Headlamp

- Resource lists flow through React Query `kubeObjectListQuery` -> `clusterFetch` -> backend proxy; items are mapped into KubeObject instances per cluster/namespace (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75).
- Cluster requests use `clusterRequest` with AbortController + default 2-minute timeout and cluster headers (KUBECONFIG/X-HEADLAMP-USER-ID) when needed (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Metrics are polled in the frontend every 10 seconds via `metrics()` and `clusterRequest` (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23).
- Events use the `Event` KubeObject with a default max limit of 2000; object-scoped events are fetched with fieldSelector + limit (headlamp/frontend/src/lib/k8s/event.ts:44; headlamp/frontend/src/lib/k8s/event.ts:141).

### Luxury Yacht

- Frontend loads snapshots via `fetchSnapshot` from the refresh server, with ETag support and retry logic for network errors (frontend/src/core/refresh/client.ts:61; backend/refresh/api/server.go:53).
- Backend builds snapshots from informers across registered domains (namespace/cluster/object/etc.) via the refresh subsystem and registry (backend/refresh/system/manager.go:90; backend/refresh/informer/factory.go:75).
- Object catalog is a dedicated service driven by informer caches and used for browse/catalog snapshots (backend/app_object_catalog.go:148; backend/refresh/snapshot/catalog.go:99).

## Refresh/watch strategy (polling intervals, watch reconnection, resync)

### Headlamp

- `useKubeObjectList` starts watches only when `refetchInterval` is unset; it uses list resourceVersions and avoids re-establishing watches when list updates (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:400).
- Frontend WebSocket multiplexer uses one connection, debounces unsubscribe, tracks COMPLETE messages, and only resubscribes after a future successful connect (no automatic reconnect loop) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:77; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:261; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:275).
- Backend multiplexer maintains per-cluster watch connections with heartbeat pings and reconnects on failure; sends COMPLETE when resourceVersion changes (headlamp/backend/cmd/multiplexer.go:389; headlamp/backend/cmd/multiplexer.go:639).
- Legacy streaming API reconnects after a fixed 3-second delay when `reconnectOnFailure` is true (headlamp/frontend/src/lib/k8s/api/v1/streamingApi.ts:300).
- Cache invalidation runs a dynamic informer watcher per context, skipping Event/Lease and deleting cache keys for recent changes (headlamp/backend/pkg/k8cache/cacheInvalidation.go:103; headlamp/backend/pkg/k8cache/cacheInvalidation.go:164; headlamp/backend/pkg/k8cache/cacheInvalidation.go:236).

### Luxury Yacht

- RefreshManager schedules per-domain intervals with manual interruption, timeouts, and exponential backoff cooldown on errors (frontend/src/core/refresh/RefreshManager.ts:571).
- Domain refresh intervals are configured (2-15 seconds) per refresher (frontend/src/core/refresh/refresherConfig.ts:24).
- Resource list domains stream over the WS multiplexer with per-cluster subscriptions, resync on RESET/COMPLETE, and polling paused while streaming is healthy for domains configured with pauseRefresherWhenStreaming (backend/refresh/resourcestream/manager.go:66; frontend/src/core/refresh/streaming/resourceStreamManager.ts:987; frontend/src/core/refresh/orchestrator.ts:981).
- Event streams use SSE; frontend reconnects with exponential backoff and error thresholds (frontend/src/core/refresh/streaming/eventStreamManager.ts:87; frontend/src/core/refresh/streaming/eventStreamManager.ts:142).
- Backend event stream sends an initial snapshot + incremental events and uses keep-alive and heartbeat timers (backend/refresh/eventstream/handler.go:43).
- Informer factories resync at a configured interval and block on cache sync (backend/refresh/informer/factory.go:75; backend/refresh/informer/factory.go:163).

## Caching/state management (in-memory stores, invalidation, persistence)

### Headlamp

- Backend caches GET responses with a 10-minute TTL when cache is enabled, skipping failures and selfsubjectrulesreviews (headlamp/backend/pkg/k8cache/cacheStore.go:175; headlamp/backend/pkg/k8cache/cacheStore.go:203).
- Cache invalidation purges on mutating requests and refreshes from the API; watch invalidation runs through dynamic informers (headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; headlamp/backend/pkg/k8cache/cacheInvalidation.go:164).
- Permissions are checked via SSAR with cached clientsets (10-minute TTL) keyed by token (headlamp/backend/pkg/k8cache/authorization.go:40; headlamp/backend/pkg/k8cache/authorization.go:119).
- React Query caches lists; watch updates are applied with resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

### Luxury Yacht

- Snapshot API uses checksum-based ETag; frontend uses If-None-Match and caches refresh base URL, and backend serves short-lived cached snapshots to avoid rebuilds (backend/refresh/api/server.go:77; backend/refresh/snapshot/service.go:19; frontend/src/core/refresh/client.ts:119).
- Refresh store maintains per-domain snapshot state (version/checksum/etag, timestamps, errors) and scoped entries (frontend/src/core/refresh/store.ts:13).
- Object catalog supports pagination/batching and an SSE stream; browse now consumes SSE with debounced, merge-queued updates plus snapshot fallback on gaps/drops to avoid update-depth issues (backend/refresh/snapshot/catalog.go:99; backend/refresh/snapshot/catalog_stream.go:126; frontend/src/core/refresh/orchestrator.ts:2225; frontend/src/core/refresh/streaming/catalogStreamManager.ts:262).
- Event stream manager caps events per scope and dedupes entries via a stable key (frontend/src/core/refresh/streaming/eventStreamManager.ts:83; frontend/src/core/refresh/streaming/eventStreamManager.ts:187).

## Metrics/events pipeline (collection, aggregation, streaming)

### Headlamp

- Metrics are polled in the frontend every 10 seconds using `clusterRequest` (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23).
- Events are handled as KubeObjects with a max limit (2000); object events use fieldSelector and limit (headlamp/frontend/src/lib/k8s/event.ts:44; headlamp/frontend/src/lib/k8s/event.ts:141).
- Watch updates use `KubeList.applyUpdate` with resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

### Luxury Yacht

- Metrics poller runs in backend with rate limiting and exponential backoff + jitter; snapshots read from the provider (backend/refresh/metrics/poller.go:74; backend/refresh/metrics/poller.go:181).
- Event pipeline is informer -> eventstream manager -> SSE handler with initial snapshot + incremental updates (backend/refresh/eventstream/manager.go:34; backend/refresh/eventstream/handler.go:71).
- Frontend event stream manager merges payloads, caps event lists, and tracks truncation (frontend/src/core/refresh/streaming/eventStreamManager.ts:363).

## Error handling/backoff (rate limits, retries, failure recovery)

### Headlamp

- Cluster requests time out via AbortController (default 2 minutes) and can trigger logout on auth errors (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Streaming reconnection uses a fixed 3-second delay in v1; multiplexer uses heartbeat pings + reconnect (headlamp/frontend/src/lib/k8s/api/v1/streamingApi.ts:333; headlamp/backend/cmd/multiplexer.go:389).
- WebSocket multiplexer connect uses polling without timeout; resubscribe happens only after a later successful connect (no auto-reconnect loop) (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:77; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:261).
- Unauthorized responses can be synthesized by the cache layer (headlamp/backend/pkg/k8cache/authErrResp.go:23; headlamp/backend/pkg/k8cache/authorization.go:119).

### Luxury Yacht

- Snapshot fetch retries network errors with exponential delay and invalidates base URL after failures (frontend/src/core/refresh/client.ts:142).
- RefreshManager enforces timeouts, aborts, and exponential backoff cooldown on errors (frontend/src/core/refresh/RefreshManager.ts:634).
- Event stream reconnects with exponential backoff and error thresholds for notifications (frontend/src/core/refresh/streaming/eventStreamManager.ts:142; frontend/src/core/refresh/streaming/eventStreamManager.ts:392).
- Metrics poller uses rate limiting and exponential backoff with jitter (backend/refresh/metrics/poller.go:181; backend/refresh/metrics/poller.go:260).

## Performance considerations (pagination, batching, UI update frequency)

### Headlamp

- Backend response cache + watch invalidation reduces redundant API calls when cache is enabled (headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/backend/pkg/k8cache/cacheInvalidation.go:164).
- WebSocket multiplexer reduces watch connection count and debounces unsubscribe (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:221).
- React Query list cache receives incremental watch updates instead of full reloads (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

### Luxury Yacht

- Snapshot API includes batch/latency stats and ETag, enabling cache-aware clients (backend/refresh/api/server.go:77; backend/refresh/snapshot/catalog.go:142).
- Catalog SSE drives browse updates with debounced application and snapshot fallback to avoid update-depth risks (frontend/src/core/refresh/orchestrator.ts:2225; frontend/src/core/refresh/streaming/catalogStreamManager.ts:262; frontend/src/core/refresh/streaming/catalogStreamManager.ts:330).
- Event stream caps events (500) per scope to prevent memory growth (frontend/src/core/refresh/streaming/eventStreamManager.ts:83).
- Several refreshers run at 2-3 second intervals; resource streaming now pauses refreshers for non-metrics list domains while healthy, reducing interval load (events, namespaces, and metrics-only domains still poll) (frontend/src/core/refresh/refresherConfig.ts:24; frontend/src/core/refresh/orchestrator.ts:982).

## Deep Analysis by Subsystem

### Data fetch layer (API client, request scheduling)

Headlamp:

- React Query list requests are defined via `kubeObjectListQuery`, keyed by cluster/namespace/queryParams, with optional `refetchInterval` driving polling (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:73).
- `clusterRequest` uses a 2-minute AbortController timeout, injects `KUBECONFIG`/`X-HEADLAMP-USER-ID` headers for stateless clusters, and auto-logout on 401 if configured (headlamp/frontend/src/lib/k8s/api/v1/constants.ts:26; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:134; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:146; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:157).
- Backend cluster proxy requests are wrapped by `CacheMiddleWare` when cache is enabled, which generates a cache key, performs SSAR authorization, serves cached responses, and stores fresh responses (headlamp/backend/cmd/server.go:183; headlamp/backend/cmd/server.go:214; headlamp/backend/cmd/server.go:225; headlamp/backend/cmd/server.go:239).
- Cache store logic persists successful responses for 10 minutes, skips "Failure" payloads and `selfsubjectrulesreviews`, and returns cached headers via `X-HEADLAMP-CACHE` (headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/backend/pkg/k8cache/cacheStore.go:221; headlamp/backend/pkg/k8cache/cacheStore.go:234; headlamp/backend/pkg/k8cache/cacheStore.go:152).
- Non-GET invalidation deletes cache keys and triggers a GET replay to refresh the cache (headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; headlamp/backend/pkg/k8cache/cacheInvalidation.go:71; headlamp/backend/pkg/k8cache/cacheInvalidation.go:83).

Luxury Yacht:

- `fetchSnapshot` resolves the refresh base URL with exponential backoff, caches it, and retries network failures while invalidating the cached base URL (frontend/src/core/refresh/client.ts:61; frontend/src/core/refresh/client.ts:84; frontend/src/core/refresh/client.ts:156; frontend/src/core/refresh/client.ts:205).
- Snapshot responses use ETag checksums and honor `If-None-Match`; on cache misses the backend still builds the snapshot before comparing the checksum (frontend/src/core/refresh/client.ts:131; backend/refresh/api/server.go:71; backend/refresh/snapshot/service.go:19).
- Snapshot builds are deduplicated with singleflight, cached with a short TTL, and checksummed from JSON marshaling to produce a stable checksum/ETag (backend/refresh/snapshot/service.go:19; backend/refresh/snapshot/service.go:47; backend/refresh/snapshot/service.go:90).
- Manual refresh jobs execute with retry/backoff and enforce a request timeout (backend/refresh/types.go:228; backend/refresh/types.go:231; backend/refresh/types.go:266).
- Domain refresh cadence is defined centrally (2s-15s intervals with cooldown/timeout) (frontend/src/core/refresh/refresherConfig.ts:24).

### Data fetch layer differences

- Headlamp: frontend talks to the backend cluster proxy per request, with timeouts and per-request cluster headers (headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).
- Luxury Yacht: frontend uses a refresh snapshot API backed by informer caches instead of direct cluster proxy calls (frontend/src/core/refresh/client.ts:119; backend/refresh/system/manager.go:90).

### Data fetch layer comparison table

| Aspect               | Headlamp                                                    | Luxury Yacht                                        | Evidence                                                                                                                 |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Primary request path | Frontend `clusterFetch` / `clusterRequest` to backend proxy | Frontend `fetchSnapshot` to refresh server          | headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75; frontend/src/core/refresh/client.ts:119                                |
| Response shaping     | React Query list mapping to KubeObject                      | Backend snapshot payloads                           | headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; backend/refresh/system/manager.go:90                       |
| Cache signal         | Response cache TTL (10 min, when enabled)                   | Snapshot ETag/Checksum + short-lived snapshot cache | headlamp/backend/pkg/k8cache/cacheStore.go:203; backend/refresh/api/server.go:77; backend/refresh/snapshot/service.go:19 |

Evidence:

- Headlamp: headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/backend/pkg/k8cache/cacheStore.go:203.
- Luxury Yacht: frontend/src/core/refresh/client.ts:119; backend/refresh/system/manager.go:90; backend/refresh/api/server.go:77.

### Watch handlers (resource/event watches, reconnect logic)

Headlamp:

- Watches are only started when `refetchInterval` is unset and list queries are loaded; resourceVersion is omitted from the identity to avoid reconnect churn when lists update (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:492; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:503).
- Multiplexed watch subscriptions track latest resourceVersion and apply updates directly into the React Query cache (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:184; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:232).
- `KubeList.applyUpdate` rejects stale updates based on resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:52).
- WebSocket multiplexer uses a polling connect loop with no timeout and resubscribes on reconnect; COMPLETE messages are tracked but not acted on beyond bookkeeping (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:60; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:106; headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:284).
- Backend multiplexer sends periodic pings, reconnects on heartbeat failure, and emits COMPLETE messages when resourceVersion changes (headlamp/backend/cmd/multiplexer.go:389; headlamp/backend/cmd/multiplexer.go:404; headlamp/backend/cmd/multiplexer.go:686).

Luxury Yacht:

- Shared informer factory runs with a configured resync interval and waits for cache sync on start (backend/refresh/informer/factory.go:75; backend/refresh/informer/factory.go:163; backend/refresh/informer/factory.go:172).
- Permission checks are cached and singleflighted for informer gating (backend/refresh/informer/factory.go:301; backend/refresh/informer/factory.go:315; backend/refresh/informer/factory.go:344).
- RefreshManager enforces timeouts, aborts in-flight work on manual refresh, and applies exponential cooldowns after errors (frontend/src/core/refresh/RefreshManager.ts:588; frontend/src/core/refresh/RefreshManager.ts:634; frontend/src/core/refresh/RefreshManager.ts:733).
- Resource streams use a WebSocket multiplexer with per-cluster subscriptions and resync on RESET/COMPLETE (backend/refresh/resourcestream/handler.go:13; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084).
- Events stream over SSE with initial snapshot, keepalive pings, and heartbeat timeout monitoring (backend/refresh/eventstream/handler.go:71; backend/refresh/eventstream/handler.go:118; backend/refresh/eventstream/handler.go:160).
- Event stream backpressure drops slow subscribers and caps subscribers per scope (backend/refresh/eventstream/manager.go:18; backend/refresh/eventstream/manager.go:67; backend/refresh/eventstream/manager.go:164).
- Catalog SSE uses streaming updates with subscriber buffers that can drop updates for slow consumers; UI responds by triggering snapshot fallback on gaps/drops or cache-not-ready states (backend/objectcatalog/streaming.go:151; frontend/src/core/refresh/streaming/catalogStreamMerge.ts:135; frontend/src/core/refresh/streaming/catalogStreamManager.ts:330).

### Watch handlers differences

- Headlamp: resource lists update via watch streams over a WebSocket multiplexer with resourceVersion gating and COMPLETE signals (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:124; headlamp/backend/cmd/multiplexer.go:639).
- Luxury Yacht: resource list domains stream over a WS multiplexer with per-cluster subscriptions and resync on RESET/COMPLETE; polling pauses while streams are healthy for domains configured to pause (events/logs remain on SSE; metrics-only domains still poll) (backend/refresh/resourcestream/handler.go:13; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084; frontend/src/core/refresh/orchestrator.ts:982).

### Watch handlers comparison table

| Aspect             | Headlamp                           | Luxury Yacht                                                                    | Evidence                                                                                                                                                                  |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watch transport    | WebSocket multiplexer (single WS)  | Resource stream WS multiplexer for lists + SSE for events/logs                  | headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; backend/refresh/resourcestream/handler.go:13                                                                      |
| Update model       | ResourceVersion-gated list updates | Streamed incremental updates with resync + polling pause for configured domains | headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084; frontend/src/core/refresh/orchestrator.ts:982     |
| Reconnect strategy | Heartbeat ping + reconnect         | Resource stream resync on RESET/COMPLETE + SSE reconnect with backoff           | headlamp/backend/cmd/multiplexer.go:389; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084; frontend/src/core/refresh/streaming/eventStreamManager.ts:142 |

Evidence:

- Headlamp: headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43; headlamp/backend/cmd/multiplexer.go:389.
- Luxury Yacht: backend/refresh/resourcestream/handler.go:13; frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084; frontend/src/core/refresh/orchestrator.ts:982; frontend/src/core/refresh/streaming/eventStreamManager.ts:142.

### Store/cache (local state, selectors, derived views)

Headlamp:

- Cache keys derive from group+kind+namespace+context, and cached responses preserve headers with an explicit cache marker (headlamp/backend/pkg/k8cache/cacheStore.go:125; headlamp/backend/pkg/k8cache/cacheStore.go:145).
- Cache invalidation skips Event/Lease resources and filters out initial sync noise by only invalidating objects created in the last minute (headlamp/backend/pkg/k8cache/cacheInvalidation.go:106; headlamp/backend/pkg/k8cache/cacheInvalidation.go:248).
- React Query list cache updates in-place via `setQueryData` when watch updates arrive (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:232).

Luxury Yacht:

- Refresh store tracks per-domain status, version, checksum, ETag, timestamps, errors, and dropped refresh counts (frontend/src/core/refresh/store.ts:13; frontend/src/core/refresh/store.ts:19; frontend/src/core/refresh/store.ts:71).
- Snapshot service uses singleflight plus short-lived per-domain/scope caching with TTL and cache bypass on demand (backend/refresh/snapshot/service.go:19; backend/refresh/snapshot/service.go:47; backend/refresh/snapshot/service.go:154).
- Object catalog caches sorted chunks and kind/namespace lists, with an eviction TTL that prunes stale entries (backend/objectcatalog/service.go:97; backend/objectcatalog/service.go:1802; backend/objectcatalog/service.go:1807).
- Catalog health status marks stale/degraded states when syncs fail (backend/objectcatalog/service.go:1888).
- Streaming state updates publish cached chunks/kinds/namespaces and readiness state (backend/objectcatalog/streaming.go:197).

### Store/cache differences

- Headlamp: backend response cache (TTL + watch invalidation) plus React Query list caches (headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:242).
- Luxury Yacht: snapshot store + ETag/Checksum + short-lived snapshot cache, plus detail/YAML/helm response cache with informer-driven invalidation; object catalog caches and SSE stream (frontend/src/core/refresh/store.ts:13; backend/refresh/snapshot/service.go:19; backend/response_cache.go:11; backend/response_cache_invalidation.go:22; backend/refresh/snapshot/catalog_stream.go:32).

### Store/cache comparison table

| Aspect            | Headlamp                                      | Luxury Yacht                                                       | Evidence                                                                                                                           |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Backend cache     | HTTP response cache (TTL + invalidation)      | Snapshot ETag + short-lived snapshot cache + store + detail/YAML/helm response cache | headlamp/backend/pkg/k8cache/cacheStore.go:203; backend/refresh/snapshot/service.go:19; backend/response_cache.go:11; frontend/src/core/refresh/store.ts:13 |
| Invalidation      | Dynamic informer invalidation + non-GET purge | Refresh intervals + manual refresh + response cache invalidation on informer updates | headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; frontend/src/core/refresh/refresherConfig.ts:24; backend/response_cache_invalidation.go:22 |
| Permission gating | SSAR per request with cached clientsets       | Runtime SSAR checks for informers + per-request SSAR gating for snapshot builds      | headlamp/backend/pkg/k8cache/authorization.go:119; backend/refresh/system/manager.go:93; backend/refresh/snapshot/service.go:55; backend/refresh/snapshot/permission_checks.go:79 |

Evidence:

- Headlamp: headlamp/backend/pkg/k8cache/cacheStore.go:203; headlamp/backend/pkg/k8cache/cacheInvalidation.go:55; headlamp/backend/pkg/k8cache/authorization.go:119.
- Luxury Yacht: backend/refresh/snapshot/service.go:19; backend/response_cache.go:11; backend/response_cache_invalidation.go:22; frontend/src/core/refresh/store.ts:13; frontend/src/core/refresh/refresherConfig.ts:24; backend/refresh/system/manager.go:93; backend/refresh/snapshot/permission_checks.go:79.

### Resources data flow traces

Headlamp:

1. UI `KubeObject.useList` -> `useKubeObjectList` (React Query list) -> `clusterFetch` -> backend `/clusters/{cluster}/...` proxy -> Kubernetes API list -> React Query cache update (headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:64; headlamp/frontend/src/lib/k8s/api/v2/fetch.ts:75).
2. Watch path -> WebSocket multiplexer `/wsMultiplexer` -> cluster watch socket -> updates applied via `KubeList.applyUpdate` (headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:61; headlamp/backend/cmd/multiplexer.go:592; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

Luxury Yacht:

1. UI RefreshOrchestrator -> `fetchSnapshot` -> refresh server `/api/v2/snapshots/{domain}` -> snapshot service built from informer caches -> snapshot payload -> refresh store update (frontend/src/core/refresh/client.ts:119; backend/refresh/api/server.go:53; backend/refresh/system/manager.go:90; frontend/src/core/refresh/store.ts:13).
2. UI ResourceStreamManager -> WebSocket `/api/v2/stream/resources` -> resource stream multiplexer -> backend resource stream manager -> incremental updates merged into refresh store with resync on RESET/COMPLETE (frontend/src/core/refresh/streaming/resourceStreamManager.ts:1084; backend/refresh/system/manager.go:543; backend/refresh/resourcestream/handler.go:13).

### Metrics pipeline (collection, aggregation, streaming)

Headlamp:

- Metrics polling is UI-driven on a fixed 10s interval without built-in backoff or rate limiting (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:33; headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:39).
- Requests use the same 2-minute timeout as other cluster requests (headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:134; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:157).

Luxury Yacht:

- Backend poller rate-limits via a token bucket and retries with exponential backoff + jitter (backend/refresh/metrics/poller.go:74; backend/refresh/metrics/poller.go:111; backend/refresh/metrics/poller.go:285).
- Poller metadata tracks consecutive failures and success/failure counts (backend/refresh/metrics/poller.go:36; backend/refresh/metrics/poller.go:138; backend/refresh/metrics/poller.go:342).
- Metrics polling is disabled with an explicit reason when metrics API or permissions are missing (backend/refresh/system/manager.go:153; backend/refresh/system/manager.go:166; backend/refresh/system/manager.go:178).

#### Metrics collection differences

- Headlamp: metrics polling is frontend-driven (10s) via clusterRequest (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23).
- Luxury Yacht: backend metrics poller with rate limiting + backoff feeds snapshots (backend/refresh/metrics/poller.go:74; backend/refresh/system/manager.go:153).

### Metrics collection comparison table

| Aspect              | Headlamp                      | Luxury Yacht                       | Evidence                                                                                     |
| ------------------- | ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Collection location | Frontend poller (10s)         | Backend poller + provider          | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/metrics/poller.go:74  |
| Backoff/rate limit  | None (beyond request timeout) | Rate-limited + exponential backoff | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/metrics/poller.go:181 |
| Delivery            | Direct callback to UI         | Snapshot payloads                  | headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; backend/refresh/system/manager.go:153 |

Evidence:

- Headlamp: headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23.
- Luxury Yacht: backend/refresh/metrics/poller.go:74; backend/refresh/metrics/poller.go:181; backend/refresh/system/manager.go:153.

### Metrics data flow traces

Headlamp:

1. UI calls `metrics()` -> setInterval(10s) -> `clusterRequest` -> backend proxy -> metrics API -> callback with metrics items (headlamp/frontend/src/lib/k8s/api/v1/metricsApi.ts:23; headlamp/frontend/src/lib/k8s/api/v1/clusterRequests.ts:122).

Luxury Yacht:

1. Backend metrics poller -> list node/pod metrics -> store in provider -> snapshot builders read provider -> frontend `fetchSnapshot` delivers metrics in payload (backend/refresh/metrics/poller.go:181; backend/refresh/system/manager.go:153; frontend/src/core/refresh/client.ts:119).

### Events ingestion (filters, retention, UI delivery)

Headlamp:

- Events are fetched with a configurable max limit (default 2000); object events use fieldSelector + limit (headlamp/frontend/src/lib/k8s/event.ts:51; headlamp/frontend/src/lib/k8s/event.ts:147; headlamp/frontend/src/lib/k8s/event.ts:164).
- Watch updates apply through `KubeList.applyUpdate` with resourceVersion gating (headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:52).

Luxury Yacht:

- Cluster/namespace events are sorted by timestamp, limited to 500, and include warnings on truncation (backend/refresh/snapshot/event_limits.go:3; backend/refresh/snapshot/cluster_events.go:71; backend/refresh/snapshot/cluster_events.go:111; backend/refresh/snapshot/namespace_events.go:117).
- Object events use fieldSelector filtering and limit to 500 (backend/refresh/snapshot/object_events.go:73; backend/refresh/snapshot/object_events.go:94; backend/refresh/snapshot/event_limits.go:5).
- Event stream manager caps to 500 items, dedupes by composite key, and uses exponential reconnect backoff on the frontend (frontend/src/core/refresh/streaming/eventStreamManager.ts:83; frontend/src/core/refresh/streaming/eventStreamManager.ts:363; frontend/src/core/refresh/streaming/eventStreamManager.ts:745; frontend/src/core/refresh/streaming/eventStreamManager.ts:142).

### Events ingestion differences

- Headlamp: events are KubeObjects with list+watch and a 2000 item limit; object events use fieldSelector (headlamp/frontend/src/lib/k8s/event.ts:44; headlamp/frontend/src/lib/k8s/event.ts:141).
- Luxury Yacht: events stream over SSE with initial snapshot + incremental entries and a 500 item cap (backend/refresh/eventstream/handler.go:71; frontend/src/core/refresh/streaming/eventStreamManager.ts:83).

### Events ingestion comparison table

| Aspect   | Headlamp                            | Luxury Yacht                   | Evidence                                                                                                           |
| -------- | ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Source   | K8s Event list + watch              | Informer + SSE stream          | headlamp/frontend/src/lib/k8s/event.ts:44; backend/refresh/eventstream/handler.go:71                               |
| Limits   | Max 2000 events                     | Max 500 events (frontend cap)  | headlamp/frontend/src/lib/k8s/event.ts:51; frontend/src/core/refresh/streaming/eventStreamManager.ts:83            |
| Delivery | Watch updates applied to list cache | SSE payloads merged into store | headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43; frontend/src/core/refresh/streaming/eventStreamManager.ts:363 |

Evidence:

- Headlamp: headlamp/frontend/src/lib/k8s/event.ts:44; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43.
- Luxury Yacht: backend/refresh/eventstream/handler.go:71; frontend/src/core/refresh/streaming/eventStreamManager.ts:363.

### Events data flow traces

Headlamp:

1. UI uses `Event.useList` -> list request + watch updates via `useKubeObjectList` -> watch data applied to list cache (headlamp/frontend/src/lib/k8s/event.ts:206; headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:124; headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:43).

Luxury Yacht:

1. Frontend `EventStreamManager` opens EventSource -> `/api/v2/stream/events` -> backend builds initial snapshot + subscribes to informer events -> SSE payloads -> frontend merges and caps events (backend/refresh/eventstream/handler.go:71; backend/refresh/eventstream/manager.go:34; frontend/src/core/refresh/streaming/eventStreamManager.ts:363).

## Recommendations for Luxury Yacht (stability/perf)

Gap-closing work (completed):

- ✅ Optional parity: per-request SSAR gating for snapshot builds to match Headlamp's per-request checks (headlamp/backend/pkg/k8cache/authorization.go:119; backend/refresh/system/manager.go:93; backend/refresh/permissions/checker.go:34).

## Stability risks (remaining, with evidence)

None.

## Stability risks (completed)

1. ✅ Snapshot refresh cooldown now triggers an immediate auto retry after errors, avoiding stalls until the next interval tick (frontend/src/core/refresh/RefreshManager.ts:832; frontend/src/core/refresh/RefreshManager.ts:845).
2. ✅ Refresh callbacks now isolate subscriber failures so one slow callback does not fail the entire refresh cycle (frontend/src/core/refresh/RefreshManager.ts:713; frontend/src/core/refresh/RefreshManager.ts:803).
3. ✅ Stream mux now drops the oldest outgoing message and issues a RESET for the hot scope instead of closing the entire session (backend/refresh/streammux/handler.go:315; backend/refresh/streammux/handler.go:349).
4. ✅ Stream resume buffers are evicted when scopes have no subscribers, preventing unbounded growth (backend/refresh/eventstream/manager.go:331; backend/refresh/resourcestream/manager.go:745).
5. ✅ Event stream backpressure now drops the oldest queued event before closing the subscriber, reducing forced resyncs under bursty load (backend/refresh/eventstream/manager.go:348; backend/refresh/eventstream/manager.go:366).
6. ✅ Resource stream backpressure now issues a RESET to resync slow subscribers instead of immediately dropping them, reducing resubscribe storms (backend/refresh/resourcestream/manager.go:1835; backend/refresh/resourcestream/manager.go:1865).
7. ✅ GVR discovery caching now expires entries and is cleared on CRD changes, preventing stale GVR lookups for YAML/apply paths (backend/object_yaml.go:56; backend/response_cache_invalidation.go:116).
8. ✅ Custom resource stream updates now evict cached YAML responses for dynamic resources, preventing stale YAML payloads for CRDs (backend/response_cache_invalidation.go:42; backend/refresh/resourcestream/manager.go:643).

## Performance improvement opportunities (remaining, with evidence)

None.

## Performance improvements (completed)

1. ✅ Incremental list caching for polling-only domains reuses unchanged rows to reduce full payload replacements (frontend/src/core/refresh/orchestrator.ts:1812; frontend/src/core/refresh/orchestrator.test.ts:370).

## Polling-only (non-streaming) domains

With the current backend, none of the polling‑only domains can use streaming without adding new stream sources or changing semantics.

Evidence: the only SSE endpoints wired are /api/v2/stream/resources, /api/v2/stream/events, /api/v2/stream/logs, and /api/v2/stream/catalog (backend/refresh/system/manager.go). The orchestrator only attaches
streaming for domains backed by those endpoints (frontend/src/core/refresh/orchestrator.ts).

Per polling‑only domain:

- namespaces: no resource stream support for namespaces today; would require adding namespaces to the resource stream backend and frontend.
- cluster-overview: derived/aggregated payload; would require a new aggregator from node/pod streams or a new stream endpoint.
- node-maintenance: snapshot is sourced from the local store; no stream endpoint.
- object-details, object-yaml, object-helm-manifest, object-helm-values: per‑object GETs; no stream endpoint and no list/watch semantics today.
- object-events: could theoretically be derived from the existing event stream, but event stream entries are raw events without the snapshot’s aggregation fields (counts, timestamps), so it would be a behavioral
  change (backend/refresh/eventstream/manager.go).
- catalog-diff: explicitly kept on snapshot/manual refresh flow; streaming would conflict with the current guidance in the frontend refresh notes (frontend/src/core/refresh/orchestrator.ts).
