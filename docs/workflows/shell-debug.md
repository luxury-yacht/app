# Shell Exec and Debug Containers

This document describes the current shell exec + ephemeral debug container implementation, including backend/frontend responsibilities, event contracts, and maintenance gotchas.

Status: implemented and in active use.

## Why this exists

The Object Panel Shell tab supports two related workflows:

1. Start an interactive exec session in an existing pod container.
2. Create a Kubernetes ephemeral debug container, then connect a shell to it.

The same backend session manager powers both flows.

## Code map

### Backend

- `backend/shell_sessions.go`
  - Shell session creation, input/output streaming, resize, close, and replay backlog.
- `backend/shell_sessions_lifecycle.go`
  - Shell session registration, runtime-operation registration, list/status
    events, cluster cleanup, and count/list helpers.
- `backend/resources_pods.go`
  - App-level wrappers:
    - `GetPodContainers(clusterID, namespace, podName)`
    - `CreateDebugContainer(clusterID, req)`
- `backend/resources/pods/debug.go`
  - Ephemeral container creation + readiness polling.
- `backend/resources/pods/logs.go`
  - `PodContainers(...)` includes init + regular + ephemeral container names.
- `backend/resources/types/types.go`
  - `ShellSessionRequest`, `ShellSession`, `ShellSessionInfo`
  - `DebugContainerRequest`, `DebugContainerResponse`
  - `ShellOutputEvent`, `ShellStatusEvent`
- `backend/cluster_dependencies.go`
  - Cluster resolution (`clusterID` required for all shell/debug operations).

### Frontend

- `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`
  - Terminal UI, connect/start-debug controls, session attach/reattach, event handling.
- `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.css`
  - Shell tab layout + terminal/xterm integration styling.
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx`
  - Passes cluster/object context + capability reasons into `ShellTab`.
- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`
  - Capability descriptors:
    - shell exec (`create` on `pods/exec`)
    - debug (`update` on `pods/ephemeralcontainers`)
- `frontend/src/ui/status/SessionsStatus.tsx`
  - Header runtime operation panel for shell sessions and port forwards. It
    reads `runtime-operations:list` for shell/port-forward presence and uses
    workflow lists for shell/port-forward row details.
- `frontend/src/ui/status/runtimeOperationStatusAdapter.ts`
  - Pure reducer and row selector for merging runtime-operation, shell, and
    port-forward events into the Sessions status rows.
- `frontend/src/ui/layout/ClusterTabs.tsx`
  - Delegates close intent to `KubeconfigContext`; the shared frontend
    selection transition persists the new selected set, and backend selection
    cleanup stops removed-cluster runtime operations.

## Backend architecture

### 1) Session startup and transport

`StartShellSession(clusterID, req)` in `backend/shell_sessions.go`:

- Resolves cluster-scoped dependencies (`resolveClusterDependencies`).
- Validates namespace, pod, and container selection.
- Loads pod; allows regular containers and ephemeral containers as exec targets.
- Builds `PodExecOptions` with `Stdin/Stdout/Stderr/TTY = true`.
- Creates both websocket and SPDY executors and uses `remotecommand.NewFallbackExecutor(...)`.
  - Websocket is preferred.
  - SPDY is used on upgrade/proxy failures.
- Registers session in `App.shellSessions` and emits a full `object-shell:list` snapshot.
- Starts stream goroutine and timeout monitor goroutine.

### 2) Event contract

Backend emits three event streams:

- `object-shell:output`
  - Payload: `ShellOutputEvent { sessionId, clusterId, stream, data }`
- `object-shell:status`
  - Payload: `ShellStatusEvent { sessionId, clusterId, status, reason? }`
  - Common statuses: `open`, `closed`, `error`, `timeout`
- `object-shell:list`
  - Payload: full `[]ShellSessionInfo` snapshot

`object-shell:list` is the source of truth for shell session row details.
`runtime-operations:list` is the lifecycle/cleanup view that includes shell
sessions alongside port forwards and active node drains. The Sessions status
panel only renders shell and port-forward details; drain UI remains owned by
node maintenance.

### 3) Session lifecycle, timeouts, replay

Session behavior in `backend/shell_sessions.go` and
`backend/shell_sessions_lifecycle.go`:

- Idle timeout: `30m` (`shellIdleTimeout`)
- Hard max duration: `8h` (`shellMaxDuration`)
- Buffered output replay backlog:
  - stored per session
  - bounded to `256 KiB` (`shellOutputBacklogMaxBytes`)
  - exposed via `GetShellSessionBacklog(sessionID)`
- Cluster shutdown support:
  - `StopClusterShellSessions(clusterID)` closes all sessions for that cluster and emits list/status updates.

### 4) Debug container creation

`CreateDebugContainer(clusterID, req)` delegates to `resources/pods.Service.CreateDebugContainer(...)`:

- Validates namespace/pod/image.
- Gets current pod.
- Appends `corev1.EphemeralContainer` with:
  - generated name `debug-<8 chars>`
  - chosen image
  - optional `TargetContainerName`
  - `Stdin: true`, `TTY: true`
- Calls `UpdateEphemeralContainers(...)`.
- Polls `pod.Status.EphemeralContainerStatuses` until running (or timeout).
- Returns `{ containerName, podName, namespace }`.

Operational notes captured from design docs:

- Ephemeral containers are generally Kubernetes 1.25+ (older clusters may return unsupported API errors).
- Ephemeral containers are not removed independently; they persist until pod deletion/recreation.

## Frontend architecture

### 1) Capability gating

Shell tab availability is gated by object kind + RBAC:

- Shell tab itself only appears for Pods (`constants.ts`, `TABS.SHELL.onlyForKinds = ['pod']`).
- Shell connect action reason comes from capability `shell-exec`.
- Debug action reason comes from capability `debug-ephemeral`.

`ObjectPanelContent` passes:

- `disabledReason` for shell exec constraints.
- `debugDisabledReason` for debug container constraints.
- `clusterId`, `namespace`, `resourceName`, and container candidates.

### 2) ShellTab UI/state model

`ShellTab` uses a small state machine:

- `idle` -> `connecting` -> `open`
- terminal or backend failures -> `error`
- remote close/timeout -> `closed`

Current controls behavior:

- Uses a checkbox: `Start a debug container`.
- Control rows differ for normal shell vs debug-container mode.
- Controls are hidden while session is active (`open` or `connecting`).
- Connection errors are shown in an error banner (`Connection failed: ...`).

### 3) xterm integration

`ShellTab` initializes xterm with:

- `@xterm/xterm` + `FitAddon` + `ClipboardAddon`
- custom key handling for Cmd/Ctrl+C and Cmd/Ctrl+V
- resize observer -> `ResizeShellSession(sessionId, cols, rows)`

The CSS in `ShellTab.css` includes targeted xterm overrides for:

- app-consistent scrollbar appearance
- removal of xterm right-edge artifacts (overview ruler/shadow/gutter interactions)

### 4) Reattach behavior

When the user revisits a Pod Shell tab, `ShellTab` attempts to reattach to an existing tracked session for the same `(clusterId, namespace, podName)`:

- Uses `ListShellSessions()` to find latest matching session.
- Replays buffered output via `GetShellSessionBacklog(sessionId)`.
- Buffers live events during replay and trims overlap to avoid duplicate output.
- Suppresses first resize-triggered redraw on reattach to avoid prompt duplication.
- Does not auto-close session on tab/component unmount.

### 5) Debug flow in ShellTab

When debug mode is enabled and user clicks `Start`:

1. Calls `CreateDebugContainer(clusterId, { namespace, podName, image, targetContainer })`.
2. On success:
   - disables debug mode
   - sets selected container to returned ephemeral container name
   - refreshes container discovery
   - starts normal shell connection flow
3. On failure:
   - writes failure line in terminal
   - sets `status = 'error'`
   - displays reason banner

Container discovery/normalization:

- Backend `GetPodContainers` labels names with suffixes (`(init)`, `(debug)`).
- `ShellTab` strips ` (debug)` for actual exec targets and filters out init containers.

## How components work together

### Normal shell connect

1. User presses `Connect` in Shell tab.
2. Frontend calls `StartShellSession(clusterId, request)`.
3. Backend starts stream, tracks session, emits `object-shell:list` and `object-shell:status`.
4. Frontend writes streamed output from `object-shell:output` and forwards input with `SendShellInput`.
5. Shell row details update from `object-shell:list`; global status presence
   updates from `runtime-operations:list`.

### Debug container + connect

1. User enables debug checkbox and picks image/target container/shell.
2. Frontend calls `CreateDebugContainer(...)`.
3. Backend creates/polls ephemeral container.
4. Frontend switches back to normal shell mode and calls `StartShellSession(...)` targeting new container.
5. Session is now managed identically to regular shell exec.

### Cluster-aware behavior

- All backend shell/debug methods require `clusterID`.
- Session records include `clusterId` + `clusterName`.
- Session panels can attach across clusters by switching active cluster first.
- Closing or removing a cluster tab flows through the shared frontend
  kubeconfig selection transition. Backend selection cleanup then stops
  runtime operations for clusters that left the selected set.

### Operation lifecycle registry

Shell sessions register with the backend runtime operation registry when they
start and unregister when they close, error, time out, or are stopped by cluster
lifecycle cleanup. The registry entry uses a full Pod target reference:
`clusterId`, empty group, `v1`, `Pod`, namespace, and pod name.

Cluster removal, kubeconfig clearing, explicit cluster-tab close, and app
shutdown all use the same backend cleanup path. That path is idempotent:
runtime cleanup removes the registry entry before invoking the shell cleanup
hook, so repeated close/remove paths do not double-report or resurrect a
closed session.

## Gotchas and maintenance notes

- `clusterID` is mandatory: backend returns errors for blank/non-active clusters.
- `open` status is not permanent success: stream errors can follow quickly; frontend must still handle `error/closed/timeout`.
- Keep replay dedupe logic intact when touching reattach flow:
  - `pendingReplayRef`
  - overlap trimming
  - first-resize suppression
- Do not close sessions on tab unmount by default: users expect session continuity across tab switches.
- If changing `GetPodContainers` display labels, update ShellTab normalization logic accordingly.
- Debug creation and shell exec are separate permissions; keep both capability reasons distinct in UI.
- If UI for debug mode is changed again, keep plan-doc assumptions in mind:
  - design docs originally described a segmented control, but current implementation uses a checkbox.

## Test coverage

Backend:

- `backend/shell_sessions_test.go`
- `backend/shell_sessions_error_test.go`
- `backend/resources/pods/debug_test.go`

Frontend:

- `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx`
- `frontend/src/ui/status/SessionsStatus.test.tsx`
- `frontend/src/ui/layout/ClusterTabs.test.tsx`

Recommended checks after changes:

1. Shell connect/disconnect on pod containers without regressions.
2. Reattach without duplicate backlog/live output.
3. Debug container creation success + error paths.
4. Cross-cluster attach from the runtime status panel.
5. Cluster-tab close and selector removal terminate cluster-scoped runtime
   operations through the same kubeconfig selection transition and backend
   cleanup path.
