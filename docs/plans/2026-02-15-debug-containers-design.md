# Ephemeral Debug Containers — Design

**Status:** ✅ Implemented (February 16, 2026). Backend and frontend changes are in place; manual smoke validation remains part of rollout verification.

## Overview

Add the ability to create Kubernetes [ephemeral containers](https://kubernetes.io/docs/concepts/workloads/pods/ephemeral-containers/) on a running pod and immediately shell into them, all from within the existing Shell tab.

**Scope:** Minimal first pass. No new tabs or panels. The Shell tab gains a debug mode with an image selector, target container picker, and a "Debug" button. After creating the ephemeral container, the existing shell connection flow handles exec-ing into it.

## What Changes

| Layer | What's added |
|-------|-------------|
| **Backend Go** | `CreateDebugContainer(clusterID, DebugContainerRequest) → DebugContainerResponse` — uses the Kubernetes ephemeral containers subresource API |
| **Frontend Shell tab** | Debug mode toggle, image dropdown (presets + custom), target container dropdown, Debug button |
| **Types** | `DebugContainerRequest` struct and response |

## Backend: `CreateDebugContainer`

**New file:** `backend/resources/pods/debug.go`

The function will:

1. Fetch the current pod spec.
2. Append a new `EphemeralContainer` to `pod.Spec.EphemeralContainers` with:
   - Auto-generated name: `debug-<short-uuid>` (e.g., `debug-a1b2c3`).
   - The user-chosen image.
   - `TargetContainerName` set to the selected target container (enables process namespace sharing).
   - `Stdin: true`, `TTY: true` (so the shell can attach).
3. Call the ephemeral containers subresource API: `Pods(namespace).UpdateEphemeralContainers(ctx, name, pod, ...)`.
4. Poll the pod status (short timeout, ~30s) until the ephemeral container reaches `Running` state.
5. Return the ephemeral container name so the frontend can immediately connect a shell to it.

**New app-level wrapper in `backend/resources_pods.go`:**

```go
func (a *App) CreateDebugContainer(clusterID string, req DebugContainerRequest) (*DebugContainerResponse, error)
```

Follows the same `resolveClusterDependencies` pattern as `DeletePod`, `GetPod`, etc.

**Important considerations:**

- Ephemeral containers require Kubernetes 1.25+ (feature went GA there). Handle the API error gracefully if the cluster is too old.
- Once created, ephemeral containers cannot be removed — they exist until the pod is deleted. The UI makes this clear to the user.

## Frontend: Shell Tab Changes

The Shell tab toolbar currently has: `[Container dropdown] [Shell dropdown] [Connect button]`

A mode toggle is added to switch between **Shell mode** (current behavior) and **Debug mode**.

### Debug mode toolbar

`[Image dropdown] [Target container dropdown] [Shell dropdown] [Debug button]`

### Mode switching

- A segmented control at the left of the toolbar: `Shell | Debug`.
- In **Shell mode**, everything works exactly as today.
- In **Debug mode**, the container dropdown is replaced by:
  - **Image dropdown** — presets (`busybox:latest`, `alpine:latest`, `nicolaka/netshoot:latest`) plus a "Custom..." option that reveals a text input.
  - **Target container dropdown** — populated from `availableContainers` (same source as the current container dropdown). This is the container whose process namespace the debug container will share.

### Flow when user clicks Debug

1. Button shows "Creating..." (disabled state).
2. Calls `CreateDebugContainer(clusterId, { namespace, podName, image, targetContainer })`.
3. Backend returns the ephemeral container name once it's running, or returns an error if the container fails to start within the poll timeout.
4. On success, frontend automatically switches to Shell mode, sets the container dropdown to the new ephemeral container name, and initiates a shell connection.
5. On error (timeout or API failure), the error is displayed in the terminal area.
6. User lands in a live terminal inside the debug container.

### Container list integration

The ephemeral container name gets added to the container dropdown, making it available for future shell reconnects and log viewing via the Logs tab.

### Error handling

- If the cluster doesn't support ephemeral containers, show the API error in the terminal placeholder area (same pattern as shell connection errors today).
- A small warning note in Debug mode: "Debug containers persist until the pod is deleted."

## Testing

### Backend tests (`backend/resources/pods/debug_test.go`)

- Success path: mock the Kubernetes client, verify the ephemeral container subresource API is called with correct image, target container, stdin/tty flags.
- Container name generation: verify `debug-<uuid>` format.
- Polling: mock pod status responses to test the wait-for-running logic, including timeout.
- API error: simulate a 404/unsupported response for clusters < 1.25.
- Missing cluster dependencies: verify proper error propagation.

### Frontend tests (`ShellTab.test.ts` additions)

- Mode toggle switches between Shell and Debug toolbar layouts.
- Debug button calls `CreateDebugContainer` with selected image and target container.
- On success, container dropdown updates and shell auto-connects.
- On error, placeholder message displays the error.
- Custom image input appears when "Custom..." is selected.
- Debug button disabled states (during creation, when no image selected).
