# Event Stream Review Plan

Goal: capture the review findings and follow-up work for `backend/refresh/eventstream`.

Plan:

- ✅ Address the resume/subscribe gap that can drop events between `Resume` and `Subscribe` (e.g., subscribe first, then replay buffer). Impact: medium (prevents missed events). Effort: medium.
- ✅ Handle subscriber limit hits explicitly (return an SSE error payload or HTTP 429/503 instead of keeping an idle stream). Impact: medium (clear client behavior, avoids silent failures). Effort: low/medium.
- ✅ Reject empty namespace scopes (`scope=namespace:`) as invalid with 400 instead of falling into a snapshot error. Impact: low (cleaner client error). Effort: low.
- ✅ Add tests for subscriber limit handling and the resume/subscribe gap behavior. Impact: low/medium (guard against regressions). Effort: low/medium.

Notes:

- Current behavior: resume occurs before subscription, and the handler does not check for nil channels when the subscriber limit is exceeded.

  - Medium backend/refresh/snapshot/service.go:84 — cache‑bypass requests still share the same singleflight key as non‑bypass calls, so a non‑bypass in‑flight can satisfy a bypass
    request with a cached response. If bypass must be strict (e.g., manual refresh), consider skipping singleflight or using a distinct key when HasCacheBypass is true.
  - Medium backend/refresh/snapshot/object_events.go:125 — API fallback only filters involvedObject.name (and namespace), not involvedObject.kind, so until the informer cache is
    synced, object events can include other kinds with the same name. Add a kind selector and a test for the fallback path.
  - Low backend/refresh/snapshot/object_details.go:125 — parseObjectScope accepts an empty kind (e.g. default::name), which then returns a generic “custom resource” payload rather
    than a 400. Recommend rejecting empty kind early.
  - Low backend/refresh/snapshot/namespace_events.go:111 — namespace events use CreationTimestamp for sort/age, while cluster events use EventTime/LastTimestamp. This can surface
    stale ordering/age for repeated events. Consider reusing eventTimestamp to keep behavior consistent.
