# Luxury Yacht

[![Copilot](https://github.com/luxury-yacht/app/actions/workflows/agents/copilot-pull-request-reviewer/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/agents/copilot-pull-request-reviewer)
[![CodeQL](https://github.com/luxury-yacht/app/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/github-code-scanning/codeql)
[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=luxury-yacht_app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=luxury-yacht_app)
[![Release](https://github.com/luxury-yacht/app/actions/workflows/release.yml/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/release.yml)

Luxury Yacht is a cross-platform GUI desktop app for managing Kubernetes clusters and resources.

![Screen shot of Luxury Yacht](https://luxury-yacht.app/images/screenshots/object-panel-right-dark.png)
**New to Luxury Yacht?** Check out the [Features](https://luxury-yacht.app/features) page!

**Luxury Yacht is open source and free for personal and commercial use.** No fees, no subscriptions, no telemetry.

## Why Luxury Yacht?

I'm a Kubernetes admin. I've tried most of the other apps in this space. None of them worked quite the way I wanted. I created Luxury Yacht to close those gaps, and make my job (and hopefully yours) a little easier.

Luxury Yacht has all the standard features of a Kubernetes management app. If you've used k9s, Lens, Headlamp, or similar apps, you know what to expect: cluster summary data, real-time metrics, workload status, detailed drilldown info, pod logs, etc.

### Highlights

Here are some of the features of Luxury Yacht that you might not find in other apps.

- **Maybe the best log viewer you've ever used.** Highlight search text. Invert your search to only show lines without the text. Use regular expressions. Show system timestamps for logs without their own timestamps, or logs that have indecipherable formats like unix epoch time. Customize the timestamp format. Show times in UTC or your local time zone. Toggle support for ASCII color codes. Make JSON logs more readable by showing them in tabular or pretty-print format.

- **Object Maps.** Visualize the relationships between objects in your clusters. View a node-level map, an namespace-level map, or drill down to specific objects.

- **Flexible panel layouts.** Organize your info however you like. Dock panels to the right, bottom, or float them as a resizable window. Open multiple object tabs in each panel. Drag tabs between panels, or drag out to create a new floating panel.

- **Object Diff.** Can't understand why a deployment is working correctly in one cluster, but not the other? Open both deployments in the Diff Objects panel to see exactly what the differences are.

- **Command Palette.** Instant access to nearly everything in the app. Open clusters, toggle settings, select a namespace, go straight to a specific object's details, change the app's appearance, and much more.

- **Favorites.** Save a view (and its filters) as a favorite for quick access. Favorites can be cluster-specific, or create a generic favorite that works in any cluster.

- **Themes per cluster.** The flexible theme system allows you to assign colors to specific clusters or patterns in cluster names. Assign your dev clusters a blue theme, and your prod clusters a red theme, so you can instantly know when you're working in production. And, of course, you can have light and dark versions of your themes.

- **Zero-touch setup.** Luxury Yacht uses your existing kubeconfig files. It reads `~/.kube` and loads your clusters into a dropdown menu. Select a cluster from the dropdown to get started. Open Settings to add or change which directories Luxury Yacht scans for kubeconfig files.

- **Node maintenance.** Cordon, drain, and delete nodes with ease.

- **Simple port forwarding.** Right-click on a workload, pod, or service and click Port Forward. Select a port and click Start. That's it. Run multiple port forwards simultaneously, and easily track them in a centralized status console.

- **Shell support with debug containers.** Of course you expect to be able to get a shell in a container, but what if the container doesn't support shell access? Luxury Yacht gives you a simple way to start an ephemeral debug container in that pod, attached to the container.

## Installation

### Direct Downloads

Visit [Downloads](https://luxury-yacht.app/#downloads) on the web site, or go to the [Releases](https://github.com/luxury-yacht/app/releases) page if you know exactly what you need.

### Package Managers

Package manager support is currently limited, but more will be added.

#### Homebrew (macOS only)

```sh
brew install luxury-yacht
```

### Building from Source

If you prefer to build the app from source, see the Development section.

### Troubleshooting

#### The app won't start on Linux

Luxury Yacht requires webkit2 4.1. Some distros don't include it, or don't install it by default. Installation will vary depending on your distro.

| Distro       | Installation                           |
| ------------ | -------------------------------------- |
| Ubuntu 20.04 | Unsupported                            |
| Ubuntu 22.04 | `sudo apt install libwebkit2gtk-4.1-0` |

If your distro isn't on this (admittedly short) list, you'll have to search your package manager to determine the exact package name. If you have info you'd like to add to this list, email [admin@luxury-yacht.app](mailto:admin@luxury-yacht.app) or open an issue.

## Development

### Prerequisites

- [Mise](https://mise.jdx.dev/)
- The platform dependencies reported by `wails doctor`

#### Activate Mise

Add the activation command for your shell to its startup file. This is a one-time setup that makes the tool versions from `mise.toml` available whenever you enter the repository.

| Shell      | Startup file                 | Command.                                                     |
| ---------- | ---------------------------- | ------------------------------------------------------------ |
| Zsh        | `~/.zshrc`                   | `eval "$(mise activate zsh)"`                                |
| Bash       | `~/.bashrc`                  | `eval "$(mise activate bash)"`                               |
| Fish       | `~/.config/fish/config.fish` | `mise activate fish \| source`                               |
| PowerShell | `$PROFILE`                   | `(&mise activate pwsh) \| Out-String \| Invoke-Expression`   |

Open a new terminal after saving the startup file.

If you don't want to change your shell configuration,  prefix each repository command with `mise exec --`, for example `mise exec -- mage dev`.

#### Install the Toolchain

From the repository root, install the pinned Go, Node, npm, Wails, Mage, Staticcheck, and Trivy versions from `mise.toml`, then check the platform dependencies required by Wails:

```shell
mise install
wails doctor
```

Luxury Yacht uses [Wails](https://wails.io/) for the desktop app and [Mage](https://magefile.org/) for cross-platform development commands.
To see what `mage` targets are available, run `mage -l` in the repo root.

### Development Mode

The fastest way to get the app up and running for development is to run in Wails development mode. This gives you hot-reloads and access to the browser console for debugging.

```bash
mage dev
```

Note that hot-reload of the Go backend will cause the app to restart, while changes to frontend code will be reflected immediately without an app restart.

### Storybook

[Storybook](https://storybook.js.org/) is available for developing and previewing UI components in isolation.

Run `mise install` first so Storybook uses the canonical Node and npm versions.

```bash
mage storybook
```

This starts the Storybook dev server at [http://localhost:6006](http://localhost:6006).

### Build

```bash
mage build
```

### Install

To install the app locally:

```bash
mage install:unsigned
```

## Versions

The app version and development-tool versions have separate canonical sources. Scripts and workflows must read these sources rather than resolving versions dynamically.

#### App Version

App version is derived from `info.productVersion` in [wails.json](wails.json)

```bash
APP_VERSION=$(jq -r '.info.productVersion' wails.json)
```

#### Toolchain Versions

All Mise-managed development-tool versions are canonical in the `[tools]` section of [mise.toml](mise.toml). The Windows-only NSIS version is canonical in that file's `[vars]` section, and CI consumes the config directly.

```bash
mise config get tools.go
mise config get tools.node
mise config get tools.trivy
```

The Go directive and Mage/Wails requirements in `go.mod` and the Node/npm metadata in `frontend/package.json` are compatibility mirrors. `go test ./mage` checks that they match `mise.toml`.

## Publishing Releases

Run the prerelease checks. This should surface any problems that could cause the release to fail.

```bash
mage qc:prerelease
```

You should also run the benchmark tests if you're going to make changes to the backend code. Compare the numbers before and after your change to make sure you haven't introduced any major performance hits.

```bash
mage qc:benchmark
```

1. Update the version in [wails.json](wails.json)

1. Commit and push the change.

1. Create and push a tag. The `release` workflow will do the rest.

```bash
git tag $(jq -r '.info.productVersion' wails.json)
git push origin main --tags
```
