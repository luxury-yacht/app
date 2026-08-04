# Error Reporting

Luxury Yacht uses Sentry Cloud for frontend and backend error reporting in
packaged builds. Reporting defaults **on**, but starts only after the persisted
preference has loaded and the corresponding DSN is configured. Users can turn
both reporters off under **Settings → Data Management → Telemetry**. Development
builds disable both SDKs even when Sentry environment variables are present.

## Runtime Behavior

The integration keeps Sentry's exception processing while replacing its broad
data-collection defaults with an application-owned privacy boundary:

- `frontend/src/core/telemetry/sentry.ts` initializes `@sentry/react` after the
  persisted preference has loaded. React 19 root handlers capture frontend failures.
  A page-lifecycle browser-session integration sends release-health sessions
  while reporting is enabled. The SDK's automatic DOM, console, fetch, XHR,
  history, culture, and default session breadcrumbs/contexts are disabled.
- `frontend/src/utils/errorHandler.ts` is the presentation boundary for handled
  operational failures. `handle` reports before publishing a global error
  notification except when it classifies authentication or permission failure
  as an expected UI condition already owned by the auth overlay or permission
  state. Those conditions add an allowlisted `ui.error.expected` warning
  breadcrumb instead of creating an issue. `handleInline` and
  `handleOperational` remain exception boundaries even for permission-shaped
  text, so an unexpected internal failure does not disappear merely because
  its message contains `permission` or `403`. Both preserve the original
  JavaScript `Error` for `captureException`. Validation messages and advisory
  warnings are not exceptions and stay local. Render failures already owned by
  the React 19 root handler are not captured a second time by legacy component
  boundaries.
- `frontend/src/shared/components/errors/ErrorSurface.tsx` is the rendering
  boundary for dynamic inline error text. An operational surface receives the
  original error and reports it when presented; validation, runtime-status,
  and already-reported messages must declare that classification explicitly.
  The namespace-scope editor is one production caller: persistence and missing-
  cluster state failures cross the operational surface with their original
  error, while invalid namespace input crosses the validation surface locally.
  The `no-inline-error-text` Biome plugin rejects raw JSX rendering of
  error-shaped values (including `.message`, `String(error)`, and
  `error.toString()`). The mandatory `check:error-reporting-boundaries` pass
  additionally follows caught, rejected, and constructed errors through
  renamed and transitive aliases, formatter/helper calls, JSX props, and React
  state or reducer dispatches. It reuses the repository's pinned TypeScript
  project and AST APIs rather than adding a second parser/traversal dependency.
  Only values returned by the shared reporting boundary are treated as already
  reported. Renaming an operational error string therefore cannot bypass
  `ErrorSurface` or discard the original exception before it reaches reporting.
- `handleOperational` is the matching non-toast boundary for caught failures
  that are handled without rendering an error surface. Production code cannot
  call `console.error` directly: the `no-direct-console-error` Biome plugin
  requires the original exception to cross one of these shared boundaries.
  Event-bus subscriber exceptions use an installed reporter on the bus, so the
  bus stays cycle-free while still crossing the same telemetry boundary.
- The navigation owner publishes the active view, tab, aliased cluster, and
  object-panel state, while the namespace owner publishes an aliased selected
  namespace. These are attached to user-visible error events and app-owned
  breadcrumbs. Data and
  app-state broker reads carry one `broker-read-N` identifier from request start
  through completion; a displayed error caused by that request reuses the same
  identifier as its operation id. Refresh failures are presented inside the
  orchestrator before the broker call completes, so the orchestrator explicitly
  carries that live request id into the error boundary; the frontend reporter
  resolves it against the active broker record instead of assigning a separate
  `ui-error-N` id. Other handled failures receive a unique
  `ui-error-N` operation id and retain the allowlisted user action, source,
  cluster alias, and namespace alias. User-initiated async work that is not a broker
  read runs through `runUserAction`; the wrapper gives each invocation a
  `user-action-N` id and binds a rejected `Error` to that exact invocation.
- Breadcrumbs are emitted by the navigation, broker-request, `runUserAction`,
  error-presentation, expected-condition, and error-handler boundaries. Feature components do not
  call Sentry directly. While exactly one broker request is active, those
  app-owned breadcrumbs receive its request id. Before a frontend event is
  sent, breadcrumbs from other request ids and breadcrumbs labeled with a
  different view, tab, cluster alias, or namespace alias are removed. A handled
  failure without a broker request keeps only
  breadcrumbs carrying its exact operation id. Wrapped user actions therefore
  retain their own start/failure trail even when another action overlaps; an
  unwrapped failure keeps only its own presentation breadcrumb instead of
  guessing from the most recent click. Every breadcrumb category has a closed
  field allowlist; labels, request scopes, raw error messages, and arbitrary
  caller context are not copied into the Sentry event.
- Background handled failures keep only their own `ui.error.handled`
  breadcrumb, matched by operation id. They do not inherit the last unrelated
  browser activity merely because it happened in the same workspace.
- `frontend/src/main.ts` imports `App` dynamically, *after* that initialization.
  A static import would evaluate the whole application module graph first, so a
  module-level failure anywhere in the app would reach an uninstrumented page
  and never be reported. Keep the import dynamic; `src/main.test.ts` pins the
  ordering. Preference-hydration failures are buffered in memory until the
  persisted reporting choice is known. An enabled preference flushes the
  original exceptions after SDK initialization; opt-out discards them. If the
  persisted preference itself cannot be read, reporting fails closed and the
  buffer is discarded rather than risking transmission after an opt-out.
- `internal/sentry` initializes `sentry-go`, forwards exceptions and
  panics, and owns the runtime enable/disable and shutdown lifecycle. It lives
  under the module-root `internal` directory because reporting is process-wide
  infrastructure shared by the root Wails composition process and packages
  under `backend`. Go permits both callers to import a root-internal package
  while preventing modules outside Luxury Yacht from importing it; placing the
  package under `backend/internal` would prevent root `main.go` from using it
  for startup, Wails-run, and process-panic reporting. The package declaration
  intentionally remains `sentryreporting`: that name distinguishes the
  application-owned consent/privacy boundary from the upstream Sentry SDK and
  preserves existing exception type names such as
  `sentryreporting.LoggedError` for stable issue grouping.
- `backend/logger.go` keeps local log messages human-readable while forwarding
  structured failures separately. `ErrorWithCause` sends the original Go error
  through `CaptureException`, and `Panic` sends the recovered value through
  `CapturePanic`. Human-readable operation text stays in the local log; Sentry
  receives operation context only when the caller supplies the closed
  structured schema. Stacktrace
  attachment is enabled so even a panic whose recovered value is only a string
  retains the call stack. Legacy
  string-only `ERROR` calls still become `sentryreporting.LoggedError`, so their
  issue title reads `sentryreporting.LoggedError: <message>`. The type name is
  user-visible — Sentry titles issues `"<type>: <value>"` — so renaming it
  renames every future legacy-log issue.
- Non-error backend log entries become Sentry breadcrumbs while reporting is
  enabled. Wails resource operations receive a process-unique operation id;
  refresh snapshot requests reuse `X-Correlation-ID`, including the frontend
  broker's `broker-read-N` id. Queued manual-refresh jobs retain that identity
  after the HTTP request finishes. Only breadcrumbs matching the event's exact
  operation id and raw cluster are selected internally, then identifiers are
  replaced before transport. Errors without an explicit operation
  are assigned a `backend-report-N` id and receive no unscoped breadcrumbs, so
  same-cluster background activity cannot become a false trail. The transported
  event scope includes source, `cluster.alias`, structured operation fields,
  and operation id. Backend breadcrumb data is limited to operation id and
  cluster alias.
- `backend/internal/applog.ReportError` and
  `resources/common.Dependencies.LogRequestFailure` preserve typed errors across
  package and cluster-scoped logger boundaries. Kubernetes request operations
  expose only action, API group/version, resource type, subresource, and scope;
  the schema has no namespace, object-name, URL, message, or arbitrary-map
  fields. Built-in identities and discovery-backed custom resources use the
  same final allowlist. Loggers that do not implement the optional structured
  interface retain the previous string-only local-log behavior.
  Resource handlers touched by this reporting path wrap returned causes with
  `%w` so their callers can continue inspecting the chain.
- The resource reporting helpers return the original error chain with an
  internal telemetry-disposition marker. A resource handler must propagate
  that returned error when it reports locally. `FetchResourceWithSelection`
  still captures unmarked errors as the universal fallback, but does not
  capture a marked error a second time; it continues to emit the
  `backend-error` event for the UI in both cases. The marker does not change the
  rendered error or remove typed Kubernetes status information. A Go AST guard
  rejects resource code that silently discards a reporting helper's result.
- Unexpected metrics polls, beta-expiry startup failures, capability-review
  batch failures, and classified authentication failures also use the
  structured path. An absent Metrics API is expected cluster capability state:
  it produces one warning breadcrumb per uninterrupted unavailable run and no
  exception. Other repeated poll failures produce at most one exception per API
  in an uninterrupted failure run; a successful full collection re-arms the
  report so a later outage remains visible. Authentication diagnostics retain
  the original cause internally while exposing only their existing sanitized
  fields to the frontend. Capability
  batch summaries and slow-review breadcrumbs retain group/version, resource,
  verb, and namespaced-versus-cluster scope, but never the caller-supplied
  permission key, namespace, or object name. Batch timing breadcrumbs aggregate
  by scope type rather than namespace value. The final backend scrubber protects
  only that producer-owned capability-shape grammar before applying generic
  hostname and Kubernetes-object redaction to the surrounding failure text.
- `backend/app_settings.go` persists `errorReportingEnabled` and switches the
  backend reporter only after the setting write succeeds. Missing settings use
  the documented default-on preference, but malformed/unreadable settings are
  returned as RPC errors rather than converted into defaults. Backend startup
  and frontend preference hydration therefore both fail closed when a
  persisted opt-out cannot be read.
- `frontend/vite.config.ts` owns release identity and frontend source-map upload.

Neither reporter uses a custom fingerprint. Backend exceptions that implement
Kubernetes `APIStatus` add
`k8s.reason` and `http.status_code` tags, including when that status error is
wrapped. A `kubernetes` context also carries the status, reason, code, retry
delay, API group/kind, and field-level causes when present. Cause reasons use a
closed Kubernetes allowlist, cause messages are omitted, and only schema-shaped
field paths such as `spec.template.spec.containers[0].image` are retained. Paths
containing map keys or other free-form values become `[field]`. The typed status
message is replaced before transport because validation errors can echo rejected
manifest values. Object names and request payloads are not copied into that
context. Exception types, useful stack frames, release/environment, OS/runtime
context, safe operation identity, Kubernetes reason/status/field details, and
the pseudonymous frontend installation ID remain available for diagnosis.

The backend defines one `beforeSend` privacy boundary. It removes user/request
data and hostnames, clears captured runtime variables, sanitizes free-form text,
replaces cluster identifiers, typed Kubernetes status object names, and
resource names supplied through the operation contract's redaction-only channel.
Generic Kubernetes prose redaction preserves quoted object names, unquoted
`namespace/name` pairs, and unquoted name-shaped values containing a dot, dash,
underscore, or digit. It deliberately does not treat every bare English word
after `service`, `node`, or another kind noun as an identifier, because doing so
destroys actionable messages such as `service unavailable`. The boundary also
normalizes this repository's application frame
filenames to paths such as `backend/capabilities/service.go`, and removes stack
frames belonging to the reporting machinery itself — `sentryReporter`'s capture
methods, `applog`, the application `Logger`, and registered one-line forwarders
such as `logError`, `logDeleteError`, and `LogRequestFailure`. Sentry derives an
issue's culprit and grouping key from the innermost frame, so without the trim
every backend `ERROR` groups under the reporter or under a logging helper
instead of the code that failed.
Absolute home-directory prefixes remain redacted; only the repository-relative
application path is retained.

The frontend applies the same closed-by-default treatment while preserving one
source-map requirement: stack-frame `filename`/`abs_path` and
`debug_meta.images[].code_file` are canonicalized to matching identities such
as `app:///assets/index-a1b2c3.js`. Hosts, query strings, and local build paths
are removed, but distinct bundle filenames remain distinct so uploaded hidden
source maps can be selected unambiguously.

Log forwarders — functions whose only job is handing a message to the
application logger — are a **maintained list** in `reporter.go` (`logForwarders`).
A stack cannot say whether a function did work before logging, so they cannot be
detected structurally. The known failure mode is that a new forwarder silently
becomes the culprit for every issue its callers report; `LogRequestFailure` was
added after exactly that happened in production. When you add a helper that just
calls `applog.Error`, register it there.

The same hook also restricts `in_app` to this module's own packages. Sentry
groups only on frames the SDK associates with the application, and sentry-go
marks everything outside GOROOT as in-app — Wails, client-go, and every other
dependency in the module cache. Left alone, that ties the grouping key to
dependency internals, so upgrading a dependency would re-group unrelated issues.

Both SDKs explicitly disable automatic user info, headers, cookies, request and
response bodies, URL query parameters, GraphQL variables/documents, generative
AI input/output, database query data, and stack-frame variables. The frontend
retains five source-context lines around stack frames; the final scrubber also
sanitizes those lines. See Sentry's current
[React data-collection options](https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection)
and [Go data-collection options](https://docs.sentry.io/platforms/go/configuration/options/#DataCollection).

Reports are pseudonymous, not anonymous. A random `anonymizedId` stored in the
local settings file is the frontend Sentry user ID, allowing events and release
sessions from one installation to be counted together without an account
identity. Turning reporting off stops future transmission but does not delete
events already stored in Sentry.

## Telemetry Cadence

Installation registration, Release Health sessions, and error events are
separate Sentry signals. They must not be treated as interchangeable counts.

| Signal | When it is sent | What it measures |
| --- | --- | --- |
| `app.installation.registered` | Once per `anonymizedId`, after Sentry confirms delivery. Registration runs as cancellable background work after the Wails startup callback begins; a failed delivery is retried on a later startup. | Approximate installation count. |
| Frontend Release Health session | When the frontend page lifecycle starts: normally once per app launch, and again after a hard reload such as Factory Reset. | Successful frontend load. It is not a periodic heartbeat and does not report time spent or actions taken in the app. |
| Error event | Whenever a reportable exception crosses an owned reporting boundary while reporting is enabled. | A diagnostic failure event, independent of installation and session counts. |

After Sentry confirms a successful `app.installation.registered` flush, the
settings file records `installationMetricReported: true`. Ordinary subsequent
launches therefore do not send the metric again. Factory Reset deletes both the
old `anonymizedId` and that acknowledgement. The frontend reload creates a new
ID and a new Release Health session, while the replacement installation
registration is scheduled from the Go backend's next startup callback,
normally on the next full app launch. The new ID is then counted as a new
pseudonymous installation. Factory Reset waits for any in-flight registration,
including its acknowledgement write, before deleting settings, so that worker
cannot restore the previous ID after deletion.

The registration flush has a two-second deadline, but it never runs on the
pre-`wails.Run` initialization path and therefore cannot add that delay to app
launch. Shutdown cancellation stops an in-flight registration. Enabling error
reporting at runtime schedules the same background path rather than blocking
the settings RPC.

Release Health sessions come from the React SDK's page-lifecycle browser
session integration. They are associated with the pseudonymous user ID,
release, and environment. The Go SDK sends backend error events and the custom
installation metric, but it does not send Release Health sessions. Consequently,
0% backend adoption means that the backend project has no session population;
it does **not** mean that the backend or the release is unused. Use frontend
**Users** for active pseudonymous installations, frontend **Sessions** for
approximate app loads, and `app.installation.registered` for cumulative
installation registrations.

These sessions are Release Health data, not Session Replay. Captured exceptions
can mark a session as errored and unhandled failures can mark it as crashed, but
the page-lifecycle integration does not send a running duration or periodic
updates. See Sentry's
[Release Health documentation](https://docs.sentry.io/product/releases/health/)
and the React SDK's
[browser-session integration](https://docs.sentry.io/platforms/javascript/guides/react/configuration/integrations/browsersession/).

The final frontend and backend scrubbers remove requests, IP addresses,
hostnames, usernames, email addresses, URLs, common credentials, local home
paths, raw cluster/namespace identifiers, runtime variable values, and
unreviewed breadcrumb fields. Infrastructure identifiers become process-local
`cluster-N` and `namespace-N` aliases where correlation is useful. These
defenses apply even if a future SDK version populates a field that automatic
collection was configured not to gather. Capability breadcrumb producers also
omit raw permission keys, namespaces, and object names before the final
scrubber runs.

Only `frontend/src/core/telemetry/sentry.ts` and
`internal/sentry` may import Sentry SDKs. Biome and Go architecture
tests enforce those boundaries. New UI work should use `errorHandler`,
`ErrorSurface`, `runUserAction`, and the data-access request wrapper; those
owners create reporting context and breadcrumbs automatically.

## Cancellation Is Not a Failure

Only structured failures and string-only `ERROR` entries become Sentry issues;
lower levels are breadcrumbs. Context cancellation is an expected lifecycle
event — a panel closed, the user navigated away, a cluster disconnected, a
poller shut down — and must not be reported as a failure.

- Resource services call `LogResourceRequestFailure` or
  `LogDynamicResourceRequestFailure`, which route through
  `common.Dependencies.LogRequestFailure`, log a
  cancelled Kubernetes call at `DEBUG` and report every other original error
  through the structured path. Prefer it over formatting an error into
  `Logger.Error` so new resource kinds inherit cancellation handling and retain
  typed Kubernetes status data.
- The metrics poller treats demand-shutdown cancellation as an expected
  lifecycle event and logs intermediate retries as warnings. Metrics API absence
  is a warning rather than an exception. Other failures retain the original
  cause and stack in one error report per API during a continuous failure run;
  successful collection resets that latch.

`context.DeadlineExceeded` is deliberately still an error: a request that ran
out of time is a real problem, unlike one the app itself cancelled.

Entries from `logsources.ErrorCapture` never reach the reporter at all.
`backend/internal/errorcapture` scrapes third-party stderr — klog lines from
client-go and friends — and republishes them at whatever severity they claim.
Those are not this application failing, and their stack is the scraper rather
than any failing code, so they stay in the local application log and stop there.

## Build Configuration

Release builds read these GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `SENTRY_FRONTEND_DSN` | Embedded browser SDK DSN |
| `SENTRY_BACKEND_DSN` | Embedded Go SDK DSN |
| `SENTRY_AUTH_TOKEN` | Build-only source-map upload token |
| `SENTRY_ORG` | Source-map destination organization slug |
| `SENTRY_FRONTEND_PROJECT` | Source-map destination frontend project slug |

The Vite plugin runs only when the auth token, organization, and frontend
project are all present. It generates hidden source maps, uploads them under
`luxury-yacht@<productVersion>`, and deletes the `.map` files after upload. Never
put `SENTRY_AUTH_TOKEN` in a `VITE_` variable; Vite-prefixed values are bundled
into the webview.

The plugin is configured with `telemetry: false` and
`bundleSizeOptimizations.excludeTracing: true`. The application does not
initialize Sentry tracing, so the latter removes unused tracing code without
changing exception capture, source maps, or Release Health sessions. The
`telemetry` option defaults to
`true`, which reports the plugin's own build errors and timings to Sentry's
servers on every release build. It is about the build tool, not about
application data, and is kept off deliberately — `vite.config.test.ts` pins it.

Maintainer-only `.env`, CI secret, and publishing instructions live in
[RELEASE.md](../../RELEASE.md). Contributor and fork workflows do not require
production Sentry credentials.

There is no `SENTRY_BACKEND_PROJECT` setting. The backend SDK selects its Sentry
project from `SENTRY_BACKEND_DSN`; only the frontend source-map uploader needs a
project slug.

`mage dev` does not initialize either Sentry SDK or the source-map upload plugin.
The Wails `dev` build tag disables the backend reporter, while Vite's `serve`
command injects an empty frontend DSN and produces no Sentry release identity.
Local DSNs, source-map credentials, and the persisted Error Reporting value are
therefore ignored by the reporters and are not needed.

For a packaged backend, `SENTRY_BACKEND_DSN` can override the DSN embedded at
build time. Release identity and the `production` environment are build-owned
and have no environment-variable overrides.

The option names and lifecycle follow Sentry's current
[React SDK](https://docs.sentry.io/platforms/javascript/guides/react/),
[Go SDK](https://docs.sentry.io/platforms/go/), and
[Vite source-map](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/)
guidance.
