# Multi-cluster support

This document captures the multi-cluster decisions, rules, and constraints that must be preserved in future work.

## Goals

- Support simultaneous connections to multiple clusters.
- Keep the UI single-cluster per tab (no cross-cluster aggregation in views).
- Ensure object identities and refresh scopes are cluster-aware everywhere.

## Core decisions

- A single refresh orchestrator is used; refresh scope is driven by the active tab.
- No "primary cluster" concept; selection is a set and must not assume a first cluster.
- `clusterId` is `filename:context`; `clusterName` is `context`.
- Refresh scopes and keys are `clusterId|<scope>` (multi-cluster: `clusters=id1,id2|<scope>`).
- Duplicate context names may exist, but only one can be active at a time.
- Namespace selection stays in the frontend; do not add it to catalog snapshots.
- Backend APIs that fetch or mutate resources must require an explicit `clusterId`; no implicit fallback.

## Cluster selection rules

- Kubeconfig selection is multi-select, sourced from kubeconfig contexts.
- Cluster activation can come from:
  - Startup persistence
  - Kubeconfig dropdown
  - Command palette
- Cluster deactivation can come from:
  - Kubeconfig dropdown
  - Cluster tab close button
  - `ctrl+w/cmd+w` key command

### Selection events

- `kubeconfig:changing` only fires when the selection becomes empty.
- `kubeconfig:changed` only fires when at least one cluster becomes active after empty.
- `kubeconfig:selection-changed` is the lightweight signal for add/remove while non-empty.

### No clusters active

- Disable sidebar and main content (no data loading or spinners).
- Show an overlay message in the main layout: "No active clusters. Select a cluster from the kubeconfig dropdown."
- Set the header title to "No Active Clusters".
- Clear snapshot state and stop all refresh/streams.
- Kubeconfig dropdown, command palette, settings/about, and logs still work.
- Do not auto-select a default kubeconfig or context; activation only happens through explicit user action or persisted selections.

## Cluster tabs

- Tabs appear only when two or more clusters are open.
- Tabs are created when a cluster is selected and removed when it is deselected.
- Tabs are draggable; use native drag-and-drop (no new deps).
- Closing a tab deselects the cluster and triggers cleanup.

### Ordering

- Initial order follows kubeconfig selection order.
- Drag order persists across restarts.
- Closed tabs lose their position; reopening follows selection order.

## Per-tab UI state

- Each tab has its own view state, sidebar, and object panel state.
- Views only show data for the active tab cluster.
- Object panel actions must always be scoped to the originating cluster.

## Namespace behavior

- Namespaces are scoped to the active cluster tab.
- The synthetic "All Namespaces" entry appears only after that cluster’s namespace
  data is available.
- Do not auto-select a namespace on tab open; selection is only on explicit user action.
- Clicking a namespace toggles expand/collapse; it does not select a view.

## Refresh behavior

- Per-tab refresh is the default.
- Background refresh toggle exists and defaults to enabled.
- When background refresh is enabled, skip forced manual refresh on tab switches because all tabs are already refreshed.

### Domain scoping

- Unscoped domains are still cluster-prefixed to avoid cross-tab data bleed.
- `cluster-overview` is scoped to the active tab cluster only.
- Catalog and namespace browse are scoped to the active cluster.

## Object catalog

- The object catalog is the source of truth for cluster/namespace listings.
- Use catalog namespace groups in sidebar rendering.

## Command palette behavior

- Kubeconfig items open a cluster tab if closed, or switch to it if already open.
- Kubeconfig items show a checkmark when active; no close/deselect from command palette.
- "Close Current Cluster Tab" command exists and shows Cmd/Ctrl+W shortcut.

## Kubeconfig dropdown behavior

- Dropdown label is always "Select Kubeconfig".
- Selected clusters show a checkmark (no blue highlight).
- The trigger width fits the label; the expanded menu fits content and right-aligns.

## Error handling and transitions

- Refresh base URL may change when the backend rebuilds the refresh subsystem.
- Frontend invalidates the base URL and suppresses transient network errors during selection transitions.
- In-flight refreshes tied to removed clusters must be ignored or canceled.
- Missing cluster scope is a hard error (HTTP 400) for refresh/manual/stream endpoints; no legacy fallback.

## Risks

- Refresh fan-out can increase load per cluster; watch for timeouts.
- Stream merge volume/order can create backpressure; throttle if needed.
- Single-cluster domain restrictions must allow explicit cluster scopes.

## Backend scope requirements

- Resource/detail/YAML/Helm endpoints require `clusterId`; reject empty scope early.
- Response cache keys must be scoped by `clusterId` to prevent cross-cluster reuse.
