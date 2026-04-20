# TODO

## Large Cluster Support Review Findings

### Review #1

Critical bugs missed (confirmed by reading the source)

1. eventStreamManager.ts:451 — payload.reset branch is a no-op.
   payload.reset ? this.clusterEvents : this.clusterEvents — both arms identical. Should be payload.reset ? [] : this.clusterEvents. Server-driven event resets never clear stale entries; list grows instead of replacing on reconnect / backend restart.
2. resourceStreamManager.ts:935 — dangerous clusterId fallback in mergeClusterRows.
   (row.clusterId ?? targetCluster).trim() then compared against targetCluster → rows with missing clusterId are always filtered out, regardless of which cluster's payload is arriving. Violates the AGENTS.md critical rule. Use row.clusterId?.trim() ?? '' !== targetCluster.
3. backend/refresh/snapshot/merge.go:486 — cluster overview merge loses truncation/warning stats.
   mergedStats := refresh.SnapshotStats{ItemCount: overview.TotalNodes} bypasses mergeListStats, so Truncated / Warnings from individual cluster shards are silently dropped and ItemCount is semantically node-count, not row-count. Exactly the kind of signal you need at 25k+ rows.

Important gaps

4. Kind filter in ClusterViewCustom / NsViewCustom still derives from loaded rows (useKindFilterOptions(data)), not catalog metadata — violates the metadata-sourcing rule in large-data-architecture.md. The comment in useKindFilterOptions.ts acknowledges this; needs a catalog-backed path.
5. gridTablePerformanceStore never prunes per-label entries. Module-level entries Map grows across navigations; only full reset wipes it. Long sessions accumulate stale labels in every snapshot rebuild.
6. eventObjectIdentity.buildEventObjectReference returns undefined for CRD event targets when no objectApiVersion is present — a significant fraction of involvedObject links go dark in CRD-heavy clusters.

Lower-priority

- Several typed keyExtractors (ClusterViewConfig/RBAC, NsViewConfig/Workloads) omit explicit group/version, relying on resolveBuiltinGroupVersion fallback — works for built-ins but is inconsistent with BrowseView / \*Custom which thread them explicitly.
- GetZoomLevel/SetZoomLevel in app_settings.go skip settingsMu while other setters hold it — pre-existing but now sharing file I/O with the new MaxTableRows path.
- Metrics/overview fallback branches in merge.go silently drop payloads when both MetricsByCluster and ClusterID are empty (possible during mid-initialization).

Recommendation

Fix #1, #2, #3 before merging — they're small, high-impact, and mechanical. #4–#6 can be addressed in a follow-up phase but should be tracked.

### Review #2

1. High: The new maxTableRows cap breaks correctness for locally filtered tables because rows are truncated before the built-in search/kind/namespace filters run. GridTable now slices inputData to maxTableRows first, and useGridTableFilters only searches that sliced subset, so anything beyond the first N rows becomes impossible to find with local search/filter even though the tooltip says narrowing can reveal it. This affects the non-query tables the branch is trying to help, such as Pods and Workloads. Refs: frontend/src/shared/components/tables/hooks/useGridTableController.tsx:212, frontend/src/shared/components/tables/hooks/useGridTableController.tsx:218, frontend/src/shared/components/tables/useGridTableFilters.ts:313, frontend/src/shared/components/tables/useGridTableFilters.ts:329.
2. High: The row cap does not actually bound the expensive work for most views, so “large cluster support” is still incomplete. Most screens still call useTableSort(data, ...) on the full dataset before GridTable trims it, which means large refreshes still allocate and sort all rows on every update; only the final rendered subset is smaller. That improves paint pressure, but not the upstream refresh/sort CPU and memory cost that usually hurts first at cluster scale. Refs: frontend/src/hooks/useTableSort.ts:120, frontend/src/hooks/useTableSort.ts:153, frontend/src/shared/components/tables/hooks/useGridTableController.tsx:214, frontend/src/modules/namespace/components/NsViewPods.tsx:408, frontend/src/modules/namespace/components/NsViewWorkloads.tsx:202.
3. Medium: The object-panel guardrail test was weakened enough that it can pass vacuously. The audit used to prove it was inspecting real literal object refs; now it only proves that some openWithObject( or ObjectPanelLink text exists somewhere in production sources, which does not guarantee the AST walkers still see any literal refs to validate. That reduces protection around the exact GVK/cluster identity migration this branch is making. Refs: frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts:285, frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts:298, frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts:311, frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts:323.

Assessment

The branch is directionally better. The identity work is an improvement, the stable-reference work should reduce rerender churn, and the diagnostics added here make future
profiling easier. But I would not call the large-cluster work complete yet because the new cap currently trades correctness away on local tables and leaves a lot of the expensive
upstream work untouched.

## Issues

- Issue 40 Support object creation

- Issue 135 Enable text select/copy in more places

- Issue 113 Add support for Gateway API

## Feature Ideas

- Object relationships map
- Traffic flow map

- Gridtable improvements
- Allow column order change via drag
  - should reset button also reset to default column order?
    - probably not because that reset is for filters
- Pods view, change default column order to Name, Owner, Namespace

- Transfer files to/from pods
- Select container
- can we show a file dialog for the remote filesystem?

- More deployment options
- Container scope:
  - set image
    - show a list of containers and their images, allow override
  - update resource requests/limits

- Metrics over time
- Graphs instead of only point-in-time numbers
- No persistence, just show metrics for the current view, drop them when the view changes

- Helm install/upgrade/delete
- track deployments, offer rollbacks?

- Multi-select/batch operations
- Allow batch operations, but could be dangerous

## Wails v3 (when ready)

- Multiple windows
- Object Panel, logs, diagnostics in its own window

- Automatic app updates
