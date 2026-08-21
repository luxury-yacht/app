### Migration to Wails v3

Luxury Yacht v2.0.0 has migrated to the latest version of the Wails framework! Wails v3 includes many new features, both under-the-hood and user-facing.

### Added

- **Real multi-window support.** Previous versions were single-window only, and faked multi-window support by launching a completely separate process. Wails v3 includes proper support for multiple app windows.
- **Auto-updates.** The app now checks for new releases and lets you perform an in-place upgrade. Rollout supports macOS app bundles, Windows NSIS installations, and the portable Linux distribution. Linux DEB/RPM and other unsupported installation types continue to offer the manual download path.
- **Windows auto-updates.** The per-user installer is the recommended default and updates without elevation. An all-users installer remains available for managed or shared machines; those installations detect new releases and use the current installer instead of requesting special updater privileges. Windows updater downloads are authenticated by the signed updater manifest, but the executables and installers are not yet Authenticode-signed and may be blocked by restrictive Windows application-control policies.

### Fixed

- **Factory Reset now removes all app-owned state.** Preferences, favorites, UI persistence, updater state and staging, caches, browser storage, abandoned atomic-write files, and obsolete files under the app state roots are cleared while external kubeconfig files are preserved. Interrupted-save temp files are also discarded before runtime owners start on the next launch.
- **Windows updater release contracts.** Unpublished Windows payloads no longer produce missing-asset update errors, updater artifacts and both NSIS installer scopes now consume the same freshly built executable, Windows uninstall identity comes from one validated project configuration, and post-update Installed Apps versions retain the release tag format.
