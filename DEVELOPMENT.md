# Development

## Prerequisites

Luxury Yacht uses [Mise](https://mise.jdx.dev/) to manage toolchain versions and installs. Follow the instructions on Mise's page to install Mise on your platform.

### Activate Mise

Add the activation command for your shell to its startup file. This is a one-time setup that makes the tool versions from `mise.toml` available whenever you enter the repository.

| Shell      | Startup file                 | Command                                                      |
| ---------- | ---------------------------- | ------------------------------------------------------------ |
| Zsh        | `~/.zshrc`                   | `eval "$(mise activate zsh)"`                                |
| Bash       | `~/.bashrc`                  | `eval "$(mise activate bash)"`                               |
| Fish       | `~/.config/fish/config.fish` | `mise activate fish \| source`                               |
| PowerShell | `$PROFILE`                   | `(&mise activate pwsh) \| Out-String \| Invoke-Expression`   |

Open a new terminal after saving the startup file.

#### Using Mise Without Modifying Your Shell

If you don't want to change your shell configuration, you have two options

1. Manually run the shell command in the table above prior to starting development work.
2. Prefix each tool managed by Mise with `mise exec --` (for example `mise exec -- wails3 dev`).

### Install the Toolchain

From the repository root, install the tool versions from `mise.toml`:

```shell
mise install
```

Next, check the platform dependencies required by Wails:

```shell
wails3 doctor
```

This will print a list of dependencies for Wails. You must install at least the required dependencies.

Wails v3 owns the complete project task graph, including development, builds,
packaging, quality checks, tests, cleanup, Storybook, and release publication.
Run `wails3 task -list` to inspect the command surface.

## Development Mode

The fastest way to get the app up and running for development is to run in Wails development mode. This gives you hot-reloads and access to the browser console for debugging.

```bash
wails3 dev
```

Note that hot-reload of the Go backend will cause the app to restart, while changes to frontend code will be reflected immediately without an app restart.

## Storybook

[Storybook](https://storybook.js.org/) is available for developing and previewing UI components in isolation.

Run `mise install` first so Storybook uses the canonical Node and npm versions.

```bash
wails3 task storybook
```

This starts the Storybook dev server at [http://localhost:6006](http://localhost:6006).

## Build

```bash
wails3 build
```

## Package

Create the platform-native app bundle, installer, and/or packages under `bin/`:

```bash
wails3 package
```

Use the generated artifact appropriate for the host platform. During active
development, use `wails3 dev` instead of installing a package.

## Install an Unsigned Local Build

Build and install a local copy without Developer ID signing, notarization, or
package signing:

```bash
wails3 task install:unsigned
```

The task installs to `/Applications` on macOS, `~/.local/bin` on Linux, and the
current user's `Programs` directory on Windows.

## Build the Linux Portable Distribution

On Linux, build the production binary once and then package that existing
binary for portable installation and automatic updates:

```bash
wails3 task linux:build ARCH=amd64
wails3 task linux:generate:portable ARCH=amd64
```

Use `ARCH=arm64` for the ARM release. The command writes two versioned archives
under `bin/`: a manual `-portable.tar.gz` installer and a single-binary
`.tar.gz` updater payload. Validate the updater archive through Wails with:

```bash
UPDATER_ARTIFACT=bin/luxury-yacht-<version>-linux-amd64.tar.gz \
GOARCH=amd64 wails3 task release:validate-linux-updater
```

The manual install defaults to
`${XDG_DATA_HOME:-$HOME/.local/share}/luxury-yacht`. It is distinct from the
developer-only unsigned install task above.

## Versions

The app version and development-tool versions have separate canonical sources. Scripts and workflows must read these sources rather than resolving versions dynamically.

### App Version

App version is derived from `info.version` in [build/config.yml](build/config.yml).

```bash
APP_VERSION=$(sed -nE 's/^  version: "([^"]+)"/\1/p' build/config.yml)
```

### Toolchain Versions

All Mise-managed development-tool versions are canonical in the `[tools]` section of [mise.toml](mise.toml). The Windows-only NSIS version is canonical in that file's `[vars]` section, and CI consumes the config directly.

```bash
mise config get tools.go
mise config get tools.node
mise config get tools.trivy
```

The Go directive and Wails requirement in `go.mod` and the Node/npm metadata in
`frontend/package.json` are compatibility mirrors. Tests in
`cmd/project` check that they match `mise.toml`.

### Wails Version and Binding Contract

The Wails CLI version in `mise.toml` is canonical. The backend module version in
`go.mod` and `@wailsio/runtime` version in `frontend/package.json` must match it.
Before changing Wails, review the selected release's migration notes, then
update the canonical pin and both mirrors together. Do not resolve any of these
dependencies through `latest`.

Generate committed TypeScript bindings with:

```bash
wails3 generate bindings -ts -i -d frontend/bindings -clean -time-type string -names ./...
```

The project contract uses TypeScript interfaces, string timestamps, and named
calls. Run `wails3 task qc:bindings` to regenerate those bindings in isolation
and reject any drift from `frontend/bindings`.

## Maintainer Documentation

Project maintainers can find production configuration and publishing steps in
[RELEASE.md](RELEASE.md).
