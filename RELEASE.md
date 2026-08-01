# Release Operations

This document is for project maintainers who have access to the production
Sentry projects, signing credentials, and GitHub Actions secrets. Contributors
and forks do not need these credentials; use [DEVELOPMENT.md](DEVELOPMENT.md)
for the ordinary development workflow.

## Local Production Configuration

Create the ignored repository-root `.env` file from the provided template:

```bash
cp .env.example .env
```

Set all five values:

```dotenv
SENTRY_FRONTEND_DSN=
SENTRY_BACKEND_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_FRONTEND_PROJECT=
```

The frontend and backend DSNs select the projects that receive runtime events.
The auth token, organization slug, and frontend project slug are build-only
credentials for frontend source-map upload. Do not commit `.env`; Mage loads it
automatically, and variables already exported by the shell take precedence.

To exercise a production build and install it locally without signing:

```bash
mage install:unsigned
```

Sentry remains disabled when running `mage dev`, even when `.env` exists. See
[the error-reporting architecture](docs/architecture/error-reporting.md) for
the reporting and data-collection boundaries.

## GitHub Actions Configuration

The release workflow reads these repository Actions secrets for Sentry:

| Secret | Purpose |
| --- | --- |
| `SENTRY_FRONTEND_DSN` | Frontend runtime event destination |
| `SENTRY_BACKEND_DSN` | Backend runtime event destination |
| `SENTRY_AUTH_TOKEN` | Frontend source-map upload authentication |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_FRONTEND_PROJECT` | Frontend Sentry project slug |

The signed macOS build additionally reads:

| Secret | Purpose |
| --- | --- |
| `MACOS_CERTIFICATE` | Base64-encoded signing certificate |
| `MACOS_CERTIFICATE_PWD` | Signing certificate password |
| `APPLE_ID` | Apple account used for notarization |
| `APPLE_APP_PASSWORD` | App-specific Apple password |
| `APPLE_TEAM_ID` | Apple developer team identifier |

`RELEASES_REPO_TOKEN` authorizes publishing the generated artifacts to the
GitHub release.

## Publishing a Release

Run the prerelease checks. This surfaces problems that could cause the release
workflow to fail:

```bash
mage qc:prerelease
```

If the release includes backend changes, run the benchmarks and compare the
results with the baseline from before the change:

```bash
mage qc:benchmark
```

1. Update `info.productVersion` in [wails.json](wails.json).
2. Commit and push the version change.
3. Create and push the matching tag. The `release` workflow builds and
   publishes the release:

```bash
git tag $(jq -r '.info.productVersion' wails.json)
git push origin main --tags
```
