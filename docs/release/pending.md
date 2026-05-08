### Changed

- Removed the Node Maintenance tab in favor of standard context menu actions for Cordon, Drain, and Delete.
  - Cordon and Delete use standard confirmation modals.
  - Drain opens an info modal to start a drain, exposes drain options, and shows the status of all drain attempts on that node.
- Backend resource semantics now live in a shared model under `backend/resourcemodel`. Previously, multiple backend and frontend views could independently interpret the same
  Kubernetes data, which allowed statuses and references to drift between tables, detail panels, streams, and maps. The backend now canonically derives resource identity,
  status, lifecycle, and object relationships, while the frontend renders those app-level models instead of reinterpreting Kubernetes semantics.
  - Table views, details, streams, maps, and events use the shared model where applicable. App infrastructure, raw content tabs, operational workflows, permissions, and aggregate dashboards do not.
