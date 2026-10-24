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

Sentry is disabled when running development builds via `wails3 dev`, even when
`.env` exists. Packaged builds use the application-owned collection limits and
final privacy scrubbers documented below; SDK defaults are not the privacy
contract.
See [the error-reporting architecture](docs/architecture/error-reporting.md)
for the reporting and data-collection boundaries.

Packaging a local production build enables error reporting only when the
corresponding DSNs are present in `.env`. The persisted Error Reporting setting
still controls whether the packaged app initializes either SDK. Platform-native
artifacts are written to `bin/`.

```bash
wails3 package
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

The signed Windows build additionally reads:

| Secret | Purpose |
| --- | --- |
| `SIGNPATH_API_TOKEN` | API token of the SignPath user that submits signing requests |
| `SIGNPATH_ORGANIZATION_ID` | SignPath organization identifier |

The [SignPath GitHub App](https://github.com/apps/signpath) must be installed
on the `luxury-yacht` organization with access to this repository; the signing
step fails with "Failed to retrieve GitHub App token" without it.
The SignPath project `app` must have the `windows-exe` and
`windows-installers` artifact configurations and the `test-signing` and
`release-signing` policies. Dry runs use `test-signing`; tag pushes and checked
release dispatches use `release-signing`, which needs approval in SignPath for
each executable and installer signing request. See
[CODE_SIGNING.md](CODE_SIGNING.md).

`RELEASES_REPO_TOKEN` authorizes publishing the generated artifacts to the GitHub release.

## Testing Release Workflow Changes

A manual **Release** run is a dry run unless **Create GitHub release** is
checked. For faster feedback, a dry run can skip the test job and uncheck any
of the **Build macOS**, **Build Windows**, and **Build Linux** checkboxes. Each
platform builds amd64 and arm64 side by side. Release preparation needs every
platform, so a run with fewer platforms stops after building. A published
release always runs the tests and builds every platform.

The platform checkboxes default to checked, so from the command line pass
`false` for the platforms to skip. This runs only the Windows builds:

```bash
gh workflow run release.yml --ref <branch> -f skip_tests=true \
  -f build_macos=false -f build_linux=false
```

## Publishing a Release

Run the prerelease checks. This surfaces problems that could cause the release workflow to fail:

```bash
wails3 task qc:prerelease
```

If the release includes backend changes, run the benchmarks and compare the results with the baseline from before the change:

```bash
wails3 task qc:benchmark
```

1. Update `info.version` in [build/config.yml](build/config.yml), then run
   `wails3 task common:update:build-assets` to refresh platform metadata. The
   upstream updater overwrites generated build assets, so review the resulting
   diff and retain the repository's interface-binding, desktop-only, GTK4-only,
   metadata, and packaging choices before committing.
2. Commit and push the version change.
3. Create and push the matching tag. The `release` workflow builds and
   publishes the release:

```bash
VERSION=$(sed -nE 's/^  version: "([^"]+)"/\1/p' build/config.yml)
git tag "${VERSION}"
git push origin main --tags
```
