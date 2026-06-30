### Added

### Changed

- The app no longer injects cloud-provider install locations (Google Cloud SDK and
  Caskroom paths) into `PATH` at startup, and no longer probes for
  `gke-gcloud-auth-plugin`. Kubeconfig is treated as the auth contract: a kubeconfig's
  `exec` credential helper is still honored, resolved through your login-shell `PATH`
  plus generic desktop directories (`/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`,
  `$HOME/.local/bin`). If a credential helper was previously found only because the app
  added a provider-specific directory, put that helper on your login-shell `PATH`, use an
  absolute `command` in the kubeconfig, or install it in one of the generic directories.

### Fixed

- Object Panel → Details now refreshes when the underlying object changes (e.g. a
  Deployment's container image tag). The details snapshot previously carried a constant
  source-version ETag, so the backend kept replying "not modified" and the panel showed
  stale content for the rest of the session. The object's `resourceVersion` is now the
  details source clock, and the header-metadata cache is evicted on change (which also
  keeps the "Last Modified" field current). Applies to every kind, including custom
  resources.
