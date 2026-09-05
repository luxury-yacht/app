### Changed


### Fixed

- The Linux portable installer did not properly register the app icon, so it was showing the generic Wails icon. In order to fix this, you'll need to uninstall and reinstall the app.
  - `cd $HOME/.local/share/luxury-yacht`
  - run `./manage-installation uninstall`
  - Reinstall from the portable installer's `install.sh` script.
