### Changed

- Misc performance enhancements and fixes for Object Maps.
- Helm releases:
  - New Map tab showing the objects the release created and the links between them. Objects the release's manifest names that are no longer in the cluster appear as dashed "Not found" cards. Helm release rows also offer **Open Map**.
  - The Values tab's Defaults view shows the chart's own defaults, including subchart defaults, settings you overrode, and empty settings such as `podAnnotations: {}`.
  - The Values tab's Merged and Overrides views mark each line your overrides set: `>` for a changed chart default, `+` for a new setting, `=` for one that matches the default, and `-` for a removed key, with overridden keys, including keys inside a replaced list, colored to match. Hover a marked line to see the chart default it replaced. In Merged, keys removed with a `null` override appear as struck-through rows, and subchart copies of overridden `global` values are marked too.
  - The Values tab remembers whether you were on Defaults, Overrides, or Merged when you switch to another tab and back.
  - The Values and Manifest tabs read the release once per refresh instead of up to five times.

### Fixed

- Helm releases: values copied from the Values tab keep strings such as `yes`, `on`, and `off` quoted, so Helm no longer reads them back as booleans.
