# Error Reporting

Packaged builds report frontend and backend errors to Sentry Cloud. Reporting
defaults **on** but starts only after the persisted preference loads and the
matching DSN is configured; **Settings → Data Management → Telemetry** turns
both reporters off. Development builds disable both SDKs even when Sentry
environment variables are present.

Only `frontend/src/core/telemetry/sentry.ts` and `internal/sentry` may import
Sentry SDKs (Biome and Go architecture tests enforce this). Feature code never
calls Sentry; `errorHandler`, `ErrorSurface`, `runUserAction`, and the
data-access request wrapper create reporting context and breadcrumbs.

## Enablement and Consent

- `backend/preferences_settings.go` persists `errorReportingEnabled`; the
  post-commit settings dispatcher switches the backend reporter through
  `ErrorReportingService` only after the write succeeds.
- Missing settings use the default-on value; malformed or unreadable settings
  are RPC errors, not defaults. Backend startup and frontend hydration both fail
  closed when a persisted opt-out cannot be read.
- `internal/bootstrap` calls the package-level, non-Wails
  `InitializeErrorReporting` with the immutable `PreferencesService.EnsureLoaded`
  result; only `loaded` provenance may enable the reporter. It is absent from
  `DesktopService` and generated bindings.
- `sentry.ts` initializes `@sentry/react` after the preference loads; React 19
  root handlers capture frontend failures. `frontend/src/main.ts` must import
  `App` dynamically after initialization, or a module-level failure reaches an
  uninstrumented page (`src/main.test.ts` pins this).
- Preference-hydration failures are buffered in memory until the choice is
  known: enabled flushes the original exceptions after initialization; opt-out
  or an unreadable preference discards them.
- Turning reporting off stops future transmission; it does not delete events
  already in Sentry.

## Error Status Contract

Every backend error that crosses to the frontend carries one typed status, so
no layer decides behavior from message text.

- `backend/internal/errorstatus` owns `Status` (Kubernetes `Status`-shaped:
  `code`, `reason`, `category`, `message`, `retryable`, `expected`, optional
  `ref` and `details`) and its `Reason`/`Category` enums, generated to
  TypeScript (`ErrorStatus*` in `types.generated.ts`). `Classify` decides, in
  order: an explicit status attached at a boundary, an app permission denial,
  a Kubernetes `APIStatus`, `authstate.AuthInvalidError`, then known transport
  conditions (cancellation, bare client deadline, decode errors, the
  known-only credential classifier); everything else is `Unknown`.
  `retryable` and `expected` come from the retry and reporting rules, not from
  the reason, so a case that differs from its reason's usual value keeps its
  verdict.
- Wire forms: a bound method's returned error carries the status as the Wails
  `cause` (`ServiceOptions.MarshalError`); a refresh HTTP failure answers with
  the status as its body and its `code` as the response status; resource and
  container-log stream error frames carry it as `errorDetails`. A result that
  returns state alongside a failure (`ClusterWorkspaceResult`, a failed
  manual-refresh job) carries the status as its `error`; the frontend turns it
  into an error with `statusError`, which validates it at the boundary. Wails
  framework failures (panic, wrong arity, unknown method) carry no status and
  are presented as `UNKNOWN` and reported.
- Boundaries type what only they know: caller-input checks return
  `BadRequest`; a refresh request for a cluster without an active subsystem
  returns `ClusterNotReady`, and one before the refresh service is published
  `RefreshUnavailable`; a gated user action (`RunObjectAction`, YAML apply and
  ownership check, shell) marks a `Forbidden` `expected: false`, because the
  UI only offers actions its permission gate allowed.
- `ref` names the object whose lookup failed, with full identity. Only the
  producer that looked that exact object up sets it. Object details confirm a
  Kubernetes NotFound with an uncached read first. A Helm release missing
  from Helm storage is a NotFound, and its details name the release's
  synthetic `helm.sh/v3` `HelmRelease` identity. Kubernetes `details` are never
  used for identity.
- YAML editor conflicts are response data (`yamlConflict`), not errors; live
  object YAML never enters the error path.

## Frontend Boundaries

- `frontend/src/utils/errorHandler.ts` takes the category from the status
  (`errorStatusOf`); an error without one is `NETWORK` only for the browser's
  own fetch failure, otherwise `UNKNOWN`. `handle` reports before publishing a
  global notification, and suppresses the toast only for an `expected`
  `PERMISSION` or `AUTHENTICATION` status (refresh denials; credential
  failures the auth overlay owns). `VALIDATION` shows the status's own
  message. A 409 (`Conflict`, `AlreadyExists`) is `CONFLICT`, not
  `VALIDATION`: another writer won a race, so "check your input" would
  mislead. It is still reported.
- One reporting decision: `core/telemetry/expectedErrors.ts` returns the
  status's `expected` verdict when there is a status, otherwise only browser
  conditions (clipboard denial, browser/Wails cancellation) are expected.
  `handle`, `handleInline`, and `handleOperational` share it before any Sentry
  scope or error breadcrumb. No category or message text suppresses a report.
- A refresh domain stores its last failure as a `RefreshFailure`
  (`core/refresh/refreshFailure.ts`): `backend` with the status, `local` with
  the browser's message and error name, or `denied` for a read the capability
  gate refused before any request. Empty states and diagnostics recognize a
  denial from the failure (`isPermissionDenied`); gating reads the scope's
  separate `permissionDenied` stamp, which outlives stream resets that clear
  the failure. The object panel treats a `NotFound` as deletion only when its
  `ref` has the panel's own identity (`objectPanelId`: cluster, group,
  version, kind in any letter case, namespace, name).
- Advisory warnings stay local. Legacy component
  boundaries do not re-capture render failures owned by the React 19 root
  handlers.
- `frontend/src/shared/components/errors/ErrorSurface.tsx` renders dynamic
  inline error text. An operational surface receives the original error and
  reports when presented; validation, runtime-status, and already-reported text
  must declare that classification (e.g. namespace-scope editor: persistence
  and missing-cluster failures are operational, invalid input is validation).
- `handleOperational` is the non-toast boundary for failures handled without a
  surface. Event-bus subscriber exceptions use a reporter installed on the bus,
  keeping the bus cycle-free.
- Enforcement: Biome `no-inline-error-text` rejects raw JSX rendering of
  error-shaped values (`.message`, `String(error)`, `error.toString()`);
  `no-direct-console-error` bans production `console.error`. The mandatory
  `check:error-reporting-boundaries` pass (`npm run check`) follows caught,
  rejected, and constructed errors through renamed/transitive aliases,
  formatter/helper calls, JSX props, and React state or reducer dispatches,
  reusing the pinned TypeScript project and AST APIs (no second parser). Only
  values returned by the shared reporting boundary count as already reported.

## Frontend Context and Breadcrumbs

- The navigation owner publishes active view, tab, aliased cluster, and
  object-panel state; the namespace owner publishes the aliased namespace. Both
  attach to user-visible error events and app-owned breadcrumbs.
- Operation ids: broker data/app-state reads carry one `broker-read-N` from
  start to completion, reused by any error they cause. Refresh failures are
  presented inside the orchestrator before the broker call completes, so it
  passes the live request id to the error boundary and the reporter resolves
  it against the active broker record. Other handled failures get `ui-error-N`
  with the allowlisted user action, source, cluster alias, and namespace alias.
  Non-broker user async work runs through `runUserAction`, which assigns
  `user-action-N` per invocation and binds a rejected `Error` to it.
- Only the navigation, broker-request, `runUserAction`, error-presentation, and
  error-handler boundaries emit breadcrumbs. While exactly one broker request is
  active, they receive its request id.
- Before send, breadcrumbs from other request ids or labeled with a different
  view, tab, cluster alias, or namespace alias are dropped. A failure without a
  broker request keeps only breadcrumbs with its exact operation id: overlapping
  wrapped actions keep their own trails, an unwrapped failure keeps only its
  presentation breadcrumb (never the latest click), and a background failure
  keeps only its own `ui.error.handled` breadcrumb.
- Every breadcrumb category has a closed field allowlist; labels, request
  scopes, raw error messages, and arbitrary caller context are never copied.

## Backend Reporting

- `internal/sentry` (package `sentryreporting`) initializes `sentry-go`,
  forwards exceptions and panics, and owns enable/disable and shutdown. It sits
  in module-root `internal` because `internal/bootstrap` (startup, Wails-run,
  process-panic reporting) and `backend` both import it; under
  `backend/internal`, bootstrap could not. The package name
  separates the app-owned privacy boundary from the SDK and keeps type names
  stable for grouping.
- `backend.ErrorReportingService` owns the reporter, live enable/disable,
  installation registration, and the mutex serializing registration with
  Factory Reset; it does not retain Preferences.
- `backend/logger.go` keeps local text human-readable. `ErrorWithCause` sends
  the original error through `CaptureException`; `Panic` sends the recovered
  value through `CapturePanic` with stacktrace attachment, so string panics keep
  their stack. Operation context reaches Sentry only through the caller's closed
  structured schema.
- String-only `ERROR` calls become `sentryreporting.LoggedError`. Sentry titles
  issues `"<type>: <value>"`, so renaming the type renames every future
  legacy-log issue.
- Non-error log entries become breadcrumbs while enabled. Wails resource
  operations get a process-unique operation id; refresh snapshot requests reuse
  `X-Correlation-ID` (including `broker-read-N`), kept by queued manual-refresh
  jobs after the request ends. Only breadcrumbs matching the event's exact
  operation id and raw cluster are selected; identifiers are then replaced.
- Errors without an explicit operation get `backend-report-N` and no unscoped
  breadcrumbs, so same-cluster background activity cannot become a false trail.
  Event scope: source, `cluster.alias`, structured operation fields, operation
  id. Breadcrumb data: operation id and cluster alias only.
- `backend/internal/applog.ReportError` and
  `resources/common.Dependencies.LogRequestFailure` preserve typed errors across
  package and cluster-scoped logger boundaries. Kubernetes request operations
  expose only action, group/version, resource, subresource, and scope; no
  namespace, object name, URL, message, or arbitrary map, for built-in and
  discovered resources alike. Loggers without the optional structured interface
  stay string-only. Handlers on this path wrap causes with `%w`.
- Resource reporting helpers return the original chain with an internal
  telemetry-disposition marker; a handler that reports locally must propagate
  it; there is no gateway-level fallback capture, so a resource service reports
  its own failures (Helm uninstall included). The marker changes neither
  rendered text nor typed status. A Go AST guard rejects resource code that
  discards a helper's result.
- A panicking snapshot build is reported through the panic path (the snapshot
  service's `WithLogger`), and the request fails with `snapshot build panic:
  <value>`; the stack never enters the error message the UI shows.
- Unexpected metrics polls, beta-expiry startup failures, capability-review
  batch failures, and classified auth failures also use the structured path.
  Auth diagnostics expose only existing sanitized fields to the frontend; the
  original failure stays in the local log, not auth lifecycle state.
- Capability batch summaries and slow-review breadcrumbs keep group/version,
  resource, verb, and namespaced-vs-cluster scope, never the permission key,
  namespace, or object name; timing breadcrumbs aggregate by scope type.
- Metrics dedupe: an absent Metrics API is expected (one warning breadcrumb per
  uninterrupted unavailable run, no exception). Other repeated poll failures
  report at most once per API per uninterrupted failure run, with original cause
  and stack; a successful full collection re-arms. Retries log as warnings.
- Neither reporter uses a custom fingerprint.

## Kubernetes Status Context

Exceptions implementing `APIStatus`, even wrapped, add `k8s.reason` and
`http.status_code` tags plus a `kubernetes` context (status, reason, code,
retry delay, API group/kind, field causes). Cause reasons use a closed
allowlist; cause messages are dropped; only schema-shaped field paths (e.g.
`spec.template.spec.containers[0].image`) survive, and any path containing map
keys or other free-form values becomes `[field]` as a whole. The status message is replaced because validation errors echo
manifest values. Object names and request payloads are never copied. Kept for
diagnosis: exception types, useful frames, release/environment, OS/runtime,
safe operation identity, Kubernetes reason/status/fields, installation ID.

## Privacy Boundary

- Both SDKs disable automatic user info, headers, cookies, request/response
  bodies, URL query parameters, GraphQL variables/documents, generative AI
  input/output, database query data, and stack-frame variables; the frontend
  also disables automatic DOM, console, fetch, XHR, history, culture, and
  default session breadcrumbs/contexts. The frontend keeps five source-context
  lines around frames, which the final scrubber sanitizes.
- Final frontend and backend scrubbers remove requests, IPs, hostnames,
  usernames, emails, URLs, common credentials, local home paths, raw
  cluster/namespace identifiers, runtime variable values, and unreviewed
  breadcrumb fields, even if a future SDK fills a field collection skips.
  Identifiers become process-local `cluster-N` / `namespace-N` aliases where
  correlation helps.
- Backend `beforeSend` (single hook) removes user/request data and hostnames,
  clears runtime variables, sanitizes free text, and replaces cluster
  identifiers, typed-status object names, and resource names from the
  operation contract's redaction-only channel.
- Prose redaction covers quoted object names, unquoted `namespace/name`, and
  unquoted name-shaped values with a dot, dash, underscore, or digit. Rejected:
  redacting every word after a kind noun — it destroys `service unavailable`.
- The scrubber protects only the producer-owned capability-shape grammar
  before redacting surrounding text.
- Backend frames normalize to repository-relative paths
  (`backend/capabilities/service.go`); home-directory prefixes stay redacted.
- Frontend frame `filename`/`abs_path` and `debug_meta.images[].code_file`
  become matching `app:///assets/index-a1b2c3.js` identities without hosts,
  queries, or build paths; distinct bundles stay distinct so hidden source maps
  resolve.
- Reports are pseudonymous, not anonymous: a random `anonymizedId` in local
  settings is the frontend Sentry user ID.

## Backend Grouping

- `beforeSend` drops reporting-machinery frames (`sentryReporter` capture
  methods, `applog`, the app `Logger`, registered forwarders such as
  `logError`, `logDeleteError`, `LogRequestFailure`). Sentry groups on the
  innermost frame, so otherwise every `ERROR` groups under the reporter.
- Forwarders are maintained by hand in `logForwarders`
  (`internal/sentry/reporter.go`); stacks cannot show whether a function did
  work before logging. Register any helper that only calls `applog.Error`, or
  it becomes the culprit for all callers (happened in production).
- `in_app` is limited to this module's packages; sentry-go's default marks all
  non-GOROOT code in-app, so dependency upgrades would re-group issues.

## Telemetry Cadence

Installation registration, upgrades, Release Health sessions, and error events
are separate signals, never interchangeable counts.

| Signal | When sent | Measures |
| --- | --- | --- |
| `app.installation.registered` | Once per `anonymizedId` after Sentry confirms delivery; cancellable background work after the Wails startup callback; failures retry on a later startup. | Approximate new installations. |
| `app.installation.upgraded` | On the same background path, once per newer release a registered installation runs; `from.version` is the last reported release, `unknown` for installations registered before upgrade tracking. | Upgrade events, not distinct installations; the destination is the metric's `sentry.release`. |
| Frontend Release Health session | At frontend page-lifecycle start: once per launch, again after a hard reload such as Factory Reset. | Successful loads; no heartbeat, duration, or actions. |
| Error event | A reportable exception crosses an owned boundary while enabled. | A failure, independent of the other counts. |

- A confirmed flush records `installationMetricReported: true` and
  `reportedVersion`, the running release; later launches skip registration.
  A launch sends registration or an upgrade, never both.
- `reportedVersion` only moves forward: a relaunch or downgrade sends nothing,
  so returning to an already reported release is not a second upgrade.
  Development and other non-release builds (rejected by
  `updateidentity.ParseReleaseVersion`) register but never report upgrades or
  record a version.
- Sentry keeps application metrics for 30 days on every plan, so both
  installation metrics are counts within that window; all-time totals must be
  accumulated outside Sentry.
- Factory Reset deletes `anonymizedId`, that flag, and `reportedVersion`; the
  reload creates a new ID and session, and the backend's next startup callback
  (normally the next launch) registers it as a new installation. Factory Reset
  waits for any in-flight registration and its acknowledgement write before
  deleting settings, so the worker cannot restore the old ID.
- The flush has a two-second deadline but never runs before `app.Run`, so it
  cannot delay launch; shutdown cancels it. Runtime enabling schedules the same
  background path without blocking the settings RPC.
- Sessions come only from the React page-lifecycle browser-session integration
  while reporting is enabled (user ID, release, environment). The Go SDK sends no sessions, so 0% backend
  adoption is not disuse. Use frontend **Users** for active installations,
  **Sessions** for approximate loads, `app.installation.registered` for new
  registrations, and `app.installation.upgraded` for upgrades.
- Sessions are Release Health, not Session Replay: exceptions mark them errored
  and unhandled failures crashed.

## Cancellation and Expected Outcomes

Only structured failures and string-only `ERROR` entries become issues; lower
levels are breadcrumbs. Context cancellation (panel closed, navigation, cluster
disconnect, poller shutdown) is expected and never reported.

- Resource services call `LogResourceRequestFailure` /
  `LogDynamicResourceRequestFailure` (via
  `common.Dependencies.LogRequestFailure`): cancellation logs at `DEBUG`, other
  original errors report structurally. Prefer them over formatting into
  `Logger.Error` so new kinds inherit this and keep typed status.
- Capability batches check their context before reporting: a cancelled request
  can carry a sibling task's failure as its cause. Batch metrics and results
  remain; deadlines remain reportable.
- The metrics poller treats demand-shutdown cancellation as expected.
- A standalone client-side `context.DeadlineExceeded` is reportable; a deadline
  carried by a URL or network operation is a connectivity outcome.
- The known-only credential classifier keeps expected auth and connectivity
  outcomes in the local log: wrapped auth-state errors, raw 401s or helper
  failures, API-server unavailable/timeouts, recognized DNS/TCP/TLS failures,
  dropped HTTP/2 connections (lost, client-closed, GOAWAY), and an EOF inside a
  request error (a bare EOF still reports). Unrecognized errors report. Structured 403s, refresh-domain permission
  denials, and NotFound stay local; permission decisions and returned errors
  are unchanged.
- The auth recovery loop separately treats an unknown probe failure as
  connectivity, because an inconclusive probe must not invalidate credentials.
- `logsources.ErrorCapture` entries (third-party stderr such as klog, routed by
  `backend/internal/errorcapture`) never reach the reporter: they are not app
  failures and their stack is the scraper. Stderr carries no cluster identity,
  so it is only logged: never attached to a returned error and never surfaced
  as a UI event. Permission-denied lines become informational, and a repeated
  warning or error line logs once per session.

## Build Configuration

- Release builds embed `SENTRY_FRONTEND_DSN` and `SENTRY_BACKEND_DSN`;
  `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_FRONTEND_PROJECT` are build-only
  source-map inputs. Secret setup and publishing: [RELEASE.md](../../RELEASE.md);
  contributors and forks need no production credentials.
- `frontend/vite.config.ts` owns release identity and upload. The Vite plugin
  runs only when token, org, and frontend project are all set; it uploads hidden
  source maps as `luxury-yacht@<productVersion>` and deletes the `.map` files.
- Never put `SENTRY_AUTH_TOKEN` in a `VITE_` variable; those are bundled into
  the webview.
- Plugin `telemetry: false` stops it reporting its own build errors/timings to
  Sentry (`vite.config.test.ts` pins it).
  `bundleSizeOptimizations.excludeTracing: true` drops unused tracing code (the
  app never initializes tracing) without affecting capture, source maps, or
  sessions.
- No `SENTRY_BACKEND_PROJECT`: the backend project comes from its DSN.
- `wails3 dev` initializes neither SDK nor the plugin: the `production` build
  tag is absent (backend off) and Vite dev injects an empty DSN with no release
  identity. Local DSNs, credentials, and the persisted setting are ignored.
- A packaged backend accepts a `SENTRY_BACKEND_DSN` environment override.
  Release identity and the `production` environment are build-owned, with no
  overrides.
