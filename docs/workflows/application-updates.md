# Application Updates

Wails v3 downloads, verifies, stages, replaces, and relaunches. Luxury Yacht
owns release discovery, installation eligibility, user consent, process
lifecycle, durable helper reconciliation, and release publication. The website
hosts only manual recovery guidance, never discovery or payload delivery.

## Runtime and user contract

- One process-wide `backend.UpdateCoordinator`, started by the first
  runtime-ready workspace: reconcile a prior helper attempt, check silently,
  then every six hours. All windows read and act on the same snapshot and
  `app-update` event. Checks and downloads are cancellable.
- Checks only discover. The header status control is a label and entry point to
  About, the single surface for release notes, progress, failures, and recovery.
  `frontend/src/ui/status/updatePresentation.ts` supplies status copy, badge,
  tone, and release identity to both, so they cannot disagree.
- **Download Update** is explicit consent to download and stage one known
  version. **Restart to Update** is separate consent to persist the handoff,
  quit all peers through the normal lifecycle, replace, and relaunch. No
  updater-owned window, background download, or forced restart.
- Stable builds accept only newer stable releases; beta builds accept newer beta
  or stable (beta-to-stable convergence). Skip suppresses automatic
  presentation of that exact normalized version; a manual check may show it.

## Installation eligibility

Discovery and in-place installation are separate capabilities, and checking
requires the platform/architecture payload to be enabled.

| Installation | Check | Self-update | Required evidence / fallback |
| --- | --- | --- | --- |
| macOS app bundle | Yes | Yes when the volume and bundle parent are writable | Otherwise open the authenticated macOS download. |
| Windows NSIS, per-user | Yes | Yes | Valid adjacent `luxury-yacht.install.json` with product ID, `nsis`, `user` scope. |
| Windows NSIS, machine | Yes | No | Exact HKLM ownership plus a valid adjacent machine marker; an otherwise identical legacy registration substitutes only when no marker exists. Open the authenticated Windows download. |
| Linux portable, per-user | Yes | Yes when the target's parent supports create-and-rename | Valid adjacent marker with `portable`, `user`; otherwise offer the portable download. The running executable cannot be opened for write (`ETXTBSY`); Wails replaces it after the parent exits. |
| Linux DEB/RPM | Yes, with a valid system package marker | No | Explain package-manager ownership; open package choices. |
| Development, invalid, or unknown | No | No | Explain updates are unavailable; offer downloads. |

- Never infer ownership from a path or filename. Marker schema, product,
  distribution, scope, and exact location form the eligibility boundary in
  `internal/updateidentity`.
- `luxuryYacht.updaterTargets` in `build/config.yml` is the single publication
  and eligibility list, embedded at build and required by release tooling. A
  build whose target is absent never initializes the provider or checks, so an
  unpublished payload cannot cause recurring missing-asset errors.

### Windows distribution

- Releases publish a recommended per-user NSIS installer (LocalAppData) and an
  optional all-users one (Program Files); each writes an adjacent marker with
  its scope. The package task builds once: the raw versioned updater executable
  is a byte-for-byte copy of the binary inside `user-installer.exe` and
  `system-installer.exe`. Release jobs check its exact name, PE header, and
  architecture and authenticate its digest through the signed `updater.json`.
- Legacy all-users installs (no marker) are recognized only when the exact
  64-bit HKLM uninstall registration names the running executable and its
  adjacent uninstaller; marked machine installs need the same registration.
  Both may check but never stage or replace; the update action opens the
  authenticated download. Automatic update never requests UAC or changes scope.
- The per-user installer refuses to install over an all-users registration
  (exit code 66; interactively offers Windows Installed Apps). Scope changes
  are an explicit uninstall/reinstall.
- After a raw-executable swap, startup reconciles and clears the durable attempt
  first; per-user installs then revalidate the marker and HKCU uninstall
  registration before updating `DisplayVersion` (all-users metadata stays
  installer-owned). Both keep the configured `v`-prefixed version.
- CI runs Windows-native identity tests and a silent installer drill for amd64
  and arm64 (`build/windows/package-drill.ps1`) proving each scope's marker and
  registry ownership, installer-owned file removal, user-profile settings
  preservation, side-by-side refusal, and cleanup after partial failure. The
  premerge gate cross-vets both architectures. Wails refuses a download unless
  its SHA-512 digest and Ed25519ph signature match the embedded public key.
- Known gap: no Authenticode signing, so Smart App Control or enterprise App
  Control may block the app. Authenticode is future hardening, not the payload
  integrity boundary. With a certificate, sign the executable before the raw
  copy and NSIS packaging, then sign the installer; artifact format and
  eligibility stay unchanged.

### Linux distributions

- One binary per architecture feeds DEB, RPM, the portable installer, and the
  updater archive. DEB/RPM own `/usr/share/luxury-yacht/install.json`
  (`deb`/`rpm`, `system`), removed with the package; it never makes the
  executable replaceable.
- The manual `-portable.tar.gz` `install.sh` installs without elevation below
  `${XDG_DATA_HOME:-$HOME/.local/share}/luxury-yacht`, writes the adjacent
  marker (`portable`, `user`), and installs the desktop entry and icon under the
  same data home. Upgrades validate the installed marker through the same
  schema/product/distribution/scope boundary, not byte equality with the next
  archive's marker.
- Desktop entry and icon use `org.wails.luxury_yacht`, the GTK app ID Wails
  derives from runtime name `Luxury Yacht`; keep them aligned when renaming or
  upgrading Wails so Wayland docks match windows to the launcher. Rerunning the
  installer migrates a former `luxury-yacht.desktop` that points here;
  binary-only updates never migrate desktop integration.
- `manage-installation uninstall` removes only that verified installation, and
  the UID-derived updater temp root only when its full ownership marker matches
  and every child has an updater staging or helper-log shape; lookalike roots or
  unknown entries are kept.
- The portable runtime needs GTK 4 and WebKitGTK 6.0 (archive README lists
  Debian/Ubuntu and Fedora/RHEL packages).
- `-updater.tar.gz` is a single-entry tar holding only the executable (the
  suffix prevents confusion with the portable installer) and the sole Linux
  `updater.json` artifact; installer tar, DEB, RPM, and AppImage are manual.
  Pre-publication Wails extraction conformance must yield exactly one executable
  regular file with the configured binary name.

## Release and trust contract

- A public GitHub Release is the complete update unit: manual installers,
  enabled updater payloads, and exactly one `updater.json` giving version,
  channel, and per payload the immutable asset URL, filename, size, SHA-512
  digest, and Ed25519ph signature.
- The runtime picks an eligible release, then fetches that release's
  `updater.json`. Missing, duplicate, oversized, malformed, or mismatched
  metadata (URL, filename, size, platform, architecture, version, channel,
  digest, signature) fails closed. Wails verifies the payload against the
  manifest and the embedded public key.
- Release tooling takes the target list from `build/config.yml` and exact
  payload names, rejecting directories, globs, installers in place of payloads,
  duplicates, missing targets, and ambiguous files.
- Job order: build manual and updater artifacts (platform-native signing where
  required); validate each payload as the exact target Wails swaps; create and
  sign one `updater.json` and verify every payload against the embedded key;
  upload all with `gh release create --draft`; publish only via the final
  `gh release edit --draft=false`.
- A manual **Release** dispatch is a full dry run unless **Create GitHub
  release** is checked: tests, all builds and package drills, aggregation,
  manifest signing/verification, asset discovery, release notes, and exact
  publication inputs, kept as the `prepared-release-assets` artifact.
  `RELEASE_DRY_RUN=true` stops before any GitHub Releases call, and the website
  update does not run. The checked input or a matching version tag lets the
  separately permissioned publication job consume that artifact, reject an
  existing release, and create it.
- Local check with a complete `artifacts/`:
  `RELEASE_DRY_RUN=true mise exec -- wails3 task release:app`.
- Never overwrite a release automatically. A failed upload or publish leaves an
  operator-inspected draft; repair or delete it and rerun everything. Release
  publication is the only rollout pointer (no site, branch, mutable manifest, or
  cache invalidation).

Before a stable rollout, drill that recovery against a disposable repository
(`cmd/project/release_draft_drill.go`):

```sh
RELEASE_DRAFT_DRILL_REPOSITORY=owner/disposable-repository \
RELEASE_DRAFT_DRILL_CONFIRM=create-and-delete-disposable-draft \
mise exec -- wails3 task release:failed-draft-drill
```

It refuses `luxury-yacht/app`, creates a uniquely tagged draft with a
disposable asset, fails before `gh release edit --draft=false`, confirms the
draft remains, and deletes it (reporting the tag on cleanup failure). The
repository must exist and the `gh` account must create and delete its releases.

## Staging, restart, and recovery

- `internal/updatetemp` creates and validates a private per-user root before any
  Wails or child-process dispatch and points the platform temp environment at
  it, so staging and helper logs stay under a bounded parent. Unix requires the
  current UID and owner-only permissions. Windows creates root and marker with
  an explicit `TOKEN_USER` owner and a protected DACL giving only that user
  inheritable full control; reused paths owned by any other account or group are
  rejected.
- Installable portable Linux targets base the root on the target's XDG data
  home so Wails' Unix helper swaps with a same-filesystem rename;
  package-managed and unverified Linux targets use the system temp base.
- Startup cleanup may inspect only validated `wails-update-*` children and must
  keep paths recorded by `internal/updatestate`.
- Persist `PreparedUpdate` after a verified download, before exposing ready
  state. Restart atomically converts it to `UpdateAttempt`, then invokes Wails
  restart so the detached helper owns replacement and relaunch.
- `ServiceShutdown` stops the coordinator, cancels in-flight work, and removes
  prepared staging not yet in a helper attempt; a restart handoff keeps the
  attempt for the helper and next launch.
- Launch reconciliation: target version means success; source version means
  the helper restored the old app (ingest its bounded, sanitized diagnostic and
  show recovery); any other version means a manual or newer install superseded
  it (clear without a stale failure).
- A failed helper relaunch can restore the previous app. Post-launch defects
  are fixed by a higher signed version or manual installer, never an
  updater-driven downgrade.

## Factory Reset

Orchestration and static-state sweep:
[application lifecycle](../architecture/application-lifecycle.md#factory-reset).

- `UpdateCoordinator` owns live and durable updater reset from its configured
  `StatePath` and private `TempRoot`. Dynamic prepared, attempt, cleanup,
  staging, protected, and helper-log paths are validated by
  `internal/updatestate`/`internal/updatetemp` before deletion and are never raw
  paths in the static manifest.
- Reset cancels and awaits an active check or download, then clears
  pending/prepared/skipped projections and durable state. It is rejected during
  a restart/application handoff or other non-cancellable durable mutation,
  keeping recovery state.
- Cleanup tries every validated artifact, keeps failures for retry, aggregates
  errors, and deletes the state file only after validated cleanup. Missing state
  and repeated reset are valid; resolving paths must not create directories.
- If startup rejected the temp root, updates stay disabled and reset leaves that
  unvalidated path alone instead of reporting a reset failure.

## Signing keys

- Commit only the public key. The unencrypted CI private key PEM lives in the
  protected `UPDATER_PRIVATE_KEY_PEM` secret, is written only to the release
  runner's temp directory, never logged, and deleted after signing.
- Wails accepts one active public key. Rotation: ship a release signed by the
  old key embedding the new key, wait an adoption window, then sign with the new
  key. Clients that miss it use a manual installer. On suspected compromise,
  stop publication; never rely on an in-band transition signed by that key.

## Starting points and validation

- Runtime: `backend/update_coordinator.go`, `backend/update_coordinator_config.go`,
  `backend/internal/appupdates`, `backend/update_provider.go`
- Eligibility and state: `internal/updateidentity`, `internal/windowsinstall`,
  `internal/updatestate`, `internal/updatetemp`
- UI: `frontend/src/ui/status`, `frontend/src/ui/modals/AboutModal.tsx`
- Release: `cmd/project/{updater_release,release,linux_portable,windows_updater}.go`,
  `.github/workflows/release.yml`, `build/linux/portable`,
  `build/linux/nfpm/nfpm.yaml`, `build/windows/Taskfile.yml`, `build/windows/nsis`

Changes must prove channel selection, fail-closed manifest validation, consent
boundaries, platform eligibility, shutdown/restart ordering, helper
reconciliation, local signature verification, draft-before-public ordering, and
installed-app smoke behavior for every enabled platform/architecture.
