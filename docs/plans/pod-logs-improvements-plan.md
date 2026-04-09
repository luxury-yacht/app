# Pod Logs Improvements Plan

## Overview

Improve Luxury Yacht's pod log retrieval and viewing without turning the existing object panel into a general-purpose log exploration tool.

This plan is intentionally limited to object-scoped log viewer improvements inside the existing Object Panel.

The current pod logs implementation already has strengths that should be preserved, especially GUI-oriented buffering, reconnect deduplication, and stream-to-fallback recovery. The goal is to keep those strengths while improving source-side filtering, container coverage, load control, and output shaping.

## Goals

- Make pod log object references fully cluster-aware and GVK-aware
- Improve backend log retrieval and streaming correctness and resilience
- Add source-side filtering so noisy workloads can be narrowed before transport
- Add explicit concurrency/backpressure controls for multi-pod and multi-container fan-out
- Improve log display with highlighting and richer structured output modes
- Preserve the existing object-panel UX for common pod/workload debugging

## Non-Goals

- Do not embed a freeform CLI-style query model into the existing Object Panel
- Do not expose raw Go-template customization in v1 of this work
- Do not add all-namespace arbitrary log searching to the current logs tab
- Do not broaden scope beyond pod logs unless required for shared plumbing

## Current Gaps

- Log scope still uses the legacy `cluster|namespace:kind:name` format instead of full object identity
- Backend log fan-out has no explicit concurrency cap
- Source-side filtering is limited; most narrowing happens after logs already reach the client
- Ephemeral containers are exposed in parts of the UI but not fully handled by the live stream path
- Fallback/manual fetch can hide real API errors as empty results
- Reader logic still depends on `bufio.Scanner` defaults, which are fragile for large log lines
- Presentation does not yet have include/exclude/highlight controls or multiple output modes

## Architecture Direction

Keep the current object-scoped panel model:

- one selected Kubernetes object
- live stream when possible
- fallback polling when needed
- GUI-oriented filtering, parsing, and buffering

Add targeted improvements where they reinforce that model:

- better backend filtering
- better container handling
- concurrency limits
- clearer failures
- highlight and output modes

Explicitly out of scope for this plan:

- regex-driven arbitrary workload discovery
- all-namespace freeform log search
- label/field/node selector driven log exploration beyond the selected object
- any standalone or cluster-wide log exploration feature

## Phase 1: Fix Log Object Identity

### Objectives

- Replace legacy log scope construction with the same cluster-aware object identity rules used elsewhere in the app
- Require full object identity for object-backed log views: `clusterId`, `namespace` when applicable, `group`, `version`, `kind`, and `name`
- Keep a short compatibility bridge during migration

### Backend

- ✅ Update log stream scope parsing to support the GVK-aware object scope format
- ✅ Update workload/pod resolution code to consume full object identity instead of legacy kind-only scope segments
- ✅ Update fallback/manual log-fetch request handling to consume the same canonical object identity as the live stream path
- [ ] Add hard failures for missing API version once all callers are migrated
- ✅ Keep a temporary compatibility parser for old log scopes during rollout

### Frontend

- ✅ Update `getObjectPanelKind` to build `logScope` from full object identity
- [ ] Thread GVK-aware log scope through `ObjectPanelContent`, `LogViewer`, and refresh orchestration
- ✅ Update manual/fallback log fetch requests to derive from the same canonical object identity used by live streaming
- ✅ Remove legacy comments and assumptions that logs are the one exception to full object identity

### Tests

- ✅ Add frontend tests proving log scopes include `clusterId + namespace when applicable + group/version + kind + name`
- ✅ Add backend tests for GVK log scope parsing
- ✅ Add tests proving live and fallback/manual log requests resolve the same object identity
- ✅ Add collision tests for same-kind different-group objects

### Exit Criteria

- All object-backed log paths use full cluster-aware object identity
- Legacy scope parsing is only a migration shim, not the main format

## Phase 2: Strengthen Backend Log Retrieval

### Objectives

- Make batch fetch and stream retrieval support the same container classes and error semantics
- Close correctness gaps around init, ephemeral, and container-state handling

### Backend

- [ ] Add explicit options for including or excluding init containers
- [ ] Add explicit options for including or excluding ephemeral containers
- ✅ Treat ephemeral containers as included by default in "all containers" mode
- [ ] Add container-state targeting where Kubernetes semantics make it meaningful
- ✅ Ensure batch fetch and stream follow enumerate the same container sets
- ✅ Stop returning empty success on permission or transport failures
- ✅ Replace default `bufio.Scanner` limits with safer large-line handling
- [ ] Normalize transient "no logs yet" conditions so they are distinguishable from real failures

### Frontend

- [ ] Update the single-pod container picker to accurately reflect containers the backend can actually stream
- ✅ Surface backend failures as failures, not "No logs available"
- ✅ Add UI affordances for init/debug/ephemeral container visibility when relevant
- ✅ Ensure "all containers" mode clearly indicates that ephemeral containers are included by default when present

### Tests

- ✅ Add backend tests for ephemeral container streaming
- ✅ Add backend tests for parity between stream and fallback container selection
- ✅ Add backend tests for oversized log lines
- ✅ Add frontend tests for real error display vs empty-log states

### Exit Criteria

- Ephemeral containers work end-to-end
- Stream and fallback paths support the same container-selection semantics
- Permission and transport errors are never silently flattened into empty results

## Phase 3: Add Source-Side Filtering and Load Controls

### Objectives

- Move the most expensive filtering closer to the backend
- Add explicit concurrency protection for workload fan-out

### Backend

- ✅ Extend log request/stream options with source-side filters for containers
- ✅ Add include/exclude regex support for log lines before sending to the client
- [ ] Add optional pod-name include/exclude filters for multi-pod workloads
- ✅ Share one backend target-resolution, filtering, ordering, and cap-handling path between live follow and previous-log fetch
- ✅ Add per-scope maximum concurrent log target limits
- ✅ Start with a provisional default per-scope cap of 24 resolved pod/container targets, subject to validation during hardening
- [ ] Add a global maximum concurrent log target limit across all active log scopes
- [ ] Start with a provisional default global cap of 72 resolved pod/container targets, subject to validation during hardening
- [ ] Define the global cap as process-wide with fair sharing across clusters so one cluster cannot starve unrelated active scopes in another cluster
- [ ] Count resolved pod/container targets, not just pod count, against both caps
- [ ] Use deterministic target selection when caps are hit:
- ✅ prefer ready/running pods first
- ✅ then stable sort by pod name and container name
- ✅ then take the first N targets allowed by the active cap
- ✅ keep the cap enforced across stream lifecycle changes so pod churn rebalances the bounded target set instead of growing past it
- [ ] Define behavior when the limit is exceeded:
- ✅ object panel mode returns a structured warning and degraded subset
- ✅ previous/manual mode uses the same target cap model and deterministic selection
- ✅ previous/manual mode may batch or serialize requests internally, but must preserve the same visible target set semantics as live mode
- ✅ Emit telemetry for dropped or skipped streams due to concurrency limits

### Frontend

- [ ] Add UI controls for highlight filters appropriate to the object panel
- ✅ Add UI controls for include/exclude regex filters appropriate to the object panel
- [ ] Persist highlight filter state for the lifetime of the Object Panel tab, including transient remounts such as cluster switching
- ✅ Persist include/exclude filter state for the lifetime of the Object Panel tab, including transient remounts such as cluster switching
- [ ] Drop highlight filter state when the owning Object Panel tab is closed
- ✅ Drop include/exclude filter state when the owning Object Panel tab is closed
- [ ] Reflect backend warnings when not all pod/container targets were opened or fetched
- ✅ Reflect backend warnings when not all pod/container targets were opened or fetched
- [ ] Distinguish transport drops from intentional filtering

### Tests

- ✅ Add backend tests for include/exclude filters
- [ ] Add backend tests for concurrency cap behavior
- [ ] Add backend tests proving live follow and previous/manual fetch resolve the same capped target set
- [ ] Add frontend tests for warning states when limits are hit

### Exit Criteria

- Filtering reduces backend/API load, not just frontend noise
- Large workloads cannot open unbounded streams
- When caps are hit, users see a deterministic subset and an explicit warning rather than silent omission

## Phase 4: Improve Output and Readability

### Objectives

- Improve output and readability in a GUI-native form
- Keep the current parsed-table strengths while improving raw log readability
- Preserve Luxury Yacht's existing 12-color pod palette while making pod-to-color assignment stable by pod name instead of current visible ordering

### Frontend

- ✅ Keep the existing 12-color log pod palette from the light and dark themes
- ✅ Change pod color assignment from sorted visible pod order to stable hash-based pod-name mapping so a pod keeps the same color across refreshes and pod-list churn
- ✅ Ensure the stable mapping still degrades predictably when more than 12 pods are visible
- [ ] Add highlight support for matched substrings
- [ ] Expand display modes:
- [ ] raw
- [ ] structured JSON
- [ ] pretty JSON
- [ ] parsed table
- [ ] Add richer timestamp controls:
- [ ] hidden
- [ ] default
- [ ] short
- [ ] localized display
- [ ] Preserve current pod/container prefixes and color cues where useful
- [ ] Ensure copy/export behavior respects the active display mode

### Backend

- [ ] Keep backend responsibility limited to log delivery, filtering, target selection, ordering, metadata, and warnings
- [ ] Do not add backend-side parsed-log formatting or user-defined output rendering

### Tests

- ✅ Add frontend tests proving pod colors remain stable for a given pod name when the visible pod set changes
- ✅ Add frontend tests covering >12 pod wraparound behavior
- [ ] Add frontend tests for highlight behavior
- [ ] Add frontend tests for output mode switching
- [ ] Add frontend tests for timestamp format controls

### Exit Criteria

- Pod colors remain visually aligned with the current theme palette but no longer shift when pods appear, disappear, or reorder
- Users can move quickly between raw and structured views
- Search/highlight is visually obvious and does not mutate the underlying log content

## Phase 5: Hardening and Rollout

### Quality Gates

- [ ] Run targeted backend tests for pod log fetch and stream packages
- [ ] Run targeted frontend tests for `LogViewer`, log stream manager, and fallback manager
- [ ] Run `mage qc:prerelease`

### Operational Checks

- [ ] Validate behavior against large workloads with many pods and containers
- [ ] Validate RBAC-denied, auth-recovery, and refresh-subsystem rebuild scenarios
- [ ] Validate cluster switching with active log streams
- [ ] Validate memory behavior with the configured log buffer limit

### Documentation

- [ ] Add developer docs describing the log pipeline and scope format
- [ ] Document which pod log behaviors are intentionally adopted vs intentionally omitted

## Recommended Implementation Order

1. Phase 1: Fix log object identity
2. Phase 2: Strengthen backend retrieval
3. Phase 3: Add source-side filtering and load controls
4. Phase 4: Improve output and readability
5. Phase 5: Hardening and rollout

This order fixes correctness first, then reliability, then operator-scale behavior, then presentation.

## Settled Decisions

- Pod color stability is hash-based against the existing 12-color palette.
- Include/exclude/highlight patterns are scoped to the Object Panel tab lifetime. They persist while that object tab remains open, including transient remounts such as cluster switching, and are dropped when the object tab is closed.
- Concurrency caps apply both per scope and globally, are measured in resolved pod/container targets rather than pods alone, and must preserve fair sharing across clusters.
- Object Panel logs remain strictly object-scoped; broad environment-level log exploration is out of scope.
- Backend remains delivery-only for logs; formatting and parsed presentation stay in the frontend.
- Previous-log retrieval uses the same backend target-selection/filter/cap path as live follow, but remains a distinct non-follow execution mode.
- Ephemeral containers are included by default in "all containers" mode.
