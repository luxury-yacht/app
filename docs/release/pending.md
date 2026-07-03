### Added

### Changed

- The namespace list no longer polls every 2 seconds: a server-side doorbell
  announces namespace changes and workload-presence flips (including the
  first-load "workloads unknown" settling), and the sidebar refetches only then.
- Table data now refreshes purely on server push while streams are healthy: live
  CPU/memory usage is joined into rows by the backend at serve time, and a new
  server-side "metric doorbell" tells the app when fresh metrics were collected
  — eliminating client-side polling, the multi-request metric overlay, and the
  giant row-key query strings. CPU/memory sorting runs server-side with correct
  pagination.
- The Object Panel Events tab no longer polls every 10 seconds: a per-object
  server-side doorbell announces new events for the panel's object, and the tab
  refetches only then (the poll remains as a fallback while the stream is down).

### Fixed

- The "Awaiting metrics data..." banner now appears even when nothing else is
  changing in the cluster: metric staleness is evaluated in the app from the
  sample's collection time, so a stopped or broken metrics-server surfaces as
  stale data instead of silently showing outdated usage numbers forever.
