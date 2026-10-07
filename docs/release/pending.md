### Changed

- Columns dropdown menu changed to an icon to save space and reduce visual clutter. Functionality is the same.
- PodDisruptionBudget details reorganized into Health and Budget sections.
  - Health shows a healthy-pods bar against the required count, and whether evictions are allowed or why they are blocked (unhealthy pods, a budget that requires every pod, no matching pods, or a controller error).
  - Pods with an eviction in progress are listed and link to the pod.
  - Budget shows the full pod selector, including match expressions and the empty/missing selector cases, plus the unhealthy pod eviction policy.

### Fixed

- Paste from clipboard into a shell session no longer prompts with a context menu to confirm the paste.
