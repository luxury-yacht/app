# Automatic Application Updates

Status: draft implementation plan. No updater installation or restart behavior
is approved by this document alone. Resolve the approval gates below before
changing code or release automation.

This plan proposes superseding the notification-only decision in
`docs/plans/wails-v3-follow-up-tracks.md:3-23` only after the approval gates below
are accepted. Until then, the recorded notification-only behavior remains the
project decision. When implementation is complete, move durable lifecycle and
distribution contracts into `docs/architecture` and
`docs/workflows/application-updates.md`, then remove the completed updater
section from the broader follow-up plan.

## Outcome

Luxury Yacht should check for application updates automatically without
interrupting normal work. When a supported installation has an update, the
existing shell surfaces should offer a user-initiated Wails update flow that
downloads, authenticates, stages, and applies the update through an explicit
restart action.

The proposed first release:

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

## Approval gates

Resolve these decisions with the project owner before implementation:

1. Confirm that "automatic updates" means silent automatic checks followed by
   separate user-initiated **Download Update** and **Restart & Apply** actions,
   not silent download or forced restart.
2. Confirm the initial platform policy:
   - macOS: full self-update only after the installed bundle passes the runtime
     eligibility preflight;
   - Windows: full self-update only after per-user installation and signing
     requirements are satisfied; and
   - Linux DEB/RPM: notification and manual package-manager update only.
3. Confirm use of an Ed25519 signing key held in a protected CI secret, with the
   public key embedded in the application.
4. Confirm whether a Windows Authenticode certificate is available. If it is
   not, keep Windows on notification-only behavior until one is provisioned or
   explicitly accept the unsigned-binary distribution risk.
5. Confirm whether **Skip This Version** must survive application restarts. The
   recommended default is yes, implemented as backend-owned update state that
   is not part of portable settings export.
6. Confirm use of the separately deployed `luxury-yacht/site` repository for
   fixed channel manifests. That cross-repository publication step and its
   server cache policy must be implemented before enabling production checks.
   The existing release job already invokes a site update with a repository
   token (`cmd/project/site.go:11-32`;
   `.github/workflows/release.yml:196-212`).

## Current state

The application already pins Wails `v3.0.0-beta.8`, and that pinned module
contains `app.Updater`, the GitHub and endpoint providers, updater publishing
commands, the built-in updater window, and the helper-mode swap. No Wails
dependency change is currently required (`go.mod:15`; pinned dependency sources
`pkg/updater/updater.go`, `pkg/updater/providers/github/github.go`,
`pkg/updater/providers/endpoint/endpoint.go`,
`internal/commands/updater_tool.go`, `pkg/updater/window.go`, and
`pkg/updater/helper.go`).

The existing application updater is notification-only:

- `backend/app_update.go:22-178` calls the GitHub latest-release API, performs a
  custom version comparison, caches `UpdateInfo`, and emits `app-update`;
- `backend/app_version.go:60-170` attaches that cached state to `GetAppInfo`;
- `backend/app_lifecycle.go:42-65` starts one update check after the first
  runtime-ready workspace window;
- `frontend/src/ui/status/UpdateStatus.tsx:55-149` reads app info, subscribes to
  `app-update`, and opens the downloads page from the header chip; and
- `frontend/src/ui/modals/AboutModal.tsx:80-105` renders the same availability
  state in About.

The current client calls GitHub's unauthenticated `/releases/latest` endpoint
(`backend/app_update.go:22-24,177-214`). GitHub documents a 60-request-per-hour,
per-originating-IP limit for unauthenticated REST requests; see
[GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-unauthenticated-users).
The static endpoint provider removes that GitHub API dependency from client
checks.

The current release workflow publishes installer or package artifacts, not the
single replaceable targets accepted by the Wails updater:

- macOS publishes signed and notarized DMGs
  (`.github/workflows/release.yml:104-145`);
- Windows publishes unsigned NSIS installers
  (`.github/workflows/release.yml:156-159`);
- Linux publishes DEB and RPM packages
  (`.github/workflows/release.yml:147-154`); and
- the release artifact naming contract encodes those formats in
  `cmd/project/project_config.go:153-208`.

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

1. Configure the updater and subscribe to its events before `application.Run`.
2. Start the coordinator only after the first `WindowRuntimeReady`, preserving
   the existing readiness guarantee in `backend/app_lifecycle.go:42-65`.
3. Run one silent `Updater.Check` immediately, then repeat every six hours.
4. Suppress automatic checks for development builds, server builds, and builds
   without a valid release version or supported distribution identity.
5. Cancel the scheduler during service shutdown.
6. Allow only one check/download/install flow at a time. A manual check should
   join, focus, or report the existing flow rather than start a competing state
   machine.

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
   error results have an immediate visible owner.
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
6. Notification-only distributions expose **View Download Options**, which opens
   the release/download page and never stages an artifact.

All labels and actions must be shared across the header, About, native menu, and
command palette. Frontend state reads remain behind `appStateAccess`; updater
commands use the explicit backend API allowlist.

### Skip and dismiss

The pinned updater keeps `SkipVersion` only in process memory
(`pkg/updater/window_lifecycle.go:153-186`). If restart-persistent skipping is
approved:

- persist one canonical, unprefixed `skippedVersion` value as backend-owned
  application update state. It must use the exact normalized form returned as
  endpoint `Release.Version` because Wails skip matching is string equality
  (`pkg/updater/providers/endpoint/endpoint.go:177-179`;
  `pkg/updater/window_lifecycle.go:178-186`);
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
(`backend/app_lifecycle.go:63`; `backend/app_update.go:53-62`). If an opt-out is
later approved, implement it as a backend-owned preference described by the app
settings schema and mutated through `UpdateAppPreferences`.

### Expired beta recovery

An expired beta remains notification-only. Today the first
`WindowRuntimeReady` returns before `startUpdateCheck` when
`checkStartupBetaExpiry` fails, then shows a dialog and quits
(`backend/app_lifecycle.go:42-63,125-137`). Do not start a long-running updater
flow inside that shutdown path.

Replace the expiry dialog's passive instruction with an explicit
**Download Latest Version** action that opens the release/download page before
quit, plus **Quit**. This is the recovery path even on a normally self-updatable
installation. Tests must prove an expired beta cannot enter download, staging,
or restart states and that the manual recovery action remains available.

## Provider, channels, and version identity

Use `github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint`, not the
GitHub Releases provider, for production installation. The GitHub provider's
`ChecksumAsset` supplies digest integrity but no application-pinned signature,
and its beta.8 default asset matcher requires the runtime platform string
`darwin` while the current macOS assets are named with `macos`
(`pkg/updater/providers/github/github.go:391-421`;
`cmd/project/project_config.go:182-187`). The endpoint manifest carries the
per-artifact digest and `ed25519ph` signature authenticated by the public key
embedded in the application. See
[cryptographic verification](https://v3.wails.io/guides/updater/#cryptographic-verification).

Create two fixed manifests through that existing `luxury-yacht/site` deployment:

- `https://luxury-yacht.app/updates/stable.json`
- `https://luxury-yacht.app/updates/beta.json`

Configure one endpoint URL,
`https://luxury-yacht.app/updates/{{channel}}.json`, and set
`endpoint.Config.Channel` to the build's normalized `stable` or `beta` channel.
Do not rely on `updater.Config.Channel`: beta.8 does not add it to
`CheckRequest`, while the endpoint provider owns placeholder substitution and
client-side channel enforcement (`pkg/updater/updater.go:212-216`;
`pkg/updater/types.go:94-101`;
`pkg/updater/providers/endpoint/endpoint.go:38-55,148-150,270-309`).

The site implementation must add the static update files to its build output and
define a cache policy that permits prompt channel rollback. The exact URLs and
response headers become release-contract constants covered by tests. Versioned
update artifacts remain assets of their ordinary immutable GitHub release tag;
each manifest contains absolute URLs to those versioned artifacts.

Channel rules:

- stable builds read only the stable manifest;
- beta builds read the beta manifest;
- a beta release advances only the beta manifest;
- a stable release generates two manifests over the same stable version and
  artifacts: one declaring channel `stable` for `stable.json`, and one declaring
  channel `beta` for `beta.json`, so beta users can converge without failing the
  endpoint provider's channel filter; and
- neither channel pointer moves until the versioned release and every updater
  artifact have been published and verified.

`build/config.yml:15` currently stores a `v`-prefixed version. Add one shared,
tested normalization boundary that passes Wails the same semantic version
without the leading `v`. `cmd/project/build_metadata.go:57-68` copies the
configured version verbatim into the embedded manifest, and
`backend/app_version.go:42-58` copies that value into `backend.Version`; the new
boundary normalizes that authoritative value exactly once for updater config,
channel manifests, skip persistence, and comparisons. Do not add a second
version source or restore ldflag version injection.

Name and test the intentional comparison change: the legacy comparator drops
prerelease suffixes at `backend/app_update.go:253-263`, so
`2.0.0-beta.1` and `2.0.0` compare equal. The endpoint provider delegates its
newer-version decision to Wails' SemVer wrapper
(`pkg/updater/providers/endpoint/endpoint.go:148-152`;
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
5. Extract the ZIP through the same Wails extraction path used by the client,
   assert that the only top-level entry is the `.app`, and rerun the signature,
   Gatekeeper, and stapler validations against that extracted bundle. Signing
   the source bundle is not evidence that the bytes and metadata survive the
   updater's extraction path.
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

Failure of any preflight rule projects a non-installable update with
**View Download Options**. Treat the preflight as eligibility evidence, not a
guarantee: the helper can still fail after process exit.

Before `Updater.Restart`, persist an `updateAttempt` record containing the
canonical from/to versions, start time, platform target, and current process ID.
Wails derives the helper log path from that parent process ID
(`pkg/updater/updater.go:411-413`), so the next normal launch can inspect the
exact `wails-update-<parent-pid>.log` rather than guessing among updater logs. On
that launch:

- if the running version is the target version, mark the attempt successful and
  clear it;
- if the running version is still the source version, mark the attempt failed,
  ingest the exact helper log into application logs, and expose a recovery
  message plus manual download action; and
- if the expected helper log does not exist, report the failed attempt without
  inventing a cause.

This covers both restored-backup relaunches and failures that leave the old app
closed until the user starts it manually. Helper logs are diagnostic input, not
trusted state, and must be size-bounded and sanitized before application-log
ingestion.

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
6. Define a one-time migration path for existing machine-scope installations.
   Until migrated, those installs stay notification-only.
7. Reconcile per-user Apps & Features `DisplayVersion` after a successful
   update, because Wails replaces the application executable rather than
   rerunning NSIS. Keep uninstaller ownership and registry access limited to the
   known per-user installation contract.

Do not add a compile-time distribution stamp: the same signed executable is the
input to both NSIS and the raw updater artifact (`build/windows/Taskfile.yml:85-102`).
The installer-written marker is the runtime distribution and scope identity. A
general filesystem-writability check alone is not sufficient proof that
replacing a package-owned executable is correct.

### Linux

DEB and RPM installations remain notification-only. Users update them through
their package manager or download the new package from the release page. The app
must not replace `/usr/local/bin/luxury-yacht` behind dpkg or rpm.

A later phase may add a separately identified portable Linux distribution with
a user-owned single binary or single-entry tar archive. That distribution must
carry build metadata that explicitly opts into self-update; path writability
alone is not an opt-in signal. AppImage behavior requires separate investigation
and is not assumed to be compatible.

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
   list containing exactly one supported updater target for every enabled
   platform and architecture. Pass those individual paths to
   `wails3 updater manifest`; never pass a release directory or glob. The Wails
   CLI's directory collection includes DMG, DEB, RPM, and EXE files and the
   endpoint provider chooses the first matching manifest entry
   (`internal/commands/updater_tool.go:589-633,645-710`;
   `pkg/updater/providers/endpoint/endpoint.go:350-369`).
3. Reject DMG, NSIS installer EXE, DEB, RPM, AppImage, MSI, PKG, checksum,
   signature-sidecar, key, documentation, and unknown extensions as updater
   install targets. Assert that every accepted target is a ZIP, tar archive, or
   bare executable intended for Wails replacement.
4. Run `wails3 updater manifest` with the canonical release version, the channel
   being served, notes, private key, absolute immutable versioned-release URL
   prefix, and the explicit updater file list. A stable release runs this step
   once with channel `stable` and once with channel `beta`.
5. Run `wails3 updater verify` with the embedded public key against every local
   artifact in each generated manifest.
6. Publish the ordinary immutable versioned GitHub release and all of its assets.
   Never clobber or re-upload an artifact URL already referenced by a published
   channel manifest.
7. Download every versioned artifact URL and confirm its bytes match the local
   file that passed verification.
8. Update the applicable static manifest file in `luxury-yacht/site` last.
9. Read the public channel-manifest URL back after deployment, assert the exact
   canonical version and expected channel, then download and verify every
   referenced artifact again with the embedded public key. A stale or mismatched
   response fails the release.

The channel manifest is the rollout pointer. Publishing it last prevents a
client from observing an update whose artifact is not available yet. A release
job must fail if any supported platform/architecture artifact is absent,
duplicated, ambiguously named, unsupported, unsigned, unverifiable, or served
with stale channel contents.

### Key rotation

Wails `updater.Config` accepts one active public key. Normal rotation therefore
requires a transition release signed by the old key that embeds the new public
key, followed by a deliberate adoption window before CI begins signing channel
manifests with the new key. Clients that miss the transition cannot trust the
new key and need a manual installer recovery path.

If the private key is suspected compromised, stop advancing both channel
manifests immediately. Do not attempt an in-band rotation signed only by the
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
- a failed macOS eligibility preflight never offers **Download Update**;
- a helper-side failure detected from the persisted `updateAttempt` on the next
  launch is visible in About and application logs; and
- application quit still flows through the existing `ShouldQuit` and backend
  persistence contract in `main.go:65-80` and
  `docs/architecture/application-lifecycle.md:102-113`.

The current backend quit preparation always returns `true`; it cannot veto
restart, though it may wait up to two seconds for selection persistence
(`backend/app_lifecycle.go:26,222-252`). That bounded wait occurs inside Wails'
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

- before client installation, restore the channel pointer to the prior signed
  manifest to stop further rollout;
- never use the updater to downgrade a client that already installed the bad
  version;
- ship a higher corrective version for post-launch defects; and
- keep manual installers available for trust-root, permission, or platform-
  signing recovery.

## Cross-layer ownership

### Producer and consumers

The producer is the release pipeline plus the `cmd/project` release-contract
helpers. It owns versioned updater artifact names, platform/architecture
coverage, signatures, manifest contents, channel publication, and publication
ordering.

The Wails endpoint provider consumes the manifest. A process-owned backend
coordinator consumes Wails updater events and owns the application update
snapshot. `GetAppInfo`, the `app-update` event, header status, About, native
menus, and any command-palette entry consume that snapshot or its commands.

Do not leave the current GitHub client active beside the Wails provider. Move
every consumer to the coordinator, prove parity, then delete the legacy HTTP
fetcher, custom version parser, and obsolete tests in one affected-path change.

### Ordering and readiness

- `application.New` must run before `app.Updater.Init`.
- Updater configuration with `WindowNone` and event subscription must finish
  before any check.
- No UI event or update surface opens during `ServiceStartup`.
- The first runtime-ready workspace starts the once-only process scheduler.
- Later workspace windows consume broadcast state but do not create schedulers.
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
- Shutdown cancels the scheduler before service teardown releases application
  state.

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

### Phase 1: release identity and eligibility

Add failing tests for:

- canonical version normalization;
- `endpoint.Config.Channel` selection and stable/beta manifest labelling,
  including a stable version served by a manifest declaring channel `beta`;
- dev and server suppression;
- expired-beta notification-only recovery;
- supported platform/architecture/distribution combinations;
- macOS installed-bundle, writable-parent, read-only-volume, and unsupported-path
  eligibility;
- Windows valid per-user installer marker versus missing, malformed,
  mismatched-product, non-adjacent, and machine-scope identity;
- Linux package-manager exclusion; and
- exactly one updater artifact for every enabled target, with directory and glob
  inputs rejected.

Implement one shared build/update identity boundary. Do not infer eligibility
from platform alone.

### Phase 2: coordinator state machine

Introduce a small updater interface around the Wails methods used by Luxury
Yacht so tests can use an offline fake provider and deterministic clock.

Add failing tests for:

- configuration before checking;
- once-only startup after first runtime readiness;
- immediate and periodic silent checks;
- a manual check that never downloads by itself;
- explicit download consent for a known pending version;
- explicit restart consent for a ready version;
- scheduler cancellation;
- single-flight manual/background interaction;
- simultaneous actions from different workspace windows;
- final-workspace close cancellation without an updater-window orphan;
- no-update, available, downloading, verifying, installing, ready, and error
  projection;
- invalid early download/restart rejection; and
- allowed check/download/restart transitions that reach ready state.

### Phase 3: app-state migration

Define the smallest backend DTO that preserves the current shell contract while
making updater state explicit. Regenerate Wails bindings if its shape changes.

Add failing tests proving:

- `GetAppInfo` returns the current snapshot without starting a second check;
- every relevant Wails event updates the snapshot and emits one `app-update`;
- release notes, version, publication time, progress, eligibility, and errors
  map correctly;
- dev and unsupported builds report a non-installable state without errors;
- skipped-version persistence uses the endpoint's canonical unprefixed form and
  hydrates and updates atomically if approved;
- the intentional prerelease-to-stable SemVer behavior differs from the legacy
  numeric comparator; and
- persisted `updateAttempt` state reports success, restored-old-version failure,
  missing-log failure, and sanitized size-bounded helper-log diagnostics.

Only after these pass, remove the custom GitHub release fetch and numeric
version parser.

### Phase 4: shell actions

Add failing frontend and menu tests before changing the surfaces:

- the status chip appears only for an applicable update;
- **Check for Updates…** checks only and opens the existing About update section;
- activating the chip opens About without starting a download;
- **Download Update** calls the Wails download/install operation only for an
  eligible pending release;
- **Restart & Apply** calls restart only from ready;
- notification-only installs open the release/download page;
- About shows checking, current, available, progress, ready-to-restart,
  unsupported, and error states, including release notes;
- manual check labels and actions are aligned across native menu and command
  palette surfaces;
- automatic failures remain non-modal; and
- focus/keyboard ownership remains with the existing shared About modal
  infrastructure.

Use existing CSS tokens and the current About/shared-modal infrastructure. Do
not theme, replace, or open the Wails built-in window in this implementation.

### Phase 5: publishing pipeline

Add failing `cmd/project` contract tests for updater artifact names, supported
extensions, platform/architecture completeness, manifest URLs, channel
selection and manifest labels, explicit-file-only input, duplicate rejection,
macOS extracted-bundle validation, public-manifest readback, and publication
ordering.

Then update the platform tasks and release workflow to build, platform-sign,
archive, validate the extracted payload, upload, manifest-sign, verify, publish
channel metadata through `luxury-yacht/site`, and read the public result back.
Retain the existing manual installation artifacts.

### Phase 6: affected-path cleanup

- delete the legacy GitHub update client and custom comparison helpers;
- delete or rewrite tests that assert the retired release-page-only behavior;
- remove obsolete DTO fields only after all frontend consumers move;
- update `docs/architecture/application-lifecycle.md` with the durable process
  lifecycle contract;
- create `docs/workflows/application-updates.md` for the durable publishing,
  platform eligibility, helper-failure recovery, rollback, and key-handling
  workflow;
- add the user-facing change to `docs/release/pending.md`; and
- retire the completed updater checklist in
  `docs/plans/wails-v3-follow-up-tracks.md`.

## Validation and rollout

### Focused validation

- Run backend coordinator, lifecycle, menu, settings-state, and release-tooling
  tests with directly affected coverage.
- Run frontend status, About, command-palette, app-state-access, and modal tests
  with directly affected coverage.
- Regenerate and verify Wails bindings when backend DTOs or methods change.
- Generate manifests from explicit file arguments and prove directory, glob,
  installer, package, duplicate, and ambiguous inputs fail before signing.
- Run `wails3 updater verify` against a tampered artifact and wrong public key
  and prove both fail closed.
- Read both public channel manifests back, verify their channel labels and exact
  expected version, and reverify every downloaded artifact.
- Run the full `mise exec -- wails3 task qc:prerelease` gate on the latest
  worktree, then inspect formatting changes.

### Platform smoke tests

For each enabled target, install an older signed build and update it through a
local or prerelease manifest:

- macOS arm64 and amd64: validate the signed/notarized source and Wails-extracted
  bundles, then verify installed-path eligibility, read-only-volume and
  unwritable-parent rejection, complete bundle swap, `open -n` relaunch through
  the single-instance lifecycle, version, settings, restored-backup reporting,
  missing-helper-log reporting, and backup-creation and launch failures;
- Windows amd64 and arm64, when enabled: verify per-user install identity,
  every invalid marker form, Authenticode, executable swap without elevation,
  Apps & Features version reconciliation, relaunch, uninstall, and machine-scope
  notification-only fallback; and
- Linux DEB/RPM: verify notification-only behavior and confirm no staging or
  swap attempt occurs.

Exercise offline, no-update, missing-artifact, wrong-architecture, bad digest,
bad signature, extraction failure, unsupported artifact, stale public manifest,
unwritable target, the bounded two-second quit flush, normalized skipped version,
expired-beta manual recovery, successful restart, and failed relaunch states.

Run multi-window smoke tests with two workspace peers: simultaneous manual
checks, check during automatic check, download from either peer, non-last close
during download, final close during download, restart from either peer, and
exactly one process scheduler, download, helper, persistence flush, and relaunch.

### Rollout

1. Land the complete app and release-pipeline contract without enabling a
   platform whose install eligibility is unresolved.
2. Publish an updater-capable beta containing its own signed artifacts and beta
   manifest through the new static site path. Existing builds continue using the
   notification-only updater; the new build exercises updates beginning with the
   following beta.
3. Prove beta-to-beta update and emergency channel rollback on every enabled
   target.
4. Publish a stable candidate that produces distinct `stable`-labelled and
   `beta`-labelled manifests over the same stable artifacts, then prove both
   stable-to-stable and beta-to-stable selection.
5. Publish a stable release only after public-manifest readback, the platform
   smoke matrix, and the full gate are green.
6. Monitor updater errors, helper-attempt reconciliation, failed relaunch
   reports, and manual-download fallback use before expanding Windows or Linux
   eligibility.

## Acceptance criteria

- Automatic checks never open a window when the app is current or the check
  fails.
- **Check for Updates…** and status-chip activation never download an update.
- No update downloads without **Download Update**, and no restart occurs without
  **Restart & Apply**.
- Stable builds never receive a prerelease; beta builds receive newer beta or
  stable releases according to manifests that retain the requesting build's
  channel label.
- Every installed artifact is matched to the exact platform, architecture,
  channel, and eligible distribution.
- Every installed artifact passes both the manifest digest and the Wails CLI's
  per-artifact `ed25519ph` verification against the embedded public key.
- No updater manifest is generated from a directory or glob, and no installer or
  package artifact can enter its explicit file list.
- macOS offers self-update only for an eligible installed bundle, validates the
  exact extracted signed/notarized payload, and swaps the complete app bundle.
- A macOS helper-side failure is reported from persisted attempt state on the
  next manual or automatic launch, including when no matching helper log exists.
- Windows self-update, if enabled, works without elevation from the approved
  per-user installation marker and preserves correct uninstall metadata.
- Linux package installations never mutate package-owned files.
- Expired beta builds provide the manual release-page recovery action and never
  enter download, staging, or restart.
- Restart follows the existing multi-window quit and persistence lifecycle.
- A relaunch failure restores the prior application; a post-launch defect is
  recovered through a higher version or manual installer, never silent
  downgrade.
- `GetAppInfo`, `app-update`, header status, About, native menus, and command
  palette share one backend-owned update state and action path.
- The legacy GitHub release client and custom version comparator are removed
  after consumer parity is proven.
- The release job cannot advance a channel manifest with missing, ambiguous,
  unsupported, unsigned, unverifiable, or stale publicly served artifacts or
  manifest contents.
- No private signing material is committed, logged, embedded, or persisted by
  the application.
