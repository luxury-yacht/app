### Added

- Error notifications now have a Copy button that copies the error to the clipboard.
- An object panel's Details tab now shows a "Last Modified" time reflecting the object's most recent spec/metadata change (when available).
- Ingress and Gateway hostnames in the object panel now show small `https`/`http` links that open the host in your browser.

### Changed

- Switching tabs in the object panel triggers fewer re-renders, so the panel feels more responsive.
- The object map refreshes more efficiently, issuing fewer redundant data calls.

### Fixed

- Tables now load as soon as their own data is ready during cluster connection: one slow or failing watch (for example a misbehaving CRD or restricted resource) no longer delays every other view's first load.
- Authentication errors reported by the cluster are now detected reliably even when the underlying error output is split across multiple reads.
- Fixed a race condition in automatic auth-recovery checks that could cause a hang.
- Fixed a potential resource leak where a custom-resource watch could be recreated after its cluster had been shut down.
- Port-forward session status is now a closed, typed set on both the backend and frontend, preventing invalid status values.
- Massive refactor consolidating resource logic behind a single registry. 700+ files changed. This is a cleanup effort intended to make life easier for app development. There is no user-facing impact (🤞) but it's a big enough change that it's worth mentioning.
