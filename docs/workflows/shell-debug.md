# Shell And Debug Container Contract

Shell exec and debug container workflows combine RBAC, pod/container identity,
streaming IO, operation lifecycle, and object-panel UI. Treat them as
cluster-scoped runtime operations.

## Agent Contract

- Shell/debug targets must carry `clusterId`, pod identity, namespace, and
  container selection.
- Debug container creation and shell attachment are separate steps; failure in
  one must not leave ambiguous session state.
- Session lifecycle must register with runtime operations and clean up on
  cluster removal.
- Terminal streams must not leak after tab close, panel close, cluster removal,
  or app shutdown.
- Capability gating must distinguish regular exec, debug container creation,
  attach, and unsupported Kubernetes API behavior.
- Reattach/backlog behavior must remain scoped to the originating cluster and
  session.
- Ephemeral debug containers persist on the Pod until Pod deletion; the app does
  not independently remove them.

## Ownership

- Backend shell sessions and lifecycle: `backend/shell_sessions*.go`
- Debug container creation: `backend/resources/pods/debug.go`
- Runtime operation registry: `backend/runtime_operations.go`
- Object-panel shell/debug UI: `frontend/src/modules/object-panel`
- Permission/action capability rules:
  [../architecture/permissions.md](../architecture/permissions.md)
- Operation cleanup: [operation-lifecycle.md](operation-lifecycle.md)

## Change Checklist

When changing shell/debug behavior:

1. Trace target identity from object panel to backend session start.
2. Check RBAC/capability state for exec, attach, and debug creation separately.
3. Verify session registration, event emission, backlog, reattach, close, and
   cleanup.
4. Confirm cluster removal cleans streams and runtime registry rows.
5. Test failure paths without leaving live sessions or misleading UI state.

## Validation

Run focused backend shell/debug tests and affected object-panel frontend tests.
Manual smoke testing is appropriate for terminal stream behavior.
