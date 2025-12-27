# Multi-cluster support plan

## Decisions from discovery

- Support simultaneous connections to multiple clusters.
- Aggregate resources across clusters.
- Keep cluster selection in the kubeconfig dropdown, but switch it to multi-select.
- Clusters are sourced from kubeconfig contexts.
- Streaming should be multi-cluster when multiple clusters are active, merged by timestamp.
- `clusterId` is `filename:context`; `clusterName` is `context`.
- Duplicate context names may exist in the list, but multi-select must prevent them from being active at the same time; disable duplicates with tooltip: "`context` is already active. Duplicate context names are not allowed."
- Refresh scope keys are prefixed as `clusterId|<scope>` to avoid collisions while preserving scope semantics.
- Object panel actions use the selected object's `clusterId` without changing kubeconfig selection.
- Namespace selection shows per-cluster, collapsible namespace lists when multiple clusters are selected.
- Keys/filters/ids must include cluster, even when only one cluster is active.

## Backend approach

- Treat cluster identity as first-class: add `clusterId` (format `filename:context`) and `clusterName` to all resource summaries/lists.
- Maintain a Kubernetes client pool keyed by `clusterId`, and run refresh builders per cluster.
- Aggregate per-cluster results into a single snapshot payload, preserving `clusterId`/`clusterName` on each item.
- Keep the object catalog as the source of truth for cluster/namespace listings and selected cluster set.
- Preserve permission gating per cluster and surface issues per cluster in diagnostics.

## Refresh/streaming approach

- Snapshot refresh domains accept the selected cluster set and fan out per cluster.
- Manual refresh endpoints accept the same selection to re-sync only active clusters.
- Streaming is multi-cluster for logs/events/catalog when multiple clusters are active; merge stream events by timestamp.

## Frontend approach

- Kubeconfig dropdown becomes a multi-select and drives the active cluster set.
- Prevent duplicate context names from being selected; disable duplicates with the tooltip above.
- Add a `Clusters` filter in GridTable filter bar for aggregated views.
- Add a `Cluster` column via shared column factories to display human-readable cluster name.
- Diagnostics panel surfaces per-cluster status and permission issues.
- Object panel actions should target the selected object's `clusterId` without changing the kubeconfig selection.
- Namespace sidebar shows per-cluster, collapsible namespace lists when multiple clusters are selected.

## Data contract updates

- All list items include `clusterId` and `clusterName`.
- Object references used in panels/actions include `clusterId`.
- Refresh payloads include `selectedClusterIds` (or equivalent) to reflect active scope.
- Diagnostics entries include `clusterId` and `clusterName`.
- Keys/filters/ids in frontend state include `clusterId`.

## Risks

- Fan-out refresh load; may need concurrency limits and timeouts per cluster.
- Merged streaming order/volume could be costly; consider backpressure and per-cluster throttling.
- Avoiding cross-cluster confusion; rely on cluster column + filter in aggregated views.

## Review findings against current code (challenges/blockers)

- Blocker: Backend is built around a single selected cluster (one client, one refresh manager, one object catalog). Multi-cluster requires a client pool plus per-cluster refresh/catalog orchestration. (Refs: `backend/app.go`, `backend/app_kubernetes_client.go`, `backend/app_refresh_setup.go`, `backend/app_object_catalog.go`)
- Blocker: Kubeconfig selection/settings are single-string APIs and UI. Multi-select needs new Wails methods, settings format, and event payloads. (Refs: `backend/kubeconfigs.go`, `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx`, `frontend/src/shared/components/KubeconfigSelector.tsx`, `frontend/src/core/events/eventBus.ts`)
- Blocker: Refresh API/client and base URL are single-cluster with only a `scope` parameter; streams bind to one Kubernetes client. No per-cluster snapshot/stream selection today. (Refs: `backend/app_refresh.go`, `backend/refresh/api/server.go`, `frontend/src/core/refresh/client.ts`, `backend/refresh/logstream/handler.go`, `frontend/src/core/refresh/streaming/logStreamManager.ts`)
- Blocker: Data contracts lack cluster identity, so aggregated tables cannot add Cluster column/filter or route actions to the right cluster. This touches catalog summaries, namespace payloads, and object references. (Refs: `backend/objectcatalog/types.go`, `backend/refresh/snapshot/namespaces.go`, `frontend/src/core/refresh/types.ts`, `frontend/src/types/view-state.ts`)
- High: Permissions/capabilities/discovery caches are keyed to a single selection and single client, so state would mix/overwrite across clusters without refactor. (Refs: `backend/app.go`, `backend/app_capabilities.go`, `backend/object_yaml.go`, `frontend/src/core/capabilities/store.ts`)
- Medium: GridTable filters/persistence assume kinds/namespaces only and a single `clusterIdentity`. Adding a Clusters filter and stable persistence for multi-selection requires schema/storage changes. (Refs: `frontend/src/shared/components/tables/GridTable.types.ts`, `frontend/src/modules/browse/components/BrowseView.tsx`, `frontend/src/modules/namespace/hooks/useNamespaceGridTablePersistence.ts`)

## Phase 1: cluster-based keys/ids (no multi-cluster behavior yet, first)

Goal: introduce cluster-aware identifiers across data contracts and state to unblock multi-cluster work, without changing UI behavior or selection flows.

Backend
- Add a cluster identity helper (`clusterId`, `clusterName`) derived from the active kubeconfig (filename + context).
- Update selection keys and caches to use `clusterId` (refresh manager setup, permission cache, discovery cache, object-yaml GVR cache).
- Extend refresh system config/telemetry to carry cluster identity for diagnostics.
- Add `clusterId`/`clusterName` to catalog summaries and dependencies; keep catalog the source of truth.
- Embed cluster identity into every refresh snapshot payload and list entry (including node maintenance, object details/events/content, and cluster overview).
- Include `clusterId` in object references used by actions (details/logs/YAML/exec).
- Accept cluster-prefixed scope strings (`clusterId|<scope>`) in log/event streaming handlers and strip the prefix before parsing (keep the original scope string in SSE payloads for client keying).

Frontend
- Surface `selectedClusterId`/`selectedClusterName` in kubeconfig context from the current selection (no UI changes yet).
- Add `clusterId`/`clusterName` to refresh payload types and `clusterId` to `KubernetesObjectReference`.
- Add cluster-aware scope/key helpers (prefix `clusterId|<scope>`) and use them for refresh state keys, diagnostics keys, capability keys, streaming scopes, and GridTable persistence.
- Ensure object panel actions read `clusterId` from the selected object without changing the selected kubeconfig.
- Do not add new UI controls, columns, or filters in Phase 1.

Tests
- Update snapshot/streaming/capabilities tests to include cluster-aware keys and payloads.
- Add/adjust tests for scope parsing with cluster-prefixed scopes.

Phase 1 status (in progress)
Backend
- ✅ Cluster identity helper and refresh config/telemetry updated to include cluster meta.
- ✅ Cluster meta added to catalog summaries and most refresh snapshot payloads (including node maintenance and object details/events/content); scope parsing updated to accept `clusterId|<scope>` in log/event streams and namespace scope helpers.
- ✅ Audit catalog stream payloads for missing cluster meta and add coverage.
- ✅ Confirmed snapshot payloads/object references include cluster meta (catalog stream fixed); add/adjust tests as needed.
Frontend
- ✅ Kubeconfig context exposes `selectedClusterId`/`selectedClusterName`; refresh scope helpers added; refresh orchestrator normalizes scopes; refresh payload types updated with cluster meta; object reference types include `clusterId`.
- ✅ Capabilities bootstrap/registry uses cluster-aware keys; permission cache keys include `clusterId` and allow per-cluster bootstrap refresh.
- ✅ Event stream manager uses full cluster-prefixed scope keys; diagnostics parsing strips cluster prefix for pod labels.
- ✅ Object panel actions, logs, events, and maintenance use cluster-prefixed scopes and per-object `clusterId`.
- ✅ Namespace resources and GridTable persistence include `clusterId`.
- ✅ Cluster resources permission checks and namespace permission evaluation are scoped by `selectedClusterId`.
- ✅ Fix remaining TypeScript typing mismatch when building cluster-prefixed pod scopes.
- ✅ Fixed NsResourcesContext tests after cluster-aware changes.
- ✅ Fixed useObjectPanel tests after cluster-aware changes.
- ✅ Fixed ObjectPanel tests after cluster-aware changes.
- ✅ Fixed refresh orchestrator tests after cluster-aware scope changes.
- ✅ Fixed backend test failures for cluster-aware Helm mapping and selection key.
- ✅ Added a provider-order test for KubernetesProvider to surface missing KubeconfigProvider usage.
- ✅ Fixed KubernetesProvider order so KubeconfigProvider wraps ViewStateProvider.
- ✅ Diagnosed KubernetesProvider test failure (ObjectPanelState dependency) and updated mocks/act handling.
- ✅ Resolved provider dependency loop by restoring provider order and moving cluster context updates into KubeconfigProvider.
- ✅ Fixed unused `expect` import in KubernetesProvider test.
- ✅ Ran tests for capabilities/refresh/streaming/object panel/namespace resources; no failures.

Out of scope for Phase 1
- Kubeconfig multi-select, duplicate context disabling, and any cluster selection behavior changes.
- Multi-cluster refresh fan-out or client pooling.
- Cluster column/filter UI or aggregated views.
- Any streaming behavior changes beyond keying.

## Phase 2: multi-cluster selection + fan-out (next)

Goal: enable multi-select cluster workflows and refresh/stream fan-out while preserving the Phase 1 cluster-aware keys.

Backend
- Persist selected cluster IDs as a list (migrate from single selection) and expose Wails APIs to read/update the selection.
- Implement a Kubernetes client pool keyed by `clusterId`, created/removed as selection changes.
- Refactor refresh setup to run per-cluster refresh cycles and merge snapshot payloads, preserving cluster meta on every item.
- Update the object catalog to track namespaces and selections per cluster (catalog remains the source of truth).
- Accept selected cluster sets in manual refresh endpoints and streaming handlers; merge multi-cluster stream events.
- Surface diagnostics and permission issues per cluster in telemetry and refresh status.

Frontend
- Switch KubeconfigSelector to multi-select and track `selectedClusterIds` in KubeconfigContext.
- Disable duplicate context selections with the defined tooltip.
- Pass selected cluster sets through the refresh orchestrator and manage per-cluster streams.
- Add Cluster column + Clusters filter using shared column factories; persist filter state with cluster IDs.
- Update namespace sidebar to show per-cluster collapsible lists when multiple clusters are active.

Tests
- Backend: client pool lifecycle, multi-cluster refresh aggregation, catalog namespace listings, stream merge behavior.
- Frontend: multi-select selector behavior, duplicate disablement, per-cluster diagnostics, refresh/stream state updates.
