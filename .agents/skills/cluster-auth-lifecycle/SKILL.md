---
name: cluster-auth-lifecycle
description: Work on Luxury Yacht kubeconfig selection, multi-cluster client lifecycle, auth failure/recovery, selected/background clusters, cluster tabs, refresh subsystem rebuilds, and object catalog lifecycle
---

# Cluster Auth Lifecycle

Use this when touching kubeconfig selection, cluster client setup, auth failure
overlays, retry/recovery, selected/background cluster state, cluster tabs,
refresh subsystem rebuilds, object catalog start/stop, or tests for cluster
add/remove behavior.

## Read First

1. `AGENTS.md`
2. `backend/AGENTS.md` for backend lifecycle/client changes
3. `frontend/AGENTS.md` for frontend cluster state or UI changes
4. `docs/architecture/multi-cluster.md`
5. `docs/architecture/data-freshness.md`
6. `docs/architecture/auth.md`
7. `docs/architecture/refresh-system.md`
8. `docs/architecture/catalog.md` when object catalog lifecycle is involved

## Backend Entry Points

- `backend/app_kubernetes_client.go`
- `backend/kubeconfigs.go`
- `backend/app_refresh_setup.go`
- `backend/app_refresh_update.go`
- `backend/app_refresh_subsystems.go`
- `backend/app_refresh_recovery.go`
- `backend/app_object_catalog.go`
- `backend/internal/authstate`

## Frontend Entry Points

- `frontend/src/modules/kubernetes/config`
- `frontend/src/modules/cluster`
- `frontend/src/ui/layout/ClusterTabs.tsx`
- `frontend/src/ui/overlays/AuthFailureOverlay.tsx`
- `frontend/src/core/refresh`
- `frontend/src/core/data-access`

## Checklist

- [ ] Every cluster-data path carries `clusterId`; never infer the active
      cluster in a backend/API/cache/action path.
- [ ] Selected and background cluster sets stay distinct and refresh scopes are
      rebuilt or cleared when cluster selection changes.
- [ ] Refresh domains stay single-cluster. Cross-cluster displays fan out only
      for clusters they display; retained inactive tabs stay passive.
- [ ] Cluster add/remove updates aggregate refresh handlers and object catalog
      services through the live update path, not only initial setup.
- [ ] Auth-failed clusters do not block healthy clusters.
- [ ] Retry/recovery rebuilds transport, refresh, object catalog, and frontend
      diagnostics consistently.
- [ ] Closing/removing a cluster cleans up streams, sessions, stale scopes, and
      catalog state for that cluster.
- [ ] Every frontend cluster-tab open/close affordance routes through
      `KubeconfigContext`'s unified selection transition (`openKubeconfig`,
      `closeKubeconfig`, or `setSelectedKubeconfigs`); do not splice selected
      clusters locally or call generated backend selection/close commands from
      UI surfaces.
- [ ] Tests cover at least one multi-cluster or auth-failure transition.
- [ ] Non-doc changes pass `mage qc:prerelease`.

## Validation

Use focused checks while iterating:

```sh
go test ./backend ./backend/internal/authstate
npm run typecheck --prefix frontend
npm run test --prefix frontend -- cluster kubeconfig auth refresh
```

Then run `mage qc:prerelease` for non-documentation changes.
