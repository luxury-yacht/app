# Node Logs Plan

## Overview

Add a `Node Logs` tab to the object panel for `Node` objects.

The tab should only appear when the selected cluster/node supports node log access through the
Kubernetes node proxy endpoint and the current user can use it. Unlike pod shell, this cannot be a
pure RBAC check: the app must also discover whether the endpoint is functional and which log
sources are available.

## Goals

- Only show `Node Logs` when the current node supports usable log access.
- Keep detection scoped to the node object panel, matching the current shell-tab pattern.
- Discover available node log sources before rendering the tab.
- Let the user choose one discovered source and then filter within that source.
- Keep all requests multi-cluster aware via `clusterId`.

## Non-Goals

- Do not build a universal node logging backend across all providers in v1.
- Do not aggregate multiple node log sources into one merged stream in v1.
- Do not add cluster-wide preflight checks outside the object panel in v1.
- Do not support non-Kubernetes fallback access methods such as SSH in v1.

## UX Summary

When a `Node` object panel opens:

1. Run node-log capability discovery for that node.
2. If discovery finds no usable sources, omit the `Node Logs` tab.
3. If discovery succeeds, show the `Node Logs` tab.
4. Inside the tab, show:
   - source selector
   - optional path/query metadata for the selected source
   - text filter for the displayed log content
   - raw log output

## Architecture

### 1. Capability Model

Extend the object panel capability flow with node-log discovery state.

Suggested frontend shape:

```ts
interface NodeLogSource {
  id: string;
  label: string;
  kind: 'journal' | 'path' | 'directory' | 'query';
  path?: string;
  query?: string;
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

### 3. Tab Gating

Follow the existing shell pattern:

- `ObjectPanel` mounts
- node-log capability discovery runs for `Node` objects
- `useObjectPanelTabs` includes `Node Logs` only when `hasNodeLogs` is true

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

- [ ] Define node-log discovery/fetch response types.
- [ ] Implement backend node log root probe per `clusterId` + node name.
- [ ] Normalize discovered entries into source records.
- [ ] Distinguish:
  - unsupported endpoint
  - forbidden access
  - empty/no usable sources
  - usable sources found
- [ ] Add backend tests for representative responses:
  - directory listing response
  - access denied
  - not found/unsupported
  - malformed response

### Phase 2: Frontend Capability Integration

- [ ] Extend object panel capability state with node-log discovery.
- [ ] Run discovery only for `Node` object panels.
- [ ] Keep the request keyed by `clusterId` + node identity.
- [ ] Add `hasNodeLogs` to computed capabilities.
- [ ] Add a capability reason for hidden/unsupported node logs.
- [ ] Ensure no node-log probes run for non-node panels.

### Phase 3: Object Panel Tab

- [ ] Add `Node Logs` tab definition.
- [ ] Gate it with `hasNodeLogs`.
- [ ] Keep it `Node`-only.
- [ ] Preserve the existing tab ordering conventions.
- [ ] Add tests proving the tab appears only after successful discovery.

### Phase 4: Node Logs Viewer

- [ ] Build a minimal node-log viewer component.
- [ ] Render discovered sources in a selector.
- [ ] Fetch logs for the selected source.
- [ ] Add client-side text filtering.
- [ ] Handle empty states and backend errors clearly.
- [ ] Reuse existing log viewer styling patterns where reasonable, without coupling node logs to
      pod/workload-specific assumptions.

### Phase 5: Hardening

- [ ] Cache discovery results per panel or per node identity to avoid duplicate probes.
- [ ] Define refresh behavior for discovery vs. log content fetch.
- [ ] Verify disabled tab behavior across cluster switches and panel remounts.
- [ ] Confirm no cluster-wide assumptions leak into node-specific discovery.
- [ ] Add documentation for supported and unsupported cluster configurations.

## Detection Rules

Recommended v1 rules:

- `403` / `401`: treat as unavailable due to access
- `404`: treat as unsupported
- `200` with no usable sources: treat as unavailable
- `200` with at least one usable source: treat as supported

Usable source rules should be conservative in v1:

- allow sources explicitly discovered from the endpoint
- do not invent provider-specific paths unless discovery confirms them

## Risks

- Managed clusters may expose the endpoint inconsistently.
- Some clusters may return HTML directory listings rather than structured data.
- Service-style queries such as `?query=kubelet` may work on some nodes and fail on others.
- RBAC success does not guarantee kubelet log query is enabled or useful.
- Provider-specific entries may need normalization without overfitting to one platform.

## Open Questions

- Should discovery happen once per node panel mount only, or be refreshable from the UI?
- Should directory entries like `pods/` and `containers/` be exposed directly in v1, or only
  sources that map cleanly to readable log content?
- Should the app expose raw discovered paths to the user, or only curated labels?
- Do we want a small “unsupported on this cluster” reason available in the node details view, or
  only implicit tab absence?

## Recommended First Slice

Ship the narrowest useful version first:

1. Discover root sources for a node.
2. Gate `Node Logs` tab on discovery success.
3. Support selecting one discovered source.
4. Display raw logs with text filtering.

That gets the core behavior into the app while keeping provider-specific edge cases contained.
