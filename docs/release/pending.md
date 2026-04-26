### Added

- Support for Gateway API objects (fixes https://github.com/luxury-yacht/app/issues/113)
  - `BackendTLSPolicy`
  - `GatewayClass`
  - `Gateway`
  - `GRPCRoute`
  - `HTTPRoute`
  - `ListenerSet`
  - `ReferenceGrant`
  - `TLSRoute`

### Changed

- Kind badge colors are now auto-assigned instead of being hard-coded, using the same color palette and hashing method used to assign colors to container names in the log viewer.
  - Good news - all object kinds are now color-coded, including CRDs that used to all be gray
  - Not-as-good news - colors have changed compared to previous versions. Hopefully this doesn't bother anyone too much since the previous colors had no specific meaning, and are only intended for quick visual differentiation in a list.
- Inactive panels are dimmed to provide visual indication of where the focus is in the app.
- Design tweaks to the Details tab for `Service` and `EndpointSlice` objects

### Fixed

- Improved behavior of `esc` to close Object Panel tabs:
  - Close the currently active tab, and open the tab to the left
  - If there are no tabs to the left, open the tab to the right
  - If there are no remaining tabs, close the panel
- Fixed broken resolution of `endpointslice` names that caused an error when viewing YAML
- Improved mouse selection handling in the Command Palette
