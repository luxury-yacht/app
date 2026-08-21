### Migration to Wails v3

Luxury Yacht v2.0.0 has migrated to the latest version of the Wails framework! Wails v3 includes many new features, both under-the-hood and user-facing.

### Added

- **Real multi-window support.** Previous versions were single-window only, and faked multi-window support by launching a completely separate process. Wails v3 includes proper support for multiple app windows.
- **Auto-updates.** The app now checks for new releases and lets you perform an in-place upgrade. Rollout supports macOS app bundles, Windows NSIS installations, and the portable Linux distribution. Linux DEB/RPM and other unsupported installation types continue to offer the manual download path.
  - For Windows, please note that these are still unsigned executables. I am looking into options for an affordable signing certificate. Also note that the per-user installer is recommended. The all-users installer will not auto-update.

### Fixed

- Factory Reset in Settings -> Advanced now properly removes ALL saved state. Preferences, favorites, UI persistence, updater state and staging, caches, browser storage, abandoned atomic-write files, and obsolete files under the app state roots are all deleted. Interrupted-save temp files are also discarded on app startup. Factory Reset also completes when automatic updates were disabled by an invalid or foreign temp root, while leaving that unowned path untouched.
