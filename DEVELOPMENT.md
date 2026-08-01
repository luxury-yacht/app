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
2. Prefix each tool managed by Mise with `mise exec --` (for example `mise exec -- mage dev`).

### Install the Toolchain

From the repository root, install the tool versions from `mise.toml`:

```shell
mise install
```

Next, check the platform dependencies required by Wails:

```shell
wails doctor
```

This will print a list of dependencies for Wails. You must install at least the required dependencies.

Luxury Yacht uses [Mage](https://magefile.org/) for cross-platform development commands. Mage is similar to `make`, but is written in Go, so will work the same across all platforms. To see what `mage` targets are available, run `mage -l` in the repo root.

## Development Mode

The fastest way to get the app up and running for development is to run in Wails development mode. This gives you hot-reloads and access to the browser console for debugging.

```bash
mage dev
```

Note that hot-reload of the Go backend will cause the app to restart, while changes to frontend code will be reflected immediately without an app restart.

## Storybook

[Storybook](https://storybook.js.org/) is available for developing and previewing UI components in isolation.

Run `mise install` first so Storybook uses the canonical Node and npm versions.

```bash
mage storybook
```

This starts the Storybook dev server at [http://localhost:6006](http://localhost:6006).

## Build

```bash
mage build
```

## Install

To install the app locally:

```bash
mage install:unsigned
```

## Versions

The app version and development-tool versions have separate canonical sources. Scripts and workflows must read these sources rather than resolving versions dynamically.

### App Version

App version is derived from `info.productVersion` in [wails.json](wails.json)

```bash
APP_VERSION=$(jq -r '.info.productVersion' wails.json)
```

### Toolchain Versions

All Mise-managed development-tool versions are canonical in the `[tools]` section of [mise.toml](mise.toml). The Windows-only NSIS version is canonical in that file's `[vars]` section, and CI consumes the config directly.

```bash
mise config get tools.go
mise config get tools.node
mise config get tools.trivy
```

The Go directive and Mage/Wails requirements in `go.mod` and the Node/npm metadata in `frontend/package.json` are compatibility mirrors. `go test ./mage` checks that they match `mise.toml`.

## Maintainer Documentation

Project maintainers can find production configuration and publishing steps in
[RELEASE.md](RELEASE.md).
