# Refresh Refactor Plan

## Goals

- Improve readability and maintainability of the refresh subsystem wiring without changing behavior.
- Reduce duplication in permission checks and domain registration.

## Non-goals

- No changes to snapshot payloads, streaming behavior, or frontend-facing APIs.
- No new dependencies.

## Phases

1. Baseline map and invariants ✅
   - Inventory domain registrations in `backend/refresh/system/manager.go` (domain name, scope, informer vs list fallback).
   - Capture the permission requirements per domain and the expected fallback behavior.
   - Identify tests that already cover registry, snapshot service, and permission gating.

2. Decompose the system manager wiring ✅
   - Extract domain registration blocks into smaller, focused helpers (cluster, namespace, object panel, streams).
   - Move permission-check helper types and functions into a small internal helper file within `backend/refresh/system/`.
   - Keep public signatures and registration order stable.

3. Centralize permission/registration logic ✅
   - Represent domain requirements in a small declarative table or struct.
   - Drive list/list+watch checks and permission-denied domain registration from that data.
   - Consolidate common logging and `PermissionIssue` handling.

4. Verification ✅
   - Run existing backend refresh tests; add targeted tests if coverage gaps appear for registration order or permission gating.
   - Update `docs/development/data-refresh-system.md` only if the refactor changes any documented behavior.

5. Declarative registration table ✅
   - Replace per-group registration helpers with an ordered table of domain registration entries.
   - Drive gating, fallbacks, and dependency checks from the table without changing behavior.

6. Preflight alignment ✅
   - Generate the permission preflight list from the registration table to prevent drift.

7. Snapshot service abstraction ✅
   - Update event stream handler wiring to accept the snapshot service interface instead of `*snapshot.Service`.

8. Metadata deduplication ✅
   - Reduce repetition of domain metadata like `issueResource`, `logGroup`, `logResource`, `deniedReason` via helpers or constants.

9. Metrics gating consolidation ✅
   - Align metrics polling permission checks with the same gating helper used for domains.

10. Registration table tests ✅
   - Add a small test to validate registration order and required dependency checks (dynamic client, helm factory).
