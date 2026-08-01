# Error Reporting

Luxury Yacht supports anonymous, errors-only reporting to Sentry from both the
React webview and Go backend. Packaged builds enable it by default when the
corresponding DSN is present. Users can disable both reporters with **Error
Reporting** under **Settings → Data Management**. The integration
does not enable tracing, replay, metrics, or Sentry logs. Development builds
disable both SDKs even when Sentry environment variables are present.
The frontend also removes Sentry's default browser-session integration, so
enabling error reporting does not emit Release Health sessions when no error
occurs.

## Ownership

- `frontend/src/core/telemetry/sentry.ts` owns browser SDK initialization and
  React 19 root error handlers. It starts disabled until persisted preferences
  have loaded, then follows live preference changes.
- `internal/sentryreporting` owns the Go SDK client, payload sanitizer, runtime
  enable/disable switch, and shutdown flush.
- `backend/logger.go` forwards backend `ERROR` entries. Cluster identity remains
  available to the app's local logging path but is removed at the external
  reporting boundary; lower log levels remain local.
- `backend/app_settings.go` persists `errorReportingEnabled` and switches the
  backend reporter only after the setting write succeeds.
- `frontend/vite.config.ts` owns release identity and source-map upload.

## Anonymous Event Contract

Both SDKs disable automatic user, cookie, request/response header, body, query
parameter, database-query, generative-AI, and stack-variable collection where
those options apply. A final `beforeSend` sanitizer constructs a new event from
an allowlist, so fields added by SDK integrations or future SDK versions are
excluded unless the application explicitly approves them:

- the random event ID, event timestamp, app release, production environment,
  severity, and SDK platform;
- generic `Frontend error` or `Backend error` text;
- allowlisted JavaScript built-in exception classes or a normalized
  compile-time Go error type;
- handled/synthetic flags and numeric exception-chain relationships, without
  free-form mechanism descriptions or data;
- frontend exception stacks with an anonymized bundle basename, line, column,
  in-app status, and source-map debug ID; raw function/module strings are
  excluded and source maps recover the build-owned source names;
- backend exception/log call-site stacks with compile-time function/module
  names, source-file basename, line, column, and in-app status; and
- static tags identifying the frontend or backend app surface, plus an
  allowlisted backend subsystem such as `Refresh` or `Auth`.

The sanitizer removes original error messages, arbitrary exception and
mechanism strings, cluster IDs, Kubernetes data, users, request data, URLs,
local paths, breadcrumbs, runtime contexts, variables, attachments, thread
IDs/names, device/server names, full user agents, and custom fingerprints. Tests
serialize representative frontend and backend events, assert their approved
top-level field sets, and reject planted email addresses, IP addresses, cluster
IDs, local paths, host names, and secrets.

For both Sentry Cloud projects, maintainers must also enable **Prevent Storing
of IP Addresses** in **Project Settings → Security & Privacy**. Sentry exposes
this project option as `scrubIPAddresses`; the current
[project API documentation](https://docs.sentry.io/api/projects/retrieve-a-project/)
reports whether it is enabled. This cloud-side setting is a release prerequisite
because an application cannot hide the source address of a direct network
connection from its destination.

Turning Error Reporting off closes both SDK clients. The Go reporter discards
its buffered transport without flushing during opt-out. Normal application
shutdown still gets a bounded flush while reporting remains enabled.

## Build Configuration

Release builds read exactly these GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `SENTRY_FRONTEND_DSN` | Embedded browser SDK DSN |
| `SENTRY_BACKEND_DSN` | Embedded Go SDK DSN |
| `SENTRY_AUTH_TOKEN` | Build-only source-map upload token |
| `SENTRY_ORG` | Source-map destination organization slug |
| `SENTRY_FRONTEND_PROJECT` | Source-map destination frontend project slug |

The Vite plugin runs only when the auth token, organization, and project are all
present. It generates hidden source maps, uploads them under
`luxury-yacht@<productVersion>`, and deletes the `.map` files after upload. Never
put `SENTRY_AUTH_TOKEN` in a `VITE_` variable; Vite-prefixed values are bundled
into the webview.

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
build time. Release identity and the `production` environment are owned by the
build and have no environment-variable overrides.

The option names and lifecycle follow Sentry's current
[React SDK](https://docs.sentry.io/platforms/javascript/guides/react/),
[Go SDK](https://docs.sentry.io/platforms/go/), and
[Vite source-map](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/)
guidance.
