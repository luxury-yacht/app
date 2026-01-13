# Event Stream Review Plan

Goal: capture the review findings and follow-up work for `backend/refresh/eventstream`.

Plan:
- ✅ Address the resume/subscribe gap that can drop events between `Resume` and `Subscribe` (e.g., subscribe first, then replay buffer). Impact: medium (prevents missed events). Effort: medium.
- ✅ Handle subscriber limit hits explicitly (return an SSE error payload or HTTP 429/503 instead of keeping an idle stream). Impact: medium (clear client behavior, avoids silent failures). Effort: low/medium.
- ✅ Reject empty namespace scopes (`scope=namespace:`) as invalid with 400 instead of falling into a snapshot error. Impact: low (cleaner client error). Effort: low.
- ✅ Add tests for subscriber limit handling and the resume/subscribe gap behavior. Impact: low/medium (guard against regressions). Effort: low/medium.

Notes:
- Current behavior: resume occurs before subscription, and the handler does not check for nil channels when the subscriber limit is exceeded.
