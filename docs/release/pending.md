### Added

- Log viewer improvements
  - `logfmt` and `klog` formats are now recognized and offer Pretty and Table formatting options.
  - Filter by log level from the new Log Levels dropdown. The app makes a best-effort guess to determine the log level from unstructured log lines, and mulitline logs such as stack traces inherit the level of the previous log line.
  - Debug, warning, and error log lines get color markers on the left edge. These markers can be toggled from the Log Levels dropdown.
