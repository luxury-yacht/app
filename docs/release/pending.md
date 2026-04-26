### Added

- Support for Gateway API objects (closes https://github.com/luxury-yacht/app/issues/113)
  - `BackendTLSPolicy`
  - `GatewayClass`
  - `Gateway`
  - `GRPCRoute`
  - `HTTPRoute`
  - `ListenerSet`
  - `ReferenceGrant`
  - `TLSRoute`

### Changed

- Kind badge colors are now assigned by hashing the Kind name instead of being hard-coded, similar to how we assign colors to container names in the log viewer.
  - Good news - all object kinds are color-coded now, including CRDs that used to all be gray
  - Bad news - colors have changed compared to previous versions

### Fixed

- Improved behavior of `esc` to close Object Panel tabs:
  - Close the currently active tab, and open the tab to the left
  - If there are no tabs to the left, open the tab to the right
  - If there are no remaining tabs, close the panel
