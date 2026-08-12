# Release Operations

This document is for maintainers with access to credentials required to create a release. Contributors and forks do not need these credentials. See [DEVELOPMENT.md](DEVELOPMENT.md) for the ordinary development workflow.

## Local Production Configuration

Create a regular `.env` file in the repository root:

```sh
cat > .env <<'EOF'
SENTRY_FRONTEND_DSN=
SENTRY_BACKEND_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_FRONTEND_PROJECT=
EOF
```

Update the values. `.env` is git-ignored. Never commit this file.

Sentry is disabled when running development builds via `mage dev`, even when
`.env` exists. Packaged builds use the application-owned collection limits and
final privacy scrubbers documented below; SDK defaults are not the privacy
contract.
See [the error-reporting architecture](docs/architecture/error-reporting.md)
for the reporting and data-collection boundaries.

Installing a local production build enables error reporting only when the
corresponding DSNs are present in `.env`. The persisted Error Reporting setting
still controls whether the packaged app initializes either SDK.

```bash
mage install:unsigned
```


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

`RELEASES_REPO_TOKEN` authorizes publishing the generated artifacts to the GitHub release.

## Publishing a Release

Run the prerelease checks. This surfaces problems that could cause the release workflow to fail:

```bash
mage qc:prerelease
```

If the release includes backend changes, run the benchmarks and compare the results with the baseline from before the change:

```bash
mage qc:benchmark
```

1. Update `info.version` in [build/config.yml](build/config.yml), then run
   `mage build-assets` to refresh platform metadata.
2. Commit and push the version change.
3. Create and push the matching tag. The `release` workflow builds and
   publishes the release:

```bash
VERSION=$(sed -nE 's/^  version: "([^"]+)"/\1/p' build/config.yml)
git tag "v${VERSION}"
git push origin main --tags
```
