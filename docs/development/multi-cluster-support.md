# Multi-Cluster Support

Luxury Yacht supports multiple Kubernetes clusters with complete isolation between them. Auth failures, transport errors, and data in one cluster never affect other clusters.

## Core Principles

1. **Every cluster is independent and equal** - No "primary" or "host" cluster concept
2. **Complete isolation** - Auth, data, caches, and state are per-cluster
3. **Graceful degradation** - One cluster failing doesn't break others
4. **Explicit user control** - Clusters are selected explicitly, not auto-selected
5. **Single-cluster per view** - UI shows data for the active tab cluster only (no cross-cluster aggregation in views)

## Cluster Identity

| Field         | Format             | Example                 |
| ------------- | ------------------ | ----------------------- |
| `clusterId`   | `filename:context` | `config:prod-us-east-1` |
| `clusterName` | `context`          | `prod-us-east-1`        |

The ID is derived in `clusterMetaForSelection()` (`kubeconfig_selection.go`):

```go
ClusterMeta{
    ID:   fmt.Sprintf("%s:%s", filename, selection.Context),
    Name: selection.Context,
}
```

Duplicate context names may exist across kubeconfigs, but only one can be active at a time.

## Refresh Scope Keys

Scopes are prefixed with cluster identity for stable keying:

| Type           | Format                      | Example                                         |
| -------------- | --------------------------- | ----------------------------------------------- |
| Single cluster | `clusterId\|<scope>`        | `config:prod\|namespace:default`                |
| Multi-cluster  | `clusters=id1,id2\|<scope>` | `clusters=config:prod,config:staging\|limit=25` |

See `clusterScope.ts` for encoding/decoding helpers.

## Architecture

### Per-Cluster Client Structure

Each cluster has its own `clusterClients` instance (`cluster_clients.go`):

```go
type clusterClients struct {
    meta                ClusterMeta
    kubeconfigPath      string
    kubeconfigContext   string
    client              kubernetes.Interface
    apiextensionsClient apiextensionsclientset.Interface
    dynamicClient       dynamic.Interface
    metricsClient       *metricsclient.Clientset
    restConfig          *rest.Config
    authManager         *authstate.Manager  // Per-cluster auth state
    authFailedOnInit    bool                // Pre-flight check failed
}
```

Clusters are stored in a map keyed by cluster ID:

```go
clusterClientsMu sync.Mutex
clusterClients   map[string]*clusterClients
```

Access clusters via:

```go
clients := app.clusterClientsForID(clusterID)
if clients == nil {
    // Cluster not found
}
```

### Per-Cluster Subsystems

Each cluster has its own refresh subsystem (`system.Subsystem`):

```go
refreshSubsystems map[string]*system.Subsystem
```

The subsystem contains:

- Informer factory
- Resource stream
- Refresh manager
- Registry (permissions/capabilities)

### Aggregate Handlers

For cross-cluster operations, aggregate handlers merge data from all clusters:

```go
refreshAggregates *refreshAggregateHandlers
```

When a cluster is added/removed/rebuilt, aggregates must be updated:

```go
clusterOrder := make([]string, 0, len(a.refreshSubsystems))
for id := range a.refreshSubsystems {
    clusterOrder = append(clusterOrder, id)
}
a.refreshAggregates.Update(clusterOrder, a.refreshSubsystems)
```

## Cluster Selection

### Selection Sources

Cluster activation can come from:

- Startup persistence (previously selected clusters)
- Kubeconfig dropdown
- Command palette

Cluster deactivation can come from:

- Kubeconfig dropdown
- Cluster tab close button
- `Ctrl+W` / `Cmd+W` keyboard shortcut

### Selection Events

| Event                          | When Fired                                      |
| ------------------------------ | ----------------------------------------------- |
| `kubeconfig:changing`          | Selection becomes empty                         |
| `kubeconfig:changed`           | At least one cluster becomes active after empty |
| `kubeconfig:selection-changed` | Cluster added/removed while non-empty           |

### No Clusters Active

When no clusters are selected:

- Disable sidebar and main content (no data loading or spinners)
- Show overlay: "No active clusters. Select a cluster from the kubeconfig dropdown."
- Set header title to "No Active Clusters"
- Clear snapshot state and stop all refresh/streams
- Kubeconfig dropdown, command palette, settings/about, and logs still work

## Cluster Tabs

- **Visibility**: Tabs appear only when two or more clusters are open
- **Creation**: Tabs are created when a cluster is selected
- **Removal**: Closing a tab deselects the cluster and triggers cleanup
- **Draggable**: Use native drag-and-drop for reordering

### Tab Ordering

- Initial order follows kubeconfig selection order
- Drag order persists across restarts (see `clusterTabOrder.ts`)
- Closed tabs lose their position; reopening follows selection order

## Per-Tab UI State

- Each tab has its own view state, sidebar, and object panel state
- Views only show data for the active tab cluster
- Object panel actions must always be scoped to the originating cluster

## Per-Cluster State Tracking

### Auth State

Each cluster has its own `authstate.Manager`. See [auth-manager.md](./auth-manager.md) for details.

### Transport Failures

Transport failures are tracked per-cluster:

```go
transportStatesMu sync.RWMutex
transportStates   map[string]*transportFailureState
```

Key functions:

- `recordClusterTransportFailure(clusterID, reason, err)`
- `recordClusterTransportSuccess(clusterID)`
- `runClusterTransportRebuild(clusterID, reason, err)`

### Auth Recovery Scheduling

Prevents duplicate recovery attempts:

```go
clusterAuthRecoveryMu        sync.Mutex
clusterAuthRecoveryScheduled map[string]bool
```

## Namespace Behavior

- Namespaces are scoped to the active cluster tab
- The synthetic "All Namespaces" entry appears only after that cluster's namespace data is available
- Do not auto-select a namespace on tab open; selection is only on explicit user action
- Namespace selection stays in the frontend; do not add it to catalog snapshots

## Object Catalog

The object catalog is the **source of truth** for cluster/namespace listings. Use catalog namespace groups in sidebar rendering:

```typescript
const groups = catalogDomain.data?.namespaceGroups ?? [];
```

## Refresh Behavior

- Per-tab refresh is the default
- Background refresh toggle exists and defaults to enabled
- When background refresh is enabled, skip forced manual refresh on tab switches

### Domain Scoping

- Unscoped domains are still cluster-prefixed to avoid cross-tab data bleed
- `cluster-overview` is scoped to the active tab cluster only
- Catalog and namespace browse are scoped to the active cluster

## Backend API Requirements

- Resource/detail/YAML/Helm endpoints **require** `clusterId`
- Missing cluster scope returns HTTP 400 - no legacy fallback
- Response cache keys must be scoped by `clusterId` to prevent cross-cluster reuse

```go
// Example: clusterId is required
if clusterId == "" {
    base.Error = "clusterId is required"
    // Returns 400
}
```

## Event System

All events include `clusterId` for frontend routing:

### Health Events

```go
runtime.EventsEmit(app.Ctx, "cluster:health:healthy", map[string]any{
    "clusterId":   clusterID,
    "clusterName": clusterName,
})
```

### Auth Events

```go
runtime.EventsEmit(app.Ctx, "cluster:auth:failed", map[string]any{
    "clusterId":   clusterID,
    "clusterName": clusterName,
    "reason":      reason,
})
```

### Backend Error Events

```go
app.emitEvent("backend-error", map[string]any{
    "clusterId":    clusterID,  // Always include
    "resourceKind": resourceKind,
    "message":      message,
    "error":        err.Error(),
})
```

## Frontend Integration

### Kubeconfig Context

```typescript
const {
  selectedClusterId, // Currently active cluster tab
  selectedClusterIds, // All selected clusters (Set)
  setSelectedKubeconfig, // Switch active cluster
} = useKubeconfig();
```

### Per-Cluster State Tracking

Frontend tracks state per-cluster using Maps:

```typescript
const [clusterAuthErrors, setClusterAuthErrors] = useState<Map<string, ClusterAuthState>>(
  new Map()
);

const [clusterHealth, setClusterHealth] = useState<Map<string, 'healthy' | 'degraded'>>(new Map());
```

### Isolated Storage Keys

Per-cluster localStorage keys prevent state leakage:

```typescript
// Bad - shared across clusters
const FILTER_KEY = 'pods:unhealthy-filter';

// Good - isolated per cluster
const getFilterKey = (clusterId: string) => `pods:unhealthy-filter:${clusterId}`;
```

## Kubeconfig Dropdown Behavior

- Dropdown label is always "Select Kubeconfig"
- Selected clusters show a checkmark (no blue highlight)
- The trigger width fits the label; the expanded menu fits content and right-aligns

## Command Palette Behavior

- Kubeconfig items open a cluster tab if closed, or switch to it if already open
- Kubeconfig items show a checkmark when active
- No close/deselect from command palette
- "Close Current Cluster Tab" command exists with `Cmd/Ctrl+W` shortcut

## Cluster Lifecycle

### Adding a Cluster

1. User selects cluster in kubeconfig picker
2. `syncClusterClientPool()` creates new `clusterClients`
3. `buildClusterClients()` initializes clients with per-cluster auth manager
4. Pre-flight check tests connectivity
5. If auth fails on init, `authFailedOnInit` is set (subsystem skipped)
6. `buildRefreshSubsystemForSelection()` creates subsystem
7. Aggregates are updated

### Removing a Cluster

1. User deselects cluster
2. `syncClusterClientPool()` detects removal
3. Auth manager is shut down
4. Subsystem is torn down
5. Entry removed from maps
6. Aggregates are updated
7. In-flight refreshes tied to removed clusters are ignored/canceled

### Rebuilding After Auth Recovery

When auth recovers (`rebuildClusterSubsystem`):

1. Find the kubeconfig selection for this cluster
2. Build new clients with fresh credentials from kubeconfig
3. Preserve the existing auth manager (already in valid state)
4. Build new subsystem
5. Update aggregates
6. Start object catalog

## Heartbeat

The heartbeat runs independently for each cluster (`app_heartbeat.go`):

- Interval: 15 seconds
- Timeout per check: 5 seconds
- Skips clusters with invalid auth

## Error Handling

- Refresh base URL may change when backend rebuilds the refresh subsystem
- Frontend invalidates the base URL and suppresses transient network errors during selection transitions
- Missing cluster scope is a hard error (HTTP 400) for refresh/manual/stream endpoints

## Drain Store Isolation

Node drain jobs are isolated by cluster:

```go
store.SetJobCluster(jobID, clusterID, clusterName)
jobs := store.GetJobsForCluster(clusterID)
```

This prevents cross-cluster bleed when node names overlap.

## Risks and Considerations

- Refresh fan-out can increase load per cluster; watch for timeouts
- Stream merge volume/order can create backpressure; throttle if needed
- Single-cluster domain restrictions must allow explicit cluster scopes

## Common Patterns

### Getting Cluster-Specific Clients

```go
clients := app.clusterClientsForID(clusterID)
if clients == nil {
    return fmt.Errorf("cluster not found: %s", clusterID)
}
_, err := clients.client.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
```

### Iterating All Clusters

```go
app.clusterClientsMu.Lock()
clusters := make(map[string]*clusterClients)
for k, v := range app.clusterClients {
    clusters[k] = v
}
app.clusterClientsMu.Unlock()

for clusterID, clients := range clusters {
    // Process each cluster
}
```

### Frontend Event Handling

```typescript
useEffect(() => {
    const handler = (...args: any[]) => {
        const payload = args[0] as { clusterId: string; ... } | undefined;
        if (!payload?.clusterId) return;

        setClusterState(prev => {
            const next = new Map(prev);
            next.set(payload.clusterId, ...);
            return next;
        });
    };

    runtime.EventsOn('my-event', handler);
    return () => runtime.EventsOff('my-event');
}, []);
```

## Adding New Per-Cluster Features

When adding features that have per-cluster state:

1. **Backend**: Store state in a map keyed by cluster ID
2. **Events**: Always include `clusterId` in event payloads
3. **Frontend**: Track state per-cluster using Map
4. **Display**: Only show state for the active cluster
5. **Cleanup**: Remove state when cluster is removed
6. **Tests**: Verify isolation (action in cluster A doesn't affect cluster B)

## Testing

Run isolation tests:

```bash
cd backend && go test -v -run TestIsolation ./...
cd frontend && npm test -- --testPathPattern=multiClusterIsolation
```

Key test files:

- `backend/multi_cluster_isolation_test.go`
- `frontend/src/hooks/multiClusterIsolation.test.ts`

## Troubleshooting

### Data from wrong cluster appearing

1. Check `clusterId` in event payloads
2. Verify frontend is filtering by `selectedClusterId`
3. Check for shared state that should be per-cluster

### Auth failure affecting multiple clusters

1. Verify each cluster has its own `authManager` instance
2. Check that `clusterClientsForID` returns correct cluster
3. Look for global state that should be per-cluster

### Cluster not loading after auth recovery

1. Check `rebuildClusterSubsystem` is being called
2. Verify aggregates are updated after rebuild
3. Check object catalog is started for the cluster

## Related Files

| File                                                           | Purpose                                |
| -------------------------------------------------------------- | -------------------------------------- |
| `backend/cluster_clients.go`                                   | Per-cluster client management          |
| `backend/cluster_auth.go`                                      | Per-cluster auth state handlers        |
| `backend/kubeconfig_selection.go`                              | Cluster ID derivation                  |
| `backend/app_heartbeat.go`                                     | Per-cluster health checks              |
| `backend/app_refresh_recovery.go`                              | Per-cluster transport failure tracking |
| `backend/multi_cluster_isolation_test.go`                      | Isolation tests                        |
| `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx` | Cluster selection                      |
| `frontend/src/core/contexts/AuthErrorContext.tsx`              | Per-cluster auth state                 |
| `frontend/src/core/refresh/clusterScope.ts`                    | Scope key encoding                     |
| `frontend/src/ui/layout/ClusterTabs.tsx`                       | Tab strip component                    |
| `frontend/src/core/persistence/clusterTabOrder.ts`             | Tab order persistence                  |
| `frontend/src/hooks/multiClusterIsolation.test.ts`             | Frontend isolation tests               |
