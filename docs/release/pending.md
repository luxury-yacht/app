### Added

- Support for Gateway API resources in the Object Map.

### Changed

- HPA-managed workloads now show state-appropriate `Scale to 0` or
  `Resume from 0` actions instead of a disabled scale placeholder, while regular
  workloads keep the existing `Scale` action.
- The workload scale modal now includes a direct `Scale to 0` action with
  confirmation before applying the change.
- Resource refresh and streaming are now more consistently scoped per cluster.
  - Background refresh fans out as separate per-cluster work instead of relying on aggregate refresh scopes.
  - Resource streams now resume, resync, and fall back to snapshots more predictably when connections reset or data drift is detected.
- GridTable behavior is more consistent across resource tables.
  - Filtering, CSV export, column sizing, column visibility, keyboard navigation, focus handling, and persisted table state now share the same underlying table logic.
- Container Logs and Node Logs now share more of the same viewer behavior.
  - Search, filtering, JSON parsing, copy/export behavior, ANSI rendering, and scroll restoration are more consistent between the two log surfaces.
- App preferences are now saved through a unified settings path.
  - Settings use backend-provided defaults, validation, and bounds.
  - Failed preference saves roll back optimistic frontend changes instead of leaving the UI and persisted settings out of sync.

### Fixed

- Refresh rejects multi-cluster scopes by default, preventing accidental mixed-cluster state from being written to the refresh store.
- Resource stream connection health and diagnostics are more accurate during reconnects, resets, and visibility changes.
- GridTable row and cell lookups handle cluster-scoped keys and column keys without unsafe assumptions.
- Node log fetching routes through the shared cluster data-access policy, so paused refresh behavior and diagnostics are handled consistently.
