### Added

- Multi-window improvements!
  - Make clusters and panels work together across multiple windows. Panels are now owned by a cluster instead of a parent window. Opening the same cluster in two app windows gives both windows access to the same panels.
  - Panel windows now show the owning cluster’s name.
  - Drag tabs between windows, or drag a tab out to create a window where you dropped it. Dragging the last tab out of a window closes the window.
  - Closing a cluster’s last tab closes its panel windows. Closing one of several tabs for that cluster keeps its panels available. Closing an app window also leaves floating panels open.
  - Closing or quitting checks for unsaved changes in the YAML editor. Restarting restores the clusters that were open.

### Fixed

- Refresh now recovers automatically when Kubernetes permissions are restored, without requiring an app restart.
- Failed data refreshes retry with backoff while retaining the last available data.
- Resource streams reconnect after delivery overflow; oversized reconnect replays request a fresh snapshot to avoid repeated disconnects.
- Replacing a cluster connection now stops the previous object catalog and releases its generation's resources.
- Fix a regression for expired or missing SSO credentials. The app again shows instructions to sign in instead of spinning forever or incorrectly asking you to install the AWS CLI.
