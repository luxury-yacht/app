# Application Updates

Luxury Yacht uses Wails v3 for download, verification, staging, replacement,
and relaunch. Luxury Yacht owns release discovery, installation eligibility,
user consent, process lifecycle, durable helper reconciliation, and release
publication. The website is not part of release discovery or self-update
payload delivery; it hosts only manual recovery guidance.

## Runtime and user contract

The first runtime-ready workspace starts one process-wide coordinator. It
reconciles a prior helper attempt, checks silently, and schedules another check
every six hours. Every window reads the same backend snapshot and receives the
same `app-update` event.

An automatic or manual check only discovers an update. The header status
control is a label and an entry point: it announces availability and opens the
About dialog, which is the single surface for release notes, progress,
failures, and recovery actions. Status copy, badge, tone, and release identity
come from one shared presentation (`frontend/src/ui/status/updatePresentation.ts`)
so the header and About can never disagree. **Download Update** is explicit
consent to download and stage one known version. **Restart to Update** is
separate consent to persist the handoff, quit all workspace peers through the
normal lifecycle, replace the application, and relaunch. There is no
updater-owned window, background download, or forced restart.

Stable builds accept only newer stable releases. Beta builds may accept a
newer beta or stable release, allowing beta-to-stable convergence. Skipping a
version suppresses automatic presentation of that exact normalized version;
a manual check may reveal it again.

## Installation eligibility

Release discovery and in-place installation are separate capabilities:

| Installation | Check | Self-update | Required evidence / fallback |
| --- | --- | --- | --- |
| macOS app bundle | Yes when its platform/architecture payload is enabled | Yes when the volume and bundle parent are writable | Otherwise open the authenticated macOS download path. |
| Windows NSIS, per-user | Yes when its platform/architecture payload is enabled | Yes | A valid adjacent `luxury-yacht.install.json` marker with product ID, `nsis`, and `user` scope. |
| Windows NSIS, machine | Yes when its platform/architecture payload is enabled | No | Exact HKLM ownership plus a valid adjacent machine marker; an otherwise identical legacy registration may substitute for a marker only when none exists. Open the authenticated Windows download path. |
| Linux portable, per-user | Yes when its platform/architecture payload is enabled | Yes when the target's parent supports create-and-rename | A valid adjacent marker with `portable` and `user` scope; otherwise offer the portable download. The running Linux executable itself cannot be opened for write (`ETXTBSY`), and Wails replaces it only after the parent process exits. |
| Linux DEB/RPM | Yes when its platform/architecture payload is enabled and it has a valid system package marker | No | Explain package-manager ownership and open package choices. |
| Development, invalid, or unknown distribution | No | No | Explain that automatic updates are unavailable and offer download choices. |

Do not infer ownership from a path or filename alone. Marker schema, product
identity, distribution, scope, and exact expected location are all part of the
eligibility boundary in `internal/updateidentity`.

`luxuryYacht.updaterTargets` in `build/config.yml` is the single publication
and runtime-eligibility list. Build metadata embeds it in the application, and
release tooling uses the same list to require the matching payloads. A build
whose platform/architecture is absent does not initialize the provider or
perform update checks, so an unpublished payload cannot become a recurring
missing-asset error.

### Windows distribution

Every release publishes a recommended per-user NSIS installer under
LocalAppData and an optional all-users installer under Program Files. Both write
an adjacent `luxury-yacht.install.json` marker with their installation scope.
The raw updater executable is a versioned byte-for-byte copy of the same built
executable consumed by both installers.
Release jobs validate its exact name, PE header, and architecture, publish
it with the installer, and authenticate its digest through the release-scoped
Ed25519-signed `updater.json`.

Legacy all-users installs have no marker. The runtime recognizes them only when
the exact 64-bit HKLM uninstall registration names the running executable and
its adjacent uninstaller. Marked machine installations require that same
registration. Both forms may check for releases but never stage or replace the
machine-owned executable. The available-update action opens the authenticated
Windows download so the existing installation scope can be upgraded explicitly
with the current installer; automatic update never requests UAC.

The per-user installer still refuses to create a second copy over an existing
all-users product registration. A conflict exits with code 66 and,
interactively, offers to open Windows Installed Apps. Scope changes remain an
explicit uninstall/reinstall choice; automatic update never changes scope.

After a successful raw-executable swap, startup first reconciles and clears the
durable update attempt. Per-user installs then revalidate the adjacent marker
and matching HKCU uninstall registration before updating `DisplayVersion`;
all-users metadata remains owned by its installer. Both NSIS and post-swap
per-user reconciliation retain the configured `v`-prefixed release version.

The unsigned Windows build job runs Windows-native identity tests plus a silent
installer drill for amd64 and arm64. The package task builds once,
then copies the updater executable and packages that same binary into distinct
`user-installer.exe` and `system-installer.exe` artifacts. The drill proves each
scope's marker and registry ownership, removal of installer-owned files,
preservation of user-profile settings, and machine/per-user side-by-side
refusal, including cleanup after a partial drill failure. The premerge quality
gate also cross-vets Windows amd64 and arm64 code. Both Windows architectures
are updater targets, and Wails refuses a downloaded executable unless its
SHA-512 digest and Ed25519ph signature match the public key embedded in the
application.

Windows executables and installers are not currently Authenticode-signed.
Authenticode is a future distribution-hardening step, not the updater's payload
integrity boundary. Windows Smart App Control or an enterprise App Control
policy can still block unknown unsigned code. When a certificate is available,
sign the built executable before both the raw copy and NSIS packaging, then sign
the completed installer separately; the updater artifact format and runtime
eligibility contract do not change.

### Linux distributions

Each Linux architecture is built once. DEB, RPM, the portable installer, and
the updater archive all consume that same production binary. DEB and RPM own
`/usr/share/luxury-yacht/install.json`, with `deb` or `rpm` distribution and
`system` scope. The marker is removed with the package and never makes the
package-owned executable replaceable by Wails.

The manual portable artifact ends in `-portable.tar.gz`. Its `install.sh`
installs without elevation below
`${XDG_DATA_HOME:-$HOME/.local/share}/luxury-yacht`, writes the adjacent
`luxury-yacht.install.json` marker with `portable` distribution and `user`
scope, and installs the desktop entry and icon below the same XDG data home.
The installed desktop entry and icon use `org.wails.luxury_yacht`, matching
the GTK application ID Wails derives from the runtime name `Luxury Yacht`.
Keep these aligned when changing the runtime name or upgrading Wails so
Wayland docks can associate running windows with their launcher. Rerunning
the portable installer migrates the former `luxury-yacht.desktop` launcher
when its executable points to this installation. Binary-only automatic
updates do not migrate desktop integration.
Portable upgrades validate the installed marker through the same
schema/product/distribution/scope boundary as fresh installs rather than
requiring byte-for-byte equality with the next archive's marker.
The installed `manage-installation uninstall` command removes only that
verified portable installation. It also removes the one UID-derived updater
temp root only when the full ownership marker matches and every child has an
updater-owned staging or helper-log shape; lookalike roots and roots containing
unknown entries are preserved. The portable runtime requires GTK 4 and WebKitGTK
6.0; the archive README lists Debian/Ubuntu and Fedora/RHEL package names.

The similarly versioned Linux archive ending in `-updater.tar.gz` is a
single-entry tar containing only the executable. The explicit suffix prevents
users from mistaking this internal swap payload for the manual portable
installer. It is the sole Linux artifact accepted into `updater.json`; the
installer tar, DEB, RPM, and AppImage are manual artifacts only. Wails
extraction conformance runs before release publication and must yield exactly
one executable regular file with the configured binary name.

## Release and trust contract

Each public GitHub Release is the complete update unit. It contains ordinary
manual installers, updater payloads for the enabled platform/architecture
targets, and exactly one `updater.json`. The manifest identifies the release
version and channel and, for every updater payload, its immutable GitHub asset
URL, filename, byte size, SHA-512 digest, and Ed25519ph signature.

The runtime first selects an eligible GitHub Release, then fetches that same
release's `updater.json`. It rejects missing, duplicate, oversized, malformed,
or mismatched metadata; a URL, filename, size, platform, architecture, version,
channel, digest, or signature disagreement fails closed. Wails verifies the
downloaded payload with the manifest digest/signature and the public key
embedded in the application.

Release tooling accepts the explicit target list from `build/config.yml` and
exact payload names. It
must reject directories, globs, installers/packages in place of updater
payloads, duplicates, missing targets, and ambiguous files. The release job:

1. builds each manual and updater artifact, applying platform-native signing
   where required by that target's distribution contract;
2. validates each updater payload as the exact install target Wails will swap;
3. creates and signs one `updater.json`, then verifies every local payload
   against the embedded public key;
4. uploads the complete asset set with `gh release create --draft`; and
5. makes it discoverable only with the final `gh release edit --draft=false`.

A manual **Release** workflow dispatch defaults to a full dry run. Leave
**Create GitHub release** unchecked to run the tests, every platform build and
package drill, artifact aggregation, updater-manifest signing and verification,
release-asset discovery, release-note rendering, and construction of the exact
publication inputs. The prepared asset set is retained as the
`prepared-release-assets` workflow artifact, but `RELEASE_DRY_RUN=true` stops
the shared release command without querying or mutating GitHub Releases; the
downstream website update does not run because no release was published.
Checking the input, or pushing a matching version tag, makes the separately
permissioned publication job consume that same prepared artifact, reject an
existing release, and create the GitHub Release.

The release command can exercise the same final preparation validation locally
when a complete `artifacts/` directory is already present:

```sh
RELEASE_DRY_RUN=true mise exec -- wails3 task release:app
```

Never overwrite an existing release automatically. A failed upload or publish
leaves an operator-inspected draft; repair or delete it and rerun the complete
sequence. GitHub Release publication is the only rollout pointer, so no site,
branch, mutable channel manifest, or cache invalidation participates.

Before a stable-channel rollout, exercise that recovery contract against a
repository used only for release drills:

```sh
RELEASE_DRAFT_DRILL_REPOSITORY=owner/disposable-repository \
RELEASE_DRAFT_DRILL_CONFIRM=create-and-delete-disposable-draft \
mise exec -- wails3 task release:failed-draft-drill
```

The drill refuses `luxury-yacht/app`, creates a uniquely tagged draft with a
disposable asset, injects a local failure before `gh release edit
--draft=false`, confirms GitHub still reports the release as a draft, and
deletes it before returning. If cleanup fails, the command reports the exact
tag that must be removed manually. The disposable repository must already
exist, and the active `gh` account must be allowed to create and delete its
releases (`cmd/project/release_draft_drill.go`).

## Staging, restart, and recovery

`internal/updatetemp` creates and validates a private, user-specific root before
any Wails or child-process dispatch and sets the platform temp environment to
that root. Portable Linux installations place this root beside the installation
directory under the same XDG data home so Wails' final rename does not cross
from the system temporary filesystem into the portable target filesystem.
Other distributions retain the system temporary base. Wails staging and helper
logs therefore stay below a bounded parent.
Startup cleanup may inspect only validated `wails-update-*` children there and
must preserve paths recorded by `internal/updatestate`.

After a verified download, persist `PreparedUpdate` before exposing ready state.
Restart atomically converts it to `UpdateAttempt` before invoking Wails. Normal
shutdown cancels work and cleans a merely prepared directory; a restart
handoff preserves the attempt for the helper and next launch.

On launch, reconcile the running version with the attempt:

- target version means the update succeeded;
- source version means the helper restored the previous application; ingest
  its bounded, sanitized diagnostic when present and show the recovery action;
- any other release version means a manual or newer installation superseded
  the attempt; clear it without reporting a stale failure.

A helper relaunch failure can restore the previous application. A defect found
after a successful launch is corrected with a higher signed version or a
manual authenticated installer, never an updater-driven downgrade.

## Factory Reset

`backend.UpdateCoordinator` owns live and durable updater reset. It resolves the
configured `StatePath` and private `TempRoot`; dynamic prepared, attempt,
cleanup, staging, protected, and helper-log paths are validated by
`internal/updatestate`/`internal/updatetemp` before deletion. They are not raw
paths exposed to the generic static app-state manifest.

Reset cancels and waits for an active check or download before clearing the
pending/prepared/skipped projections and durable state. It rejects reset while
restart/application handoff or another non-cancellable durable mutation is in
flight, leaving recovery state intact. Cleanup attempts every validated owned
artifact, preserves failed entries for retry, aggregates errors, and removes
the state file only after validated cleanup. Missing state and a repeated reset
are valid; merely resolving paths must not create their parent directories. If
startup rejected the configured temp root, updates remain disabled and reset
leaves that unvalidated path untouched instead of treating the startup
diagnostic as a Factory Reset failure. The final static-state sweep still
removes app-owned config and cache state.

## Signing-key handling

Commit only the public key. Keep the unencrypted CI private key PEM in the
protected `UPDATER_PRIVATE_KEY_PEM` secret, materialize it only in the release
runner's temporary directory, never log it, and remove it after signing.

Wails accepts one active updater public key. Normal rotation requires a release
signed by the old key that embeds the new public key, followed by an adoption
window before CI signs with the new key. Clients that miss the transition use
a manual authenticated installer. If compromise is suspected, stop updater
publication; do not rely on an in-band transition signed only by that key.

## Starting points and validation

- Runtime composition: `main.go`, `backend/update_coordinator_config.go`
- Coordinator and GitHub adapter: `backend/internal/appupdates`, `backend/update_provider.go`
- Eligibility and durable state: `internal/updateidentity`, `internal/windowsinstall`,
  `internal/updatestate`, `internal/updatetemp`
- Shell surfaces: `frontend/src/ui/status`, `frontend/src/ui/modals/AboutModal.tsx`, `frontend/src/core/backend-api`
- Release tooling: `cmd/project/updater_release.go`, `cmd/project/release.go`, `.github/workflows/release.yml`
- Linux distribution: `build/linux/portable`, `build/linux/nfpm/nfpm.yaml`, `cmd/project/linux_portable.go`
- Windows distribution: `build/windows/Taskfile.yml`, `build/windows/nsis`,
  `build/windows/package-drill.ps1`, `cmd/project/windows_updater.go`

Changes must prove channel selection, fail-closed manifest validation, explicit
consent boundaries, platform eligibility, shutdown/restart ordering, helper
reconciliation, local signature verification, draft-before-public ordering,
and installed-app smoke behavior for every enabled platform/architecture.
