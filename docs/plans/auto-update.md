# Automatic Application Updates

Status: implementation in progress. Phases 1 through 4 are implemented. The
Phase 5 macOS pipeline embeds the approved public key, produces and verifies one
signed `updater.json`, uploads it beside the ordinary release assets, and keeps
the GitHub Release in draft state until every upload succeeds. The application
discovers releases through GitHub and loads that release's `updater.json` before
accepting an update. Before Stage 1 rollout, the macOS beta smoke and recovery
matrix must pass. The Phase 6 durable lifecycle, workflow, and release
documentation is complete. Cross-platform acceptance remains the overall
completion gate. Windows Authenticode certificate procurement is in progress.
It does not block the macOS stage, but it remains a Windows enablement and
overall-completion dependency (`backend/update_provider.go`;
`cmd/project/updater_release.go`; `cmd/project/release.go`;
`.github/workflows/release.yml`).

Local validation: `mise exec -- wails3 task qc:prerelease` passed on 2026-08-14.
The live installed-app smoke matrix remains rollout evidence, not a local test.

The running product remains notification-only on each distribution until its
rollout stage passes. Durable lifecycle and distribution contracts live in
`docs/architecture/application-lifecycle.md` and
`docs/workflows/application-updates.md`.

## Outcome

Luxury Yacht will check for application updates automatically without
interrupting normal work. When a supported installation has an update, the
existing shell surfaces will offer a user-initiated Wails update flow that
downloads, authenticates, stages, and applies the update through an explicit
restart action.

The shared updater behavior:

- checks silently after the first workspace window becomes runtime-ready and
  every six hours afterward;
- also exposes an explicit **Check for Updates…** command;
- uses `updater.WindowNone`; Luxury Yacht's existing shell owns user consent,
  release notes, progress, errors, and restart actions;
- treats **Check for Updates…** as check-only and never begins a download until
  the user activates **Download Update** for a known release;
- never restarts the app without an explicit user action;
- uses Wails' updater state machine, staging, helper swap, and rollback-on-
  relaunch-failure behavior;
- authenticates each update artifact with the Wails CLI's `ed25519ph` signature
  over its SHA-512 prehash, carried with its digest in a Wails Update Manifest;
- supports stable and beta channels without offering beta releases to stable
  builds;
- enables full self-update only for installation types whose application target
  is intentionally user-writable; and
- retains a release-page notification path for unsupported or non-writable
  installation types.

Delivery is deliberately staged. macOS is the first self-update target, but
macOS completion is not plan completion. This initiative is complete only when
all of the following are production-supported for every release architecture:

- an eligible installed macOS `.app` updates through a signed/notarized app ZIP;
- an eligible per-user Windows installation updates through a signed raw
  executable; and
- an explicitly identified, user-owned portable Linux installation updates
  through a single binary or single-entry tar payload.

DEB and RPM remain package-manager-owned notification-only distributions. The
cross-platform requirement is one first-class self-updating distribution on
each desktop operating system, not in-place mutation of every installation
format. AppImage and automatic package-repository management are outside this
plan unless later added as separately approved distribution work.

## Non-goals

- silent download, forced restart, or an updater-owned modal workflow;
- in-place replacement of files owned by DEB, RPM, or a machine-scope Windows
  installer;
- AppImage self-update, package-repository management, delta updates, or
  automatic downgrade; and
- treating completion of the macOS stage as completion of the cross-platform
  initiative.

## Decision gates

Owner decisions recorded before implementation:

- [x] "Automatic updates" means silent automatic checks followed
  by separate user-initiated **Download Update** and **Restart & Apply** actions,
  not silent download or forced restart.
- [x] Deliver in stages beginning with macOS, while requiring supported
  self-update distributions on macOS, Windows, and Linux before declaring the
  initiative complete. DEB/RPM remain notification-only; portable Linux is a
  required completion stage.
- [x] Use an Ed25519 signing key held in a protected CI secret, with
  the public key embedded in the application.
- [x] Windows Authenticode certificate procurement is in progress. Windows
  remains notification-only until the certificate is provisioned, and the
  initiative cannot be declared complete in that state.
- [x] **Skip This Version** survives application restarts as backend-owned update
  state that is not part of portable settings export.
- [x] Publish exactly one signed `updater.json` as an asset of each GitHub
  Release, beside the artifacts it authenticates. GitHub Release discovery is
  the channel pointer: stable releases are ordinary releases and beta releases
  are prereleases. Build the release as a draft, upload all assets, then publish
  it as the final rollout step. Do not add a site, Pages, raw-branch, or separate
  mutable-manifest dependency (`backend/update_provider.go`;
  `cmd/project/release.go`; `.github/workflows/release.yml`).

## Current state

The application already pins Wails `v3.0.0-beta.8`, and that pinned module
contains `app.Updater`, the GitHub and endpoint providers, updater publishing
commands, the built-in updater window, and the helper-mode swap. No Wails
dependency change is required for the planned update and application-owned
temporary-directory flow (`go.mod:15`; pinned dependency sources
`pkg/updater/updater.go`, `pkg/updater/providers/github/github.go`,
`pkg/updater/providers/endpoint/endpoint.go`,
`internal/commands/updater_tool.go`, `pkg/updater/window.go`, and
`pkg/updater/helper.go`).

The application-side updater foundation is implemented:

- `backend/update_provider.go` wraps Wails' GitHub provider with exact
  updater-payload matching, fetches the selected release's sibling
  `updater.json`, and attaches its signed verification material only after the
  manifest matches the selected GitHub asset;
- `backend/update_coordinator_config.go:47-113` resolves installation eligibility,
  reconciles application-owned update state, and composes the Wails updater
  before the application starts;
- `backend/internal/appupdates/coordinator.go:21-179` owns typed status,
  capability gates, persisted skip hydration, and fail-closed initialization;
- `internal/updatestate/state.go:123-230,368-598` owns validated durable
  prepared, attempt, cleanup, and next-launch reconciliation state; and
- `frontend/src/ui/status/UpdateStatus.tsx:63-159` and
  `frontend/src/ui/modals/AboutModal.tsx:100-224` project that shared state into
  the header chip and About actions.

The legacy unauthenticated GitHub latest-release client and custom numeric
version comparator have been removed. The approved Ed25519 public key is
embedded from `backend/updater_public_key.pem`; its SHA-256 DER fingerprint is
`5fb9230f10b42312008e6caa8c782e195a170970334b41d89b1c90e43820f15b`
(`backend/update_coordinator_config.go:20-21`; `backend/update_coordinator_commands_test.go:26-39`).
The private key remains outside the repository in the protected
`UPDATER_PRIVATE_KEY_PEM` Actions secret. The release helper uploads assets to a
draft and publishes the release only after `gh release create` has returned
success for the complete asset set (`cmd/project/release.go`).

The macOS release build now emits and publishes the first single replaceable
updater target:

- macOS publishes the existing DMGs plus per-architecture signed/notarized app
  ZIPs, validates the source bundle, then validates the Wails-extracted bundle
  through the same code-signing, Gatekeeper, and stapler checks
  (`.github/workflows/release.yml:62-68,118-157`;
  `build/darwin/Taskfile.yml:130-142`);
- Windows publishes unsigned NSIS installers
  (`.github/workflows/release.yml:168-171`);
- Linux publishes DEB and RPM packages
  (`.github/workflows/release.yml:159-166`); and
- the release helper selects an explicit ordered target set, signs and verifies
  one release-scoped `updater.json`, materializes and removes the protected key
  in a scoped CI step, and publishes it with the installers and updater payloads
  in one draft-then-public GitHub Release (`cmd/project/updater_release.go`;
  `cmd/project/release.go`; `.github/workflows/release.yml`).

Wails accepts a single binary, a ZIP with exactly one top-level entry, or a
single-entry tar archive. It does not install DMG, PKG, MSI, DEB, RPM, or NSIS
packages. See the Wails
[artifact format contract](https://v3.wails.io/guides/updater/#artifact-formats).

Installation ownership is also material:

- the Windows installer defaults to machine scope and installs under Program
  Files (`build/windows/Taskfile.yml:58-65`,
  `build/windows/nsis/project.nsi:72-78`); and
- Linux packages install the executable under `/usr/local/bin`
  (`build/linux/nfpm/nfpm.yaml:19-25`).

Those targets are not generally replaceable by an ordinary unelevated process.
The updater must not attempt a swap merely because a platform-matching artifact
exists.

## Proposed user experience

### Automatic checks

Automatic work is process-scoped, not window-scoped or cluster-scoped:

1. For an eligible released desktop build, configure the updater and subscribe
   to its events before `application.Run`.
2. Start the coordinator only after the first `WindowRuntimeReady`, preserving
   the existing readiness guarantee in `backend/application_lifecycle.go:42-65`.
3. Run one silent `Updater.Check` immediately, then repeat every six hours.
4. Suppress automatic checks for development builds, server builds, and builds
   without a valid release version or valid distribution identity. A valid
   notification-only DEB, RPM, or machine-scope installation still checks so it
   can offer the defined manual recovery action; eligibility blocks staging,
   not discovery.
5. Cancel the scheduler during service shutdown.
6. Allow only one check/download/install flow at a time. A manual check joins,
   focuses, or reports the existing flow rather than starting a competing state
   machine.

Development builds, server builds, builds with an invalid release version, and
builds without a valid distribution identity do not call `app.Updater.Init` at
all. Their coordinator enters an application-owned, non-error `disabled` state
and never calls Wails `Check`, `DownloadAndInstall`, or `Restart`. A manual shell
action that is reachable in a disabled desktop build opens About with the
disabled explanation rather than surfacing Wails `ErrNotConfigured`; server
builds expose no update shell action. Eligible released builds call `Init`
exactly once because the pinned updater rejects a second initialization
(`pkg/updater/updater.go:106-115`; `pkg/updater/config.go:58-74`).

Do not configure Wails `CheckInterval` for this behavior. In the pinned module,
each interval tick calls `CheckAndInstall`; that method opens a window, calls
`Check`, and immediately calls `DownloadAndInstall` when it finds a release
(`pkg/updater/updater.go:126-154,336-379`). It therefore both interrupts the user
and downloads without the separate consent required here. A Luxury Yacht-owned
timer calling only `Check` is required for silent background checks.

### Shell surfaces

The backend coordinator remains the single update-state owner. It adapts Wails
events into one application DTO and the existing `app-update` broadcast. The
frontend must not create a second provider client or subscribe directly to
Wails updater wire strings.

The affected consumers are:

- `GetAppInfo` through `frontend/src/core/app-state-access` for current snapshot
  reads;
- the existing header update chip;
- the About modal;
- **Check for Updates…** in the macOS application menu and the Help menu on
  Windows/Linux; and
- the command palette if the native command is also exposed there, using the
  same label and action owner rather than a duplicate implementation.

Automatic no-update and network-error results stay non-modal. Errors are logged
under the existing update-check log source. Configure Wails with
`updater.WindowNone`; do not call `CheckAndInstall`. The beta.8 built-in window
cannot be opened in the available state independently of `CheckAndInstall`, and
`CheckAndInstall` does not pause for its **Install Update** action before calling
`DownloadAndInstall` (`pkg/updater/updater.go:336-379`;
`pkg/updater/window_lifecycle.go:42-97`).

The shell action contract is:

1. **Check for Updates…** calls only the coordinator's check command. The manual
   path opens About to its update section so checking, current, available, and
   error results have an immediate visible owner. Native-menu presentation
   reuses `ShowAbout` and its `emitCurrentWindowEvent("open-about")` path so only
   the focused workspace peer opens About (`backend/preferences_settings.go:1400-1406`).
2. An automatic result never opens a modal. When a release is available, the
   status chip appears; activating it opens the same About update section and
   does not download.
3. About owns release version, publication time, Markdown notes, install
   eligibility, progress, and errors. It uses the existing shared modal and
   keyboard/focus contracts rather than creating updater-specific modal
   infrastructure.
4. **Download Update** is shown only for an eligible pending release. It calls
   `Updater.DownloadAndInstall`; the app remains usable while the artifact is
   downloaded, verified, extracted, and staged.
5. When staging reaches ready, the status chip and About expose
   **Restart & Apply**. Only that action may call `Updater.Restart`.
6. Notification-only distributions expose the typed reason-specific recovery
   action defined below, falling back to **View Download Options** only for an
   unsupported distribution. Recovery actions open the release/download or
   migration page and never stage an artifact.
7. Any permitted About close path, including its close control, `Escape`, or
   backdrop, closes only the presentation. It never cancels a process-owned
   check, download, verification, or staging operation. The status chip keeps
   showing the current state, and reopening About resumes from the same backend
   snapshot. Only final-window application shutdown cancels in-process work.

All labels and actions must be shared across the header, About, native menu, and
command palette. Frontend state reads remain behind `appStateAccess`; updater
commands use the explicit backend API allowlist.

Available and ready state are process-local Wails state, not a durable download
queue. If the application exits without invoking `Updater.Restart`, the next
process rechecks and, after renewed user consent, redownloads the update; the UI
must not promise that an available or prepared update resumes across launches.
Wails stores `pending`, `resolved`, and `stagingDir` only on the live `Updater`
instance (`pkg/updater/updater.go:26-32`).

### Status and recovery presentation

The coordinator exposes a typed semantic status, optional bounded progress,
eligibility reason, and recovery target. React must not derive these from Wails
event strings, filesystem paths, or platform checks. One frontend presentation
mapping owns the following canonical About copy and primary actions:

The coordinator maps Wails `StateChecking`, `StateUpToDate`, `StateAvailable`,
`StateDownloading`, `StateVerifying`, `StateInstalling`, and `StateReady` to
`checking`, `current`, `available`, `downloading`, `verifying`, `preparing`, and
`ready`, respectively. Wails `StageCheck` errors map to `check-error`; download,
verify, and install-stage errors map to `prepare-error`. `restart-error` and
`apply-error` are coordinator-owned states around restart persistence and
next-launch reconciliation. Wails `StateUnconfigured` and `StateIdle` do not
produce a user-visible update surface (`pkg/updater/types.go:12-33,79-90`).

| Semantic status | Canonical About copy | Primary action |
| --- | --- | --- |
| `disabled` | **Automatic updates are unavailable in this build.** | None |
| `checking` | **Checking for updates…** | None; About may close |
| `current` | **Luxury Yacht is up to date.** | None |
| `available` | **Luxury Yacht {version} is available.** | **Download Update** when eligible; otherwise the reason-specific recovery action below |
| `downloading` | **Downloading update…** | None; About may close |
| `verifying` | **Verifying update…** | None; About may close |
| `preparing` | **Preparing update…** | None; About may close |
| `ready` | **Luxury Yacht {version} is ready to install.** | **Restart & Apply** |
| `check-error` | **Couldn’t check for updates.** | **Check Again** |
| `prepare-error` | **Couldn’t prepare the update.** | **Retry Download** plus the installed distribution’s **View macOS Download**, **View Windows Download**, or **View Portable Download** action |
| `restart-error` | **Couldn’t restart to apply the update.** | **Restart & Apply** |
| `apply-error` | **The update couldn’t be applied. Luxury Yacht is still on {currentVersion}.** | Reason-specific manual recovery action |

Wails reports written and total bytes. Expose a percentage only when total is
positive and written is between zero and total; otherwise expose no percentage.
Never invent progress during verification or preparation. Release notes remain
visible for `available`, active preparation states, `ready`, and recoverable
errors. Wails carries release notes on `Release.Notes` and reports byte progress
separately (`pkg/updater/types.go:35-49,79-84`).

Eligibility is backend-owned, but user-facing copy and action labels live in
the one frontend presentation mapping:

| Eligibility reason | Canonical explanation | Recovery action |
| --- | --- | --- |
| `mac-not-installed-bundle` | **Move Luxury Yacht to Applications to enable automatic updates.** | **View macOS Download** |
| `mac-read-only` or `mac-unwritable-parent` | **This copy of Luxury Yacht cannot replace itself in its current location.** | **View macOS Download** |
| `windows-machine-scope` | **This copy was installed for all users. Switch to the per-user installation to enable automatic updates.** | **Switch to Per-User Installation** |
| `windows-unverified-install` | **This Windows installation cannot be verified as a supported per-user installation.** | **View Windows Download** |
| `linux-package-managed` | **This installation is managed by your system package manager. Update it with that package manager or download the latest package.** | **View Linux Packages** |
| `linux-portable-ineligible` | **This portable installation cannot replace itself in its current location.** | **View Portable Download** |
| `unsupported-distribution` | **Automatic updates are not available for this installation.** | **View Download Options** |

Every recovery action opens the immutable release's platform-appropriate
download or migration page and never starts Wails staging. The status chip uses
compact state text and always opens About for the full explanation; it does not
duplicate eligibility prose. `apply-error` selects **View macOS Download**,
**View Windows Download**, or **View Portable Download** from the persisted
attempt distribution rather than reusing an eligibility guess.

### Skip and dismiss

The pinned updater keeps `SkipVersion` only in process memory
(`pkg/updater/window_lifecycle.go:153-186`). The implemented restart-persistent
contract is:

- persist one canonical, unprefixed `skippedVersion` value as backend-owned
  application update state. It must use the exact normalized form returned as
  GitHub provider `Release.Version` because Wails skip matching is string
  equality (`pkg/updater/window_lifecycle.go:178-186`);
- hydrate Wails with that value before the first check;
- expose **Skip This Version** in About and update persistence before closing
  the update section;
- ignore the stored value automatically when the offered release has a
  different version; and
- keep the value out of portable settings export and out of frontend local
  storage.

Do not reproduce the built-in window's **Remind Me Later** action. Automatic
checks are already non-modal, and closing About leaves the chip available without
writing durable state.

Do not add an automatic-update Settings toggle in the first slice. The current
application already performs an unconditional startup check
(`backend/application_lifecycle.go:63`; `backend/app_update.go:53-62`). If an opt-out is
later approved, implement it as a backend-owned preference described by the app
settings schema and mutated through `UpdateAppPreferences`.

### Expired beta recovery

An expired beta remains notification-only. Today the first
`WindowRuntimeReady` returns before `startUpdateCheck` when
`checkStartupBetaExpiry` fails, then shows a dialog and quits
(`backend/application_lifecycle.go:42-63,125-137`). Do not start a long-running updater
flow inside that shutdown path.

Replace the expiry dialog's passive instruction with an explicit
**Download Latest Version** action that opens the release/download page before
quit, plus **Quit**. This is the recovery path even on a normally self-updatable
installation. Tests must prove an expired beta cannot enter download, staging,
or restart states and that the manual recovery action remains available.

## Provider, channels, and version identity

Use an application-owned adapter around
`github.com/wailsapp/wails/v3/pkg/updater/providers/github`. The Wails provider
owns public GitHub release discovery and artifact download. The adapter supplies
the two contracts beta.8's provider does not combine: exact Luxury Yacht updater
payload selection and application-pinned Ed25519 verification
(`backend/update_provider.go`; pinned
`pkg/updater/providers/github/github.go`).

Every GitHub Release contains exactly one asset named `updater.json`. It is a
normal Wails Update Manifest containing the release version and channel plus one
entry per enabled platform/architecture. Each entry names that release's exact
updater payload URL, filename, size, SHA-512 digest, and `ed25519ph` signature.
The same release also contains the payloads and the ordinary manual installers
(`cmd/project/updater_release.go`; `cmd/project/release.go`).

For example, a macOS-only stage publishes one file shaped like this (digest and
signature shortened here only for readability):

```json
{
  "schemaVersion": 1,
  "version": "2.0.0-beta.4",
  "channel": "beta",
  "artifacts": [
    {
      "url": "https://github.com/luxury-yacht/app/releases/download/v2.0.0-beta.4/luxury-yacht-v2.0.0-beta.4-darwin-arm64.zip",
      "filename": "luxury-yacht-v2.0.0-beta.4-darwin-arm64.zip",
      "filetype": "zip",
      "size": 48123904,
      "platform": "darwin",
      "arch": "arm64",
      "digestAlgo": "sha512",
      "digest": "<base64 SHA-512 digest>",
      "signatureAlgo": "ed25519ph",
      "signature": "<base64 Ed25519 signature>"
    }
  ]
}
```

The production macOS manifest has both `arm64` and `amd64` entries. Windows and
portable Linux entries join the same array when those rollout stages are enabled.

For a check, the adapter:

1. asks the Wails GitHub provider for the applicable published release;
2. uses an exact filename matcher that accepts only the replaceable payload
   format for the requesting platform and architecture;
3. derives the sibling `updater.json` URL from the selected asset URL;
4. requires schema version 1, the exact GitHub release version and channel, and
   exactly one entry for the requesting platform and architecture;
5. requires that entry's URL, filename, and size to match the selected GitHub
   asset and its algorithms to be `sha512` and `ed25519ph`; and
6. attaches the decoded digest and signature to the Wails release so the normal
   Wails download/install path authenticates the downloaded bytes against the
   embedded public key.

Any absent, oversized, malformed, ambiguous, mismatched, or unverifiable
manifest fails the check closed. The adapter never treats a DMG, NSIS installer,
DEB, or RPM as a replaceable updater payload
(`backend/update_provider.go`; `backend/update_provider_test.go`). See
[cryptographic verification](https://v3.wails.io/guides/updater/#cryptographic-verification).

Channel rules:

- stable builds use GitHub's latest ordinary release endpoint, which excludes
  prereleases;
- beta builds use GitHub's release-list endpoint, which includes ordinary and
  prerelease releases, so a newer stable release can supersede a beta;
- the manifest channel must match the GitHub release's prerelease flag: `beta`
  for a prerelease and `stable` otherwise; and
- publishing the complete GitHub Release is the only rollout pointer. There is
  no separately mutable channel document.

`build/config.yml:15` currently stores a `v`-prefixed version. Add one shared,
tested normalization boundary that passes Wails the same semantic version
without the leading `v`. `cmd/project/build_metadata.go:57-68` copies the
configured version verbatim into the embedded manifest, and
`backend/update_coordinator_version.go:42-58` copies that value into `backend.Version`; the new
boundary normalizes that authoritative value exactly once for updater config,
release manifests, skip persistence, and comparisons. Do not add a second
version source or restore ldflag version injection.

Name and test the intentional comparison change: the legacy comparator drops
prerelease suffixes at `backend/app_update.go:253-263`, so
`2.0.0-beta.1` and `2.0.0` compare equal. The GitHub provider delegates its
newer-version decision to Wails' SemVer wrapper
(`pkg/updater/providers/github/github.go`;
`pkg/updater/internal/semver/semver.go:35-49`) and must offer the stable release
as newer. Consumer-parity tests must lock that behavior before the legacy
comparator is removed.

## Artifact and installation policy

### macOS

Full self-update is the proposed initial supported path only for an installed
bundle that passes the eligibility preflight below.

For each architecture:

1. Build the `.app` bundle.
2. Apply Developer ID signing and notarization using the existing workflow.
3. Verify the source bundle with `codesign --verify --deep --strict`,
   `spctl --assess --type execute`, and `xcrun stapler validate`.
4. Create the archive with `ditto -c -k --keepParent <app> <archive>`. Do not use
   `--sequesterRsrc`; reject any archive containing a sibling `__MACOSX`
   directory because it violates Wails' exactly-one-top-level-entry contract.
5. Exercise the exact Wails extraction path through a repository-owned
   black-box conformance helper: construct `updater.New` with a test host and
   local provider, call `Check` and `DownloadAndInstall`, and obtain the
   extracted payload through `DownloadedPath`. Assert that the result is the
   only top-level `.app`, then rerun the signature, Gatekeeper, and stapler
   validations against that bundle. Wails' own ZIP-bundle test demonstrates
   this public entry path (`pkg/updater/updater_test.go:556-625`). Do not
   substitute a direct `ditto -x -k` extraction check, which would validate a
   different extractor. Signing the source bundle is not evidence that bytes
   and metadata survive the updater's runtime extraction path.
6. Give the ZIP a filename containing `darwin` and the Go architecture so the
   manifest and runtime agree on identity.
7. Publish the ZIP alongside the existing DMG; the DMG remains the manual
   installation artifact.

The updater must swap the complete bundle, not only
`Contents/MacOS/luxury-yacht`, so signature, resources, Info.plist, and embedded
build metadata remain one unit. Wails documents the signed `.app` ZIP as its
recommended macOS format in the
[distribution checklist](https://v3.wails.io/guides/updater/#distribution-checklist).

Before offering **Download Update**, resolve the running executable to its
enclosing `.app` using the same contract as Wails
(`pkg/updater/updater_darwin.go:11-20`) and require all of the following:

- the resolved target is an installed `.app`, not an executable running from a
  read-only mounted image, translocated path, build directory, or unsupported
  portable location;
- the target volume is not read-only;
- the target's parent directory permits creating, renaming, and deleting a
  sibling probe, because Wails creates `<target>.bak` beside the bundle before
  replacement (`pkg/updater/helper.go:118-127`); and
- the installation has not been explicitly classified as notification-only.

Failure of any preflight rule projects `mac-not-installed-bundle`,
`mac-read-only`, or `mac-unwritable-parent` with the corresponding **View macOS
Download** action. Treat the preflight as eligibility evidence, not a guarantee:
the helper can still fail after process exit.

The shared cross-platform `updateAttempt` reconciliation in the failure contract
applies to macOS as well as Windows and portable Linux. macOS recovery copy uses
the macOS download action when the running version proves the bundle swap did
not complete.

### Windows

Do not enable full self-update until all of these are resolved:

1. Change new release installers to per-user scope under LocalAppData, or add a
   separately identified per-user distribution intended for self-update.
2. Sign the application executable before creating the NSIS installer so both
   the installed binary and standalone updater artifact contain the same signed
   bytes.
3. Sign the installer separately.
4. Publish the signed raw executable as the updater artifact; retain the NSIS
   installer for first installation and manual recovery.
5. Have the per-user NSIS installer write
   `$INSTDIR\luxury-yacht.install.json` with a versioned schema containing
   `productIdentifier`, `distribution: "nsis"`, and `scope: "user"`. The app
   reads this marker adjacent to its running executable; the updater replaces
   only the executable, so the marker survives updates. A missing, malformed,
   machine-scope, mismatched-product, or non-adjacent marker is notification-only.
   The uninstaller removes it with the installation directory.
6. Apply the one-time machine-scope migration experience defined below. Until
   migrated, those installs stay notification-only.
7. Reconcile per-user Apps & Features `DisplayVersion` after a successful
   update, because Wails replaces the application executable rather than
   rerunning NSIS. Keep uninstaller ownership and registry access limited to the
   known per-user installation contract.

The machine-scope migration experience is part of the Windows stage:

1. About explains why the current installation is notification-only and exposes
   **Switch to Per-User Installation**.
2. That action opens a versioned migration page with the signed per-user
   installer and the required order: close Luxury Yacht, uninstall the existing
   all-users copy through Windows Installed Apps, then run the per-user
   installer and relaunch.
3. The per-user installer detects the registered machine-scope product and
   refuses a side-by-side installation. It offers **Open Installed Apps** and
   **Exit** rather than installing a second copy.
4. The machine-scope uninstaller and per-user installer preserve the existing
   user-profile settings. Migration tests prove the first per-user launch sees
   the prior settings before automatic updates become eligible.
5. Until the adjacent per-user marker validates, every check remains
   notification-only. The running application never initiates an elevated
   uninstall or silently changes installation scope.

Do not add a compile-time distribution stamp: the same signed executable is the
input to both NSIS and the raw updater artifact (`build/windows/Taskfile.yml:85-102`).
The installer-written marker is the runtime distribution and scope identity. A
general filesystem-writability check alone is not sufficient proof that
replacing a package-owned executable is correct.

### Linux

DEB and RPM installations remain notification-only. Users update them through
their package manager or download the new package from the release page. The app
must not replace `/usr/local/bin/luxury-yacht` behind dpkg or rpm.

New DEB and RPM packages write a package-owned, versioned installation marker at
`/usr/share/luxury-yacht/install.json` containing `productIdentifier`, the exact
`distribution: "deb"` or `distribution: "rpm"`, and `scope: "system"`. The
package manager removes the marker on uninstall. Only that validated marker may
produce `linux-package-managed`; an unmarked or malformed installation uses the
generic `unsupported-distribution` recovery instead of guessing from its path.

Full Linux self-update is a required completion stage through a separately
identified portable distribution. For each release architecture:

1. Build the same production binary used by the Linux packages.
2. Publish a versioned bare binary or single-entry tar archive intended only for
   Wails replacement; retain DEB and RPM for package-managed installation.
3. Define a user-owned portable installation root and have its installer write
   `luxury-yacht.install.json` adjacent to the executable with a versioned
   schema containing `productIdentifier`, `distribution: "portable"`, and
   `scope: "user"`.
4. Offer **Download Update** only when that marker is valid and adjacent, the
   executable and parent directory are user-writable, and the running target is
   not owned by a package manager.
5. Preserve the marker, desktop integration, icons, and documented GTK/WebKit
   runtime dependency contract when the executable is replaced.
6. Include only the portable payload, never DEB or RPM, in the Linux updater
   manifest entries.

Path writability alone is not an opt-in signal. A Linux build without the valid
portable marker remains notification-only. AppImage behavior requires separate
investigation and is not part of the completion definition.

## Signing and release publication

Generate the application update keypair once with Wails tooling:

- commit and embed only the public key;
- store the private key as a protected CI secret;
- materialize it only in the release job's temporary workspace;
- never print the key or signature inputs to logs; and
- delete the temporary key material when the signing step completes.

For each release, the release job must:

1. Download all platform artifacts into a deterministic layout.
2. Have a repository-owned `cmd/project` helper produce an explicit ordered file
   list containing exactly one supported updater target for every platform and
   architecture enabled in the current delivery stage. Pass those individual
   paths to `wails3 updater manifest`; never pass a release directory or glob.
   The Wails CLI's directory collection accepts multiple installer/package
   formats that are not valid targets for this application's replacement policy
   (`internal/commands/updater_tool.go:589-633,645-710`).
3. Reject DMG, NSIS installer EXE, DEB, RPM, AppImage, MSI, PKG, checksum,
   detached-signature, key, documentation, and unknown extensions as updater
   install targets. Assert that every accepted target is a ZIP, tar archive, or
   bare executable intended for Wails replacement.
4. Run `wails3 updater manifest` once with the canonical release version,
   channel derived from that version, notes, private key, the absolute
   versioned GitHub Release URL prefix, and the explicit updater file list. The
   output name is exactly `updater.json`.
5. Run `wails3 updater verify` with the embedded public key against every local
   artifact in `updater.json`.
6. Pass `updater.json`, every updater payload, and every manual installer to
   `gh release create --draft`. The command must return success before the
   release may become public.
7. Publish that completed draft with `gh release edit <tag> --draft=false` as
   the final rollout operation. If draft creation or asset upload fails, leave
   the release non-public. If the final edit fails, leave the complete draft for
   inspection and recovery. A rerun must not silently publish or overwrite an
   existing release; the operator inspects and removes a failed draft before
   retrying (`cmd/project/release.go`; `cmd/project/release_test.go`).

The GitHub Release is the sole rollout unit. A release job fails before public
visibility if any platform/architecture artifact required by the current stage
is absent, duplicated, ambiguously named, unsupported, unsigned, or locally
unverifiable. The client performs the same digest/signature verification after
download, so a bad or replaced remote payload fails closed. Final completion
requires each release's `updater.json` and asset set to cover macOS, Windows,
and portable Linux for every release architecture.

The existing `update-site` job remains a marketing-version update for stable
releases only. It runs after the GitHub Release and is not read by updater
clients; its failure cannot expose an incomplete updater asset set
(`cmd/project/site.go`; `.github/workflows/release.yml`).

### Key rotation

Wails `updater.Config` accepts one active public key. Normal rotation therefore
requires a transition release signed by the old key that embeds the new public
key, followed by a deliberate adoption window before CI begins signing release
manifests with the new key. Clients that miss the transition cannot trust the
new key and need a manual installer recovery path.

If the private key is suspected compromised, stop publishing updater releases
immediately. Do not attempt an in-band rotation signed only by the
suspect key. Publish incident guidance and require a manually authenticated
installer unless a previously shipped independent recovery trust path exists.

## Failure and rollback contract

The operation needed to reach ready state remains allowed while invalid states
are blocked:

- a check may run only after configuration and runtime readiness;
- download/install requires a pending release selected for the exact platform,
  architecture, channel, and eligible distribution;
- restart requires a fully downloaded, signature-verified, staged artifact;
- failed check, download, verification, extraction, or staging never calls
  restart;
- an automatic check failure remains non-modal and does not discard the running
  application;
- a manual failure remains visible in About and is logged;
- an ineligible installation never offers **Download Update** and always maps
  to one typed eligibility reason and recovery target;
- a helper-side failure detected from the persisted `updateAttempt` on the next
  launch is visible in About and application logs; and
- application quit still flows through the existing `ShouldQuit` and backend
  persistence contract in `main.go:65-80` and
  `docs/architecture/application-lifecycle.md:102-113`.

Staging cleanup uses the pinned beta.8 behavior without a Wails change. As the
first operation in `main`, before `MaybeRunExecWrapper`, reporter setup, or
`application.New`, create and validate a stable per-user Luxury Yacht directory
under the operating system's original temporary directory. The directory must
have the expected product-specific basename and ownership marker, be owned by
the current user, reject symlinks, and use owner-only permissions where the
platform supports them. Reuse a validated inherited `LUXURY_YACHT_TEMP_ROOT` to
keep helper/relaunch paths idempotent rather than nesting a new root on every
restart; when a platform launcher does not propagate that marker, derive the
same stable per-user root from the original system temp directory. Set `TMPDIR`
on Unix and both `TMP` and `TEMP` on Windows to that root. If setup or validation
fails, start the app with updates disabled and a diagnostic; do not fall back to
sweeping the shared operating-system temp directory.

This process-global temp-directory choice is intentional. Wails calls
`os.MkdirTemp("", "wails-update-*")`, and Go resolves an empty parent through
`os.TempDir`, so staging directories are created below the owned root
(`pkg/updater/download.go:24-40`;
[Go `os.TempDir`](https://pkg.go.dev/os#TempDir)). Wails also places the helper
log below `os.TempDir` and passes the environment to the helper
(`pkg/updater/updater.go:408-421`); its successful-swap cleanup checks the
staging basename rather than requiring a particular parent
(`pkg/updater/helper.go:193-203`). The exec wrapper, credential helpers, Wails
helper, and other directly spawned child processes intentionally inherit the
same temp root. A relaunched application runs the same first-step setup and must
not depend on platform launch services preserving custom environment variables.
Startup cleanup therefore touches only direct `wails-update-*` directories and
`wails-update-<pid>.log` files inside the validated Luxury Yacht root; it never
removes other child-process temp files
(`backend/exec_wrapper.go:41-49`; `backend/auth_providers.go:137-141`).

The unrecorded leak window is limited but non-zero. `download` attempts to remove
its directory on returned errors and while its cleanup defer is active,
including a panic in the provider call; `DownloadAndInstall` explicitly attempts
the same on verification, finalization, and extraction errors. Those removals
are best-effort because their errors are discarded
(`pkg/updater/download.go:34-40`; `pkg/updater/updater.go:285-323`). An orphan
without a `preparedUpdate` record can therefore remain when immediate removal
fails, when abrupt process termination bypasses defers between `MkdirTemp` and
`StateReady`, or when a panic occurs after `download` returns successfully but
before `StateReady`. The owned-root startup sweep retries those narrower cases.

After `StateReady`, validate that `DownloadedPath` is a direct child of the
owned root and atomically persist the exact staging directory as
`preparedUpdate`. A normal quit that is not applying the update removes that
exact directory and clears the record. On startup, reconcile `preparedUpdate`
and `updateAttempt` first, exclude their exact active paths, and then sweep
unreferenced updater-prefixed children of the owned root. A malformed,
symlink-escaped, or out-of-root record is logged and cleared without recursive
deletion. Wails may discard a successful staging directory before the next
download, but that in-memory cleanup does not cover process exit
(`pkg/updater/updater.go:281-285,432-438,504-514`).

Before calling `Updater.Restart` on macOS, Windows, or portable Linux, persist a
backend-owned `updateAttempt` containing the canonical source and target
versions, start time, platform, architecture, distribution identity, and current
process ID, plus the exact validated staging directory and immutable recovery
target for that release. Transfer ownership from `preparedUpdate` to
`updateAttempt` atomically. If this persistence fails, do not quit or call
`Restart`; return to `restart-error` with a visible retry action.

Wails derives the helper log path from the parent process ID
(`pkg/updater/updater.go:411-413`), so the next normal launch reads the exact
`wails-update-<parent-pid>.log` rather than guessing among updater logs. Reconcile
the record before starting a new automatic check:

- if the running version equals the target version, mark the attempt successful,
  clear it, and remove the helper log on a best-effort basis;
- if the running version equals the source version, mark the attempt failed,
  ingest the exact helper log into application logs when present, and expose
  `apply-error` plus the platform-specific recovery action;
- if the running version is different from both source and target, mark the
  attempt superseded by a manual or newer installation, clear it, and do not
  present a stale failure; and
- if an expected helper log is absent, report the failed attempt without
  inventing a cause.

After each reconciliation outcome, remove only the exact validated staging
directory recorded on the attempt and clear that path with the attempt. The
removal is best-effort because a successful helper normally removes its own
staging directory (`pkg/updater/helper.go:193-203`).

This contract covers restored-backup relaunches and failures that leave the old
application closed until the user starts it manually on every self-updating
platform. Helper logs are diagnostic input, not trusted state, and must be
size-bounded and sanitized before application-log ingestion.

The current backend quit preparation always returns `true`; it cannot veto
restart, though it may wait up to two seconds for selection persistence
(`backend/application_lifecycle.go:26,222-252`). That bounded wait occurs inside Wails'
30-second helper wait for the parent process to exit
(`pkg/updater/helper.go:103-116`). Test the bounded delay; do not describe a
cancelled quit state that the current application cannot produce.

After it creates a backup, Wails restores the installed target when replacement
or relaunch fails. Failure to create the backup exits the helper without an
automatic relaunch (`pkg/updater/helper.go:118-127,161-186`). See
[how the swap works](https://v3.wails.io/guides/updater/#how-the-swap-works).
The next-launch `updateAttempt` reconciliation owns user-visible reporting for
both outcomes. This is startup rollback, not general product rollback.

Release rollback rules:

- before publication, delete or repair a failed draft and rerun the complete
  build/sign/verify/upload sequence; drafts are not updater-visible;
- after publication, do not replace `updater.json` or any payload in place and
  do not delete the bad release as a substitute for a corrective rollout;
- never use the updater to downgrade a client that already installed the bad
  version;
- mark a defective release clearly, stop promoting it manually if necessary,
  and ship a higher signed corrective version; and
- keep manual installers available for trust-root, permission, or platform-
  signing recovery.

## Cross-layer ownership

### Producer and consumers

The producer is the release pipeline plus the `cmd/project` release-contract
helpers. It owns versioned updater artifact names, platform/architecture
coverage, signatures, release-scoped manifest contents, draft creation, and
final release publication.

The application-owned GitHub provider adapter consumes the release and its
manifest. A process-owned backend
coordinator consumes Wails updater events and owns the application update
snapshot. `GetAppInfo`, the `app-update` event, header status, About, native
menus, and any command-palette entry consume that snapshot or its commands.

Do not leave the current GitHub client active beside the Wails provider. Move
every consumer to the coordinator, prove parity, then delete the legacy HTTP
fetcher, custom version parser, and obsolete tests in one affected-path change.

### Ordering and readiness

- Process temp-root setup is the first operation in `main`, before exec-wrapper
  dispatch and `application.New`, so normal, helper, wrapper, and relaunched
  modes share one validated root.
- `application.New` and build/distribution eligibility resolution must run
  before the single permitted `app.Updater.Init` call.
- Eligible released desktop builds initialize Wails once; development, server,
  or invalid-version builds and builds with a missing or malformed distribution
  identity skip `Init` and remain in the application-owned disabled state.
- Persisted `updateAttempt` and `preparedUpdate` cleanup is reconciled after
  single-instance ownership; only then does the coordinator sweep unreferenced
  updater-prefixed children of the owned temp root, before updater initialization
  or any check.
- On eligible builds, updater configuration with `WindowNone` and event
  subscription must finish before any check.
- No UI event or update surface opens during `ServiceStartup`.
- The first runtime-ready workspace starts the once-only process scheduler.
- Later workspace windows consume broadcast state but do not create schedulers.
- A native **Check for Updates…** action uses `ShowAbout`'s current-window event
  after entering the process-owned check, so the focused peer opens About and
  other peers only consume the shared state broadcast.
- Manual actions from different workspace windows enter one coordinator-owned
  single-flight. Do not call concurrent `CheckAndInstall`; beta.8 replaces its
  current window session when another call begins
  (`pkg/updater/updater.go:350-364`).
- Closing any non-last workspace does not cancel a process-owned check or
  download. Closing the final workspace follows normal application quit,
  cancels in-process work, and cannot leave an untracked updater window keeping
  the process alive because `WindowNone` creates no updater window.
- Restart uses the application quit path so every peer closes and the once-only
  persistence flush runs before the helper swaps the target. The two-second
  persistence bound remains below the helper's 30-second parent-exit bound.
- On macOS, helper relaunch uses `open -n`; Wails enters helper mode before
  application initialization and releases its single-instance flock during
  cleanup (`pkg/updater/helper.go:69-82`;
  `pkg/application/application.go:42-47`;
  `pkg/application/single_instance_darwin.go:65-70`). Platform smoke tests must
  still prove the installed signed application relaunches exactly once.
- Shutdown cancels the scheduler and removes an exact owned `preparedUpdate`
  staging directory unless restart has atomically transferred it to
  `updateAttempt`, then service teardown releases application state.

### Circular-dependency boundary

- Root composition owns construction and process wiring.
- The backend coordinator may depend on Wails updater interfaces and backend
  app-state types, but not frontend packages.
- Frontend app-shell components read through `appStateAccess` and invoke an
  allowlisted command; they do not import generated reads directly or create a
  release provider.
- `cmd/project` release tooling remains a build-time leaf and does not import
  the application backend.
- The signing secret is CI input, never runtime configuration or persisted app
  state.

## TDD implementation sequence

Each behavior phase follows red, green, refactor. Do not implement the behavior
before observing the new focused test fail for the expected reason.

Implementation progress:

- [x] Phase 1 — release identity and eligibility. The shared boundary, platform
  probes, GitHub release-manifest adapter, and explicit updater artifact naming and
  selection live in `internal/updateidentity`,
  `backend/update_provider.go`, and `cmd/project`; their focused tests cover
  the matrix below.
- [x] Phase 2 — coordinator state machine. The process-owned coordinator,
  runtime-ready scheduler, explicit consent transitions, semantic broadcasts,
  owned temp-root setup/sweep primitives, and cancellation boundary live in
  `backend/internal/appupdates`, `internal/updatetemp`, and root composition.
- [x] Phase 3 — app-state migration. The semantic DTO, generated bindings,
  durable skip/prepared/attempt state, bounded helper diagnostics, startup
  reconciliation, and exact-path cleanup are implemented in `backend`,
  `backend/internal/appupdates`, and `internal/updatestate`.
- [x] Phase 4 — shell actions. Header/About/menu/command-palette actions remain
  presentation over the process coordinator; About now includes persisted
  **Skip This Version**, bounded progress, apply-failure recovery, and the
  expired-beta native download-or-quit prompt.
- [ ] Phase 5 — publishing pipeline. The macOS signed/notarized updater ZIP,
  Wails extraction conformance check, explicit ordered artifact selector, local
  Wails manifest sign/verify helper, public-key embedding, scoped CI key
  materialization, release-scoped `updater.json`, and draft-then-publish GitHub
  Release boundary are implemented. The live macOS rollout evidence remains
  pending.
- [ ] Phase 6 — affected-path cleanup.

### Phase 1: release identity and eligibility

Add failing tests for:

- canonical version normalization;
- stable/prerelease GitHub discovery and manifest labelling, including beta
  builds converging to a newer stable release;
- dev and server suppression;
- expired-beta notification-only recovery;
- supported platform/architecture/distribution combinations;
- macOS installed-bundle, writable-parent, read-only-volume, and unsupported-path
  eligibility;
- Windows valid per-user installer marker versus missing, malformed,
  mismatched-product, non-adjacent, and machine-scope identity;
- Linux valid portable marker versus missing, malformed, mismatched-product,
  non-adjacent, package-managed, and non-user-writable identity;
- Linux valid DEB/RPM package marker versus missing, malformed, mismatched-
  product, and wrong-scope identity, plus package-manager exclusion; and
- every ineligible installation maps to exactly one typed eligibility reason and
  platform recovery target; and
- exactly one updater artifact for every enabled target, with directory and glob
  inputs rejected.

Implement one shared build/update identity boundary. Do not infer eligibility
from platform alone.

### Phase 2: coordinator state machine

Introduce a small updater interface around the Wails methods used by Luxury
Yacht so tests can use an offline fake provider and deterministic clock.

Add failing tests for:

- configuration before checking;
- process temp-root setup runs before wrapper/helper/application dispatch, sets
  `TMPDIR` or `TMP`/`TEMP`, reuses an inherited validated root without nesting,
  and disables updates without falling back to shared-temp cleanup when setup
  fails;
- the exec wrapper, credential helpers, and updater helper inherit the owned
  temp root, while a relaunched app resolves the same root whether or not its
  platform launcher preserves the custom environment;
- eligible released builds call Wails `Init` exactly once, while development,
  server, or invalid-version builds and builds with a missing or malformed
  distribution identity never call it or any other Wails updater method;
- a reachable manual action in a disabled desktop build returns the app-owned
  disabled snapshot rather than `ErrNotConfigured`;
- once-only startup after first runtime readiness;
- immediate and periodic silent checks;
- a manual check that never downloads by itself;
- explicit download consent for a known pending version;
- explicit restart consent for a ready version;
- scheduler cancellation;
- single-flight manual/background interaction;
- simultaneous actions from different workspace windows;
- final-workspace close cancellation without an updater-window orphan;
- process restart discards available/ready state and requires a new check and
  explicit download consent rather than claiming download resumption;
- no-update, available, downloading, verifying, installing, ready, and error
  projection;
- invalid early download/restart rejection; and
- allowed check/download/skip/restart transitions that reach ready state.

### Phase 3: app-state migration

Define the smallest backend DTO that preserves the current shell contract while
making updater state explicit. Regenerate Wails bindings if its shape changes.

Add failing tests proving:

- `GetAppInfo` returns the current snapshot without starting a second check;
- every relevant Wails event updates the snapshot and emits one `app-update`;
- release notes, version, publication time, progress, eligibility, and errors
  map correctly;
- dev and unsupported builds report a non-installable state without errors;
- skipped-version persistence uses the provider's canonical unprefixed form and
  hydrates and updates atomically if approved;
- the intentional prerelease-to-stable SemVer behavior differs from the legacy
  numeric comparator; and
- persisted `updateAttempt` state on macOS, Windows, and portable Linux reports
  success, restored-old-version failure, missing-log failure, superseded-version
  cleanup, persistence failure before quit, and sanitized size-bounded
  helper-log diagnostics;
- `preparedUpdate` records only a normalized exact path inside the
  application-owned staging parent, normal quit removes it, restart transfers
  it atomically to `updateAttempt`, and next-launch reconciliation removes it;
- abrupt pre-ready orphan directories inside the owned root are swept even
  without a `preparedUpdate` record; and
- malformed, symlink-escaped, out-of-root, active-attempt, and non-updater child
  paths are never recursively deleted, and updater-prefixed paths in the shared
  operating-system temp directory remain untouched.

These tests now pass, and the custom GitHub release fetch and numeric version
parser have been removed.

### Phase 4: shell actions

Add failing frontend and menu tests before changing the surfaces:

- the status chip appears only for an applicable update;
- **Check for Updates…** checks only and opens the existing About update section;
- activating the chip opens About without starting a download;
- **Download Update** calls the Wails download/install operation only for an
  eligible pending release;
- **Restart & Apply** calls restart only from ready;
- notification-only installs expose only their reason-specific recovery action
  and open its validated release/download or migration target;
- About renders the canonical copy and actions for checking, current, available,
  downloading, verifying, preparing, ready, check-error, prepare-error,
  restart-error, and apply-error, including release notes where required;
- every typed eligibility reason renders its exact platform explanation and
  recovery action without starting staging;
- progress percentages render only for bounded backend progress;
- every permitted About close path during active work closes the modal without
  cancelling the process-owned operation, and reopening resumes from the shared
  snapshot;
- **Switch to Per-User Installation** opens the Windows migration target only
  for machine-scope identity;
- manual check labels and actions are aligned across native menu and command
  palette surfaces;
- native manual check reuses `ShowAbout` so only the focused workspace opens the
  modal while all peers receive the shared state;
- automatic failures remain non-modal; and
- focus/keyboard ownership remains with the existing shared About modal
  infrastructure.

Use existing CSS tokens and the current About/shared-modal infrastructure. Do
not theme, replace, or open the Wails built-in window in this implementation.

### Phase 5: publishing pipeline

Add failing `cmd/project` contract tests for updater artifact names, supported
extensions, platform/architecture completeness, release-scoped manifest URLs,
stable/prerelease selection and manifest labels, explicit-file-only input,
duplicate rejection, macOS extracted-bundle validation, Windows raw-executable
selection, Linux portable-payload selection, platform recovery targets, Windows
migration-page availability, and draft-before-publication ordering. The macOS
test must enter extraction through `updater.New`, `Check`, and
`DownloadAndInstall` and validate `DownloadedPath`, not invoke a second archive
extractor directly.

Add provider/helper tests proving exact updater-payload selection, same-release
`updater.json` resolution, strict version/channel/URL/filename/size matching,
base64 digest/signature length checks, local Wails verification, one manifest
asset in the release set, draft creation before public visibility, and a failed
final publish leaving the draft non-public.

Then update each platform task and the release workflow to build,
platform-sign, archive, validate the extracted payload, manifest-sign, verify,
upload all manual and updater assets to a draft GitHub Release, and publish the
complete draft in one final step. Retain the existing manual installation
artifacts.

### Phase 6: affected-path cleanup

- [x] delete the legacy GitHub update client and custom comparison helpers;
- [x] delete or rewrite tests that assert the retired release-page-only
  behavior;
- [x] remove obsolete DTO fields after all frontend consumers move;
- [x] update `docs/architecture/application-lifecycle.md` with the durable process
  lifecycle contract;
- [x] create `docs/workflows/application-updates.md` for the durable publishing,
  platform eligibility, helper-failure recovery, rollback, and key-handling
  workflow;
- [x] add the user-facing change to `docs/release/pending.md`.

## Validation and rollout

### Focused validation

- Run backend coordinator, lifecycle, menu, settings-state, and release-tooling
  tests with directly affected coverage.
- Run frontend status, About, command-palette, app-state-access, and modal tests
  with directly affected coverage.
- Regenerate and verify Wails bindings when backend DTOs or methods change.
- Generate manifests from explicit file arguments and prove directory, glob,
  installer, package, duplicate, and ambiguous inputs fail before signing.
- Prove beta.8 creates staging and helper logs below the configured process temp
  root on Unix and Windows. Exercise returned-error cleanup and startup retry,
  abrupt pre-ready orphan cleanup, ready-state cleanup, inherited child
  environments, and refusal to scan shared-temp or non-updater paths.
- Run `wails3 updater verify` against a tampered artifact and wrong public key
  and prove both fail closed.
- Generate a local release set, prove `updater.json` and every required payload
  are selected, verify the manifest locally with the embedded public key, and
  inspect the captured GitHub CLI calls to prove draft creation precedes the
  final publish edit. Exercise upload and final-publish failure without making
  an incomplete release public.
- Run the full `mise exec -- wails3 task qc:prerelease` gate on the latest
  worktree, then inspect formatting changes.

### Platform smoke tests

For each target in the current delivery stage, install an older authenticated
build and update it through a local or prerelease manifest. Before declaring the
initiative complete, rerun the combined matrix across every target:

- macOS arm64 and amd64: validate the signed/notarized source and Wails-extracted
  bundles, then verify installed-path eligibility, read-only-volume and
  unwritable-parent reason copy and recovery actions, complete bundle swap,
  `open -n` relaunch through the single-instance lifecycle, version, settings,
  restored-backup reporting, missing-helper-log reporting, and backup-creation
  and launch failures;
- Windows amd64 and arm64: verify per-user install identity,
  every invalid marker form, Authenticode, executable swap without elevation,
  Apps & Features version reconciliation, relaunch, and uninstall; assert the
  recursive NSIS uninstall leaves no installation directory even when
  `luxury-yacht.exe.old.*` or `luxury-yacht.exe.bak` is present; then verify
  machine-scope reason copy, migration-page action, side-by-side installer
  refusal, settings preservation, and notification-only fallback
  (`build/windows/nsis/project.nsi:103-116`);
- Linux amd64 and arm64 portable installs: verify valid installation identity,
  invalid-marker and package-owned rejection, bare-binary or single-entry-tar
  replacement without elevation, dependency diagnostics, relaunch, settings,
  uninstall behavior, and portable-ineligibility reason copy and recovery
  action; and
- Linux DEB/RPM: verify notification-only behavior and confirm no staging or
  swap attempt occurs, the package-owned marker is installed and removed by the
  package manager, and the package-manager explanation and action render only
  from a valid marker.

Exercise offline, no-update, missing-artifact, wrong-architecture, bad digest,
bad signature, extraction failure, unsupported artifact, mismatched release manifest,
unwritable target, the bounded two-second quit flush, normalized skipped version,
expired-beta manual recovery, closing and reopening About during every active
state, restart-attempt persistence failure, successful restart, restored-source
failure, missing helper log, superseding manual installation, and failed
relaunch states on every self-updating platform.

Run multi-window smoke tests with two workspace peers: simultaneous manual
checks, check during automatic check, download from either peer, non-last close
during download, final close during download, restart from either peer, and
exactly one process scheduler, download, helper, persistence flush, and relaunch.

### Rollout

- [x] **Stage 0 — shared foundation:** with the owner decisions resolved,
  implement the process-owned coordinator, shell actions, version/channel
  identity, updater signing, explicit artifact selection, the inherited
  application-owned process temp root and abrupt-orphan cleanup, release-scoped
  manifest publication, and notification-only eligibility fallback
  without enabling an unresolved distribution.
- [ ] **Stage 1 — macOS:** publish updater-capable arm64 and amd64 betas through
  draft-then-public prereleases, prove beta-to-beta update and failed-draft
  recovery, then publish stable only after stable-to-stable, beta-to-stable,
  same-release manifest validation, the macOS smoke matrix, and the full gate
  are green.
- [ ] **Stage 2 — Windows:** provision Authenticode signing, move the supported
  installer to per-user identity, publish signed raw updater executables for
  arm64 and amd64, publish the migration page, enforce installer side-by-side
  refusal, prove settings-preserving migration and the Windows smoke matrix in
  prerelease and ordinary releases. Existing machine-scope installs remain
  notification-only until migrated.
- [ ] **Stage 3 — Linux:** publish the explicitly identified user-owned portable
  distribution and updater payloads for arm64 and amd64, add package-owned
  identity markers to DEB/RPM, prove portable update and rollback behavior, and
  keep DEB/RPM notification-only.
- [ ] **Stage 4 — cross-platform completion:** run release-manifest readback,
  signature verification, failed-draft recovery, stable-to-stable, beta-to-beta,
  beta-to-stable, multi-window, and platform smoke tests across macOS, Windows,
  and portable Linux in one release candidate. Do not mark the initiative
  complete or retire this plan before this stage passes.
- [ ] Monitor updater errors, helper-attempt reconciliation, failed relaunch
  reports, and manual-download fallback use after each platform stage before
  expanding the next stage.

## Acceptance criteria

- The initiative is not complete until eligible macOS, per-user Windows, and
  portable Linux installations all self-update on every release architecture.
- Automatic checks never open a window when the app is current or the check
  fails.
- Development, server, or invalid-version builds and builds with a missing or
  malformed distribution identity never initialize or call Wails updater
  methods; a reachable disabled desktop action reports the application-owned
  disabled state without a Wails configuration error. Valid notification-only
  distributions still check for releases but never stage them.
- **Check for Updates…** and status-chip activation never download an update.
- No update downloads without **Download Update**, and no restart occurs without
  **Restart & Apply**.
- About renders the canonical status copy and actions, shows only real bounded
  progress, and may close and reopen during active work without cancelling or
  duplicating the process-owned operation.
- Available and ready state are explicitly process-local; quitting without
  applying removes the exact owned staging directory, and the next launch
  rechecks and requires renewed download consent rather than promising resume.
- Before any wrapper, helper, or application dispatch, the process configures a
  validated per-user temp root that beta.8 uses for staging and helper logs;
  direct child processes intentionally inherit it, and a relaunched app derives
  or reuses the same root without nesting.
- Returned update errors attempt immediate cleanup, and startup retries failed
  removal and removes abrupt pre-ready updater orphans only from that owned
  root. Shared operating-system temp paths, active attempt paths, and
  non-updater child files are never swept.
- Every ineligible installation renders its exact platform explanation and
  recovery action; no recovery action starts Wails staging.
- Stable builds never receive a prerelease; beta builds receive newer beta or
  stable releases according to GitHub release discovery, and every manifest's
  channel matches the selected release's prerelease flag.
- Every installed artifact is matched to the exact platform, architecture,
  channel, and eligible distribution.
- Every installed artifact passes both the manifest digest and the Wails CLI's
  per-artifact `ed25519ph` verification against the embedded public key.
- No updater manifest is generated from a directory or glob, and no installer or
  package artifact can enter its explicit file list.
- macOS offers self-update only for an eligible installed bundle, validates the
  exact extracted signed/notarized payload, and swaps the complete app bundle.
- A helper-side failure on macOS, Windows, or portable Linux is reported from
  persisted attempt state on the next launch, including when the exact helper
  log is absent; a different manually installed version supersedes stale attempt
  state without a false failure.
- Windows self-update works without elevation from the approved per-user
  installation marker and preserves correct uninstall metadata; recursive NSIS
  uninstall removes the complete installation directory, including any
  best-effort Wails `.old.*` or `.bak` leftovers.
- Machine-scope Windows users receive the defined per-user migration action;
  the installer prevents side-by-side scope installations and preserves
  user-profile settings through migration.
- Portable Linux self-update works without elevation only from the approved
  user-owned installation marker and preserves desktop integration and uninstall
  behavior.
- Linux package installations never mutate package-owned files.
- Expired beta builds provide the manual release-page recovery action and never
  enter download, staging, or restart.
- Restart follows the existing multi-window quit and persistence lifecycle.
- A relaunch failure restores the prior application; a post-launch defect is
  recovered through a higher version or manual installer, never silent
  downgrade.
- `GetAppInfo`, `app-update`, header status, About, native menus, and command
  palette share one backend-owned update state and action path.
- Native **Check for Updates…** reuses the existing focused-window `ShowAbout`
  path and never opens About in every workspace peer.
- The legacy GitHub release client and custom version comparator are removed
  after consumer parity is proven.
- Every release has exactly one `updater.json` beside its payloads and manual
  installers. It exactly matches the selected release version, prerelease
  channel, artifact URL, filename, size, platform, and architecture.
- Release tooling creates a draft with the complete verified asset set and
  publishes only after upload succeeds. Upload or final-publish failure never
  silently reports a new public updater release, and an existing draft or
  release is never overwritten by a rerun.
- Update availability has no runtime dependency on the marketing site, GitHub
  Pages, a raw branch, or a separately mutable channel manifest.
- No private signing material is committed, logged, embedded, or persisted by
  the application.
