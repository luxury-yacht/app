### Changed

- Improved layout of Object Maps so it makes more of an attempt to fit into the available space without scrolling.
- Removed Focus Mode from Object Maps.
- New Object Map for Helm objects shows only objects created by the Helm chart. Objects in the Helm chart manifest that no longer exist in the cluster appear as dashed "not found" cards.
- Improved Helm Values tab. It now clearly shows defaults and overrides. Overrides are shown with a mark and color.
  - `>` indicates an override that is modified from the default.
  - `=` indicates an override that exactly matches the default.
  - `+` indicates a new override value that is not in the defaults.
  - `-` indicates a values that has been removed from the defaults.
  - Hovering over an override line shows the default value.
- Scrollbars are easier to find. They are wider and higher-contrast, and appear when an area first becomes scrollable, while scrolling, and while the pointer moves over the area. They fade out after one second of inactivity and widen when hovered.

### Fixed

- Helm values copied from the Values tab keep strings such as `yes`, `on`, and `off` quoted, so Helm no longer reads them back as booleans.
