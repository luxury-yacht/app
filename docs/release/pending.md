### Migration to Wails v3

Luxury Yacht v2.0.0 has migrated to the latest version of the Wails framework! Wails v3 includes many new features, both under-the-hood and user-facing.

### Added

- **Real multi-window support.** Previous versions were single-window only, and faked multi-window support by launching a completely separate process. Wails v3 includes proper support for multiple app windows.
- **Auto-updates.** The app now checks for new releases and lets you perform an in-place upgrade. Rollout supports macOS app bundles and the portable Linux distribution. Linux DEB/RPM and other unsupported installation types continue to offer the manual download path.
- **Windows update groundwork.** New Windows installers use a per-user installation, preserve user-profile settings during uninstall/migration, and prevent side-by-side installation over a legacy all-users copy. Windows update checks and self-update remain disabled until signed updater payloads are configured; legacy all-users installations must be uninstalled through Windows Installed Apps before installing the new per-user release.

### Fixed

- **Factory Reset now removes all app-owned state.** Preferences, favorites, UI persistence, updater state and staging, caches, browser storage, abandoned atomic-write files, and obsolete files under the app state roots are cleared while external kubeconfig files are preserved. Interrupted-save temp files are also discarded before runtime owners start on the next launch.
- **Windows updater release contracts.** Unpublished Windows payloads no longer produce missing-asset update errors, updater artifacts and NSIS installers now consume the same freshly built executable, Windows uninstall identity comes from one validated project configuration, post-update Installed Apps versions retain the release tag format, and migration recovery opens an existing GitHub Release instead of a missing website route.
