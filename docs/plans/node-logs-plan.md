# Node Logs Plan

## Overview

Use the existing `Logs` tab in the object panel for `Node` objects.

The tab should appear immediately for nodes, while node-log capability discovery runs in the
background. The view then shows either a loading message, usable node log sources, or an
unavailable/unsupported state for that specific node. Unlike pod shell, this cannot be a pure RBAC
check: the app must also discover whether the endpoint is functional and which log sources are
available.

## Goals

- Show the node `Logs` experience only within the node object panel.
- Keep detection scoped to the node object panel, matching the current shell-tab pattern.
- Discover available node log sources per node.
- Let the user choose one discovered source and then filter within that source.
- Reuse as much of the pod logs interface and behavior as possible.
- Keep all requests multi-cluster aware via `clusterId`.

## Non-Goals

- Do not build a universal node logging backend across all providers in v1.
- Do not aggregate multiple node log sources into one merged stream in v1.
- Do not add cluster-wide preflight checks outside the object panel in v1.
- Do not support non-Kubernetes fallback access methods such as SSH in v1.

## UX Summary

When a `Node` object panel opens:

1. Show the normal `Logs` tab immediately.
2. Run node-log capability discovery for that node.
3. While discovery is pending, show `Checking if logs are available for this node...`.
4. If discovery succeeds, render the node log viewer inside the `Logs` tab.
5. Inside the tab, show:
   - source selector
   - text filter for the displayed log content
   - pod-log-style controls and viewer behavior

## Architecture

### 1. Capability Model

Extend the object panel capability flow with node-log discovery state.

Suggested frontend shape:

```ts
interface NodeLogSource {
  id: string;
  label: string;
  kind: 'journal' | 'path' | 'service';
  path: string;
}

interface NodeLogsCapabilityState {
  allowed: boolean;
  pending: boolean;
  reason?: string;
  sources: NodeLogSource[];
}
```

Suggested computed capability:

```ts
hasNodeLogs: boolean;
```

`hasNodeLogs` should mean:

- the current user can access the node log endpoint, and
- discovery returned at least one usable source

### 2. Backend API

Add backend methods specifically for node-log discovery and fetch.

Suggested RPC surface:

- `DiscoverNodeLogs(clusterId, nodeName) -> NodeLogDiscoveryResponse`
- `FetchNodeLogs(clusterId, nodeName, source, filter options) -> NodeLogFetchResponse`

Suggested backend behavior:

- discovery first probes `/api/v1/nodes/<node>/proxy/logs/`
- parse the directory listing or structured response into normalized sources
- optionally probe known subpaths like `journal/`
- return normalized sources plus a reason when unsupported

Suggested future refresh behavior:

- keep node-log fetch refresh-based rather than stream-based
- use `sinceTime` for incremental refresh when possible, for both service-backed and file-backed
  node log sources
- append newly returned lines to the current view instead of replacing the whole buffer
- dedupe overlapping boundary lines because `sinceTime` is inclusive
- fall back to a full reload when the selected source changes, the response is inconsistent, or the
  app cannot safely determine the append boundary

### 3. Tab Gating

Follow the existing shell pattern:

- `ObjectPanel` mounts
- node-log capability discovery runs for `Node` objects
- the normal `Logs` tab is visible immediately for nodes
- node-specific log content is rendered only when discovery succeeds

Unlike shell:

- shell uses permission descriptors only
- node logs need an async functional probe

### 4. Tab UI

Initial UI should be deliberately simple:

- single-select source dropdown
- refresh button
- text filter
- raw log viewer

V1 should fetch one source at a time.

## Phases

### Phase 1: Backend Discovery

- ✅ Define node-log discovery/fetch response types.
- ✅ Implement backend node log root probe per `clusterId` + node name.
- ✅ Normalize discovered entries into source records.
- ✅ Distinguish:
  - unsupported endpoint
  - forbidden access
  - empty/no usable sources
  - usable sources found
- ✅ Add backend tests for representative responses:
  - directory listing response
  - access denied
  - not found/unsupported
  - malformed response
- ✅ Recurse through nested directory trees with bounded depth and node limits.
- ✅ Filter compressed/binary leaves from discovery and reject them on fetch.
- ✅ Drop `pods/...` and `containers/...` sources because those logs are already available elsewhere.
- ✅ Add well-known service-query probing support for `?query=<service>` sources.

### Phase 2: Frontend Capability Integration

- ✅ Extend object panel capability state with node-log discovery.
- ✅ Run discovery only for `Node` object panels.
- ✅ Keep the request keyed by `clusterId` + node identity.
- ✅ Add `hasNodeLogs` to computed capabilities.
- ✅ Add a capability reason for hidden/unsupported node logs.
- ✅ Ensure no node-log probes run for non-node panels.

### Phase 3: Object Panel Tab

- ✅ Reuse the existing `Logs` tab instead of adding a separate `Node Logs` tab.
- ✅ Keep it `Node`-only.
- ✅ Preserve the existing tab ordering conventions.
- ✅ Show the tab immediately for nodes while discovery is pending.
- ✅ Add tests proving the node logs view is wired into the `Logs` tab for nodes.

### Phase 4: Node Logs Viewer

- ✅ Build a node-log viewer component.
- ✅ Render discovered sources in a selector.
- ✅ Fetch logs for the selected source.
- ✅ Add client-side text filtering.
- ✅ Handle empty states and backend errors clearly.
- ✅ Reuse pod log viewer styling and controls where reasonable.
- ✅ Add bounded tail fetches so loading logs does not make the app unresponsive.
- ✅ Show truncation state when only the recent tail is displayed.
- ✅ Reuse pod-log icon bar features:
  - filter/highlight/invert/case/regex
  - auto-refresh
  - wrap toggle
  - ANSI color toggle
  - copy
- ✅ Reuse pod-log JSON display modes:
  - pretty JSON
  - parsed table
- ✅ Match pod-log parsed-table expansion/collapse behavior.
- ✅ Match pod-log default positioning:
  - default to newest visible content
  - preserve scroll position on remount
  - only auto-follow when already at the bottom
- ✅ Keep existing content mounted during refresh instead of resetting to a loading placeholder.
- ✅ Group the source selector into a tree-like dropdown with CSS-drawn connectors.
- ✅ Show only the selected leaf label in the closed dropdown trigger.

### Phase 5: Hardening

- ✅ Cache discovery results per panel or per node identity to avoid duplicate probes.
- ✅ Define refresh behavior for discovery vs. log content fetch.
- ✅ Add best-effort append-style refresh using `sinceTime`, with dedupe and fallback to full
      reload.
- ✅ Keep well-known service-query sources hidden unless `?query=<service>` is proven to return
      direct text during discovery.
- ✅ Verify disabled/unavailable node logs behavior across cluster switches and panel remounts.
- ✅ Confirm no cluster-wide assumptions leak into node-specific discovery.
- ✅ Add documentation for supported and unsupported cluster configurations.

## Detection Rules

Current rules:

- `403` / `401`: treat as unavailable due to access
- `404`: treat as unsupported
- `200` with no usable sources: treat as unavailable
- `200` with at least one usable source: treat as supported

Current usable-source rules are conservative:

- allow sources explicitly discovered from the endpoint
- allow well-known service-query sources only when `?query=<service>` returns direct text
- do not invent provider-specific paths unless discovery confirms them
- reject compressed/binary leaves
- reject `pods/...` and `containers/...` sources

## Risks

- Managed clusters may expose the endpoint inconsistently.
- Some clusters may return HTML directory listings rather than structured data.
- Service-style queries such as `?query=kubelet` may work on some nodes and fail on others.
- RBAC success does not guarantee kubelet log query is enabled or useful.
- Provider-specific entries may need normalization without overfitting to one platform.
- Node log query is snapshot-based rather than stream-based, so append-style refresh is only
  best-effort and may duplicate or miss boundary lines without careful handling.

## Decisions

- Discovery runs on node panel mount only in v1.
- Well-known service-query sources are shown only when discovery proves `?query=<service>` returns
  direct text.
- Unsupported/unavailable reasoning stays inside the node `Logs` tab state, not in node details.
- Discovery is cached per `clusterId + nodeName` in the frontend for the lifetime of the session.
- Content refresh applies only to the selected log source; discovery itself does not auto-refresh.
- Incremental refresh uses `sinceTime` with a small overlap window and line-based dedupe, and falls
  back to a full tail reload when the append path returns an error or a truncated response.

## Supported Configurations

- Clusters where `/api/v1/nodes/<node>/proxy/logs/` is reachable and returns at least one directly
  readable text source.
- Text sources discovered from browsable node log trees, including nested directories such as
  `journal/...`.
- Well-known service-query sources only when `?query=<service>` returns direct text for that node.
- Best-effort incremental refresh for both service-backed and file-backed sources, with fallback to
  a full tail reload when append semantics are not reliable.

## Unsupported Or Intentionally Hidden Configurations

- Clusters where the node log endpoint is forbidden or not supported.
- Nodes where discovery yields only directory listings, binary leaves, or compressed leaves.
- Binary and compressed sources such as `.journal`, `.gz`, `.tar`, `.zip`, `.bz2`, and `.xz`.
- `pods/...` and `containers/...` sources, because those logs are already available elsewhere in
  the app.
- Well-known service queries that fall back to directory listings or otherwise do not return direct
  text for that node.

## Recommended First Slice

Shipped core slice:

1. Discover root and nested sources for a node.
2. Use the existing node `Logs` tab with pending/supported/unavailable states.
3. Support selecting one discovered source.
4. Display bounded raw logs with filtering and pod-log-style controls.

That gets the core behavior into the app while keeping provider-specific edge cases contained.

## Future Enhancements

- Add a manual discovery refresh action if users need to rescan sources without reopening the panel.
- Persist node-log discovery cache more deliberately if session-lifetime caching proves too coarse.
- Improve non-blocking refresh failure UX so content can stay visible while refresh errors are
  surfaced separately.
- Retain a safe fallback to full reload when a source does not behave consistently enough for
  append-style refresh.
