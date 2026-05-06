# TODO

1. ✅ [SECURITY] RBAC enforcement — backend/workload_actions.go:19, backend/resources_generic.go:25, backend/resources_nodes.go:22
    Mutating Wails methods perform Kubernetes writes without backend permission checks.
    Impact: frontend gating is not an enforcement boundary; this violates the backend rule that every K8s write must check permissions first.
2. ✅ [STABILITY] Object identity — backend/refresh/snapshot/object_details.go:80, backend/object_detail_provider.go:315
    object-details parses full GVK from scope, then passes only kind into the provider and cache key.
    Impact: same namespace/name/kind across different groups or versions can collide or fetch the wrong detail path.
3. ✅ [STABILITY] Kind-only workload helpers — backend/workload_rollback.go:49, backend/resources_autoscaling.go:32, frontend/src/core/data-access/readers.ts:47
    rollback history and HPA-managed checks still pass workload identity as kind/name, not group/version/kind.
    Impact: this repeats the kind-only object reference pattern we’ve been removing.
4. [SIMPLICITY] Dead list-shaped resource services — backend/resources/workloads/deployments.go:56, backend/resources/network/services.go:41, backend/resources/autoscaling/
    hpa.go:36
    Many exported plural methods in backend/resources are now test-only after the refresh-domain migration.
    Impact: they preserve the old list/table architecture and make it easier to accidentally reintroduce parallel list paths.
5. [SIMPLICITY] Snapshot fallback detail layer — backend/refresh/snapshot/object_details.go:141
    backend/refresh/snapshot still has a direct Kubernetes object-detail fetcher map alongside backend/resources.
    Impact: the boundary is documented, but this code still provides a second place to add detail logic.

## Feature Ideas

- In daemonset details, show a "NOT RUNNING ON" label that lists the nodes where the ds is missing

- Configurable backend thresholds
  - QPS (500) and Burst (1000)
  - SSRR concurrency cap (32)

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
