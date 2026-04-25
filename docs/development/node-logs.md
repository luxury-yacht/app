# Node Logs

This document describes the current node log implementation in the Object Panel, including backend
discovery/fetch behavior, frontend viewer behavior, and the main limitations to keep in mind.

Status: implemented and in active use.

## Scope

Node logs are exposed through the existing `Logs` tab in the Object Panel for `Node` objects.

This is intentionally node-scoped:

- discovery runs when a node object panel opens
- the `Logs` tab is visible immediately for nodes
- the tab then shows either:
  - `Checking if logs are available for this node...`
  - discovered node log sources
  - an unavailable state for that specific node

There is no cluster-wide preflight outside the node object panel.

## Code map

### Backend

- `backend/resources/nodes/logs.go`
  - Node log discovery, classification, source filtering, and fetch behavior.
- `backend/resources/nodes/logs_test.go`
  - Discovery/fetch tests for directory listings, binary/compressed leaves, service probes, and
    unsupported sources.
- `backend/resources/types/types.go`
  - `NodeLogSource`
  - `NodeLogDiscoveryResponse`
  - `NodeLogFetchRequest`
  - `NodeLogFetchResponse`
- `backend/resources_nodes.go`
  - App-level resource wiring for node log discovery/fetch RPCs.

### Frontend

- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`
  - Starts node-log discovery for node panels and computes node log availability state.
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`
  - Passes node log availability and source state into object panel content.
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx`
  - Routes node objects in the shared `Logs` tab to the node log viewer.
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.tsx`
  - Node log viewer UI, source selection, fetch, filtering, parsed modes, copy, scroll behavior,
    and refresh behavior.
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.css`
  - Node log selector tree styling and node-only overrides for the shared logs UI.
- `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi.ts`
  - Frontend RPC calls and session-lifetime discovery cache.

## Backend model

### Discovery

Discovery starts from:

- `/api/v1/nodes/<node>/proxy/logs/`

The backend treats the endpoint as a browsable tree:

1. fetch the root
2. parse HTML directory listings
3. recurse through directories with bounded depth and source limits
4. classify candidate leaves as `directory`, `text`, or `binary`
5. keep only directly readable text leaves

Current discovery limits:

- max depth: `5`
- max discovered sources: `64`
- parallel workers: `8`

### Classification

Current classification rules:

- HTML listing with `<pre>` => directory
- obvious binary/compressed extensions => binary
- binary-looking sampled bytes => binary
- otherwise => text

Important detail:

- discovery no longer fetches full leaf bodies just to classify them
- for leaf/service candidates it streams the plain node-log URL and reads only the first `8192`
  bytes client-side
- directory traversal still uses normal full directory fetches

This change was necessary because some clusters reject path-backed `tailLines` requests even though
the plain path works.

### Source filtering

The backend intentionally hides several classes of sources:

- compressed or binary leaves such as:
  - `.gz`
  - `.journal`
  - `.tar`
  - `.tgz`
  - `.zip`
  - `.bz2`
  - `.xz`
- `pods/...`
- `containers/...`

`pods/...` and `containers/...` are intentionally excluded because those logs are already available
through the normal pod/workload log flows elsewhere in the app.

### Well-known service probes

The backend also probes a small set of service-query sources:

- `kubelet`
- `containerd`
- `crio`
- `cri-o`
- `docker`

These become sources like:

- `services / kubelet`

but only when `?query=<service>` is proven to return direct text for that specific node.

### Error and support detection

Current high-level interpretation:

- `401` / `403` => unavailable due to permissions
- `404` => unsupported on this cluster/node endpoint
- `200` with no usable text sources => unavailable
- `200` with at least one usable text source => supported

## Frontend model

### Capability flow

Node logs are not treated as a pure RBAC capability.

Current behavior:

- node panels start discovery immediately on mount
- there is no separate frontend `nodes/proxy` pre-check
- cached discovery results are reused by `clusterId + nodeName`
- the `Logs` tab stays visible for nodes while discovery runs

### Availability states

The node `Logs` tab currently shows:

- pending:
  - `Checking if logs are available for this node...`
- unavailable:
  - `Logs are not available on this node`
  - `Error: ...` only when a backend reason exists
- supported but no source selected:
  - `Select a log source to view logs.`

### Source selector

The source selector uses the shared dropdown component and presents sources as a tree-like grouped
menu.

Current behavior:

- the closed trigger shows only the selected leaf label
- grouped rows are rendered with CSS-drawn connectors
- there is no auto-selection of the first source
- the user must explicitly choose a source before logs load

### Fetch and refresh behavior

Current fetch behavior:

- one source at a time
- default tail fetch is bounded to the most recent `256 KB`
- oversized responses are truncated client-side and marked as truncated
- the view shows a truncation notice when only the recent tail is displayed

Current refresh behavior:

- no dedicated refresh button
- refresh is driven by the existing auto-refresh control
- append-style refresh uses `sinceTime`
- a small overlap window is applied and duplicate boundary lines are deduped
- if incremental refresh fails or becomes unsafe, the viewer falls back to a full tail reload

### Source switching behavior

When the selected source changes:

- current content is cleared immediately
- the viewer shows `Loading logs…`
- the previous source’s output is not kept on screen

### Scroll behavior

Node logs intentionally matches container logs behavior:

- default to the newest visible content
- preserve scroll position on remount
- only auto-follow if the user was already at the bottom
- keep current content mounted during same-source refreshes so scroll position is not reset

### Viewer features reused from container logs

The node log viewer reuses the shared logs viewer interface patterns where possible:

- text filter
- highlight
- invert filter
- case-sensitive search
- regex search
- auto-refresh
- wrap toggle
- ANSI color toggle
- copy
- pretty JSON mode
- parsed JSON table mode

Parsed-table behavior also matches container logs for:

- row expansion/collapse
- truncation behavior
- column sizing path

## Supported configurations

The current implementation works best when:

- `/api/v1/nodes/<node>/proxy/logs/` is reachable
- the endpoint exposes at least one directly readable text source
- useful sources are discoverable either as browsed text leaves or as successful service queries

It supports:

- nested directory trees such as `journal/...`
- best-effort append refresh for both service-backed and file-backed sources
- provider-specific file trees, as long as they ultimately expose readable text leaves

## Unsupported or intentionally hidden configurations

The current implementation does not surface:

- forbidden or unsupported node log endpoints
- directory-only trees with no readable leaves
- binary/compressed leaves
- `pods/...` and `containers/...`
- non-Kubernetes access paths such as SSH

Also note:

- the node log query API is snapshot-based, not stream-based
- append refresh is best-effort, not equivalent to container logs follow streaming

## Notable maintenance gotchas

### 1. Empty directory listings

Some node log paths return an empty HTML listing like:

```html
<!doctype html>
<pre>
</pre>
```

Those are directories, not text logs. Earlier versions of the code misclassified them as text
because there were no `<a href>` entries. The current implementation treats them as directories and
does not surface them as selectable sources.

### 2. `tailLines` is not safe for path-backed discovery

Some clusters reject `tailLines` on browsed node-log paths even when the plain path works. Because
of that:

- discovery does not use `tailLines` for path-backed probes
- classification uses a streamed client-side sample from the plain path instead

### 3. Service queries are cluster-specific

`?query=kubelet` and similar queries are not consistently supported across clusters. Do not assume
that a service query will work just because a node exposes `journal/`.

### 4. Shared logs styling still applies

The node log viewer intentionally reuses the shared logs UI. That means some visual behavior is
still inherited from the shared logs styles unless explicitly overridden in `NodeLogsTab.css`.
