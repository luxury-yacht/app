### Migration to Wails v3

Luxury Yacht v2.0.0 has migrated to the latest version of the Wails framework! Wails v3 includes many new features, both under-the-hood and user-facing.

### Added

- **Real multi-window support.** Previous versions were single-window only, and faked multi-window support by launching a completely separate process. Wails v3 includes proper support for multiple app windows.
- **Application updates.** Eligible desktop installations now check GitHub Releases automatically and let you explicitly download, verify, and restart into a signed update from the About dialog or update status control. Rollout begins with macOS; unsupported installation types continue to offer the manual download path.
