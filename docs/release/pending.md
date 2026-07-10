### Added

### Changed

- Refresh API TypeScript contracts are now generated from backend Go DTOs, with stale-output and domain-parity checks to prevent cross-layer drift.

### Fixed

- The "Logs are hidden for N containers" warning in the logs view now clears once it no longer applies, instead of sticking around until the logs view was closed.
- If the logs stream delivers malformed data, the logs view now shows an error instead of loading forever.
