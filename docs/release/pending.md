### Migration to Wails v3

Luxury Yacht v2.0.0 has migrated to the latest version of the Wails framework! Wails v3 includes many new features, both under-the-hood and user-facing.

### Added

- **Real multi-window support.** Previous versions were single-window only, and faked multi-window support by launching a completely separate process. Wails v3 includes proper support for multiple app windows.
- **Auto-updates.** The app now checks for new releases and lets you perform an in-place upgrade. Rollout supports macOS app bundles and the portable Linux distribution. Linux DEB/RPM and other unsupported installation types continue to offer the manual download path.
- **Windows update groundwork.** New Windows installers use a per-user installation, preserve user-profile settings during uninstall/migration, and prevent side-by-side installation over a legacy all-users copy. Windows self-update remains disabled until the executable and installer signing rollout is complete.

### Fixed

- **Factory Reset now removes all app-owned state.** Preferences, favorites, UI persistence, updater state and staging, caches, browser storage, abandoned atomic-write files, and obsolete files under the app state roots are cleared while external kubeconfig files are preserved. Interrupted-save temp files are also discarded before runtime owners start on the next launch.
