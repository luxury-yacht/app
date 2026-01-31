# Multi-cluster isolation review findings
Date: 2026-01-31

## Potential single-cluster traces / isolation risks

1) Process-wide cluster meta fallback (backend)
- Files: `backend/refresh/snapshot/cluster_meta.go`, `backend/refresh/snapshot/service.go`
- `ClusterMetaFromContext()` falls back to a global `currentMetaState` when the request context is missing cluster meta.
- In multi-cluster mode, any code path that calls snapshot builders without a cluster-scoped context could emit payloads without a stable `clusterId` (or with whatever global value is set), which can lead to cross-cluster UI key collisions and incorrect attribution.
- Note: `snapshot.SetClusterMeta()` is currently unused, so the fallback is either empty or stale if introduced elsewhere.

2) Aggregate refresh mux uses a single cluster registry/telemetry (backend)
- Files: `backend/app_refresh_setup.go`
- The aggregate refresh mux chooses the *first available cluster*’s registry and telemetry recorder as the shared registry/recorder (`sharedRegistry`, `sharedTelemetry`).
- If clusters have different permission gating/registrations, the aggregate layer can reflect only the first cluster’s domain availability. This is a single-cluster assumption at the registry boundary.
- Telemetry recorded by aggregate requests is attributed to the first cluster’s recorder (see item 3).

3) Telemetry recorder is bound to a single cluster (backend)
- Files: `backend/refresh/telemetry/recorder.go`, `backend/refresh/system/manager.go`, `backend/app_refresh_setup.go`
- `Recorder.RecordSnapshot` stamps `ClusterID`/`ClusterName` from the recorder instance, not from scope/payload. Aggregate handlers re-use the first cluster’s recorder, so aggregate snapshots are reported as if they belong to one cluster.
- This is diagnostic-only but still a single-cluster assumption in cross-cluster diagnostics.

4) Context-name dedupe blocks multi-cluster selections with shared context names (backend + frontend)
- Files: `backend/kubeconfigs.go`, `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`
- Both layers dedupe selections by **context name only** (`seenContexts` / `resolveClusterMeta(...).name`). This prevents selecting two clusters that share the same context name across kubeconfig files.
- This is a single-cluster-era assumption (context names are globally unique) and can block legitimate multi-cluster configurations.

5) GridTable keying falls back to cluster **name** when `clusterId` is missing (frontend)
- File: `frontend/src/shared/components/tables/GridTable.utils.ts`
- `buildClusterScopedKey` uses `clusterName` as a fallback when `clusterId` is absent. If any payloads omit `clusterId`, row keys become name-based and can collide across clusters with identical names, reintroducing cross-cluster UI collisions.
- This is a trace of single-cluster assumptions in UI keying. It also masks missing `clusterId` in payloads.

6) Single-cluster-only streaming/manual domains (backend + frontend)
- Files: `backend/refresh_aggregate_catalog_stream.go`, `backend/refresh_aggregate_logstream.go`, `backend/refresh_aggregate_manual_queue.go`, `frontend/src/core/refresh/streaming/resourceStreamManager.ts`
- These paths explicitly reject multi-cluster scopes for certain domains (catalog/logs/manual queue, and non-multi resource streams).
- This is intentional but remains a single-cluster boundary that must be respected by UI scope building to avoid cross-cluster operations or confusing errors.

## Notes (multi-cluster isolation appears consistent)
- Per-cluster client dependencies are keyed by cluster ID and used consistently via `resolveClusterDependencies(...)` and `resourceDependenciesForSelection(...)` (`backend/cluster_dependencies.go`, `backend/resources_workloads.go`).
- Response cache keys are scoped by `selectionKey` (cluster ID) where used; object detail/YAML fetches enforce cluster scope (`backend/object_detail_provider.go`, `backend/object_yaml.go`).
- Aggregated event stream decorations attach cluster IDs/names to entries when missing (`backend/refresh_aggregate_eventstream.go`).
