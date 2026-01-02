# Top 10 Findings (Summary + Impact)

## Plan Summary

The plan compares Headlamp and Luxury Yacht across data loading, refresh/watch strategy, caching/state, metrics/events pipelines, error handling, and performance. It traces resource, metrics, and event flows end-to-end with evidence and highlights where Luxury Yacht relies on interval snapshots and SSE while Headlamp leans on watch-driven incremental updates, backend response caching, and per-request authorization checks. The evaluation also calls out stability risks (polling load, backpressure, permission drift) and performance opportunities (watch-based updates, caching, multiplexing), with specific line references for both apps.

## Top 10 Most Impactful Findings (with scope labels)

1. [Fundamental] Resource lists are interval snapshot-driven in Luxury Yacht (2-3s for several domains) while Headlamp uses watch-based incremental updates; shifting to watch-based updates would materially change refresh architecture and UI state flow. Evidence: `frontend/src/core/refresh/refresherConfig.ts:24`, `headlamp/frontend/src/lib/k8s/api/v2/useKubeObjectList.ts:492`, `headlamp/frontend/src/lib/k8s/api/v2/KubeList.ts:52`.
2. [Fundamental] A generalized watch streaming transport (WS multiplexer or equivalent) would be required to support #1 at scale; Headlamp multiplexes watches over a single WS and resubscribes on reconnect, while Luxury Yacht only streams events/logs. Evidence: `headlamp/frontend/src/lib/k8s/api/v2/multiplexer.ts:60`, `headlamp/backend/cmd/multiplexer.go:389`, `frontend/src/core/refresh/orchestrator.ts:1493`.
3. [Incremental] Snapshot ETag checks happen after a full snapshot build, so 304 responses do not save backend work; adding short-lived snapshot caching would reduce redundant builds. Evidence: `backend/refresh/api/server.go:71`, `backend/refresh/snapshot/service.go:31`.
4. [Incremental] Headlamp’s response cache with watch-driven invalidation reduces API traffic for repeated GETs, while Luxury Yacht lacks a similar cache for non-informer endpoints (object details/YAML/helm); targeted caching could improve performance without changing UI behavior. Evidence: `headlamp/backend/cmd/server.go:183`, `headlamp/backend/pkg/k8cache/cacheStore.go:203`, `headlamp/backend/pkg/k8cache/cacheInvalidation.go:164`.
5. [Fundamental] Permission handling diverges: Luxury Yacht preflights and caches permissions at subsystem setup, while Headlamp checks SSAR per request with cached clientsets; moving to runtime SSAR or expiring permission caches is a significant behavioral shift. Evidence: `backend/refresh/system/manager.go:93`, `backend/refresh/informer/factory.go:306`, `headlamp/backend/pkg/k8cache/authorization.go:119`.
6. [Incremental] Event streaming drops slow subscribers and has no resume tokens; reconnects rely on fresh snapshots and caps, which risks data gaps during bursts. Adding resync on drop and optional resume markers would improve reliability. Evidence: `backend/refresh/eventstream/manager.go:67`, `backend/refresh/eventstream/handler.go:118`, `frontend/src/core/refresh/streaming/eventStreamManager.ts:142`.
7. [Fundamental] Catalog browse intentionally avoids SSE updates due to React update-depth risks; making browse safely stream would require reworking store update patterns and UI rendering. Evidence: `frontend/src/core/refresh/orchestrator.ts:1506`.
8. [Incremental] High-frequency refresh intervals (2-3s) across multiple domains can cause contention and timeouts; tune intervals or gate refreshers by view/visibility to cut load. Evidence: `frontend/src/core/refresh/refresherConfig.ts:24`, `frontend/src/core/refresh/RefreshManager.ts:634`, `frontend/src/core/refresh/RefreshManager.ts:733`.
9. [Incremental] Event retention differs sharply (Headlamp default 2000, Luxury Yacht 200); increasing caps or adding pagination would reduce truncation and improve incident context without changing streaming model. Evidence: `headlamp/frontend/src/lib/k8s/event.ts:51`, `backend/refresh/snapshot/event_limits.go:3`, `backend/refresh/snapshot/cluster_events.go:111`.
10. [Incremental] Catalog SSE has explicit backpressure drop behavior for slow consumers; if SSE is reintroduced for browse, the UI must handle missed updates by re-fetching snapshots when readiness or dropped updates are detected. Evidence: `backend/objectcatalog/streaming.go:151`, `backend/refresh/snapshot/catalog_stream.go:91`.

## Detailed Plan for #1 (Watch-based incremental resource updates)

### Goals and scope

- Reduce full snapshot rebuild frequency for high-churn resource lists.
- Preserve current UI behavior while improving freshness and load.
- Keep the object catalog as the source of truth for namespace and cluster listings (no change to catalog ownership).

### Phase 0 - Design + scoping (no behavior change)

- ✅ Select initial target domains: pods, namespace-workloads, nodes (high-churn lists with clear row semantics and metrics-bearing to validate the metrics-only refresh path).
- ✅ Define the update payload shape: domain, scope, cluster meta, event type (ADDED/MODIFIED/DELETED/RESET/COMPLETE), resourceVersion, uid, name, namespace, kind, and the minimal list-row fields needed to update UI state without full rehydrate.
- ✅ Document invariants and fallbacks: require monotonic resourceVersion per scope; if missing/older RV, out-of-order update, backlog drop, or COMPLETE signal, trigger a snapshot resync and resume streaming.

### Phase 1 - Backend streaming foundation

- Extend the refresh subsystem with a resource update stream per domain/scope.
- Use informer event handlers to emit updates with resourceVersion and object identity.
- Add stream health signals: heartbeat, RESET or COMPLETE markers for resync, and backpressure handling (buffer limits + telemetry on drops). (ties to #6)
- Keep permission gating aligned with existing preflight checks; if list/watch permission is missing, do not expose the stream for that domain.
- Implement transport consolidation in parallel (WS multiplexer or similar) to avoid per-resource connection explosion. (ties to #2)
- Close #2 fully by making the multiplexer reusable across all watch-capable streams (resources now, events/logs later) with a single connection per cluster and standardized subscribe/unsubscribe semantics.
  - Decision: use WS multiplexer for resource list streaming; keep SSE for logs/events initially to limit churn.

### Phase 2 - Frontend integration (feature-flagged)

- Add a resource stream manager similar to the event stream manager, with:
  - Initial snapshot fetch, then stream subscribe.
  - ResourceVersion gating and idempotent update application.
  - Coalescing or throttling of rapid update bursts to avoid render churn.
  - Automatic resync on stream errors, out-of-order updates, or RESET/COMPLETE signals. (ties to #6)
- Keep existing interval refresh logic active behind a feature flag for safe fallback.
- Add explicit backpressure handling for stream drops (trigger a resync snapshot and log telemetry). (ties to #6)
- Close #6 fully by adding the same drop detection and resync behavior to event streams, not just resource streams, and exposing a UI-visible "stream resyncing" state.
- Preserve metrics freshness for pods/workloads/nodes by keeping a metrics refresh path in parallel:
  - Decision: add a metrics-only refresh/update path and merge metrics into stream-updated rows.
  - Ensure stream updates do not wipe existing metrics fields unless a metrics refresh has arrived.

### Phase 3 - Safe rollout strategy

- Shadow mode: connect to the stream and validate updates against snapshots without updating the UI.
- Drift detection: compare item counts and key sets; if drift is detected, disable stream for that domain and fall back to snapshots.
- Gradual enablement: start with a single domain in one view, then expand to more domains once stable.
- In parallel, tune or disable high-frequency interval refreshers for domains moved to streaming so load reduction is realized. (ties to #8)
- Close #8 fully by auditing all refreshers and applying visibility and view-based gating, not just the domains moved to streaming.

### Phase 4 - Validation and observability

- Add unit tests for update merge logic, resourceVersion gating, and reset handling.
- Add integration tests for disconnect/reconnect and stale update recovery.
- Track telemetry for stream drops, resync frequency, and snapshot fallbacks.
- Add lightweight snapshot caching to lower the cost of initial loads and resyncs. (ties to #3)
- Close #3 fully by expanding snapshot caching to all snapshot domains, with explicit invalidation rules and a bounded TTL.

### Safety guarantees

- No UI behavior change until the feature flag is enabled.
- Automatic fallback to snapshot refresh on any stream anomaly.
- Continue to use catalog snapshots for browse and namespace/cluster listings.

### Diagnostics + Logs panel follow-through (no layout changes)

- Keep Application Logs behavior unchanged unless log streaming moves to the shared transport; if it does, retain the same status transitions (loading/updating/ready/error) and error messaging paths.
- Extend Diagnostics rows (not summary cards) to reflect resource stream telemetry by wiring stream stats into existing row fields (`telemetryStatus`, `telemetryTooltip`, `dropped`, `lastUpdated`) in the `baseRows` builder.
- Add a domain-to-stream mapping alongside `DOMAIN_REFRESHER_MAP` to select the correct `telemetrySummary.streams` entry per domain.
