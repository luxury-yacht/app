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
6. Implement kubeconfig multi-select UI + selected cluster list handling; disable duplicate context names with tooltip.
7. Frontend: pass selected cluster sets through refresh orchestrator; manage per-cluster streams.
8. Add Cluster column + Clusters filter in GridTable and persist filter state with cluster IDs.
9. Expand backend + frontend tests for multi-select, fan-out, stream merge, and diagnostics; confirm >=80% coverage or note gaps.

## Risks / watchouts

- Fan-out refresh load and timeouts per cluster; may need concurrency limits.
- Stream merge ordering/volume; consider backpressure and per-cluster throttling.
- GridTable filter/persistence schema changes for cluster-aware state.
