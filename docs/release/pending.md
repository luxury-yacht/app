### Fixed

- Refresh now recovers automatically when Kubernetes permissions are restored, without requiring an app restart.
- Failed data refreshes retry with backoff while retaining the last available data.
- Resource streams reconnect after delivery overflow; oversized reconnect replays request a fresh snapshot to avoid repeated disconnects.
- Replacing a cluster connection now stops the previous object catalog and releases its generation's resources.

- The Linux portable installer did not properly register the app icon, so it was showing the generic Wails icon. In order to fix this, you'll need to uninstall and reinstall the app.
  - `cd $HOME/.local/share/luxury-yacht`
  - run `./manage-installation uninstall`
  - Reinstall from the portable installer's `install.sh` script.
