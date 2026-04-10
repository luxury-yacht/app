# Container Logs

This document describes the current pod log implementation in the Object Panel, including the backend retrieval paths, the frontend viewer model, and the main maintenance gotchas.

## Scope and identity

Object-backed log views use the same canonical object identity as the rest of the refresh system:

- namespaced objects: `clusterId|namespace:group/version:kind:name`
- cluster-scoped objects still use `__cluster__` internally for the namespace token, but pod logs only support namespaced objects

Logs are no longer a special-case legacy path. Live streaming and manual/fallback fetch both resolve the target object from the same scope value.

## Backend pipeline

There are two retrieval paths:

1. live stream via `/api/v2/stream/logs`
2. manual/fallback fetch via `LogFetcher`

Both paths share the same core target-resolution behavior:

- resolve the selected object from canonical scope
- resolve matching pods for that pod or workload
- enumerate regular, init, and ephemeral containers
- include all container states by default
- optionally narrow to one exact container when the current UI selects exactly one container in single-pod mode
- apply deterministic target ordering
- enforce target caps and emit warnings when the result is degraded

The backend returns flat log entries plus metadata and warnings. It does not render parsed JSON, pretty JSON, or user-defined layouts.

### Entry shape

Each entry contains:

- `timestamp`
- `pod`
- `container`
- `line`
- `isInit`

The frontend derives everything else from that payload.

### Live streaming

`/api/v2/stream/logs` is routed per cluster through the aggregate log stream handler, then served by `backend/refresh/logstream`.

Current live-stream behavior:

- the handler sends an immediate connected event
- the handler then sends the initial snapshot with `reset=true`
- reconnect snapshots also replace the preserved client buffer rather than appending duplicate initial lines
- follow mode uses Kubernetes `pods/log` with reconnect + de-dupe logic
- transport backlog drops surface a warning instead of silently looking like filtering

### Manual fetch and fallback

The frontend falls back to `LogFetcher` when the stream is unavailable or when previous logs are requested.

Current fetch behavior:

- live fallback and explicit manual fetch use the same canonical scope as streaming
- previous logs use `previous=true` and remain a non-follow fetch path
- total fetch failure returns an error instead of an empty success
- partial success returns entries plus warnings

### Target caps

The backend protects log fan-out in two places:

- per-scope cap: `24` resolved pod/container targets
- global cap: `72` resolved pod/container targets across all active scopes

Selection is deterministic:

- ready/running pods first
- then stable sort by pod name
- then stable sort by container name

When a cap is hit, the backend emits a warning such as:

- `Showing logs for 24 of 25 pod/container targets. Refine filters to view more.`

The global limiter is shared across clusters and rebalances capacity so one cluster does not monopolize the full budget.

### Large lines

Large single-line logs no longer depend on the default `bufio.Scanner` token limit. The backend uses the shared `backend/internal/linescanner` helper with a larger cap so large JSON lines and stack traces do not break fetch or stream processing.

### Backend-only filter knobs

The backend request/stream contracts still support additional filters for non-UI callers and tests:

- `podInclude`
- `podExclude`
- `include`
- `exclude`
- `containerState`
- explicit init / ephemeral inclusion flags

The current Object Panel logs UI does not expose those controls. The user-facing viewer now uses a simpler frontend filter model instead.

## Frontend viewer

The frontend owns log presentation, search, display modes, copy behavior, and per-tab viewer state.

### Persistence model

Log viewer state is scoped to the owning Object Panel tab:

- it survives transient unmount/remount cycles such as cluster tab switches
- it is cleared when the owning Object Panel tab closes

This state includes:

- search text
- highlight / invert / case-sensitive / regex toggles
- selected pod/container filters
- wrap
- timestamp visibility
- ANSI color visibility
- display mode
- previous logs mode
- expanded parsed rows

### Pod and container selector

The `All Logs` dropdown is a grouped multi-select.

Workload view groups:

- `Pods`
- `Init Containers`
- `Containers`

Single-pod view groups:

- `Init Containers`
- `Containers`

Notes:

- the `Pods` section is omitted for single-pod logs
- the `Init Containers` header is omitted when there are no init containers
- `Select all` / `Select none` come from the shared multi-select dropdown component
- selected pod/container filters currently narrow results in the frontend viewer
- the only backend narrowing used by the current UI is exact single-container selection in single-pod mode

### Search model

The main search input is frontend-only and runs against ANSI-stripped text.

It matches against:

- log line text
- pod name
- container name

Available search toggles:

- `Highlight`
- `Invert`
- `Match case`
- `Regex`

Rules:

- `Match case` applies only in plain-text mode
- enabling `Regex` disables and clears `Match case`
- enabling `Invert` disables `Highlight`
- invalid regex produces no matches
- the active filter chip says `Regex: ... (invalid expression)` when the current regex is invalid

### Active filters strip

When any narrowing mode is active, the viewer shows an active-filters strip with chips for:

- text or regex query
- highlight
- invert
- match case
- selected pods
- selected init containers
- selected containers
- previous logs mode

`Clear all` is always the leftmost chip and resets the viewer to the default live view.

### Previous logs

Previous logs are only supported for `Pod` objects.

Current behavior:

- the toolbar button toggles previous mode
- previous mode also appears as a chip: `Showing previous logs`
- clearing that chip returns to live logs
- `Clear all` also exits previous mode

### Display modes

The current UI exposes three display modes:

- `Raw`
- `Pretty JSON`
- `Parsed JSON`

Notes:

- parsing is frontend-only
- parsed view only activates when at least one visible line parses as a non-empty JSON object
- parsed view uses `GridTable`
- parsed view does not apply shared table badge styling based on column names
- parsed-view copy exports CSV using the visible parsed columns
- raw / pretty copy exports the currently rendered text

### Timestamps and ANSI colors

The toolbar exposes:

- `API timestamps`
- `ANSI colors`

Current behavior:

- timestamps are a simple on/off presentation toggle
- ANSI colors are shown by default when ANSI SGR sequences are present
- the ANSI button only appears when the current log buffer contains ANSI sequences
- turning ANSI colors off strips the escape sequences from display
- turning ANSI colors on renders the color/style segments inline

### Raw-view performance

Raw log rendering is virtualized so resize and scroll cost scales with visible rows instead of the full buffered log count. Parsed view relies on `GridTable` virtualization.

### Current counts and empty states

The viewer only shows a count when filters are active:

- `n logs matching filters`

Empty states are intentionally distinct:

- `No logs yet`
- `No previous logs found`
- `No logs match filters`
- backend/runtime unavailable states through warnings or errors

## Current toolbar

The log toolbar currently contains:

- `Highlight (H)`
- `Invert (I)`
- `Match case (C)`
- `Regex (X)`
- `Auto-refresh (R)`
- `Previous logs (V)` for pods
- `API timestamps (T)`
- `Wrap text (W)`
- `ANSI colors (O)` when present
- `Pretty JSON (J)` when parsable logs exist
- `Parsed JSON (P)` when parsable logs exist
- `Copy to clipboard (Shift+C)`

## Implementation notes

### 1. Do not call both `setScopedDomainEnabled` and `startStreamingDomain`

The log viewer uses the refresh orchestrator to manage log streaming. `setScopedDomainEnabled(domain, scope, true)` already schedules streaming. Calling `startStreamingDomain` separately introduces a race with orchestrator deduplication and is especially brittle under React Strict Mode.

Correct:

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
```

Incorrect:

```typescript
refreshOrchestrator.setScopedDomainEnabled(LOG_DOMAIN, logScope, true);
void refreshOrchestrator.startStreamingDomain(LOG_DOMAIN, logScope);
```

### 2. Reset scope-sensitive state during render, not in an effect

When `logScope` changes, `LogViewer` resets scope-sensitive state during render. Doing that reset in an effect causes an extra render that can interrupt stream startup.

### 3. Initial stream snapshots must replace preserved client buffers

The frontend intentionally preserves per-tab log state across transient remounts. The initial real snapshot from the backend must therefore use `reset=true`, or reconnects/tab switches will append duplicate initial lines to the preserved buffer.

### 4. Fallback/manual fetch and live stream must consume the same scope

`LogFetcher` and `/api/v2/stream/logs` both derive from the same `logScope` value built from full object identity. Do not reintroduce a second legacy identity path for manual fetches.

### 5. The current UI is intentionally simpler than the backend contract

The backend still supports more source-side filter knobs than the Object Panel exposes. That is deliberate. If you add new UI controls, document clearly whether they are frontend-only narrowing or true backend-side target reduction.
