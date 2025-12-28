# Multi-cluster support plan

## Decisions

- Support simultaneous connections to multiple clusters; aggregate resources across clusters.
- Kubeconfig selection becomes multi-select and is sourced from kubeconfig contexts.
- `clusterId` is `filename:context`; `clusterName` is `context`; refresh scopes/keys are `clusterId|<scope>`.
- Duplicate context names may exist, but only one can be active; disable duplicates with tooltip: "`context` is already active. Duplicate context names are not allowed."
- Namespace selection is global (one namespace total), session-only, and sets the cluster context for namespace refresh.
- Keep namespace selection in the frontend (do not add it to catalog snapshots).

## Current status

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend (Phase 1 complete).
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots; scope encoding fixed.
3. ✅ Namespace selection is cluster-scoped in refresh context; sidebar renders catalog namespace groups and passes cluster ID.

## Implementation steps (ordered)

1. ✅ Cluster-aware IDs/scopes/payloads across backend + frontend.
2. ✅ Per-cluster object catalog services + namespace groups in catalog snapshots.
3. ✅ Namespace selection cluster-scoped in refresh context + sidebar group rendering.
4. ✅ Finish refresh fan-out + snapshot merge for all domains; keep per-cluster permission/diagnostic isolation.
5. ✅ Accept selected cluster sets in manual refresh endpoints + streaming handlers; merge multi-cluster stream events.
6. ✅ Implement kubeconfig multi-select UI + selected cluster list handling; keep a primary selection for current consumers; disable duplicate context names with tooltip.
7. ✅ Frontend: pass selected cluster sets through refresh orchestrator; manage per-cluster streams.
8. ✅ Fix scoped domain normalization regression in refresh orchestrator (TypeScript error cleanup).
9. ✅ Add Cluster column + Clusters filter in GridTable and persist filter state with cluster IDs (wire columns/filters across views + update tests).
10. ✅ Expand backend + frontend tests for multi-select, fan-out, stream merge, and diagnostics; confirm >=80% coverage or note gaps.
11. ✅ Fix remaining TypeScript errors from cluster filter wiring (GridTable showClusterDropdown).
12. ✅ Run frontend typecheck/tests to validate cluster filter wiring changes.
13. ⏳ Add targeted frontend tests to raise coverage to >=80% for cluster/namespace views + refresh UI.
14. ✅ Make backend coverage runnable in the sandbox (covdata/toolchain + cache path workaround) and re-run `go test` with coverage.

## Risks / watchouts

- Fan-out refresh load and timeouts per cluster; may need concurrency limits.
- Stream merge ordering/volume; consider backpressure and per-cluster throttling.
- GridTable filter/persistence schema changes for cluster-aware state.

## Coverage notes

- Frontend coverage is still below 80% in multiple areas (cluster/namespace views and refresh/UI wiring); need guidance on which modules to prioritize for additional tests.
- Backend coverage is now runnable via `build/go-tools` + `build/gocache` (local covdata toolchain); current `go test ./backend -cover` reports 74.4% coverage, so hitting 80% would require more tests in lower-coverage backend areas.
