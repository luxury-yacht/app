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

### Issue 1: Process-wide cluster meta fallback
**Priority:** Medium | **Effort:** Low | **Risk:** Low

**Problem:** `ClusterMetaFromContext()` silently falls back to empty/stale global state when context is missing.

**Plan:**
1. Remove the global fallback in `ClusterMetaFromContext()` - return empty `ClusterMeta{}` instead of `CurrentClusterMeta()`
2. Delete `SetClusterMeta()` and `CurrentClusterMeta()` since they're unused and encourage incorrect patterns
3. Audit callers of `ClusterMetaFromContext()` to ensure they pass proper context with `WithClusterMeta()`
4. Add a warning log when `ClusterMetaFromContext()` receives nil context or context without meta

**Files:**
- `backend/refresh/snapshot/cluster_meta.go` - remove global state and fallback

---

### Issue 2: Aggregate mux uses single cluster registry/telemetry
**Priority:** Low | **Effort:** Medium | **Risk:** Medium

**Problem:** First cluster's registry determines domain availability for all clusters.

**Plan:**
1. For registry: Create a merged registry that unions domain registrations from all clusters, or check per-cluster registry when routing requests
2. For telemetry: See Issue 3 - telemetry should be per-request, not per-mux

**Option A (simpler):** Accept current behavior with documentation - registries are typically identical across clusters since they're code-defined, not runtime-configured.

**Option B (complete fix):**
- Create `AggregateRegistry` that wraps per-cluster registries
- Route domain lookups to the appropriate cluster's registry based on scope

**Files:**
- `backend/app_refresh_setup.go` - buildRefreshMux()
- `backend/refresh/domain/registry.go` - potentially add AggregateRegistry

---

### Issue 3: Telemetry recorder bound to single cluster
**Priority:** Low | **Effort:** Medium | **Risk:** Low

**Problem:** Aggregate snapshot telemetry is attributed to first cluster, not actual cluster(s).

**Plan:**
1. Modify `RecordSnapshot()` to accept cluster ID/name as parameters instead of using instance fields
2. Update aggregate handlers to pass the correct cluster ID when recording
3. For multi-cluster aggregates, either:
   - Record once per cluster involved, or
   - Record with a synthetic "aggregate" cluster identifier

**Alternative:** Accept current behavior - this is diagnostic-only and doesn't affect functionality. Document the limitation.

**Files:**
- `backend/refresh/telemetry/recorder.go` - RecordSnapshot signature
- `backend/refresh/snapshot/*.go` - callers of RecordSnapshot

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

### Issue 5: GridTable keying falls back to clusterName
**Priority:** Medium | **Effort:** Low | **Risk:** Low

**Problem:** Missing `clusterId` causes fallback to `clusterName`, which can collide.

**Plan:**
1. Remove the `clusterName` fallback from `defaultGetClusterId()` - return `null` if `clusterId` is missing
2. Add development-mode warning when `clusterId` is missing to catch payload issues early
3. Audit snapshot builders to ensure all payloads include `clusterId`

**Alternative:** Keep fallback but log a warning in development mode to identify missing clusterId cases.

**Files:**
- `frontend/src/shared/components/tables/GridTable.utils.ts:59-74` - defaultGetClusterId()

---

### Issue 6: Single-cluster-only streaming domains
**Priority:** N/A (Intentional) | **Effort:** N/A | **Risk:** Documentation

**Problem:** Not a bug - certain domains are intentionally single-cluster only.

**Plan:**
1. Document which domains are single-cluster only and why
2. Ensure frontend scope builders don't attempt multi-cluster for these domains
3. Improve error messages to be more user-friendly

**Domains that are single-cluster only:**
- `catalog`, `catalog-diff`, `node-maintenance` - object-scoped, require single target
- Log streams - container logs are inherently single-pod
- Catalog streams - catalog diff requires single source

**Files:**
- `docs/development/multi-cluster.md` - document single-cluster domains
- `backend/refresh_aggregate_*.go` - improve error messages

---

## Implementation Order

1. ~~**Issue 4** (High priority, Low effort) - Unblocks legitimate multi-cluster configs~~ ✅ DONE
2. **Issue 1** (Medium priority, Low effort) - Removes footgun, low risk
3. **Issue 5** (Medium priority, Low effort) - Improves debugging, prevents collisions
4. **Issue 6** (Documentation only) - No code changes needed
5. **Issue 2** (Low priority) - Consider Option A (accept with docs)
6. **Issue 3** (Low priority) - Consider accepting current behavior
