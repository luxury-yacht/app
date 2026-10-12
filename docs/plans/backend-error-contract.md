# Backend Error Contract

Temporary plan. When the last phase lands, move the durable rules into the
owning docs listed under [Docs and skills](#docs-and-skills) and delete this
file.

Evidence below was gathered on 2026-10-11 against `main` at `3e66ed05`. Code is
cited as `path:line`; claims that were traced through code but not reproduced
at runtime say so.

## Problem

Go already classifies errors by type, but that type is dropped at every
backend/frontend boundary. The frontend then reconstructs it from message text,
in several places that disagree with each other. A process-wide stderr scraper
can also attach one cluster's text to another cluster's error.

- **Bindings send text only.** `DesktopService` is the only bound service
  (`internal/bootstrap/composition.go:134-137`). It has 120 exported methods,
  and at least 96 of them return `error` (single-line signature grep). Wails
  turns a returned error into `CallError{Message: err.Error(), Cause:
  marshalError(err)}` (`wails/v3@v3.0.0-beta.28/pkg/application/bindings.go:422-437`).
  The JS runtime exposes that `cause` as `RuntimeError.cause`
  (`internal/runtime/desktop/@wailsio/runtime/src/runtime.ts:171-176`).
  `ServiceOptions.MarshalError` (`pkg/application/services.go:31-39`) is never
  set (no hits outside the module cache), so `cause` is Wails' default
  `json.Marshal(&err)`. For a wrapped error that is `{}`.
- **Refresh HTTP errors are text with status 500.** `writeError` emits
  `{code: StatusText, message: err.Error()}` (`backend/refresh/api/server.go:282-296`).
  Every non-permission build failure is a 500, including a deleted object
  (`server.go:117-129`). `refresh_transport.go:29` sends a `text/plain` 503.
  The only structured error is `refresh.PermissionDeniedStatus`
  (`backend/refresh/errors.go:52-77`). The streams use the same pattern
  (`backend/refresh/streammux/types.go:91-92`,
  `backend/refresh/containerlogsstream/types.go:105-107`).
- **The YAML editor smuggles JSON through the message.**
  `objectYAMLError.Error()` returns `"ObjectYAMLError:" + JSON`, including the
  full live object YAML (`backend/object_yaml_mutation.go:37-53, 280-286`).
  `yamlErrors.ts:7-38` parses that prefix back out of `error.message`. After
  parsing, `handleSaveError` still passes the raw error to
  `errorHandler.handle` (`yamlTransaction.ts:921-939`). For an `UNKNOWN`
  category, `handle` uses the whole message as the user message
  (`errorHandler.ts:222-228`) [traced, not reproduced].
- **Frontend text classifiers.** Each of these decides behavior from message
  text:
  - `errorHandler.ts:140-215`: "permission" anywhere means a permission error;
    `\btokens?\b` or "401" means an auth error; "missing" means not found.
  - `errorHandler.ts:259` splits on `STDERR:`.
  - `errorHandler.ts:325-336` suppresses toasts for `auth failed:` and the
    `PERMISSION`/`AUTHENTICATION` categories.
  - `core/telemetry/expectedErrors.ts:8-18` is a second, different regex set.
  - `utils/emptyState.ts:16-28`: "rbac" or "403" means "Insufficient
    permissions"; used by 9 views.
  - `core/refresh/refreshErrorNotifier.ts:36-52`: "not found", plus
    "catalog hydration incomplete", which no Go code produces (binary-safe grep).
  - `ObjectPanel.tsx:192-209`: any "not found" marks the panel's object as
    deleted.
  - `core/refresh/orchestrator.ts:257`, `clusterOverviewLifecycle.ts:19-28`,
    `hooks/useBackendErrorHandler.ts:19-20`: "no active clusters available".
  - `refreshErrorNotifier.ts:85-95`: startup suppression matches
    "snapshot request failed". That is `client.ts:281`'s fallback text for a
    non-JSON error body, such as the `text/plain` 503.
  - `errorHandler.ts:341-345` passes a category-based "expected" flag to
    `sentry.ts:1070-1074`. That gate drops `NETWORK`, `NOT_FOUND` and
    `TIMEOUT` (`errorCategories.ts:15-19`) no matter what else is known about
    the error.

  These feed 89 `errorHandler` call sites in 47 files.
- **The backend mutation check denies with plain text.**
  `requireResolvedResourcePermission` returns `fmt.Errorf("permission denied
  for …")` (`backend/resource_permission.go:89-93`). Today the frontend reads
  "permission" in that text and silently suppresses the error.
- **Concrete misclassification** [traced, not reproduced]: an object action on
  a Secret named `ci-token` fails, and the message contains
  `secrets "ci-token"`. `useObjectActionController.tsx:310` passes it to
  `handle`. `authTokenPattern` matches (`errorHandler.ts:162`), so the error is
  classed `AUTHENTICATION` and suppressed: no toast and no history entry.
- **Cross-cluster contamination.** The capture keeps one process-wide "last
  error" slot (`backend/internal/errorcapture/error_capture.go:31`).
  `CaptureWithCluster` writes `"[clusterA] auth failed: …"` into it
  (`backend/cluster_runtime_auth.go:62`, `backend/cluster_auth_contract.go:219`).
  The next `Enhance` call on any cluster consumes it and appends
  `". STDERR: …"` (`error_capture.go:285-357`, `backend/fetch_helpers.go:121`).
  The frontend then suppresses the result as an auth failure. This contradicts
  `docs/architecture/auth.md`: "Process-global stderr never supplies a
  cluster's diagnosis". Separately, all third-party stderr is dropped from App
  Logs while any one cluster has invalid auth, as is any line containing
  "token", "sso", or "expired" (`backend/application_lifecycle.go:232-247,
  445-458`).

## Target model

1. **One classifier, in Go.** `errorstatus.Classify(err) Status` reads the
   error chain only. It checks, in this order, and the first match wins:
   1. An explicit status attached by a boundary or typed app error (for
      example the HTTP layer's request-validation wrapper; see item 2).
   2. Kubernetes `APIStatus`, via `errors.As`, the same path as
      `apierrors.ReasonForError` (`k8s.io/apimachinery@v0.37.1/pkg/api/errors/errors.go:810-815`).
   3. The app's typed errors: permission denied, `authstate.AuthInvalidError`
      (`backend/internal/authstate/errors.go:7-17`), cluster-not-ready.
   4. Cancellation, then `credentialerrors.ClassifyKnown`'s known-only auth
      and connectivity rules.
   5. Otherwise `Unknown`.

   API status comes before `credentialerrors`, because `credentialerrors`
   treats any 403 as rejected credentials (`credentialerrors.go:133-135`) and
   would turn RBAC denials into auth errors. A `url.Error` wrapper proves
   nothing on its own: a redirect-policy failure must stay reportable
   (`backend/internal/errorcapture/reporting_test.go:97-105`).
2. **One wire shape everywhere.** It is shaped like a Kubernetes `Status` and
   generalizes the existing `PermissionDeniedStatus`. It is sent as:
   - the Wails `cause`, for every error a bound method returns (via
     `MarshalError`);
   - the HTTP error body. The response code is the status `code`. Requests the
     HTTP layer rejects itself are wrapped with an explicit `BadRequest`
     status, so they keep their 400 (`backend/refresh/api/server.go:27-31`);
   - stream `errorDetails`.

   YAML editor conflicts are not errors. They are response data (Decision 5).

   Wails framework failures never reach `MarshalError` and carry no `cause`:
   panic conversion and wrong argument count (`bindings.go:334-349`), and an
   unknown method. The guarantee covers returned errors only. The frontend
   treats a missing status as `Unknown`: shown, and reported.
3. **The frontend never reads message text to decide behavior.** It reads
   `reason` (lifecycle handling) and `category` (presentation). Text is only
   displayed.
4. **One reporting decision.** For an error with a status, `status.expected`
   alone decides telemetry. The category-based override
   (`errorHandler.ts:341-345` → `sentry.ts:1070-1074`) is removed. Otherwise a
   client deadline (`TIMEOUT`, `expected: false`) would still be dropped.
5. **A permission rejection on a user action is a bug, not an expected
   condition.** Two checks run before an action reaches the API server:
   - the UI capability gate decides whether an action is offered at all
     (`docs/architecture/permissions.md` "UI Permission Rules");
   - the backend mutation check is the final authority before the write
     (`backend/resource_permission.go:24-95`).

   If the backend check or the API server still rejects an offered action,
   then either the gate and the server disagree or permissions changed after
   the menu was built. The action boundary marks that Forbidden
   `expected: false`, so it shows a toast and is reported. Forbidden on refresh
   and background reads stays `expected: true` and silent, as today.
6. **Cluster attribution and object identity come from the producer, never
   from process-global state or from Kubernetes `details`.**
   - Bindings: the caller already holds `clusterId`.
   - HTTP and streams: the scope/message already carries it.
   - The classifier does not guess a cluster.
   - `ref` names the object whose lookup failed, with full identity (cluster,
     group, version, kind, namespace, name). Only the producer that performed
     that lookup sets it. Kubernetes `details` cannot be used for this:
     `NewNotFound` puts the plural resource in `details.kind` and carries no
     version or namespace (`apimachinery/pkg/api/errors/errors.go:144-155`).

### Status shape

| Field | Meaning |
| --- | --- |
| `kind`, `apiVersion` | `"Status"`, `"v1"`, matching today's permission status |
| `code` | HTTP status; refresh responses use it as the response status |
| `reason` | Go-owned enum, generated to TypeScript (below) |
| `category` | Go-owned enum: today's nine `ErrorCategory` values plus `CONFLICT` (Decision 2). It replaces the frontend's hand-written `ErrorCategory` (`frontend/src/shared/constants/errorCategories.ts`). |
| `message` | The error text, for display only |
| `retryable` | The same request may succeed later without user action |
| `expected` | An expected cluster condition: local log only, never reported |
| `ref` | Optional. The producer-owned complete reference (`clusterId`, `group`, `version`, `kind`, `namespace`, `name`) of the object whose lookup failed. It has the same shape as `resourcemodel.ResourceRef`. It is the only field used for object identity. |
| `details` | Optional, informational only: `domain`, `resource`, Kubernetes' own `group`/`kind`/`name` (where `kind` is the plural resource), and `causes[]`. Causes are formatted strings, as `formatStatusCause` (`backend/object_yaml_mutation.go:525`) produces today for the YAML editor. Never compared for identity. No feature-specific fields (Decision 5). |

`retryable` and `expected` are computed once by `Classify`. The frontend never
recomputes them. They are separate fields because existing rules disagree. For
example, a bare `io.EOF` is retried today (`backend/fetch_helpers.go:347`) but
reported, because only transport-wrapped EOF counts as connectivity
(`credentialerrors.go:202-206`).

### Reasons

Kubernetes reasons pass through. App reasons cover errors that have no API
status.

| Reason | Category | Code | Retryable | Expected | Source |
| --- | --- | --- | --- | --- | --- |
| `Unauthorized` | AUTHENTICATION | 401 | no | yes | API status |
| `CredentialsRejected` | AUTHENTICATION | 401 | no | yes | `AuthInvalidError`; `credentialerrors` auth class |
| `Forbidden` | PERMISSION | 403 | no | yes, except on a user action (target model item 5) | API status; app permission denial; typed backend mutation check |
| `NotFound` | NOT_FOUND | 404 | no | yes | API status |
| `AlreadyExists`, `Conflict` | CONFLICT (Decision 2) | 409 | no | no | API status |
| `Invalid`, `BadRequest`, `Gone`, other 4xx | VALIDATION | 4xx | no | no | API status; binding argument decode; explicit boundary `BadRequest` wrapper; typed caller-input checks (Decision 6) |
| `Timeout`, `ServerTimeout` | TIMEOUT | 504 | yes | yes | API status |
| `DeadlineExceeded` | TIMEOUT | 504 | yes | no | client deadline without a transport error |
| `TooManyRequests` | RATE_LIMIT | 429 | yes | no | API status |
| `ServiceUnavailable` | SERVER_ERROR | 503 | yes | yes | API status |
| `InternalError`, other 5xx | SERVER_ERROR | 5xx | yes | no | API status |
| `ClusterUnreachable` | NETWORK | 503 | yes | yes | Known connectivity only: `credentialerrors.ClassifyKnown`'s connectivity class (`net.OpError`, network timeouts, transport EOF inside `url.Error`, recognized connection text). A `url.Error` around anything else is `Unknown`. |
| `ClusterNotReady` | SERVER_ERROR | 503 | yes | yes | `backend/refresh_aggregate_snapshot.go:109` |
| `RefreshUnavailable` | SERVER_ERROR | 503 | yes | yes | `backend/refresh_transport.go:22-29, 57` |
| `Canceled` | UNKNOWN | — | no | yes | `context.Canceled` |
| `Unknown` | UNKNOWN | 500 | no | no | everything else |

Existing verdicts are the test oracle. Every case in
`backend/internal/errorcapture/reporting_test.go` keeps its `expected` answer,
and every case in `TestIsRetryableFetchErrorVariants` and
`TestRetryableURLReasonHandlesEveryURLShape` (`backend/fetch_helpers_test.go:355, 400`)
keeps its `retryable` answer. In particular:

- a bare client-side `context.DeadlineExceeded` stays reportable
  (`docs/architecture/auth.md` "Recovery error classification");
- a URL-wrapped redirect-policy failure is neither expected nor retryable.

The Retryable and Expected columns show each reason's usual value only.
`Classify` computes both flags per error, so an oracle case that differs from
its reason's usual value keeps its current verdict. For example, a bare
`io.EOF` is reason `Unknown` but stays retryable and reportable.

## Non-goals

- Changing auth state, auth events, or the auth overlay. They are already
  typed and per cluster (`docs/architecture/auth.md`).
- Rewording `credentialerrors`' exec-helper text rules
  (`credentialerrors.go:155-250`). Exec plugins provide no structure, and the
  output is already typed.
- Rewording container log per-target issues (`backend/internal/containerlogs/errors.go`).
  Kubelet text has no reason; the issue model is already typed.
- Typing app errors beyond the caller-input checks covered by Decision 6.
  The backend has about 1,044 `fmt.Errorf`/`errors.New` sites. Dependency and
  state failures, such as a missing client (`validateShellDependencies`,
  `shell_sessions.go:261`), stay `Unknown`.
- `ClusterWorkspaceResult.Error`, capability review errors, and app-update
  errors. Their strings are displayed, not classified (they do not appear in the
  frontend text-matching grep).
- Sentry scrubbing and consent policy.

## Inventory

### Producers and transports

| Boundary | Today | Target |
| --- | --- | --- |
| Binding rejections | Wails default `cause` | `MarshalError` → `Status` |
| Refresh snapshot / manual refresh / job HTTP | `writeError` 500 text; permission 403 Status (`server.go:76-256, 282-304`). Request validation returns 400 from plain errors (`server.go:27-31`; sites 76, 82, 143, 159, 166, 197, 249, 256). An unknown job returns `http.NotFound` text (`server.go:202-205`). | `Status` body with its `code`. The HTTP layer wraps its own validation failures as explicit `BadRequest`; an unknown job is a `NotFound` status. |
| Refresh service not published | `http.Error` text 503 (`refresh_transport.go:29`) | `Status` `RefreshUnavailable` |
| Manual refresh job | `Job.Error string` (`backend/refresh/types.go:136, 333-353`) | `Status` |
| Resource stream | `Error` + permission-only `ErrorDetails` (`streammux/handler.go:612-640`, `refresh_transport.go:55-58`) | `Status` in `errorDetails` |
| Container logs stream | `Error`, permission `ErrorDetails`, own `Retryable` (`containerlogsstream/handler.go:221-231`) | `Status`; `reconnect` from the permanent-reason policy (Decision 3) |
| Log fetch bindings | in-band `Error string` (`backend/resources/types/types.go:186, 215`) | whole-request failure becomes a returned error |
| YAML editor | `"ObjectYAMLError:"+JSON` message (`object_yaml_mutation.go:37-53`). API apply failures are converted into it, which drops the API error from the chain (`object_yaml_mutation.go:470-490`). | UID mismatch, merge conflict and merge precondition failure become a `yamlConflict` result on the `ApplyObjectYaml`, `MergeObjectYamlWithLatest` and `CheckObjectYamlOwnership` responses. API failures stay API errors with a status. The prefix protocol is deleted (Decision 5). |
| `backend-error` event | `fetch_helpers.go:113`, stderr emitter (`application_lifecycle.go:219-230`) | deleted (Phase 1) |

### Classifiers

Backend, to fold into `errorstatus`:

- `errorcapture.IsExpectedClusterFailure` (`reporting.go:19-44`), used by
  `backend/logger.go:257`.
- `isRetryableFetchError` and its text tokens (`fetch_helpers.go:34-50,
  334-401`), still used by `operations_coordinator.go:239`.
- `containerlogsstream.isRetryable` (`handler.go:228-231`). It becomes a
  reconnect policy over `reason` (Decision 3), not `Classify`'s `retryable`.

Backend, to delete:

- The stderr capture's `authPatterns`, `expectedConditionPatterns` and
  `fallbackErrorPatterns`, the last-error slot, `Enhance`,
  `CaptureWithCluster`, and the event emitter (`error_capture.go:43-71,
  239-370`).
- `containsAuthPattern` and the `anyClusterAuthInvalid` log gate
  (`application_lifecycle.go:232-247, 445-458`).

Frontend, to replace with `reason`/`category`: every file listed under
[Problem](#problem), plus `parseObjectYamlError`.

### Vestigial path removed first

All 43 `ResourceGateway.Get*` detail wrappers have no production caller:

- 38 generated in `backend/resource_details_generated.go`;
- `GetHelmReleaseDetails`, `GetHelmManifest`, `GetHelmValues` in
  `backend/helm_details.go`;
- `GetCustomResourceDefinition` in `backend/crd_details.go`;
- `GetPod` in `backend/pod_details.go`.

This was checked with a binary-safe grep for argument-shaped calls across
`backend`, `internal`, `cmd`, `frontend/src` and `frontend/bindings`. The only
hits were the unrelated `pods.GetPod` and `service.GetService`.
`DesktopService` delegates none of them. The live detail path is
`objectDetailProvider` (`backend/object_detail_provider.go`).

The wrappers are the only non-Helm callers of `FetchNamespacedResource`,
`FetchClusterResource` and `FetchResourceWithSelection`. That makes Helm
uninstall (`backend/helm_actions.go:48`) the only production path to:

- `Enhance`;
- the non-stderr `backend-error` event;
- fetch retry wrapped around a mutation.

The generic delete path makes one call with no retry
(`backend/generic_resource_actions.go:14-38`), and its service reports its own
failures (`backend/resources/generic/delete_by_gvk.go:73-80`).

The wrappers write kind-label cache keys (for example `"hpa-detailed"`,
`resource_details_generated.go:233`) that the live GVK-keyed path never reads.
Invalidation still evicts them (`response_cache_invalidation.go:313-314, 339,
351`). Helm content keys (`object_detail_provider.go:349, 366, 418, 431`; evicted at
`response_cache_invalidation.go:402-404`) are live and stay.

### Tests pinning current behavior

Backend:

- `backend/internal/errorcapture/error_capture_test.go`, `reporting_test.go`
- `backend/fetch_helpers_test.go`
- `backend/resource_bindings_test.go` (partly wrapper tests)
- `backend/workload_bindings_test.go`
- `backend/refresh/api/server_test.go`, `backend/refresh/errors_test.go`

Live-path reporting is already covered in
`backend/resources/common/deps_test.go:89-278`.

Frontend:

- `utils/errorHandler.test.ts`, `utils/emptyState.test.ts`
- `hooks/useBackendErrorHandler.test.tsx`
- `Yaml/yamlErrors.test.ts`
- `core/refresh/permissionErrors.test.ts`
- `core/refresh/orchestrator.test.ts:3121` (fixture for a string no backend produces)

### Docs and skills

- `docs/architecture/error-reporting.md`: frontend boundaries; the
  `FetchResourceWithSelection` text at 136-138; the stderr text at 276-279.
- `docs/architecture/auth.md`: State Model; credential-helper diagnostics.
- `docs/architecture/application-lifecycle.md` "Startup and readiness": the
  stderr capture.
- `docs/architecture/refresh-system.md`: transport boundary error payloads.
- `docs/architecture/shared-contracts.md` "Examples": add the error status.
- `docs/architecture/data-access.md` "Generated binding anchor".
- `backend/AGENTS.md`: the `Get<Kind>` wrapper bullet.
- `.agents/skills/add-resource/references/kind-and-details.md:62`.
- `docs/workflows/logs/application-logs.md` "Ownership".
- `docs/architecture/yaml-editing.md`: items 5 and 6. Conflicts become
  `yamlConflict` results, and an ownership-check failure reports
  operationally without a toast.

## Ordering constraints

- `containerLogsStreamProtocol.ts:90-91` rejects any frame whose
  `errorDetails` is not a permission status. The stream producer and that guard
  must change in the same step, or valid failure frames are dropped.
- `client.ts:266-283` and `expectedErrors.ts:20-33` already accept a
  Status-shaped body and `cause`. New HTTP codes and binding causes are
  therefore safe before the frontend consumes them. No frontend code in
  `frontend/src/core` branches on a specific 4xx/5xx code (grep).
- The YAML prefix protocol is replaced in one step across both layers.
- **Snapshot permission denial.** `isSnapshotPermissionDenied` requires
  `.permissionDenied === true` on the thrown error (`permissionErrors.ts:9-11`).
  Two consumers depend on it:
  - the orchestrator, to mark the scope denied, settle it, and stop automatic
    retries (`orchestrator.ts:1575-1587`);
  - telemetry (`expectedErrors.ts:24`).

  Replacing `SnapshotPermissionDeniedError` and switching those readers to the
  status is one change, in Phase 3.
- **Startup network suppression.** `refreshErrorNotifier.ts:85-95` matches
  "snapshot request failed", which is `client.ts:281`'s fallback text for
  non-JSON bodies. Once the 503s are JSON statuses, that text stops appearing.
  The suppression switches to `reason` (`RefreshUnavailable`,
  `ClusterNotReady`) plus the browser fetch-failure check in the same Phase 3
  change.
- **`DomainSnapshotState.permissionDenied`** (`core/refresh/store.ts:32`) is
  set only for a typed 403 and gates background refetch (`store.ts:234`,
  `NamespaceContext.tsx:736`, `useQueryBackedResourceGridTable.ts:128`).
  - Phase 3 keeps setting it from the status.
  - Phase 4 replaces it with a value derived from the `RefreshFailure`
    envelope.

  Both phases must prove that the typed 403 still sets it and that the
  permission-epoch reset clears it and re-enables fetching.

## Phases

Use red/green/refactor for every behavior item: watch the new test fail first.
Each phase leaves `main` releasable.

### Phase 1: Delete the vestigial producers (backend-led, no wire change)

Status: implemented 2026-10-11. Evidence is recorded under each item.

- [x] Helm uninstall failure path. The `backend-error` event and `Enhance`
      are deleted outright (items below), so "no event" and "no foreign
      cluster text" now hold by construction rather than by assertion.
      Not done: a test that a retryable failure is not retried. The gateway
      builds `helm.NewService` without an `ActionConfigFactory`, so there is no
      seam short of adding one only for the test. The retry wrapper is gone
      from `deleteHelmReleaseAction` (`backend/helm_actions.go`).
- [x] Route Helm uninstall through a direct service call, as generic delete
      does; `DeleteRelease` reports its setup failures through `logDeleteError`
      (Decision 4). Red → green:
      `TestDeleteReleaseReportsSetupFailures` (`backend/resources/helm/helm_releases_test.go`)
      failed with "Expected error with "setup failed" in chain but got nil",
      then passed. The existing uninstall-failure report test still passes.
- [x] Removed the 43 detail wrappers: generator (`genappbindings/render.go`)
      now emits only `BindingModelAnchor`; deleted `helm_details.go`,
      `crd_details.go`, `pod_details.go`; dropped the dead `appbinding.Spec.Key`
      field. Regenerated with `go run ./internal/genappbindings/cmd`; the
      fetcher map is byte-identical. The single-owner contract test no longer
      needs an exception for `resource_details_generated.go`.
- [x] Deleted `FetchResourceWithSelection`, `FetchNamespacedResource`,
      `FetchClusterResource`, `cachedResource`, `resourceFetchBoundary`, and the
      gateway's event/retry/transport wiring that only they used. Kept
      `executeWithRetry` for `FetchPodWithRetry`.
- [x] Deleted wrapper-only tests (`workload_bindings_test.go`, seven tests in
      `resource_bindings_test.go`, eight in `fetch_helpers_test.go`, three
      fallback-capture tests in `logger_test.go`). Kept non-wrapper cases.
      Converted two retry tests to drive `executeWithRetry` directly. The
      auth-recovery gateway test now uses the live `GetPodContainers`.
- [x] Moved kind-only invalidation callers to full-GVK invalidation and
      dropped the kind-only deletes (including the redundant one in
      `canServeCachedResponse`, whose callers evict their own key). This is a
      refactor under green: the existing eviction tests were updated to seed
      the live GVK and header keys and pass.
- [x] Removed the stderr emitter, `CaptureWithCluster`, the last-error slot,
      `capturedError`, `scanRecentError`, and `Enhance`; deleted
      `backend-error`, `useBackendErrorHandler` and `types/backend-events.ts`.
      Bindings regenerated (only the event type and anchor comment changed).
- [x] Red → green: `TestEmitToLogSinkLogsRepeatedWarningsAndErrorsOnce`
      (`errorcapture`) failed with 7 logged lines instead of 5, then passed.
      `TestCapturedStderrIsLoggedWhileAnotherClusterAuthIsInvalid` failed with
      0 entries, then passed after removing the `anyClusterAuthInvalid` gate and
      `containsAuthPattern`. `anyClusterAuthInvalid` and its concurrency test
      were deleted with it.
- [x] Updated `error-reporting.md`, `auth.md`, `data-access.md`,
      `backend-services.md`, `backend/AGENTS.md`, and the add-resource skill
      reference. `application-lifecycle.md` was still accurate.

### Phase 2: Status model and classifier (backend, additive)

Status: implemented 2026-10-11.

- [x] Red → green: `backend/internal/errorstatus/classify_test.go` failed to
      compile (undefined `Classify`, `Expected`, `Transient`), then passed.
      It carries every former `reporting_test.go`, `TestIsRetryableFetchErrorVariants`
      and `TestRetryableURLReasonHandlesEveryURLShape` case with its original
      verdict, plus the redirect-policy URL case, the 403-is-`Forbidden` case,
      Kubernetes details and causes, permission details, and an explicit
      `BadRequest` overriding an inner API status.
- [x] Added `backend/internal/errorstatus` (`status.go`, `classify.go`,
      `expected.go`, `transient.go`, `permission.go`). Moved the permission-denied
      error, wrapper and checks out of `backend/refresh/errors.go`; `refresh`
      keeps only `PermissionDeniedStatus` until Phase 3. Moved the status-cause
      formatter out of `object_yaml_mutation.go`. `errorstatus` does not import
      `refresh` or `resourcemodel` (which imports `refresh` transitively), so it
      has its own `ObjectRef`.
- [x] Registered `ErrorStatus`, `ErrorStatusDetails`, `ErrorStatusObjectRef`
      and the `ErrorStatusReason` / `ErrorStatusCategory` enums (with value
      arrays) in `genrefreshcontracts`; regenerated `types.generated.ts`
      (additive only).
- [x] `errorCategories.ts` keeps its `ErrorCategory` constant, now checked
      with `satisfies { [K in ErrorStatusCategory]: K }`; added `CONFLICT`
      there and in `categoryPresentation`. `npm run typecheck` passes.
- [x] Replaced `IsExpectedClusterFailure` (`logger.go`) with
      `errorstatus.Expected` and `isRetryableFetchError` with
      `errorstatus.Transient`; both are the original code moved unchanged and
      keep the original tests as their oracle.
- [x] `containerlogsstream.isRetryable` left untouched; its replacement moves
      with the Phase 3 streams item.

### Phase 3: Send the status at every boundary (backend plus frontend guards)

Progress (2026-10-11): bindings, YAML conflicts, gated actions and caller-input
checks are implemented; the items below are marked as they land.


- [x] Bindings. Red: drive real bound-method calls, not the marshaler alone.
      Use `application.NewBindings`, `Bindings.Add` with
      `NewServiceWithOptions(svc, ServiceOptions{MarshalError: …})`,
      `Bindings.Get` and `BoundMethod.Call` (`bindings.go:124, 134, 172, 308`)
      on a test service. Cases:
      - a returned typed error and a returned wrapped error: `cause` matches
        `Classify`;
      - an argument-decode failure: `cause` is a `BadRequest` status
        (`bindings.go:373-375`);
      - a panic and a wrong argument count: no `cause` (`bindings.go:334-349`).

      First confirm `Bindings.Add` works without a running application; if not,
      use the app-level harness. Then set `ServiceOptions.MarshalError` at
      `composition.go:134-137`, exported from package `backend` because
      `internal/bootstrap` cannot import `backend/internal`.
- [x] YAML conflicts become results (Decision 5). Three bindings produce
      them, and all three get the same optional field `yamlConflict:
      ObjectYAMLConflict {code, message, causes, currentYaml,
      currentResourceVersion}`:
      - `ApplyObjectYaml` (`ObjectYAMLMutationResponse`, `object_yaml_mutation.go:69`);
      - `MergeObjectYamlWithLatest` (`ObjectYAMLReloadMergeResponse`);
      - `CheckObjectYamlOwnership` (`ObjectYAMLOwnershipCheckResponse`,
        `object_yaml_ownership.go:33-35`). It runs the same
        `prepareAuthorizedYAMLMutation` (`object_yaml_ownership.go:57`), so
        it can hit the same UID mismatch (`object_yaml_mutation.go:276-286`).

      The field is `yamlConflict`, not `conflict`, because the ownership
      response already has `conflicts`, the field-manager ownership list.

      Backend red cases:
      - an apply whose object UID changed returns a successful response with
        `yamlConflict.code: ObjectUIDMismatch` and no error;
      - the ownership check on that object returns `yamlConflict` likewise;
      - a reload-merge conflict, a merge precondition failure, and a merge UID
        mismatch return `yamlConflict` on the merge response;
      - an API-rejected apply (Invalid with field causes) is rejected with a
        status whose reason is `Invalid` and whose `details.causes` are the
        formatted causes. The original API error stays in the chain for
        `Classify`;
      - no error message or status from any of the three contains live YAML.

      The Save workflow, end to end in `yamlTransaction.ts`. The ownership
      check stays advisory and fail-open (`docs/architecture/yaml-editing.md`,
      item 5), so a `yamlConflict` from it does not block saving: the save
      goes on to Apply, which gives the authoritative result. Red cases:
      - **UID changed during the edit.** The ownership check returns
        `yamlConflict` (no prompt, no `errorHandler` call), then Apply
        returns `yamlConflict`. The editor shows the message and causes
        inline and sets the server-YAML error state. It keeps the draft and
        stays in editing mode, skips post-apply verification, and calls no
        `errorHandler` with YAML in it. Today's success path verifies and
        exits editing (`yamlTransaction.ts:941-975`), so it must check
        `yamlConflict` first.
      - **Ownership check rejected** (for example `Forbidden` from its patch
        pre-check). The check reports through `handleOperational`, no toast,
        and the save proceeds. Apply's own rejection is the one
        user-visible result, so a single save never toasts twice. Today the
        ownership catch calls `handle` (`yamlTransaction.ts:447-449`), and
        `errorHandler` has no deduplication.
      - A normal save still verifies and exits editing.

      Delete `objectYAMLError` and its prefix (`object_yaml_mutation.go:37-53`)
      and the API-error conversion (`object_yaml_mutation.go:470-490`). On the
      frontend, delete `yamlErrors.ts`. `yamlTransaction.ts` takes conflicts
      from the responses (`classifyReloadMergeError` at 336-345, the
      `currentYaml` use at 821-823, `performSave` at 941-975) and causes from
      `status.details.causes` (`handleSaveError`, 921-939). The YAML prefix
      protocol is removed in this one step across both layers.
- [x] Refresh HTTP, backend. Red cases:
      - deleted object → 404 `NotFound`;
      - unknown cluster → 503 `ClusterNotReady`;
      - unpublished service → 503 `RefreshUnavailable`, as JSON;
      - permission → the 403 body is unchanged;
      - every existing request-validation path keeps 400, now as a
        `BadRequest` status: missing domain, missing/multiple cluster scope,
        enqueue rejection, missing job id, bad metrics JSON, missing
        `clusterIds`;
      - unknown job → 404 `NotFound` status.

      Add the HTTP layer's explicit `BadRequest` wrapper and apply it at the
      `server.go` validation sites. Update `writeError`,
      `writeSnapshotBuildError`, `refresh_transport.go:29`, and the aggregate
      resolver (typed error). Manual-refresh job errors carry `Status`.

      Implemented: `writeError` writes `Classify(err)` with its code
      (`backend/refresh/api/server.go`); `enqueueRejection` keeps a typed
      enqueue status and turns an untyped refusal into `BadRequest`; the
      aggregate snapshot and manual-queue resolvers return `BadRequest` /
      `ClusterNotReady`; `ManualRefreshJob.Error` is a `*Status` (generated as
      `RefreshManualJob`). Red then green:
      `TestSnapshotEndpointAnswersWithFailureStatus`,
      `TestRefreshAPIRejectsRequestsWithStatus`,
      `TestManualRefreshFailureCarriesStatus`,
      `TestAggregateManualQueueRejectsInactiveClusterAsNotReady`,
      `TestAggregateSnapshotServiceRejectsScopeWithoutOneCluster`, and the
      JSON assertion in `TestRefreshServiceBlocksEarlyRequestsUntilPublication`.
- [x] Refresh HTTP, frontend consumers, in the same change. `client.ts` throws
      one error class carrying the `Status`, replacing
      `SnapshotPermissionDeniedError`. `isSnapshotPermissionDenied` and its
      consumers (`orchestrator.ts:1575-1587`, `expectedErrors.ts:24`) read
      `reason === Forbidden`. Startup suppression (`refreshErrorNotifier.ts:85-95`)
      reads `reason` plus the browser fetch-failure check. Red cases:
      - a denied scope settles, sets `permissionDenied`, and stops automatic
        retries;
      - a permission-epoch reset re-enables fetching;
      - a `RefreshUnavailable` or `ClusterNotReady` during the startup window
        produces no toast.

      Implemented: `RefreshRequestError {status}` in `client.ts`;
      `isSnapshotPermissionDenied` reads `errorStatusOf(error)?.reason`;
      `shouldSuppressStartupError(error, message)` in
      `refreshErrorNotifier.ts`. Red then green: the converted denial tests and
      the "right after a kubeconfig change" cases in `orchestrator.test.ts`,
      and the status cases in `client.test.ts`.
- [x] Object reference on NotFound. Two prerequisites:
      - **Keep the API error.** `fetchObjectByGVK` replaces a NotFound with a
        new `fmt.Errorf` that has no `%w` (`backend/object_yaml_by_gvk.go:104-106`),
        so no caller can see a typed NotFound. Wrap the original with `%w`.
        Keep the message text: the YAML tab displays it through
        `fetchObjectYAMLByGVK` (`object_yaml_by_gvk.go:66`). Its other
        caller, header metadata (`object_detail_provider.go:197`), is
        best-effort, and the builder discards that error.
      - **The provider owns the probe.** `fetchObjectByGVK` is an unexported
        helper in package `backend`; `snapshot.ObjectDetailsBuilder` cannot
        call it. `objectDetailProvider.FetchObjectDetails`
        (`backend/object_detail_provider.go`) does the confirmation. When the
        typed or discovered detail fetch returns NotFound, it runs an uncached
        `fetchObjectByGVK` for exactly the requested GVK, namespace and name.
        Only if that also returns NotFound does it return an explicit status
        carrying `ref`: cluster from the resolved detail context, plus
        group, version, kind, namespace and name. Otherwise it returns the
        original error with no `ref`. `ObjectDetailsBuilder.Build` passes the
        error through unchanged. This costs one extra GET, and only after a
        NotFound.

      Red cases, through the real `objectDetailProvider` and
      `ObjectDetailsBuilder` on fake clients, and the refresh API:
      - `fetchObjectByGVK` on a missing object returns an error for which
        `apierrors.IsNotFound` is true, with the same message;
      - the requested object is deleted → 404 with a complete `ref`;
      - a related lookup returns NotFound while the requested object exists
        → no `ref`;
      - an object with the same name but a different namespace or group is
        not affected.

      Out of scope: kinds served by the builder's minimal generic fallback,
      the `ErrObjectDetailNotImplemented` path. That path ignores
      header-lookup errors (`object_details.go`, `fetchHeaderMetadata`), so
      deleting one of those objects produces no NotFound today and still won't.

      Implemented: `objectNotFoundError` keeps the API NotFound under the
      existing message (`backend/object_yaml_by_gvk.go`);
      `confirmMissingObject` probes and attaches `errorstatus.ObjectNotFound`
      (`backend/object_detail_provider.go`). Red then green through the real
      provider, builder and refresh API:
      `TestObjectDetailsNotFoundNamesOnlyAConfirmedMissingObject`,
      `TestFetchObjectByGVKKeepsTheAPINotFound`.
- [x] Permission rejection on gated actions (target model item 5). First, list
      the gated operations from the frontend capability descriptors and match
      each to its binding. `RunObjectAction` (`backend/object_actions.go:182-196`)
      is the main chokepoint. The backend mutation check has callers in 11
      files, among them `generic_resource_actions.go`, `workload_actions.go`,
      `pod_actions.go`, `helm_actions.go` and `operations_coordinator.go`.
      These go through `requireResourcePermission`. The YAML editor calls
      `requireResolvedResourcePermission` directly, for `patch`, in
      `prepareAuthorizedYAMLMutation` (`object_yaml_mutation.go:128,
      192-196`). Both `ApplyObjectYaml` and `CheckObjectYamlOwnership`
      (`object_yaml_ownership.go:57`) run it. Red cases:
      - a backend mutation check denies an offered action → the binding's
        `cause` is `Forbidden`, `expected: false`, and its `ref` carries the
        target's full identity;
      - the API server returns 403 after the pre-check allowed it → same
        result;
      - for `ApplyObjectYaml`, both the patch pre-check denial and an
        API-server 403 on the patch → `Forbidden`, `expected: false`;
      - a refresh-domain Forbidden is still `expected: true`.

      Make the mutation-check denial a typed permission error
      (`resource_permission.go:89-93`) carrying the check's identity, verb and
      subresource. Mark Forbidden as `expected: false` at the action boundary
      only, not in `Classify`.
- [x] Streams, including the container-log reconnect policy (Decision 3).
      The backend policy, the wire rename and the frontend guard change in
      this one step.

      First pin today's reconnect verdict for every fatal error the log
      stream can send:
      - `writeFatal` errors (`containerlogsstream/handler.go:221-231`):
        - API `NotFound`, `Forbidden`, `BadRequest` and `Invalid` → stop;
        - API 5xx or timeout, connectivity errors, and unclassified errors
          → reconnect.
      - Request-parse errors, sent without `retryable` (`handler.go:96-104,
        562-569`) → stop.
      - The stream never produces the app's own permission-denied error, so
        `Forbidden` comes only from the API. (A grep of
        `backend/refresh/containerlogsstream`, `backend/internal/containerlogs`
        and `backend/refresh_transport.go` finds no producer.)

      Red cases:
      - that matrix, unchanged under the reason-based policy;
      - a NotFound fatal is delivered, not dropped by the frame guard, and
        does not reconnect;
      - an unclassified error (`Unknown`, `status.retryable: false`) arrives
        with `reconnect: true` and the stream reconnects.

      Then replace `isRetryable` with a reconnect policy over `Classify`'s
      `reason`. Send `Status` in `errorDetails` for every error on both
      streams, plus the unavailable message at `refresh_transport.go:57`.
      Rename the container-log payload's `retryable` to `reconnect`
      (`containerlogsstream/types.go:107`). Update both protocol guards and
      their readers (`containerLogsStreamProtocol.ts:90-91, 180-196`,
      `resourceStreamProtocol.ts:129, 147`).

      Implemented: `failurePayload` / `ErrorPayload` and `reconnects(reason)`
      in `containerlogsstream/handler.go`; `streammux.ErrorMessage`; both
      transports send the status (`refresh_transport.go`); the cluster-not-ready
      sentinel became `errorstatus.ClusterNotReady`.
      `refresh.PermissionDeniedStatus` and its frontend mirror types are
      deleted. The failed log phase carries `failure: ErrorStatus | null` and
      the notifier receives it. One divergence from `isRetryable`: an API 4xx
      with a reason outside Kubernetes' known set (for example 405) now
      classifies as `BadRequest` and stops instead of reconnecting. Red then
      green: `TestFatalErrorsSayWhetherReconnectingCanHelp`,
      `TestUnclassifiedFatalReconnectsThoughNotRetryable`,
      `TestContainerLogsStreamRoutingErrorsSayWhetherARetryCanHelp`,
      `TestSessionSendErrorCarriesStatus`, and the frame/phase cases in
      `containerLogsStreamProtocol.test.ts` and
      `containerLogsStreamManager.test.ts`.
- [x] Log fetch bindings. Whole-request failures become returned errors.
      Remove the in-band `Error` fields (`types.go:186, 215`) and update
      `NodeLogsTab.tsx:253-270` and the container log fetch reader.

      Implemented: `FetchContainerLogs` and `FetchNodeLogs` return
      `(response, error)` from the service up through `DesktopService`. When
      nothing could be read, the container-log error is the first failed read
      (`%w`, so its status) plus a count; rejected node-log sources are
      `BadRequest`; denied or missing node-log endpoints keep the API status
      under today's message (`errorstatus.WithMessage`, which also replaced the
      YAML helper's local wrapper). `NodeLogsTab` reports failures through its
      existing catch path; a failed incremental read falls back to a full read.
      Red then green: the status assertions in `resources/pods/logs_test.go`,
      `resources/nodes/logs_test.go` (`TestFetchLogsKeepsTheAPIStatusUnderItsMessage`),
      `resource_bindings_test.go`, and NodeLogsTab's
      "falls back to a full read when an incremental refresh fails".
- [x] Type caller-input checks as `BadRequest` (Decision 6). The rule: a check
      of caller-supplied arguments returns an explicit `BadRequest` status
      through one `errorstatus` constructor; a dependency or state failure
      does not. Starting inventory, from a grep of `require*`, `validate*`,
      `parse*` and `errUnsupported*` helpers; finish it before the first
      edit:
      - object identity: `requireObjectName`, `requireNamespacedObject`,
        `requirePodObject` (`object_identity_validation.go:8, 15, 22`);
      - object actions: `validateObjectActionTarget`,
        `validateObjectActionName`, `requireActionNamespacedTarget`,
        `errUnsupportedActionTarget` (`object_actions.go:126, 134, 144, 159`),
        and the inline option checks in the `run*ObjectAction` handlers (11
        `fmt.Errorf`/`errors.New` sites in `object_actions.go`);
        `requireNodeActionTarget` (`node_helpers.go:22`);
        `validatePortForwardTargetGVK` (`portforward_targets.go:50`);
      - scopes and logs: `requireMatchingContainerLogsScopeCluster`
        (`pod_logs.go:55`);
      - YAML text: `parseMutationObjects`, `validateMutationObject`,
        `parseYAMLToUnstructured` (`object_yaml_mutation.go:212, 294, 383`),
        `parseReloadMergeObjects` (`object_yaml_reload_merge.go:171`);
      - attention, kubeconfig and window input: `validateAttentionIgnoredObject`,
        `validateAttentionFindingType` (`cluster_attention_rules.go:254, 272`),
        `parseKubeconfigSelection` (`kubeconfig_selection_contract.go:61`),
        `validatePanelCommandCaller` (`desktop_service.go:634`, 25 call sites);
      - settings input: `validateThemeClusterPattern`
        (`theme_pattern.go:124`), `validateImportedThemes`
        (`data_management_import_export.go:240`), `validateUniqueFavoriteName`
        (`favorites_service_persistence.go:321`).

      Red cases:
      - `RunObjectAction` for remove-finalizer without `finalizerPath` → the
        binding's `cause` is `BadRequest`, `VALIDATION`, with that specific
        message;
      - an empty object name → `BadRequest`;
      - unparseable YAML on apply → `BadRequest`;
      - a nil-client dependency failure → still `Unknown`.

### Phase 4: Frontend reads the status and drops text classifiers

- [x] Red: `errorStatusOf(error)` finds a `Status` on `cause`, on an HTTP
      error, and in a `backend` domain failure. It returns null for browser
      errors and for Wails framework failures (panic, wrong arity, unknown
      method). Those are presented as `UNKNOWN` and reported, and a refresh
      stores them as a `local` failure.
- [x] Red: the `ci-token` case. A failed action whose message contains
      "token" and whose status is `Conflict` produces a visible notification.
- [x] `errorHandler`: category comes from the status; browser-only errors
      (fetch `TypeError`, `AbortError`) keep their current mapping. Delete the
      `categorizeError` regexes, the `STDERR:` split, and `isAuthOverlayError`.
      Suppress a notification only for a `PERMISSION` or `AUTHENTICATION`
      status that is `expected` (refresh denials; auth failures the overlay
      owns). Red cases:
      - a gated action rejected with `Forbidden`, `expected: false` → toast,
        history entry, and report;
      - a refresh-domain `Forbidden` → no toast, no report.
- [x] `CONFLICT` end to end; the presentation entry landed in Phase 2. Red: a
      409 `Conflict` status from an object action shows the `CONFLICT`
      message, keeps the raw text as technical detail, and is reported.
- [x] `VALIDATION` shows the specific message (Decision 6). `getUserMessage`
      (`errorHandler.ts:222-228`) returns the status message for
      `VALIDATION`; the generic "Invalid request…" text is only used when the
      message is empty. Red: a `BadRequest` status with message "remove
      finalizer requires finalizerPath" shows that message, at warning
      severity, and is reported.
- [x] One reporting decision. `expectedErrors.ts` uses `status.expected` for
      errors with a status and keeps only the browser-condition rules for the
      rest. Remove the category override: stop passing
      `isExpectedClusterErrorCategory(category)` (`errorHandler.ts:341-345`),
      drop the category clause from `sentry.ts:1070-1074`, and delete
      `isExpectedClusterErrorCategory`. Red, through `errorHandler.handle` to
      `captureUserVisibleError`:
      - a `DeadlineExceeded` status (`TIMEOUT`, `expected: false`) is reported;
      - a `ServerTimeout` status (`expected: true`) is not;
      - a `NotFound` status is not.
- [x] Domain state holds a failure envelope. Not every failure has a backend
      status: after the client's 3 attempts, a browser fetch failure is
      rethrown (`client.ts:207-222`), and the orchestrator stores its message
      (`orchestrator.ts:1601-1606`). Replace `error?: string | null` and
      `permissionDenied` with one `error?: RefreshFailure | null`, a
      discriminated union:
      - `{ kind: 'backend'; status: Status }` for anything carrying a status;
      - `{ kind: 'local'; message: string; errorName: string }` for browser
        and framework failures, keeping the original message and error name.

      Helpers: `failureMessage(failure)` for display, and
      `isPermissionDenied(failure)`, which is `kind === 'backend'` and
      `status.reason === 'Forbidden'`. `permissionDenied` becomes derived,
      not stored. Do the exact inventory of `.error` readers first; a rough
      grep finds about 50 reads in 17 files. Red cases:
      - a failed fetch (browser `TypeError` after retries) → a visible error
        state with a `local` failure and the original message → the next
        successful fetch clears it and the domain is ready;
      - the Phase 3 permission proofs, re-run against the envelope: the typed
        403 blocks background refetch (`store.ts:234`,
        `NamespaceContext.tsx:736`, `useQueryBackedResourceGridTable.ts:128`),
        and the permission-epoch reset re-enables it.
- [x] `emptyState.ts` takes a `RefreshFailure`. Red: a timeout on an
      rbac-group resource does not render "Insufficient permissions"; a
      `local` failure renders the fallback message.
- [x] `ObjectPanel.tsx`: mark the object deleted only when the status is
      `NotFound` and its `ref` matches the panel's object on all six identity
      fields (cluster, group, version, kind, namespace, name). Never use
      `details`. Red cases:
      - genuine deletion → marked deleted;
      - NotFound with no `ref` → not marked;
      - a `ref` with the same name in another namespace → not marked;
      - a `ref` with the same name and kind in another group → not marked;
      - a `ref` from another cluster → not marked.
- [x] `orchestrator.ts:257`, `clusterOverviewLifecycle.ts:23`,
      `refreshErrorNotifier.ts:36-52`: switch to `reason`, and delete the
      unmatched "catalog hydration incomplete" branch and its fixture.

Implemented (2026-10-11), red then green:
- `errorHandler.ts` categorizes from `errorStatusOf` (browser fetch failure →
  `NETWORK`, else `UNKNOWN`), suppresses toasts only for `expected`
  `PERMISSION`/`AUTHENTICATION`, shows the `VALIDATION` message; the regexes,
  STDERR split and `isAuthOverlayError` are deleted (`errorHandler.test.ts`).
- `expectedErrors.ts` returns `status.expected`, else browser conditions only;
  `isExpectedClusterErrorCategory` and `expectedCondition` are deleted
  (`sentry.test.ts` reporting cases).
- `RefreshFailure` (`core/refresh/refreshFailure.ts`) replaces the domain's
  string error and `permissionDenied`. Deviation from the plan: a third kind,
  `denied`, carries capability-gate denials (`ClusterResourcesManager`), which
  previously reached the empty state as "permission" text and are neither a
  backend status nor a browser failure. `DiagnosticsPanel`'s
  `PERMISSION_ERROR_HINTS` text classifier was a further reader of the same
  string and now reads `isPermissionDenied`. The dead "object detail provider
  not implemented" text filter in `useObjectPanelRefresh` is removed (the
  builder consumes that error).
- `emptyState.ts`, `ObjectPanel.tsx` (NotFound + six-field `ref` match),
  `clusterOverviewLifecycle.ts` and `orchestrator.ts` (`ClusterNotReady`),
  `refreshErrorNotifier.ts` (`NotFound`; hydration branch deleted).
- Evidence: full frontend suite 536 files / 5238 tests pass; `tsc --noEmit`
  clean.

### Phase 5: Close out

- [x] Move durable rules into the docs listed above. Add the status to
      `shared-contracts.md`. (`error-reporting.md` "Error Status Contract" and
      "Frontend Boundaries", `shared-contracts.md`, `refresh-system.md`
      transport boundary, `yaml-editing.md` items 5–6, `container-logs.md`,
      `namespace-scope.md`.)
- [ ] Delete this plan — held until the rendered UI checks below are done.
- [x] Add a release note under `docs/release/pending.md`, grouped by area per
      house style.

## Decisions

1. **Permission rejection on a user action** (2026-10-11). Actions are gated on
   permissions before they are offered, so a Forbidden from an offered action
   should be impossible. If one happens, treat it as a bug: show a toast and
   report it. Background and refresh denials stay silent. See target model
   item 5 and the Phase 3 and Phase 4 items.
2. **Conflict and AlreadyExists get their own `CONFLICT` category**
   (2026-10-11). A 409 comes from racing another writer, not from bad input,
   so `VALIDATION`'s "check your input" message would mislead. Today these
   land in `UNKNOWN` because no text rule matches. `expected` stays `no`,
   matching today's reporting.
3. **Container logs keep the broader reconnect policy** (2026-10-11). The live
   stream reconnects unless the reason is permanent: `NotFound`, `Forbidden`,
   `BadRequest` or `Invalid`, as `handler.go:228-231` does today. That
   includes `Unknown`, so unrecognized kubelet or proxy drops don't end the
   tail; backoff (`containerLogsStreamManager.ts:532`) bounds the cost. The
   decision reads `reason`, never `status.retryable`. To keep the two flags
   apart on the wire, the payload's `retryable` field becomes `reconnect`.
4. **Helm uninstall reports its own failures, as generic delete does**
   (2026-10-11).
   - The uninstall call already reports through `logDeleteError`
     (`backend/resources/helm/helm_releases.go:153-155, 365-375`). That uses
     `LogRequestFailure` with a reviewed `delete helm.sh/v3 releases` shape
     and marks the error as reported, so the `FetchResourceWithSelection`
     fallback, which skips marked errors (`error-reporting.md:137`), never
     added a report for it.
   - The gap is the two setup failures before the uninstall:
     `ensureClient` and `initActionConfig` (`helm_releases.go:142-150`). They
     return unreported errors, which today only the fallback catches.
     `DeleteRelease` will report them itself, as generic delete reports its
     dynamic-client failure (`backend/resources/generic/delete_by_gvk.go:57-61`
     → `LogOperationalFailure`, `generic.go:41`).
5. **YAML conflicts are response data, not errors** (2026-10-11).
   - A UID mismatch, a reload-merge conflict, and a merge precondition failure
     return a `yamlConflict` result on the `ApplyObjectYaml`,
     `MergeObjectYamlWithLatest` and `CheckObjectYamlOwnership` responses.
     This is the `ClusterWorkspaceResult` pattern; the merge response already
     returns `currentYAML` on success.
   - The ownership check stays advisory and fail-open
     (`docs/architecture/yaml-editing.md`, item 5). Its `yamlConflict` or
     error never blocks saving, and Apply gives the single user-visible
     result.
   - Real failures stay API errors carrying the generic status.
   - The shared status gets no feature-specific fields, and live object YAML,
     which may be Secret data, never enters the error path, so it cannot
     reach toasts, history or telemetry.

6. **Caller-input checks are typed `BadRequest` in this effort, and
   `VALIDATION` shows the specific message** (2026-10-11).
   - Every binding-level check of caller-supplied arguments returns an
     explicit `BadRequest` status: object identity, action names and options,
     YAML text, scopes, window names, and settings input. Failures of
     dependencies or state are not input errors and stay `Unknown`.
   - The `VALIDATION` presentation shows the status message. The generic
     "Invalid request…" text is only a fallback for an empty message
     (`errorHandler.ts:222-228`).
   - `expected` stays `no`, so these are still reported, as today.

## Open questions

None. All six were decided on 2026-10-11; see Decisions.

## Validation

- Focused tests per phase:
  - backend: `mise exec -- go test ./backend/...` for the touched packages;
  - frontend: `vitest` from `frontend/`, for the touched modules.
- Coverage on changed code: `mise exec -- wails3 task test:backend-coverage`
  and `mise exec -- wails3 task test:frontend-coverage`; target 80% or report
  the gap.
- Cognitive complexity of 12 or lower for every changed function:
  `gocognit -over 12` and `npm run complexity --prefix frontend -- <files>`.
  This applies especially to `Classify` and the rewritten `errorHandler`.
- Generators: `mise exec -- go generate ./backend` and regenerated bindings.
  `qc:bindings` must pass.
- `mise exec -- wails3 task qc:prerelease`, then inspect the worktree for
  formatter changes.
- Rendered UI (Playwright MCP against `wails3 dev`):
  - an action rejected by the API server shows a toast. That includes an
    offered action whose permission was revoked after the menu was built;
    revoke the RBAC binding between opening the menu and clicking;
  - a deleted object marks the panel deleted, and an unrelated NotFound does
    not;
  - an RBAC-denied view shows the permission empty state, and a timeout does
    not;
  - a cluster whose auth is invalid shows only the auth overlay;
  - a sibling cluster's errors carry no foreign text.

  The restricted-cluster cases need the kind setup in `test/kind/clusters.sh`,
  which no longer exists locally. Ask before recreating it.

### Completion record (2026-10-11)

- `mise exec -- wails3 task qc:prerelease`: pass (docs, fmt, bindings, vet,
  staticcheck, race suite, lint, typecheck, frontend tests 5355, knip,
  trivy). The run needs `frontend/dist` (embedded by `main.go`); it was absent
  and was built with `npm --prefix frontend run build` first. Four
  `cmd/project` contract tests were updated for intended changes: the removed
  `backend-error` event, the removed generated `Get<Kind>` wrappers, and the
  service registration now declaring `MarshalError`.
- Coverage: frontend 90.74% statements overall, changed files ≥ 86%;
  backend `errorstatus` 94.3%, `refresh/api` 92.8%,
  `refresh/containerlogsstream` 94.1%, `resources/pods` 83.6%,
  `resources/nodes` 85.2%. Below 80% at package level and pre-existing:
  `refresh` 69.8% (changed `processManualJob` 81%), `refresh/streammux` 78.1%
  (changed `ErrorMessage` and `sendError` covered), `internal/bootstrap`
  60.9% (changed `newApplicationComposition` 95.7%).
- Complexity: no changed function above 12. Pre-existing, unchanged scores at
  HEAD: `monitorShellTimeout` 17, `waitForInformerSync` 14,
  `retryManualOperation` 14, `initializeStartupClusters` 14, and the anchor
  effect in `useQueryBackedResourceGridTable.ts` 14.
- Follow-ups done the same day, gate re-run green (5358 frontend tests):
  `ClusterWorkspaceResult.error` is a status (red then green:
  `TestApplyClusterWorkspaceReportsARejectedSelectionWithItsStatus`, and
  KubeconfigContext "reports a rejected selection with the status the backend
  returned"); a panicking snapshot build is reported through the panic path
  with a short message (`TestServiceBuildPanicIsReportedNotShown`); the
  test-only `ValidateObjectYaml` is removed (its protected-field test now runs
  through `ApplyObjectYaml`).
- Manual check 1 (deleted ConfigMap) failed: the panel sends object-details
  scopes with a lowercased kind, and the NotFound `ref` echoed it, so the
  panel's exact match missed. `confirmMissingObject` now names the resolver's
  canonical group/version/kind; the backend test sends the panel's scope form
  (red then green).
- Manual checks in `wails3 dev` against a kind cluster, all passed after the
  fixes they prompted (2026-10-11): deleted object marks the panel; a rejected
  YAML save shows the API's reason; a replaced object gives an inline
  conflict; connecting a cluster is quiet; Node Logs, previous logs and live
  logs work. Fixes found along the way: the NotFound `ref` uses the canonical
  kind; YAML editor failures report through `handleInline` (no duplicate
  toast); node log requests send options as query parameters (`RequestURI`).
- Restricted-identity checks on the kind cluster from
  `test/kind/restricted.sh` (2026-10-11). Check 1 failed at first: the
  namespaces sidebar loaded forever. A probe of the real refresh subsystem,
  run as the restricted login, got a typed `Forbidden` at once for namespaces
  and nodes, so the fault was in the frontend. This branch had folded the
  store's `permissionDenied` stamp into `error`. Stream start and resync
  writers clear `error` while the runtime keeps blocking refetches, so the
  denial vanished. The stamp is restored as on `main`; the typed query hook
  settles on it even after a reset. Red then green: orchestrator "keeps a
  permission-denied scope denied when its stream starts", useTypedResourceQuery
  "settles a denied scope whose stored failure a stream reset cleared",
  NamespaceContext "…after its stream reset the state". `qc:prerelease` pass
  (5362 frontend tests). Checks 1–3 are awaiting re-verification; this plan
  stays until they pass.
