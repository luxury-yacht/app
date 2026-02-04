# Port Forwarding Design

## Overview

Add port forwarding support to Luxury Yacht, allowing users to forward local ports to pods, services, and workloads across multiple clusters.

## Requirements

- **Supported resources**: Pods, Services, Deployments, StatefulSets, DaemonSets
- **Multi-cluster**: Full support for forwarding to any connected cluster
- **Multiple forwards**: Support multiple simultaneous port forwards
- **Management UI**: Dedicated dockable panel to view and manage active forwards
- **Auto-reconnect**: When a pod dies but the workload/service still exists, automatically reconnect to a new pod

## Architecture

### Data Model

```go
type PortForwardSession struct {
    ID            string    // Unique session ID (UUID)
    ClusterID     string    // Which cluster this belongs to
    ClusterName   string    // For display purposes
    Namespace     string
    PodName       string    // Actual pod being forwarded to
    ContainerPort int
    LocalPort     int

    // Original target (for reconnection)
    TargetKind    string    // "Pod", "Service", "Deployment", etc.
    TargetName    string    // Original resource name

    Status        string    // "starting", "active", "reconnecting", "error", "stopped"
    StatusReason  string    // Error message or reconnect info
    StartedAt     time.Time
}
```

### Pod Selection

Follows kubectl behavior - no user selection needed:
- **Pod**: Forward to that specific pod
- **Deployment/StatefulSet/DaemonSet**: Pick first ready pod from workload's selector
- **Service**: Pick first ready endpoint pod

If the user wants a specific pod, they create the forward from that pod directly.

## Backend Implementation

### New File: `backend/portforward.go`

**Exposed methods:**

```go
// Start a new port forward, returns session ID
func (a *App) StartPortForward(clusterID, namespace, targetKind, targetName string,
    containerPort, localPort int) (string, error)

// Stop a specific forward
func (a *App) StopPortForward(sessionID string) error

// Stop all forwards for a cluster (called when closing cluster tab)
func (a *App) StopClusterPortForwards(clusterID string) error

// List all active forwards
func (a *App) ListPortForwards() []PortForwardSession
```

**Internal behavior:**
- Resolves target to a pod (for Services/Workloads, finds first ready pod)
- Creates `portforward.PortForwarder` using cluster's REST config
- Spawns goroutine to run forwarder and monitor for errors
- On pod death: looks up original target, finds new pod, reconnects with backoff
- Session map protected by mutex, keyed by session ID

**Events emitted:**
- `portforward:status` - `{sessionID, status, localPort, podName, error}`
- `portforward:list` - Full list refresh on start/stop/reconnect

## Frontend Implementation

### Port Forward Modal

Uses existing `Modal` component and form styles.

**Trigger points:**
- Context menu on workloads/pods/services tables
- Object Panel button when viewing applicable resource

**Contents:**
- Resource name and cluster (read-only)
- Container port selection (radio buttons from pod spec)
- Local port input (defaults to container port)
- If no ports in spec, show free-form input

**Validation:**
- Local port not already in use by another forward
- Port number in valid range

### Port Forwards Panel

Dockable panel using existing `DockablePanel` component.

**Display:**
- Lists all active forwards across all clusters
- Shows: resource, ports, cluster/namespace, status
- Status indicators: active, reconnecting, error
- Actions: Stop (active/reconnecting), Remove (errored)

**Behavior:**
- Accessed via View menu (like App Logs)
- Auto-opens when first forward starts
- Subscribes to `portforward:status` and `portforward:list` events
- Calls `ListPortForwards()` on mount

### Integration Points

**Context menus:**
- Add "Port Forward..." to workload tables (NsViewWorkloads)
- Add "Port Forward..." to services table
- Add "Port Forward..." to pods table
- Disabled if resource has no ports defined

**Object Panel:**
- Add "Port Forward" button when viewing pod/workload/service

**View menu:**
- Add "Port Forwards" item to open/focus panel

**Cluster tab close:**
- Check for active forwards before closing
- Show confirmation: "Stop & Close" / "Cancel"
- Call `StopClusterPortForwards(clusterID)` on confirm

## Error Handling & Reconnection

### Reconnection Logic

When port forwarder detects connection dropped:
1. Check if original target still exists
2. If target gone: status "error", no retry
3. If target exists: status "reconnecting", find new ready pod
4. Retry with exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
5. After 5 failed attempts: status "error"

### Error Scenarios

| Scenario | Status | Behavior |
|----------|--------|----------|
| Local port in use | error | Fail immediately |
| Pod not ready | error | Fail with message |
| Pod dies, workload exists | reconnecting | Auto-reconnect to new pod |
| Pod dies, direct pod forward | error | No reconnect |
| Cluster disconnected | error | Mark all cluster's forwards as error |
| Network timeout | reconnecting | Retry with backoff |

### Frontend Error Display

- Panel updates in real-time via events
- Errored entries stay visible until user removes them
- "Retry" button on errored entries

## Testing Strategy

### Backend Tests

- Pod selection logic (first ready pod)
- Session lifecycle: start, stop, list
- Cluster cleanup removes correct sessions
- Mock port forwarder for state management tests

### Frontend Tests

- Modal: renders ports, validates input, calls backend
- Panel: displays sessions, handles events, stop/remove actions
- Context menu integration
- Cluster close confirmation dialog

### Manual Testing

- Full flow: modal → start → panel → stop
- Reconnection: kill pod, verify auto-reconnect
- Multi-cluster display
- Cluster close with active forwards

## Files to Create/Modify

### Backend
- `backend/portforward.go` (new)
- `backend/portforward_test.go` (new)

### Frontend
- `src/modules/port-forward/PortForwardModal.tsx` (new)
- `src/modules/port-forward/PortForwardModal.test.tsx` (new)
- `src/modules/port-forward/PortForwardsPanel.tsx` (new)
- `src/modules/port-forward/PortForwardsPanel.test.tsx` (new)
- `src/modules/port-forward/index.ts` (new)
- `src/modules/namespace/components/NsViewWorkloads.tsx` (modify - add context menu item)
- `src/modules/object-panel/...` (modify - add button)
- Cluster tab close handler (modify - add confirmation)
- View menu (modify - add Port Forwards item)
