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
- Shared viewer behavior may be reused, but source selection and transport stay
  node-log specific.

## Ownership

- Backend node log helpers: `backend/resources/nodes/logs.go`
- Object-panel node log UI:
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- Permission/capability behavior:
  [../../architecture/permissions.md](../../architecture/permissions.md)

## Change Checklist

When changing node logs:

1. Trace Node identity and `clusterId` from object panel to backend request.
2. Check source discovery, unsupported states, and empty directory handling.
3. Verify source switching, refresh, search, copy, and scroll behavior.
4. Keep container log paths hidden from node log source lists.
5. Test supported and unsupported source types.

## Validation

Run focused node log backend and object-panel frontend tests. Manual testing is
appropriate when changing source discovery.
