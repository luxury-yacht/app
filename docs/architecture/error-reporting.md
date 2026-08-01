# Error Reporting

Luxury Yacht supports optional, errors-only reporting to Sentry from both the
React webview and Go backend. Reporting stays disabled when its DSN is empty.
The integration does not enable tracing, replay, metrics, or Sentry logs.
Development builds disable both SDKs even when Sentry environment variables are
present.

## Ownership

- `frontend/src/core/telemetry/sentry.ts` owns browser SDK initialization and
  React 19 root error handlers.
- `internal/sentryreporting` owns the Go SDK client, event context, and shutdown
  flush.
- `backend/logger.go` forwards backend `ERROR` entries. Cluster-scoped entries
  retain `clusterId`; lower log levels remain local.
- `frontend/vite.config.ts` owns release identity and source-map upload.

Both SDKs disable automatic user, cookie, request/response header, body, query
parameter, database-query, generative-AI, and stack-variable collection. Browser
breadcrumbs are also disabled. Explicit application error messages and the
backend `source`/`clusterId` tags are still sent when reporting is enabled.

## Build Configuration

Release builds read these GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `SENTRY_FRONTEND_DSN` | Embedded browser SDK DSN |
| `SENTRY_BACKEND_DSN` | Embedded Go SDK DSN |
| `SENTRY_AUTH_TOKEN` | Build-only source-map upload token |
| `SENTRY_ORG` | Source-map destination organization slug |
| `SENTRY_FRONTEND_PROJECT` | Source-map destination project slug |

The Vite plugin runs only when the auth token, organization, and project are all
present. It generates hidden source maps, uploads them under
`luxury-yacht@<productVersion>`, and deletes the `.map` files after upload. Never
put `SENTRY_AUTH_TOKEN` in a `VITE_` variable; Vite-prefixed values are bundled
into the webview.

`mage dev` does not initialize either Sentry SDK or the source-map upload plugin.
The Wails `dev` build tag disables the backend reporter, while Vite's development
mode disables the frontend reporter and produces no Sentry release identity.
Local DSNs and source-map credentials are therefore ignored and not needed.

For a packaged backend, `SENTRY_DSN`, `SENTRY_RELEASE`, and
`SENTRY_ENVIRONMENT` can override embedded defaults at launch.

The option names and lifecycle follow Sentry's current
[React SDK](https://docs.sentry.io/platforms/javascript/guides/react/),
[Go SDK](https://docs.sentry.io/platforms/go/), and
[Vite source-map](https://docs.sentry.io/platforms/javascript/guides/react/sourcemaps/uploading/vite/)
guidance.
