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
- Use a single refresh orchestrator; scope refresh context to the active tab by default.
- Logs/diagnostics/modals remain outside tab context; each tab has its own sidebar, main content, and object panel.
- Do not add new dependencies for drag-and-drop.

## Current status

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend (Phase 1 complete).
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots; scope encoding fixed.
3. ✅ Namespace selection is cluster-scoped in refresh context; sidebar renders catalog namespace groups and passes cluster ID.
4. ✅ Cluster-scoped GridTable row keys applied across cluster/namespace views; `NsViewPods` test data now includes cluster metadata.
5. ✅ Backend aggregation rules updated so explicit cluster-scoped single-cluster domain requests can target non-primary clusters.
6. ✅ Background refresh setting + persistence added; refresh context fan-out now gated by the toggle.
7. ✅ Cluster tabs state + row rendering done (drag reorder + close + persistence).
8. ✅ Per-tab sidebar/object panel/navigation/namespace state wiring complete.
9. ✅ Per-tab refresh scopes updated so non-primary tabs refresh correctly on tab switch.

## Implementation steps (ordered)

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend.
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots.
3. ✅ Namespace selection cluster-scoped in refresh context + sidebar group rendering.
4. ✅ Finish refresh fan-out + snapshot merge for all domains; keep per-cluster permission/diagnostic isolation.
5. ✅ Accept selected cluster sets in manual refresh endpoints + streaming handlers; merge multi-cluster stream events.
6. ✅ Implement kubeconfig multi-select UI + selected cluster list handling; keep a primary selection for current consumers; disable duplicate context names with tooltip.
7. ✅ Frontend: pass selected cluster sets through refresh orchestrator; manage per-cluster streams.
8. ✅ Fix scoped domain normalization regression in refresh orchestrator (TypeScript error cleanup).
9. ✅ Add Cluster column + Clusters filter in GridTable and persist filter state with cluster IDs (superseded; will be removed per cluster tabs).
10. ✅ Expand backend + frontend tests for multi-select, fan-out, stream merge, and diagnostics; confirm >=80% coverage or note gaps.
11. ✅ Fix remaining TypeScript errors from cluster filter wiring (superseded; will be removed per cluster tabs).
12. ✅ Run frontend typecheck/tests to validate cluster filter wiring changes (superseded; will be removed per cluster tabs).
13. ⏳ Add targeted frontend tests to raise coverage to >=80% for cluster/namespace views + refresh UI (include RefreshManager cluster-switch/manual-refresh coverage).
14. ✅ Make backend coverage runnable in the sandbox (covdata/toolchain + cache path workaround) and re-run `go test` with coverage.
15. ✅ Diagnose and fix non-primary tabs still showing primary data (ensure per-tab refresh scopes and UI scoping).
16. ✅ Update backend aggregation rules so explicit cluster-scoped requests can target non-primary clusters for single-cluster domains (catalog/object/*/node-maintenance).
17. ✅ Introduce cluster tabs state + persistence (open clusters, active tab, order) and wire it to kubeconfig selections; reconcile order by applying persisted drag order when available and falling back to current selection order for new/reopened tabs.
18. ✅ Render cluster tabs row in layout, draggable ordering (no new deps), close button, hidden when <2 tabs.
19. ✅ Make view state per tab by storing tab-scoped state keyed by active cluster in Sidebar/ObjectPanel/Navigation/Namespace contexts and switching to the active tab’s state on change.
20. ✅ Remove cluster columns/filters and related persistence/tests from all views and shared GridTable wiring.
21. ✅ Add settings toggle in Auto-Refresh for "Refresh background clusters" (default off), persist in frontend storage, and hydrate on startup to drive refresh context defaults.
22. ✅ Update refresh context to follow active tab cluster ID; only fan-out when background refresh toggle is enabled.
23. ✅ Add/adjust tests for tabs, per-tab state, and cleanup on tab close; re-evaluate coverage notes.
24. ⏳ Verify multi-cluster UI: open/close tabs, reorder, per-tab namespace, object panel, and views show only active cluster data.
25. ✅ Resolve hook dependency lint errors from per-tab state wiring.
26. ✅ Fix object panel tests by handling missing `selectedClusterIds` defaults in context mocks.
27. ✅ Prevent ObjectPanelStateContext from re-running selection pruning when kubeconfig mocks omit `selectedClusterIds`.
28. ✅ Scope sidebar namespaces to the active cluster (filter catalog namespace groups + namespace refresh data) and add coverage.
29. ✅ Update namespace context tests to include multi-cluster payloads after active-cluster filtering.
30. ✅ Prevent namespace selection updates from running against stale cluster namespace lists.
31. ✅ Format header title as "cluster-name - namespace (if applicable) - view-name".
32. ✅ Update kubeconfig dropdown placeholder text to "Select Kubeconfig".
33. ✅ Keep kubeconfig dropdown label fixed to "Select Kubeconfig" regardless of selection.
34. ✅ Replace kubeconfig dropdown selected highlight with checkmark to match other multi-selects.
35. ✅ Fix kubeconfig dropdown renderOption signature to pass selection state for checkmarks.
36. ✅ Restrict kubeconfig hover highlight to context line only (no full-row highlight).
37. ✅ Expand cluster tabs to fit full cluster names (remove truncation/max widths).
38. ✅ Ensure unscoped refresh domains include active cluster scope so same-view tab switches refresh correctly.
39. ✅ Fix unused renderSelectedValue parameter in kubeconfig dropdown.

## Risks / watchouts

- Fan-out refresh load and timeouts per cluster; may need concurrency limits.
- Stream merge ordering/volume; consider backpressure and per-cluster throttling.
- Single-cluster domain restrictions (catalog/object) must allow explicit cluster-scoped requests to avoid blocking non-primary tabs.

## Coverage notes

- Added tests for ClusterTabs and per-tab sidebar state; coverage has not been remeasured yet, so remaining gaps are unknown.
- Added ObjectPanelStateContext + NamespaceContext per-tab selection tests; coverage still needs remeasurement.
- Backend coverage is now runnable via `build/go-tools` + `build/gocache` (local covdata toolchain); current `go test ./backend -cover` reports 74.4% coverage, so hitting 80% would require more tests in lower-coverage backend areas.

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

### Future Behavior -- may be implemented later

- User is able to load and save tab sets to quickly open a set of clusters
- Diff Objects modal
  - Select two items and diff their YAML
  - Objects can be from the same cluster or any other open cluster
