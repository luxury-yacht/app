# Shell And Debug Container Contract

Shell exec and debug container workflows combine RBAC, pod/container identity,
streaming IO, operation lifecycle, and object-panel UI. They are cluster-scoped
runtime operations ([operation-lifecycle.md](operation-lifecycle.md)).

## Agent Contract

- Targets carry the pod's identity plus the container selection.
- Debug container creation and shell attachment are separate steps; failure in
  either must not leave ambiguous session state.
- Capability gating distinguishes regular exec, debug container creation,
  attach, and unsupported Kubernetes API behavior
  ([permissions.md](../architecture/permissions.md)).
- Sessions register with the runtime-operation registry. Terminal streams must
  not leak after tab close, panel close, cluster removal, or app shutdown.
- Reattach and backlog stay scoped to the originating cluster and session.
- Ephemeral debug containers persist on the Pod until Pod deletion; the app
  does not remove them.
- Start order: `DesktopService` routes shell commands directly to
  `OperationsCoordinator`, which resolves the caller's explicit `clusterId`
  through its narrow cluster-access collaborator, checks exec permission,
  registers the session in the runtime-operation envelope, and only then starts
  the stream. A start finishing against an older operation epoch is rejected
  instead of publishing a stale session.

## Ownership

- Shell sessions, lifecycle, backlog, executor factories, and cleanup:
  `backend.OperationsCoordinator`, implemented by `backend/shell_sessions*.go`
- Debug container creation: `backend/resources/pods/debug.go`
- Object-panel shell/debug UI: `frontend/src/modules/object-panel`

## Validation

Run focused backend shell/debug and affected object-panel tests covering
registration, events, backlog, reattach, close, cleanup, and failure paths
(no live session or misleading UI left behind); smoke-test terminal stream
behavior manually.
