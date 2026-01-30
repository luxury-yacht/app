# Container log streaming

This document explains a key implementation detail for container log streaming that ensures real-time performance.

## The fix

The log viewer component uses the refresh orchestrator to manage log streaming. There are two key constraints:

### 1. Don't call both `setScopedDomainEnabled` and `startStreamingDomain`

The `setScopedDomainEnabled(domain, scope, true)` function internally schedules streaming via `scheduleStreamingStart`. If you also call `startStreamingDomain` separately, this creates a race condition with the orchestrator's `pendingStreaming` deduplication.

In React Strict Mode, effects run twice during development. When the first effect invocation starts streaming, the `pendingStreaming` map blocks the second invocation. If the cleanup from the first effect runs before streaming completes, it stops the connection. Meanwhile, the second invocation is blocked and never starts its own stream. The result is that streaming fails to establish.

**Correct:** Only use `setScopedDomainEnabled`

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
```

**Incorrect:** Calling both creates a race condition

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
void refreshOrchestrator.startStreamingDomain(LOG_DOMAIN, logScope); // Don't do this
```

### 2. Reset state during render, not in effects

When the log scope changes (e.g., user selects a different pod), the component resets its internal state. This reset should happen during the render phase, not in an effect, to avoid triggering a re-render that interrupts streaming startup.

```typescript
// Track scope changes during render, not in an effect
if (logScope !== previousLogScopeRef.current) {
  const hadPreviousScope = previousLogScopeRef.current !== null;
  previousLogScopeRef.current = logScope;
  // Reset refs...

  // Only dispatch reset if we had a previous scope (not on initial render)
  if (hadPreviousScope) {
    dispatch({ type: 'RESET_FOR_NEW_SCOPE', isWorkload });
  }
}
```

Performing this reset in an effect causes a state update, triggering a re-render, which can interrupt the streaming connection being established in a concurrent effect.

### 3. Backend sends two initial events

The backend log stream handler sends two events when a stream connects:

1. **Connected event** (sequence=1): Sent immediately when the stream is established, with `Reset: true` and empty entries. This tells the frontend the stream is active.

2. **Initial logs event** (sequence=2): Sent after the initial log fetch completes, with `Reset: false`. This event is always sent, even if there are no logs.

The frontend uses the sequence number to distinguish between:
- `sequence < 2`: Still loading (show spinner)
- `sequence >= 2`: Initial fetch complete (show logs or "No logs available")

This prevents the UI from showing "No logs available" prematurely while the backend is still fetching initial logs.
