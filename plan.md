# Multi-cluster support plan

## Decisions

- Support simultaneous connections to multiple clusters; UI is single-cluster per tab (no cross-cluster aggregation in views).
- Kubeconfig selection becomes multi-select and is sourced from kubeconfig contexts.
- `clusterId` is `filename:context`; `clusterName` is `context`; refresh scopes/keys are `clusterId|<scope>`.
- Duplicate context names may exist, but only one can be active; disable duplicates with tooltip: "`context` is already active. Duplicate context names are not allowed."
- Namespace selection, view state, and object panel state are per-tab (per cluster).
- Keep namespace selection in the frontend (do not add it to catalog snapshots).
- Cluster tabs replace the cluster columns/filters; remove all cluster column/filter UI and persistence.
- Cluster tabs are hidden unless multiple clusters are open; initial order follows kubeconfig selection order, but manual drag order persists across restarts (closed tabs reset to selection order when reopened).
- Refresh is per-tab by default; add a settings toggle to refresh background tabs when enabled.
- Background refresh defaults to enabled on startup; skip forced manual refreshes on cluster tab switches when background refresh has multi-cluster scope.
- Use a single refresh orchestrator; scope refresh context to the active tab by default.
- Logs/diagnostics/modals remain outside tab context; each tab has its own sidebar, main content, and object panel.
- No primary cluster concept; selection is a set and all backend/frontend flows must avoid primary/first-cluster assumptions.
- Prefer `clusterId` everywhere (object identity, request payloads, test data); missing `clusterId` is legacy single-cluster only.
- Always include `clusterId` on `openWithObject` payloads; do not rely on fallback selection.
- Command palette kubeconfig actions only open/switch tabs (no close/deselect from the palette).
- Do not add new dependencies for drag-and-drop.
- Treat multi-select add/remove as a lightweight selection change; only emit `kubeconfig:changing` when the selection becomes empty, and only emit `kubeconfig:changed` when at least one cluster is active after an empty selection.

## Current status

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend (Phase 1 complete).
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots; scope encoding fixed.
3. ✅ Namespace selection is cluster-scoped in refresh context; sidebar renders catalog namespace groups and passes cluster ID.
4. ✅ Cluster-scoped GridTable row keys applied across cluster/namespace views; `NsViewPods` test data now includes cluster metadata.
5. ✅ Backend aggregation rules updated so explicit cluster-scoped single-cluster domain requests can target non-active clusters.
6. ✅ Background refresh setting + persistence added; refresh context fan-out now gated by the toggle.
7. ✅ Cluster tabs state + row rendering done (drag reorder + close + persistence).
8. ✅ Per-tab sidebar/object panel/navigation/namespace state wiring complete.
9. ✅ Per-tab refresh scopes updated so non-active tabs refresh correctly on tab switch.

## Implementation steps (ordered)

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend.
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots.
3. ✅ Namespace selection cluster-scoped in refresh context + sidebar group rendering.
4. ✅ Finish refresh fan-out + snapshot merge for all domains; keep per-cluster permission/diagnostic isolation.
5. ✅ Accept selected cluster sets in manual refresh endpoints + streaming handlers; merge multi-cluster stream events.
6. ✅ Implement kubeconfig multi-select UI + selected cluster list handling; use the active tab as the single-cluster selection for current consumers; disable duplicate context names with tooltip.
7. ✅ Frontend: pass selected cluster sets through refresh orchestrator; manage per-cluster streams.
8. ✅ Fix scoped domain normalization regression in refresh orchestrator (TypeScript error cleanup).
9. ✅ Add Cluster column + Clusters filter in GridTable and persist filter state with cluster IDs (superseded; will be removed per cluster tabs).
10. ✅ Expand backend + frontend tests for multi-select, fan-out, stream merge, and diagnostics; confirm >=80% coverage or note gaps.
11. ✅ Fix remaining TypeScript errors from cluster filter wiring (superseded; will be removed per cluster tabs).
12. ✅ Run frontend typecheck/tests to validate cluster filter wiring changes (superseded; will be removed per cluster tabs).
13. ✅ Add targeted frontend tests to raise coverage to >=80% for cluster/namespace views + refresh UI (include RefreshManager cluster-switch/manual-refresh coverage).
14. ✅ Add additional frontend coverage for multi-cluster refresh/scoping edge cases (background refresh toggle, cluster selection changes, namespace selection persistence).
    - ✅ Fix Vitest hoisting in `KubeconfigContext` tests by moving refresh mocks into `vi.hoisted`.
    - ✅ Add hook tests for `useBackgroundRefresh` (localStorage default, eventBus sync).
    - ✅ Add cluster/namespace view tests that exercise object navigation payloads (ClusterViewNodes, NsViewWorkloads).
    - ✅ Add RefreshManager test coverage for cluster-selection manual refresh targeting.
    - ✅ Add namespace selection loading/persistence coverage for multi-cluster tabs.
15. ✅ Make backend coverage runnable in the sandbox (covdata/toolchain + cache path workaround) and re-run `go test` with coverage.
16. ✅ Diagnose and fix non-active tabs still showing active data (ensure per-tab refresh scopes and UI scoping).
17. ✅ Update backend aggregation rules so explicit cluster-scoped requests can target non-active clusters for single-cluster domains (catalog/object/\*/node-maintenance).
18. ✅ Introduce cluster tabs state + persistence (open clusters, active tab, order) and wire it to kubeconfig selections; reconcile order by applying persisted drag order when available and falling back to current selection order for new/reopened tabs.
19. ✅ Render cluster tabs row in layout, draggable ordering (no new deps), close button, hidden when <2 tabs.
20. ✅ Make view state per tab by storing tab-scoped state keyed by active cluster in Sidebar/ObjectPanel/Navigation/Namespace contexts and switching to the active tab’s state on change.
21. ✅ Remove cluster columns/filters and related persistence/tests from all views and shared GridTable wiring.
22. ✅ Add settings toggle in Auto-Refresh for "Refresh background clusters" (default on), persist in frontend storage, and hydrate on startup to drive refresh context defaults.
23. ✅ Update refresh context to follow active tab cluster ID; only fan-out when background refresh toggle is enabled.
24. ✅ Add/adjust tests for tabs, per-tab state, and cleanup on tab close; re-evaluate coverage notes.
25. ✅ Verify multi-cluster UI: open/close tabs, reorder, per-tab namespace, object panel, and views show only active cluster data.
26. ✅ Resolve hook dependency lint errors from per-tab state wiring.
27. ✅ Fix object panel tests by handling missing `selectedClusterIds` defaults in context mocks.
28. ✅ Prevent ObjectPanelStateContext from re-running selection pruning when kubeconfig mocks omit `selectedClusterIds`.
29. ✅ Scope sidebar namespaces to the active cluster (filter catalog namespace groups + namespace refresh data) and add coverage.
30. ✅ Update namespace context tests to include multi-cluster payloads after active-cluster filtering.
31. ✅ Prevent namespace selection updates from running against stale cluster namespace lists.
32. ✅ Format header title as "cluster-name - namespace (if applicable) - view-name".
33. ✅ Update kubeconfig dropdown placeholder text to "Select Kubeconfig".
34. ✅ Keep kubeconfig dropdown label fixed to "Select Kubeconfig" regardless of selection.
35. ✅ Replace kubeconfig dropdown selected highlight with checkmark to match other multi-selects.
36. ✅ Fix kubeconfig dropdown renderOption signature to pass selection state for checkmarks.
37. ✅ Restrict kubeconfig hover highlight to context line only (no full-row highlight).
38. ✅ Expand cluster tabs to fit full cluster names (remove truncation/max widths).
39. ✅ Ensure unscoped refresh domains include active cluster scope so same-view tab switches refresh correctly.
40. ✅ Fix unused renderSelectedValue parameter in kubeconfig dropdown.
41. ✅ Scope cluster/namespace/browse view data to the active cluster to prevent cross-tab data bleed; update tests as needed.
42. ✅ Default background refresh to enabled and skip manual refresh on cluster tab switches when multi-cluster background refresh is active.
43. ✅ Avoid clearing cluster domain data when permissions are pending so background-refreshed data stays visible on tab switches.
44. ✅ Guard SidebarStateContext Wails calls so tests don't invoke `window.go`; remove the global App mock that caused hangs.
45. ✅ Trigger a manual refresh for the active cluster view when the selected cluster list changes to preload new tabs.
46. ✅ Remove permission-pending gating so cluster views load without waiting on capability checks.
47. ✅ Add per-cluster metrics metadata for nodes/overview snapshots and use it in the UI to avoid cross-cluster metrics bleed.
48. ✅ Add per-cluster overview payloads and render cluster overview by active tab instead of merged totals.
49. ✅ Scope cluster-overview refresh to the active tab only and suppress refresh requests for closed tabs to avoid "cluster not active" errors.
50. ✅ Cancel/ignore in-flight refreshes tied to removed clusters so tab closes don't surface "cluster not active" errors.
51. ✅ Only emit `kubeconfig:changing` when the selection becomes empty, and only emit `kubeconfig:changed` when at least one cluster is active after an empty selection.
52. ✅ Update ClusterOverview tests to mock kubeconfig context now that the component reads the active cluster.
53. ✅ Handle refresh subsystem rebuilds on multi-select changes by invalidating the refresh base URL and retrying network failures with short backoff (no domain resets).
54. ✅ Add a lightweight "selection changed" signal to invalidate refresh base URL, bump refresh context version, and suppress transient network errors while the backend rebuilds refresh endpoints.
55. ✅ Also suppress transient network errors after `kubeconfig:changed` to cover transitions from zero to active clusters.
56. ✅ Emit the selection-change signal before optimistic selection updates so refreshes re-resolve the base URL before new fetches fire.
57. ✅ Update cluster tab styling to read as conventional tabs (active tab visually connected to content row).
58. ✅ Remove the blue outline/box-shadow from the active cluster tab while keeping the active tab distinction.
59. ✅ Remove the accent border from the active cluster tab while keeping the active tab distinction.
60. ✅ Add a Cmd/Ctrl+W shortcut to close the active cluster tab.
61. ✅ Scope catalog snapshot requests (Browse + Namespace Objects) to the active cluster to avoid single-cluster domain errors.
62. ✅ Batch capability checks into smaller EvaluateCapabilities calls to avoid Wails callback dropouts; add/adjust store tests.
63. ✅ Fix refresh diagnostics and browse view test regressions triggered by recent mocks and batching changes.
64. ✅ Resolve DiagnosticsPanel mock hoisting errors by hoisting mock factories.
65. ✅ Fix refresh manager mock for DiagnosticsPanel tests (missing subscribe).
66. ✅ Add missing refresh manager APIs in DiagnosticsPanel test mock.
67. ✅ Prevent dockable panels (object panel) from overlapping the cluster tabs row by enforcing a dynamic top offset.
68. ✅ Adjust kubeconfig dropdown width: compact trigger, expanded menu fits content with right-edge alignment.
69. ✅ Fix object panel open flow to avoid "object is no longer available" errors when selecting items.
70. ✅ Remove all primary-cluster assumptions across backend + frontend (refresh aggregates, kubeconfig selection storage, catalog/streams) and replace with multi-cluster selection semantics.
71. ✅ Update NsViewPods tests to assert cluster metadata is passed when opening the object panel.
72. ✅ Update command palette kubeconfig entries to toggle selections and show checkmarks for active clusters.
73. ✅ Reduce command palette kubeconfig checkmark size to match standard item height.
74. ✅ Align command palette kubeconfig checkmark in the left gutter without shifting item labels.
75. ✅ Change command palette kubeconfig action to open the tab if closed or switch to it when already open (no deselect).
76. ✅ Prefix command palette catalog search scopes with the active cluster ID to avoid unscoped catalog errors.
77. ✅ Re-audit for remaining single-cluster assumptions (unscoped catalog/object fetches, refresh scopes, and cluster metadata propagation); list findings and fix any gaps.
78. ✅ Add a command palette action to close the current cluster tab.
79. ✅ Show the Cmd/Ctrl+W shortcut on the command palette "Close Current Cluster Tab" item.
80. ✅ Add Cmd/Ctrl+Alt+Arrow shortcuts to switch cluster tabs left/right.
81. ✅ Center the header title text (cluster - namespace - view).
82. ✅ Center the header title between the right edge of app-header-left and the left edge of app-header-controls.
83. ✅ Update header title format to "Cluster: name • Namespace: name • View: name" with label/value colors.
81. ✅ Rework namespace loading per active cluster so the "All namespaces" synthetic only appears after that cluster's namespace data arrives (including newly opened tabs).
82. ✅ Stop auto-selecting namespaces on tab open; clear invalid selections and only select on explicit user action.
83. ✅ Document the "no auto-selection" behavior in NamespaceContext.
84. ✅ Reset cluster overview display on tab switch so new tabs show loading shimmers instead of cached data.
85. ✅ Gate ClusterOverview fallback data by cluster ID so cached single-cluster payloads cannot render on a different tab.
86. ✅ Toggle namespace expand/collapse on click without selecting a namespace or view (including All Namespaces).
87. ✅ Fix Sidebar.test.tsx expectations to match namespace expand/collapse and loading behavior.
88. ✅ Add an auto-dismiss progress bar to error toasts with theme tokens for track/fill colors and duration.
89. ✅ Flip the toast auto-dismiss progress animation to shrink left-to-right.
90. ✅ Fix object-detail fetches in multi-cluster by routing backend detail calls through per-cluster clients using the request cluster context.
91. ✅ Audit remaining legacy single-cluster entry points that could be used in multi-cluster flows; list candidates and risks.
92. ✅ Add cluster-aware Wails RPCs for object YAML fetch/mutations; route backend handlers through `resourceDependenciesForClusterID` and return a clear error when the cluster is not active.
93. ✅ Add cluster-aware Wails RPCs for object panel actions (delete/restart/scale/helm delete), node maintenance, pod logs/containers, and shell sessions; use per-cluster dependencies.
94. ✅ Update frontend callers to pass the active tab `clusterId` for YAML, object panel actions, logs/shell, node maintenance, and delete flows; update any helpers that build requests.
95. ✅ Update capability checks to be cluster-aware end-to-end (frontend descriptors + backend GVR resolution via cluster-scoped deps).
96. ✅ Update Wails JS bindings/mocks/types and adjust tests for the new cluster-aware RPC signatures; add coverage where gaps remain.
97. ✅ Update namespace view data models to include cluster metadata where delete actions rely on it (Autoscaling + Custom views).
98. ✅ Audit remaining frontend/backend callsites for cluster-aware RPC signatures and fix any missed tests or mocks.
99. ✅ Fix YAML mutation GVR fallback to use cluster-scoped selection keys and dependency logger (compile error cleanup).
100. ✅ Fix remaining backend wrapper tests to pass cluster ID for node force-delete signatures.
101. ✅ Fix failing LogViewer tests for cluster-aware log/container calls.
102. ✅ Fix failing ObjectPanel tests after cluster-aware RPC changes.
103. ✅ Re-audit for legacy single-cluster entry points and remaining assumptions.
104. ✅ Pass `clusterId` into all `openWithObject` calls from catalog/browse/command palette and namespace/cluster views to keep object panel requests scoped to the originating tab.
105. ✅ Pass `clusterId` through object panel detail overviews (endpoints/policy/workload) when navigating to related objects.
106. ✅ Update/extend frontend tests to cover cluster-aware `openWithObject` payloads for catalog, namespace, cluster, and overview navigation flows.
107. ✅ Run a full single-cluster assumption audit (backend RPCs, refresh scopes, navigation paths, payload types) and list any remaining gaps.
108. ✅ Apply remaining `openWithObject` clusterId plumbing and update tests (steps 97-99).
109. ✅ Confirm whether `openWithObject` should rely on active tab cluster fallback when callsites omit cluster metadata, or require explicit cluster IDs in all callsites. (Decision: always include `clusterId`.)

## Risks / watchouts

- Fan-out refresh load and timeouts per cluster; may need concurrency limits.
- Stream merge ordering/volume; consider backpressure and per-cluster throttling.
- Single-cluster domain restrictions (catalog/object) must allow explicit cluster-scoped requests to avoid blocking non-active tabs.

## Planning notes (post-mortem)

- Missed: object detail provider still routed through single-cluster App getters. Action: audit remaining legacy single-cluster entry points and ensure they use cluster-scoped dependencies.

## Audit findings (legacy single-cluster entry points)

- Resolved: YAML fetch/mutation, object panel actions, node maintenance, logs/shell, generic deletes, and capability checks are now cluster-aware (see steps 85-95).
- Resolved: `openWithObject` callsites now include `clusterId` across catalog/browse/command palette, namespace/cluster views, and object panel overview navigation; tests updated accordingly.
- Remaining backend fallback behavior: single-cluster RPC getters in `backend/resources_*.go` and `backend/object_detail_provider.go` still use `a.resourceDependencies()` when cluster meta is missing, so unscoped requests will hit the base selection.

## Multi-cluster selection note

- The backend base selection is set once in `backend/kubeconfigs.go` (`SetSelectedKubeconfigs`), and `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx` `setActiveKubeconfig` only updates frontend state. Any Wails RPC calls that still use base selection can execute against the wrong cluster tab.

## Coverage notes

- Added tests for ClusterTabs and per-tab sidebar state; coverage has not been remeasured yet, so remaining gaps are unknown.
- Added ObjectPanelStateContext + NamespaceContext per-tab selection tests; coverage still needs remeasurement.
- Backend coverage is now runnable via `build/go-tools` + `build/gocache` (local covdata toolchain); current `go test ./backend -cover` reports 74.4% coverage, so hitting 80% would require more tests in lower-coverage backend areas.

## Multi-Cluster Select

Possible conditions:

- No clusters are active
  - Disable the sidebar and main content area of the app until a cluster is selected. Do not attempt to load data or show loading spinners if no cluster is selected. Kubeconfig dropdown, command palette, settings modal, about modal, and application logs work as expected.
  - Clear all snapshot state and stop all refresh/streams.
- A single cluster is active
  - App behaves normally for a single cluster
  - Cluster tab area is not visible
- Multiple clusters are selected
  - App behaves normally for multiple clusters
  - Cluster tab area is visible

Possible cluster activation methods:

- Cluster(s) activated on startup due to persistence
- Cluster selected from the kubeconfig dropdown
- Cluster selected from the Command Palette

Possible cluster activation conditions:

- A cluster is activated when no clusters are active
  - Enable the cluster. Reactivate the sidebar and main content areas.
- A cluster is activated when one or more clusters are already active
  - App works as described in "Possible conditions"

Possible cluster deactivation methods:

- Cluster is de-selected from the kubeconfig dropdown
- Cluster is de-selected from the Command Palette
- Cluster is deactivated by clicking the close button on the tab

Possible cluster deactivation conditions:

- Cluster is the last remaining active cluster
  - Follow the instruction for "No clusters are active"
- Other clusters remain active after this cluster is closed
  - App works as described in "Possible conditions"

## Cluster Tabs

The current app layout is:

```
|----------------------------|
| app-header                 |
|----------------------------|
| sidebar   |   content      |
|           |                |
|----------------------------|
```

Let's add another row for cluster-tabs:

```
|----------------------------|
| app-header                 |
|----------------------------|
| cluster-tabs               |
|----------------------------|
| sidebar   |   content      |
|           |                |
|----------------------------|
```

### Cluster tabs behavior

Switching to cluster tabs means that we no longer need to show the Cluster columns in any views as we will only allow one cluster per tab, so remove all of that.

- `cluster-tabs` div should be hidden unless multiple clusters are open.
- Tab should be created when the user selects the cluster in the kubeconfig dropdown
- Tab should be destroyed when the user deselects the cluster in the kubeconfig dropdown
- Tab should have a close button. Click the close button closes the tab and deselects the cluster in the kubeconfig dropdown
- When a tab is closed, handle all the usual cleanup/deregistration tasks for that cluster
- Tabs should be draggable to change their order
- You may create a new cluster-tab css style for cluster tabs
