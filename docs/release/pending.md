### Changed

- Misc performance enhancements and fixes for Object Maps.
- Helm releases:
  - The Values tab's Defaults view shows the chart's own defaults, including subchart defaults, settings you overrode, and empty settings such as `podAnnotations: {}`.
  - The Values tab's Merged and Overrides views mark each line your overrides set, colored by whether it changed a chart default, added a new setting, or matches the default. Hover a marked line to see the chart default it replaced. In Merged, keys removed with a `null` override appear as struck-through rows, and subchart copies of overridden `global` values are marked too.
  - The Values tab remembers whether you were on Defaults, Overrides, or Merged when you switch to another tab and back.
  - The Values and Manifest tabs read the release once per refresh instead of up to five times.

### Fixed

- Helm releases: values copied from the Values tab keep strings such as `yes`, `on`, and `off` quoted, so Helm no longer reads them back as booleans.
