# Node Logs Contract

Node Logs show node proxy log files or service query output for a specific Node
object panel. They are snapshot/fetch based, not container log streaming.

## Agent Contract

- Node log reads must preserve `clusterId` and Node object identity.
- Do not show pod/container log paths in Node Logs; those belong to Container
  Logs.
- Source discovery is node-specific and on demand.
- Source switching should clearly reset or preserve content by policy.
- Path-backed discovery and service-backed queries have different failure and
  filtering behavior; do not merge them accidentally.
- Node log requests set their own `Accept` header (`text/plain, */*`). The
  typed clientset they go through negotiates protobuf-then-JSON for built-in
  kinds, and a node answers 406 to a request that accepts neither.
- Search, display, toolbar, keyboard shortcuts and copy come from the shared
  viewer shell ([overview.md](overview.md#shared-viewer-shell)); source
  selection and transport stay node-log specific. Node Logs has no timestamp or
  previous-log shortcuts.
- Loading, error and empty states look and sit as in Container Logs: in the log
  region below the toolbar, which holds the source picker and must stay usable
  when a source cannot be read.
- The Buffer size setting (Settings → Logs) limits Node Logs as it limits
  Container Logs: the newest lines are kept, shrinking the setting trims at once, and the
  buffer-full indicator shows once lines have been dropped (by the node's
  256 KB fetch limit or by the buffer) until another source is selected.

## Ownership

- Backend node log helpers: `backend/resources/nodes/logs.go`
- Object-panel node log UI:
  `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs`
- Shared log viewer infrastructure:
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- Permission/capability behavior:
  [../../architecture/permissions.md](../../architecture/permissions.md)

Node log discovery and fetches go through
`frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi.ts`
and `frontend/src/core/data-access/readers.ts`. Discovery is cached by
`clusterId + nodeName`; do not leak results across clusters.

## Change Checklist

When changing node logs:

1. Trace Node identity and `clusterId` from object panel to backend request.
2. Check source discovery, unsupported states, and empty directory handling.
3. Verify source switching, refresh, search, copy, keyboard shortcuts, and
   scroll behavior.
4. Keep container log paths hidden from node log source lists.
5. Test supported and unsupported source types.

## Validation

Run focused node log backend and object-panel frontend tests. Manual testing is
appropriate when changing source discovery.
