### Added

- Object Map support for `PodDisruptionBudget` and `NetworkPolicy`.
- Kubernetes API diagnostics and controls.
  - Advanced Settings now include Kubernetes API QPS, burst allowance, and permission-check concurrency controls.
  - Diagnostics panel now shows per-cluster Kubernetes API request rates, configured QPS/burst values, total requests, throttling responses, server errors, and last request timing.
- Sidebar display preferences in Settings.
  - Dimming namespaces with no workloads can be disabled
  - Namespace expansion can now be configured to keep only one namespace open at a time or multiple namespaces open.

### Changed

- Settings, modal, icon, and command palette polish.
  - Common modal headers now use a more consistent title and close-button treatment.
  - Consistent icons and more logical item arrangement in the command palette.
  - Settings sections use clearer icons and labels.
- Improved Object Map zoom behavior.
  - Auto-fit now limits maximum zoom so small maps do not over-enlarge.
  - Map rendering now responds better to app zoom changes without unexpectedly refitting the view.
- Numeric inputs no longer have spinner controls and are right-aligned for readability.
- Themes now use an internal pattern matcher instead of filename globbing.

### Fixed

- Letters with descenders (j, g, y) should no longer be clipped in Windows.
- Workload readiness during rollouts now uses live Pod readiness counts when available, making rollout status more accurate.
- Map tabs no longer show manual-refresh state while they are only waiting for their first snapshot.
- Selecting a view before refresh data is ready now populates once the data arrives.
- Kind badge hover styling no longer clips the bottom border.
- Event badges render with the correct success/warning styles.
