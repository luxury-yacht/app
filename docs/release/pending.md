### Changed

- Redesigned Settings panel. Settings are now organized into Appearance, Kubeconfigs, Display, Object Panel, and Advanced sections.
  - Cleaner settings layout with more descriptive text about what the settings do.

- Updates to App Themes.
  - There is now a `default` theme that cannot be deleted and is the auto-fallback theme when no custom theme pattern matches the cluster name. Any theme changes made while not in a theme edit mode will ask to save the changes to the `default` theme.
  - Updated the light-mode default accent color from #0d9488 to #326ce5, to better tie in the app's appearance with Luxury Yacht logo colors.

- Cluster Overview pod Status and Signal cards.
  - Pod Status now separates ready, starting, failing, and terminating pods.
  - Pod Signals now show pods with restarts and pods with containers that are not ready.
  - Clicking status or signal cards opens the all-namespaces Pods view with the matching filter applied.

- Node maintenance actions are now available from context and actions menus instead of a separate Maintenance tab in the Node Object Panel.
  - Drain opens a modal with advanced options, live status, drain history, cancellation, and retry support.

- Backend resource semantics now live in a shared model under `backend/resourcemodel`. Previously, views would decide on how interpret the data, which allowed statuses and references to drift between tables, detail panels, streams, and maps. The backend now canonically manages resource identity, status, lifecycle, and object relationships, while the frontend renders the app-level models instead of reinterpreting Kubernetes semantics. The upshot of all this is more consistent data presentation throughout the app, and less risk of future drift.

- Workload, rollback, port-forward, node maintenance, and favorites flows now use stricter object and cluster identity, improving behavior when multiple clusters contain similarly named resources.

### Fixed

- Modals can no longer accidentally be closed by clicking on the backdrop.
- Open modals no longer prevent dragging the app from the title bar.
- Workload Scale modal now accurately prepopulates the current count.
- Link color preferences are applied correctly at startup.
- Event object links now use consistent link colors.
- Disambiguated "mode" and "theme". Previously, the term "theme" was used to refer to both the color themes and the light/dark modes. Now "mode" refers strictly to light/dark mode, "theme" refers to color themes.
