# Streaming Migration Plan

## Context
- User goal: fast initial data load, real-time updates for changes, and metrics refreshed every few seconds.
- Current state: streaming is enabled across many views, but snapshots are paused when streaming is considered active.
- Headlamp reference behavior: list once, then watch; polling is disabled when watch is enabled (polling only when a refetch interval is set).

## What Went Wrong (My Mistake)
- I recommended switching most views to streaming without validating Headlamp's actual watch/polling model.
- I did not confirm that streaming health was being tracked before snapshots were paused.
- Result: the system can stop full snapshots even when the stream is not delivering, causing stale UI state.

## Desired Behavior
- Initial data loads quickly from snapshots.
- Real-time updates arrive from streaming once the stream is healthy.
- Metrics refresh every 5s (configurable) without overwriting non-metric fields.

## Phased Implementation Plan

### Phase 1: Audit and Baseline (pending)
- Inventory which domains are streaming, metrics-only, and snapshot-only.
- Identify current stream health signals (or lack of them) in the resource stream manager.
- Capture current refresh timings and gating behavior for nodes, workloads, and pods.

### Phase 2: Streaming Health Gating and Fallback (pending)
- Add a clear "stream healthy" signal from the resource stream manager.
- Only pause snapshot refreshes when the stream is confirmed healthy and delivering.
- Re-enable full snapshots automatically when the stream drops, errors, or drifts.
- Apply snapshot fallback to resource-streamed domains only (nodes, pods, namespace/cluster resource lists).
- Keep manual refresh behavior consistent with the streaming mode.

### Phase 3: Implementation Details (pending)
- Define stream healthy as: websocket open + at least one delivery signal (heartbeat/update/reset) per subscription.
- Track per-domain/per-scope stream health to avoid pausing snapshots prematurely.
- Treat stream error, disconnect, or drift as unhealthy and resume snapshot polling immediately.
- Surface stream health and fallback state in diagnostics for visibility.

### Phase 4: Metrics Cadence Tuning (pending)
- Add a single, easily configurable metrics interval (default 5s).
- Apply the interval to nodes, pods, and workloads metrics refreshes.
- Ensure metrics-only updates never overwrite status/taints/ready fields.
- Align client-side throttling with the new metrics cadence.

### Phase 5: Tests and Diagnostics (pending)
- Add tests for stream health gating and snapshot fallback logic.
- Add tests for metrics-only merge behavior to prevent regressions.
- Ensure diagnostics surface stream health and fallback state clearly.

### Phase 6: Diagnostics Retrieval Mode Reporting (pending)
- Diagnostics tab must show, for every active domain in the current view, the data retrieval mode:
  - `snapshot` (list), `streaming`, `watch`, `polling`, or `metrics-only`.
- Diagnostics tab must show health state per domain:
  - `healthy`, `degraded`, or `unhealthy`, plus the specific reason (disconnect, drift, errors, no scope, permissions).
- Diagnostics tab must surface all active domains, including scoped domains (pods/logs), with their current scopes.
- Diagnostics tab must show whether streaming is actually connected/delivering before snapshots are paused.
- Diagnostics tab must show whether polling is enabled or paused for each domain, and the active interval.

### Phase 7: Validation and Rollout Notes (pending)
- Manual validation checklist for nodes (cordon/uncordon), workloads, and pods.
- Confirm metrics cadence and correctness under stream disconnects.
- Document final behavior and limits in docs/development.
