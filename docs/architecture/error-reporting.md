# Error Reporting

Luxury Yacht uses Sentry Cloud for frontend and backend error reporting in
packaged builds. Reporting is available only when the corresponding DSN is
configured, and users can turn both reporters off under **Settings → Data
Management → Telemetry**. Development builds disable both SDKs even when Sentry
environment variables are present.

## Runtime Behavior

The integration uses Sentry's native event processing and default integrations:

- `frontend/src/core/telemetry/sentry.ts` initializes `@sentry/react` after the
  persisted preference has loaded. React 19 root handlers and Sentry's default
  browser integrations capture frontend failures. The default browser-session
  integration also sends release-health sessions while reporting is enabled.
- `internal/sentryreporting` initializes `sentry-go`, forwards exceptions and
  panics, and owns the runtime enable/disable and shutdown lifecycle.
- `backend/logger.go` forwards every backend `ERROR` log entry with its original
  message. The event scope includes the log source and `clusterId` when present;
  lower log levels remain in the local application log.
- `backend/app_settings.go` persists `errorReportingEnabled` and switches the
  backend reporter only after the setting write succeeds.
- `frontend/vite.config.ts` owns release identity and frontend source-map upload.

Neither reporter uses an application-defined `beforeSend` hook, event
allowlist, message replacement, custom fingerprint, or custom error
classification. Sentry receives the original error message, exception type,
stack trace, breadcrumbs, SDK contexts, and other data gathered by its default
integrations.

Both SDKs opt into their current `dataCollection` defaults with an empty
configuration object. These defaults collect rich debugging context and use
Sentry's built-in sensitive-key denylist; Luxury Yacht does not add another
redaction layer. See Sentry's current
[React data-collection options](https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection)
and [Go data-collection options](https://docs.sentry.io/platforms/go/configuration/options/#DataCollection).

Reports are not anonymous. Depending on the failure and SDK context, data can
include cluster IDs, cluster and Kubernetes object names, namespaces, URLs,
request headers or bodies, query parameters, local paths, breadcrumbs, device
and runtime details, user information, and IP addresses. Do not attach secrets
to errors or Sentry scope data.

The metrics poller still treats demand-shutdown cancellation as an expected
lifecycle event and logs intermediate retries as warnings. A terminal metrics
failure is logged once at `ERROR`, so the backend reporter receives the full
terminal message without paying for each retry.

Turning Error Reporting off closes both SDK clients. The Go reporter discards
its buffered transport without flushing during opt-out. Normal application
shutdown gets a bounded flush while reporting remains enabled.

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
