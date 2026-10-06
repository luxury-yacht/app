# Node Logs Contract

Node Logs show node proxy log files or service query output for one Node object
panel. They are snapshot/fetch based, not container log streaming.

## Agent Contract

- Pod/container log paths belong to Container Logs; keep them out of Node Logs
  source lists.
- Source discovery is node-specific and on demand. Discovery and fetches go
  through `NodeLogs/nodeLogsApi.ts` and
  `frontend/src/core/data-access/readers.ts`; discovery is cached by
  `clusterId + nodeName` and never leaks across clusters.
- Source switching resets or preserves content by an explicit policy.
- Path-backed discovery and service-backed queries have different failure and
  filtering behavior; do not merge them. Cover unsupported source types and
  empty directories.
- Node log requests set their own `Accept` header (`text/plain, */*`). The typed
  clientset negotiates protobuf-then-JSON for built-in kinds, and a node answers
  406 to a request that accepts neither.
- Search, display, toolbar, keyboard shortcuts, and copy come from the
  [shared viewer shell](overview.md#shared-viewer-shell); source selection and
  transport stay node-specific. Node Logs has no timestamp or previous-log
  shortcuts.
- Loading, error, and empty states look and sit as in Container Logs: in the
  log region below the toolbar, whose source picker must stay usable when a
  source cannot be read.
- The Buffer size setting (Settings → Logs) limits Node Logs as it limits
  Container Logs: the newest lines are kept, shrinking the setting trims at
  once, and the buffer-full indicator shows once lines have been dropped (by
  the node's 256 KB fetch limit or by the buffer) until another source is
  selected.

## Ownership

- Backend node log helpers: `backend/resources/nodes/logs.go`
- Object-panel UI: `frontend/src/modules/object-panel/components/ObjectPanel/NodeLogs`
- Permission/capability behavior:
  [../../architecture/permissions.md](../../architecture/permissions.md)

## Validation

Run focused node log backend and object-panel tests covering source switching,
refresh, search, copy, keyboard shortcuts, and scroll; test source-discovery
changes manually.
