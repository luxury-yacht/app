### Changed

- Removed the Maintenance tab in the Node Object Panel. Cordon, Drain, and Delete are now available in the context and actions menus.
  - Performing a drain opens an info modal. The modal exposes advanced options and shows the status of all drain attempts on that node.
- Backend resource semantics now live in a shared model under `backend/resourcemodel`. Previously, views would decide on how interpret the data, which allowed statuses and references to drift between tables, detail panels, streams, and maps. The backend now canonically manages resource identity, status, lifecycle, and object relationships, while the frontend renders the app-level models instead of reinterpreting Kubernetes semantics. The upshot of all this is more consistent data presentation throughout the app, and less risk of future drift.

### Fixed

- Links color in the theme was not being applied at startup
- Inconsistent object link colors in Events views
