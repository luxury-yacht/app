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

---

## Remediation Plan

### Issue 1: Process-wide cluster meta fallback ✅ FIXED
**Priority:** Medium | **Effort:** Low | **Risk:** Low

**Problem:** `ClusterMetaFromContext()` silently falls back to empty/stale global state when context is missing.

**Fix applied:**
1. Removed global state (`clusterMetaMu`, `currentMetaState`) and fallback
2. Deleted `SetClusterMeta()` and `CurrentClusterMeta()` (unused package-level functions)
3. `ClusterMetaFromContext()` now returns empty `ClusterMeta{}` when context is nil or missing meta
4. Added warning logs for nil context and missing cluster meta cases

**Files changed:**
- `backend/refresh/snapshot/cluster_meta.go` - removed global state, updated function

---

### Issue 2: Aggregate mux uses single cluster registry/telemetry ✅ FIXED
**Priority:** Low | **Effort:** Medium | **Risk:** Medium

**Problem:** First cluster's registry determines domain availability for all clusters.

**Analysis:** The `registry` field in `api.Server` was dead code - stored but never accessed. The actual snapshot building correctly uses per-cluster registries via each cluster's `SnapshotService`.

**Fix applied:**
1. Removed dead `registry` field from `api.Server`
2. Removed `Registry` from `MuxConfig` struct
3. Removed `sharedRegistry` selection logic from `buildRefreshMux()`
4. Cleaned up unused imports and test code

**Files changed:**
- `backend/refresh/api/server.go` - removed registry field and parameter
- `backend/refresh/system/routes.go` - removed Registry from MuxConfig
- `backend/refresh/system/manager.go` - removed Registry from MuxConfig usage
- `backend/app_refresh_setup.go` - removed sharedRegistry logic
- `backend/refresh/api/server_test.go` - removed dead registry code
- `backend/app_lifecycle_test.go` - removed Registry field

---

### Issue 3: Telemetry recorder bound to single cluster ✅ FIXED
**Priority:** Low | **Effort:** Medium | **Risk:** Low

**Problem:** Aggregate snapshot telemetry is attributed to first cluster, not actual cluster(s).

**Fix applied:**
1. Added `clusterID` and `clusterName` parameters to `RecordSnapshot()` signature
2. Updated `snapshot.Service.recordTelemetry()` to pass its cluster metadata
3. Telemetry is now correctly attributed to the cluster that produced the snapshot

**Files changed:**
- `backend/refresh/telemetry/recorder.go` - added cluster params to RecordSnapshot
- `backend/refresh/snapshot/service.go` - passes cluster metadata to RecordSnapshot
- `backend/refresh/telemetry/recorder_test.go` - updated test calls
- `backend/refresh/api/server_test.go` - updated test calls
- `backend/app_object_catalog_test.go` - updated test calls

---

### Issue 4: Context-name dedupe blocks multi-cluster ✅ FIXED
**Priority:** High | **Effort:** Low | **Risk:** Low

**Problem:** Users cannot select two clusters with the same context name from different kubeconfig files.

**Fix applied:**
1. **Backend:** Changed `seenContexts` key from `parsed.Context` to `parsed.String()` (path:context)
2. **Frontend:** Changed dedupe key from `contextName` to full selection string
3. **UI:** Removed disabled state for "duplicate" context names in KubeconfigSelector
4. **Tests:** Updated to verify same context name from different files is allowed
5. **Docs:** Updated multi-cluster-support.md

**Files changed:**
- `backend/kubeconfigs.go` - dedupe by full selection
- `backend/kubeconfigs_test.go` - updated tests
- `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx` - dedupe by full selection
- `frontend/src/modules/kubernetes/config/KubeconfigContext.test.tsx` - updated tests
- `frontend/src/shared/components/KubeconfigSelector.tsx` - removed duplicate context blocking
- `frontend/src/shared/components/KubeconfigSelector.test.tsx` - updated tests
- `docs/development/multi-cluster-support.md` - updated documentation

---

### Issue 5: GridTable keying falls back to clusterName ✅ FIXED
**Priority:** Medium | **Effort:** Low | **Risk:** Low

**Problem:** Missing `clusterId` causes fallback to `clusterName`, which can collide.

**Fix applied:**
1. Removed `clusterName` fallback from `defaultGetClusterId()` - now returns `null` if `clusterId` is missing
2. Added development-mode warning when rows have `clusterName` but missing `clusterId`
3. Added test coverage for `buildClusterScopedKey` behavior

**Files changed:**
- `frontend/src/shared/components/tables/GridTable.utils.ts` - removed fallback, added dev warning
- `frontend/src/shared/components/tables/GridTable.utils.test.tsx` - added tests

---

### Issue 6: Single-cluster-only streaming domains ✅ DOCUMENTED
**Priority:** N/A (Intentional) | **Effort:** N/A | **Risk:** Documentation

**Problem:** Not a bug - certain domains are intentionally single-cluster only.

**Documentation added:**
- Added "Single-Cluster Domains" section to `docs/development/multi-cluster-support.md`
- Documents which domains are single-cluster only and why
- Shows the `isSingleClusterDomain()` implementation
- Notes frontend scope building requirements

**Domains that are single-cluster only:**
- `object-*` (details, events, yaml) - operates on a specific object in one cluster
- `catalog`, `catalog-diff` - catalog is per-cluster
- `node-maintenance` - node operations (cordon, uncordon, drain, delete) target a specific node
- Log streams - container logs are inherently single-pod
- Catalog streams - catalog operations require single source

---

## Implementation Order

1. ~~**Issue 4** (High priority, Low effort) - Unblocks legitimate multi-cluster configs~~ ✅ DONE
2. ~~**Issue 1** (Medium priority, Low effort) - Removes footgun, low risk~~ ✅ DONE
3. ~~**Issue 5** (Medium priority, Low effort) - Improves debugging, prevents collisions~~ ✅ DONE
4. ~~**Issue 6** (Documentation only) - No code changes needed~~ ✅ DONE
5. ~~**Issue 2** (Low priority) - Consider Option A (accept with docs)~~ ✅ DONE
6. ~~**Issue 3** (Low priority) - Consider accepting current behavior~~ ✅ DONE
