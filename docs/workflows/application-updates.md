# Application Updates

Luxury Yacht uses Wails v3 for download, verification, staging, replacement,
and relaunch. Luxury Yacht owns release discovery, installation eligibility,
user consent, process lifecycle, durable helper reconciliation, and release
publication. The website is not part of this path.

## Runtime and user contract

The first runtime-ready workspace starts one process-wide coordinator. It
reconciles a prior helper attempt, checks silently, and schedules another check
every six hours. Every window reads the same backend snapshot and receives the
same `app-update` event.

An automatic or manual check only discovers an update. The header status
control and About dialog show availability, release notes, progress, failures,
and recovery actions. **Download Update** is explicit consent to download and
stage one known version. **Restart to Update** is separate consent to persist
the handoff, quit all workspace peers through the normal lifecycle, replace
the application, and relaunch. There is no updater-owned window, background
download, or forced restart.

Stable builds accept only newer stable releases. Beta builds may accept a
newer beta or stable release, allowing beta-to-stable convergence. Skipping a
version suppresses automatic presentation of that exact normalized version;
a manual check may reveal it again.

## Installation eligibility

Release discovery and in-place installation are separate capabilities:

| Installation | Check | Self-update | Required evidence / fallback |
| --- | --- | --- | --- |
| macOS app bundle | Yes when installed as an app bundle | Yes when the volume and bundle parent are writable | Otherwise open the authenticated macOS download path. |
| Windows NSIS, per-user | Yes | Yes | A valid adjacent `luxury-yacht.install.json` marker with product ID, `nsis`, and `user` scope. |
| Windows NSIS, machine | Yes | No | Offer the per-user migration path; do not request elevation or stage an update. |
| Linux portable, per-user | Yes | Yes when target and parent are writable | A valid adjacent marker with `portable` and `user` scope; otherwise offer the portable download. |
| Linux DEB/RPM | Yes with a valid system package marker | No | Explain package-manager ownership and open package choices. |
| Development, invalid, or unknown distribution | No | No | Explain that automatic updates are unavailable and offer download choices. |

Do not infer ownership from a path or filename alone. Marker schema, product
identity, distribution, scope, and exact expected location are all part of the
eligibility boundary in `internal/updateidentity`.

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

Release tooling accepts an explicit target list and exact payload names. It
must reject directories, globs, installers/packages in place of updater
payloads, duplicates, missing targets, and ambiguous files. The release job:

1. builds and applies platform-native signing to manual and updater artifacts;
2. validates each updater payload as the exact install target Wails will swap;
3. creates and signs one `updater.json`, then verifies every local payload
   against the embedded public key;
4. uploads the complete asset set with `gh release create --draft`; and
5. makes it discoverable only with the final `gh release edit --draft=false`.

Never overwrite an existing release automatically. A failed upload or publish
leaves an operator-inspected draft; repair or delete it and rerun the complete
sequence. GitHub Release publication is the only rollout pointer, so no site,
branch, mutable channel manifest, or cache invalidation participates.

## Staging, restart, and recovery

`internal/updatetemp` creates and validates a private, user-specific root before
any Wails or child-process dispatch and sets the platform temp environment to
that root. Wails staging and helper logs therefore stay below a bounded parent.
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

- Runtime composition: `main.go`, `backend/app_updates_config.go`
- Coordinator and GitHub adapter: `backend/internal/appupdates`, `backend/app_update_provider.go`
- Eligibility and durable state: `internal/updateidentity`, `internal/updatestate`, `internal/updatetemp`
- Shell surfaces: `frontend/src/ui/status`, `frontend/src/ui/modals/AboutModal.tsx`, `frontend/src/core/backend-api`
- Release tooling: `cmd/project/updater_release.go`, `cmd/project/release.go`, `.github/workflows/release.yml`

Changes must prove channel selection, fail-closed manifest validation, explicit
consent boundaries, platform eligibility, shutdown/restart ordering, helper
reconciliation, local signature verification, draft-before-public ordering,
and installed-app smoke behavior for every enabled platform/architecture.
