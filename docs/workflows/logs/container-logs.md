# Container Logs Contract

Container Logs show Kubernetes pod/workload container log output in the Object
Panel. They are not Application Logs and they are not Node Logs.

## Agent Contract

- Preserve full object identity from object panel target to backend log scope.
- Live streaming and manual/fallback fetch must consume the same canonical log
  scope.
- Workload targets resolve to bounded pod/container targets before backend log
  retrieval.
- Frontend filters such as search, regex, display mode, timestamps, wrapping,
  and ANSI rendering must not change backend target identity.
- Previous logs, tail lines, follow, timestamps, and target caps are backend log
  query concerns.
- Do not start both duplicate scoped-domain enablement and explicit stream
  startup paths for the same consumer.
- Initial stream snapshots must replace preserved client buffers when the scope
  changes.

## Ownership

- Backend pod log helpers: `backend/resources/pods/logs.go`
- Container log stream: `backend/refresh/containerlogsstream`
- Object-panel log viewer and controls:
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- Refresh/log scopes: `frontend/src/core/refresh`
- Data access: [../../architecture/data-access.md](../../architecture/data-access.md)

## Change Checklist

When changing container logs:

1. Trace object/workload identity into the log scope.
2. Confirm live stream and fallback fetch agree on target selection.
3. Verify scope changes reset or preserve buffers deliberately.
4. Keep frontend filters separate from backend target reduction.
5. Test pod, workload, missing container, previous logs, fallback, and stream
   cleanup behavior as relevant.

## Validation

Run focused backend log/stream tests and object-panel log viewer tests. Manual
stream smoke testing is appropriate for transport changes.
