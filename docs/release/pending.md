This is a code refactoring and bug-fix release. No new features.

### Fixed

- Permission denials, expired credentials, and missing Kubernetes objects no longer fire Sentry error reports.
- Canceled permission checks no longer produce bursts of duplicate error reports after a cluster connection fails.
- Cluster client access no longer stalls behind an authentication failure scan holding the client-pool lock.
- Node log discovery no longer hangs when directory traversal fills the worker queue.
- Reordering favorites preserves every saved item, and cluster filters preserve case-distinct cluster identities.
- Node drain history is isolated by cluster.
- Port-forward sessions are cleaned up when their first connection attempt fails.
- Attention rows and counts respect current permissions; an empty authorized query scope returns no retained objects.
- Rollback dialogs discard history from a previously selected cluster and release their pending-action guard after failures.
- Error reporting deduplicates independently for each cluster.
- Object-panel permission checks finish even while another cluster reports authentication recovery progress.
- Table preferences save while resource rows continue refreshing.
- Custom-resource menus report invalid resource data without interrupting the table.
- Browse and custom-resource views now update promptly after resource changes. CRD version migrations and large startup replays no longer trigger unnecessary full catalog refreshes.
- Live catalog updates no longer rebuild the entire query store for each object change.
- Moving a cluster tab to a new window preserves its docked panels, tab order, and selected views.
- Closing an object panel no longer lets a pending render recreate its removed layout.
- Closed diagnostics panels stop observing refresh writes and scanning resource-stream telemetry.
