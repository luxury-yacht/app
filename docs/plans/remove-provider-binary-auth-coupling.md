# Remove Provider-Binary Auth Coupling

Status: **Planned, not started.**

## Problem

The app should treat kubeconfig as the auth contract. If a kubeconfig uses a
`user.exec` credential plugin, the app should let `client-go` honor that
kubeconfig entry; the app should not carry provider-specific assumptions for
AWS, Google, Azure, or any other provider.

This distinction matters because the app currently has both:

- kubeconfig-owned exec support: `auth_providers.go` imports
  `k8s.io/client-go/plugin/pkg/client/auth` and its comment says the import
  registers `client-go` auth plugins so helpers declared in kubeconfigs can run
  (`backend/auth_providers.go:17`).
- app-owned provider coupling: `setupEnvironment` calls
  `exec.LookPath("gke-gcloud-auth-plugin")` and discards the result
  (`backend/auth_providers.go:61`), and `authHelperDirectories` hard-codes
  Google Cloud SDK paths and Caskroom globs (`backend/auth_providers.go:146`).

External reference to keep aligned with during implementation:
Kubernetes Authentication docs, "client-go credential plugins":
<https://kubernetes.io/docs/reference/access-authn-authz/authentication/#client-go-credential-plugins>.

## Current Contract Evidence

- Kubeconfig discovery validates files by parsing kubeconfig YAML with
  `clientcmd.LoadFromFile`, checks clusters/contexts, and appends each context
  (`backend/kubeconfigs.go:102`). This path should not require any provider
  binary to exist.
- REST config construction loads the selected kubeconfig path/context with
  `clientcmd.NewNonInteractiveDeferredLoadingClientConfig` and
  `ClientConfig()` (`backend/cluster_clients.go:488`). This is the point where
  selected kubeconfig auth configuration belongs.
- The displayable exec command must come from kubeconfig-derived config, not
  from error-string scraping: `buildRestConfigForSelection` has
  `config.ExecProvider` before Windows wrapping (`backend/cluster_clients.go:505`).
  On Windows, the wrapper replaces `ExecProvider.Command` with the app binary
  and moves the original command into wrapper args
  (`backend/exec_wrapper.go:82`).
- Exec credential errors can happen before HTTP transport sees a request; the
  preflight comment says the exec credential provider runs above the HTTP
  transport and must be checked explicitly (`backend/cluster_clients.go:392`).
- Auth state is per cluster: the architecture doc requires auth state to be
  tracked by `clusterId` and says only the affected cluster's refresh, streams,
  actions, and diagnostics should pause/block (`docs/architecture/auth.md:8`).
- Multi-cluster state must carry `clusterId` through APIs, refresh scopes,
  caches, stores, events, persistence keys, navigation, diagnostics, and object
  actions (`docs/architecture/multi-cluster.md:9`).
- Recovery probes rebuild a fresh client from kubeconfig so refreshed external
  credentials can be picked up (`backend/cluster_clients.go:361`).
- The Windows wrapper only rewrites an existing `ExecProvider` command through
  the app binary on Windows (`backend/exec_wrapper.go:60`).
- `authstate.Manager` currently stores and emits only a string reason:
  `ReportFailure(reason string)` (`backend/internal/authstate/manager.go:155`),
  `Config.OnStateChange func(state State, reason string)`
  (`backend/internal/authstate/manager.go:48`), and `setState` forwards only
  `newState, reason` (`backend/internal/authstate/manager.go:232`).
- Auth event payloads currently carry `clusterId`, `clusterName`, and raw
  `reason` for failed/recovering events (`backend/cluster_auth.go:62`,
  `backend/cluster_auth.go:83`), and progress events carry `errorClass`
  (`backend/cluster_auth.go:388`).
- The frontend auth state currently stores `reason` and `errorClass`
  (`frontend/src/core/contexts/AuthErrorContext.tsx:23`), and the auth overlay
  renders `authState.reason` directly (`frontend/src/ui/overlays/AuthFailureOverlay.tsx:45`).
- Credential-error classification is duplicated in cluster client setup
  (`backend/cluster_clients.go:532`), auth transport
  (`backend/internal/authstate/transport.go:96`), and heartbeat health
  (`backend/app_heartbeat.go:136`).
- The heartbeat classifier is narrower than the cluster-client/auth-transport
  classifier: heartbeat checks three exec-plugin patterns
  (`backend/app_heartbeat.go:144`), while cluster client setup checks eleven
  credential patterns (`backend/cluster_clients.go:541`).

## Target Contract

- Discovery and selection never require cloud-provider binaries.
- A selected kubeconfig may require an external command because that command is
  declared by kubeconfig, not by app provider logic.
- The app may improve generic desktop PATH handling, but it must not hard-code
  provider install locations or probe for a provider-specific command.
- Missing or failing exec plugins are reported as kubeconfig credential-plugin
  diagnostics for the affected `clusterId`.
- `execCommand` diagnostics are captured from `rest.Config.ExecProvider` during
  config construction, with Windows wrapper unwrapping handled explicitly; do
  not scrape the command out of the error string.
- Auth failure and recovery behavior stays per-cluster and continues to rebuild
  fresh kubeconfig-derived clients during recovery.

## Phase 1: Characterize The Contract With Tests

- [ ] Add a **characterization/guard** backend test proving kubeconfig discovery
      accepts a kubeconfig whose user has
      `exec.command: definitely-missing-helper`; app discovery calls
      `clientcmd.LoadFromFile` (`backend/kubeconfigs.go:102`), and
      client-go v0.36.2 `LoadFromFile` reads file bytes and decodes config
      (`k8s.io/client-go@v0.36.2/tools/clientcmd/loader.go:397`).
- [ ] Keep or rename the existing **guard** coverage proving
      `setupEnvironment` keeps generic executable directories such as
      `$HOME/.local/bin`; current coverage asserts that path
      (`backend/app_lifecycle_test.go:27`).
- [ ] Add an **expected-red** backend test proving `setupEnvironment` does not
      append Google Cloud SDK directories when those directories exist under a
      temp `HOME`. The current `authHelperDirectories` list includes those
      directories, so this is the Phase 2 behavior pin
      (`backend/auth_providers.go:146`).
- [ ] Add a **guard** backend test proving the selected kubeconfig's
      `ExecProvider.Command` is preserved by `buildRestConfigForSelection`
      except for existing Windows wrapper behavior
      (`backend/cluster_clients.go:505`, `backend/exec_wrapper.go:60`).
- [ ] Add backend tests for an `execDisplayCommand` helper:
      - non-Windows/unwrapped config displays `ExecProvider.Command`
        (`backend/cluster_clients.go:505`);
      - Windows-wrapped config displays the original command stored after
        `--ly-exec-wrapper`, not the app executable
        (`backend/exec_wrapper.go:82`);
      - missing `ExecProvider` produces no command.
- [ ] Add classifier tests covering missing helper, helper non-zero exit, HTTP
      401/403, expired token strings, SSO strings, and connectivity errors. The
      current classifier fixtures include provider-named AWS/GCloud examples in
      heartbeat tests (`backend/app_heartbeat_test.go:518`); keep provider names
      as input examples, not as app-owned branches.
- [ ] Before consolidating classifiers, pin each current call site's verdicts:
      preflight/recovery (`backend/cluster_clients.go:399`,
      `backend/cluster_clients.go:475`), auth transport
      (`backend/internal/authstate/transport.go:61`), and heartbeat
      (`backend/app_heartbeat.go:124`). The heartbeat helper currently uses a
      narrower pattern set (`backend/app_heartbeat.go:144`) than
      `isCredentialError` (`backend/cluster_clients.go:541`).

## Phase 2: Remove Provider-Specific PATH Logic

- [ ] Delete the discarded `exec.LookPath("gke-gcloud-auth-plugin")` probe; both
      return values are assigned to blank identifiers today
      (`backend/auth_providers.go:61`).
- [ ] Replace `authHelperDirectories` with a provider-neutral helper, for
      example `defaultExecutableSearchDirectories`, containing only generic
      locations:
      - `/usr/local/bin`
      - `/opt/homebrew/bin`
      - `/usr/bin`
      - `$HOME/.local/bin`
- [ ] Remove Google Cloud SDK home/share/Caskroom paths from the app-owned list
      as an explicit behavior change, not as mechanical cleanup
      (`backend/auth_providers.go:153`, `backend/auth_providers.go:160`).
- [ ] Keep login-shell PATH merging, because `setupEnvironment` already reads a
      login shell PATH before merging app process PATH (`backend/auth_providers.go:47`).
- [ ] Update tests in `backend/auth_providers_paths_test.go` and
      `backend/app_lifecycle_test.go` to describe generic desktop executable
      discovery instead of provider-specific auth helper discovery.

## Phase 3: Centralize Exec Credential Diagnostics

- [ ] Introduce one backend classifier for credential-plugin failures, cluster
      credential rejection, and connectivity. Candidate package:
      `backend/internal/credentialerrors`.
- [ ] Make the classifier API accept contextual data in addition to `error`,
      because `execCommand` comes from `rest.Config.ExecProvider`
      (`backend/cluster_clients.go:505`), while current classifiers only accept
      `error` (`backend/cluster_clients.go:535`,
      `backend/app_heartbeat.go:139`).
- [ ] Replace `isCredentialError` in cluster client setup
      (`backend/cluster_clients.go:532`) with the shared classifier.
- [ ] Replace `isCredentialError` in auth transport
      (`backend/internal/authstate/transport.go:96`) with the shared classifier.
- [ ] Replace `isExecCredentialError` in heartbeat health
      (`backend/app_heartbeat.go:136`) with the shared classifier.
- [ ] Return a typed diagnostic from the classifier, not only a boolean:
      `class`, `kind`, sanitized `summary`, and optional `execCommand`.
- [ ] Preserve or deliberately change each call site's verdict table. A wider
      classifier would change heartbeat behavior if it turns current
      connectivity-class strings into `healthAuthFailure`; heartbeat maps
      auth-class errors to `healthAuthFailure` and all other errors to
      `healthConnectivityFailure` (`backend/app_heartbeat.go:124`,
      `backend/app_heartbeat.go:133`).
- [ ] Keep raw provider stderr out of default UI copy unless a separate
      diagnostic/details surface deliberately exposes it.

## Phase 4: Carry Typed Auth Diagnostics To The Frontend

- [ ] Change the `authstate.Manager` producer contract by name instead of
      routing diagnostics around it. The current path is
      `ReportFailure(reason string)` (`backend/internal/authstate/manager.go:155`)
      to `OnStateChange(state, reason string)`
      (`backend/internal/authstate/manager.go:48`) to
      `handleClusterAuthStateChange(clusterID, state, reason)`
      (`backend/cluster_auth.go:29`).
- [ ] Add an `authstate.FailureDiagnostic` (or equivalent) that contains the
      existing reason plus `class`, `kind`, sanitized `summary`, and optional
      `execCommand`.
- [ ] Store the latest failure diagnostic in the manager alongside
      `failureReason`; `State()` and the initial auth-state RPC currently expose
      only `state`, `reason`, `secondsUntilRetry`, and `errorClass`
      (`backend/internal/authstate/manager.go:138`,
      `backend/cluster_auth.go:359`).
- [ ] Capture `execCommand` during REST config construction before Windows
      wrapping, or with an explicit unwrap helper for already-wrapped configs
      (`backend/cluster_clients.go:505`, `backend/exec_wrapper.go:82`).
- [ ] Extend backend auth state/events so failed, recovering, progress, and
      initial-state payloads can carry typed diagnostic fields alongside the
      existing `clusterId`, `clusterName`, `reason`, and `errorClass`
      (`backend/cluster_auth.go:62`, `backend/cluster_auth.go:83`,
      `backend/cluster_auth.go:388`).
- [ ] Extend `ClusterAuthState` and auth event payload types with typed
      diagnostic fields (`frontend/src/core/contexts/AuthErrorContext.tsx:23`).
- [ ] Update `applyAuthFailedEvent`, `applyAuthRecoveringEvent`,
      `applyAuthProgressEvent`, and initial-state hydration to preserve the
      typed diagnostic fields (`frontend/src/core/contexts/AuthErrorContext.tsx:89`,
      `frontend/src/core/contexts/AuthErrorContext.tsx:114`,
      `frontend/src/core/contexts/AuthErrorContext.tsx:139`,
      `frontend/src/core/contexts/AuthErrorContext.tsx:201`).
- [ ] Update `AuthFailureOverlay` to render kubeconfig-centered copy. Example:
      "This kubeconfig asks Kubernetes to run `<command>` for credentials. Install
      that command, add it to PATH, or update the kubeconfig, then retry."
      Existing overlay rendering starts at
      `frontend/src/ui/overlays/AuthFailureOverlay.tsx:45`.
- [ ] Add frontend tests for missing exec command, failed exec command, cluster
      rejected credentials, and connectivity-class recovery. Existing
      subscription tests cover the four auth event names
      (`frontend/src/core/contexts/AuthErrorContext.test.tsx:105`).

## Phase 5: Preserve Multi-Cluster Recovery Behavior

- [ ] Keep every new backend event and frontend state update keyed by
      `clusterId`, matching the auth architecture contract
      (`docs/architecture/auth.md:8`) and multi-cluster contract
      (`docs/architecture/multi-cluster.md:9`).
- [ ] Confirm one cluster with a missing/failing exec plugin pauses only that
      cluster's refresh/action surface. The auth doc requires unrelated clusters
      to continue operating (`docs/architecture/auth.md:3`).
- [ ] Confirm recovery still builds a fresh kubeconfig-derived client instead of
      using the wrapped transport (`docs/architecture/auth.md:75`,
      `backend/cluster_clients.go:361`).
- [ ] Confirm rebuilt cluster transports reuse the existing auth manager, because
      the auth doc records that invariant and its pinned test
      (`docs/architecture/auth.md:79`).

## Validation

Documentation-only changes to this plan do not require prerelease validation
under the root AGENTS rule (`AGENTS.md:106`, `AGENTS.md:112`). Implementation
work should use red/green/refactor TDD for each behavior change
(`AGENTS.md:52`).

Targeted implementation checks:

- `go test ./backend ./backend/internal/authstate`
- `npm run test --prefix frontend -- AuthErrorContext AuthFailureOverlay`
- `npm run typecheck --prefix frontend`
- `mage qc:prerelease` before presenting non-documentation work as ready
  (`AGENTS.md:106`)

## Rollout Notes

- Split implementation into separate PRs where possible:
  1. provider-specific PATH cleanup;
  2. classifier consolidation with call-site verdict pins;
  3. typed auth diagnostics and frontend copy.
- Backend cleanup can land before frontend copy changes if typed diagnostics are
  added compatibly with existing `reason` and `errorClass` fields.
- Removing Google Cloud SDK directory injection can affect users whose
  `gke-gcloud-auth-plugin` or `gcloud` binary is installed only under one of the
  removed paths and not present in login-shell PATH. Migration guidance: put the
  credential helper on login-shell PATH, use an absolute `exec.command` in the
  kubeconfig, or install the provider helper in a generic executable directory
  such as `/usr/local/bin`, `/opt/homebrew/bin`, or `$HOME/.local/bin`
  (`backend/auth_providers.go:153`, `backend/auth_providers.go:160`,
  `backend/auth_providers.go:47`).
- Frontend copy should avoid naming AWS, Google, Azure, or any provider unless
  the kubeconfig command itself contains that provider's command name.
- This plan intentionally keeps kubeconfig `exec` support. Removing `exec`
  support would reject valid kubeconfigs that depend on `client-go` credential
  plugins, which is not the target contract described above.
