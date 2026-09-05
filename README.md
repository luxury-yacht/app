# Luxury Yacht

[![Copilot](https://github.com/luxury-yacht/app/actions/workflows/agents/copilot-pull-request-reviewer/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/agents/copilot-pull-request-reviewer)
[![CodeQL](https://github.com/luxury-yacht/app/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/github-code-scanning/codeql)
[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=luxury-yacht_app&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=luxury-yacht_app)
[![Release](https://github.com/luxury-yacht/app/actions/workflows/release.yml/badge.svg)](https://github.com/luxury-yacht/app/actions/workflows/release.yml)

Luxury Yacht is a cross-platform GUI desktop app for managing Kubernetes clusters and resources.

![Screen shot of Luxury Yacht](https://luxury-yacht.app/images/screenshots/object-panel-right-dark.png)
**New to Luxury Yacht?** Check out the [Features](https://luxury-yacht.app/features) page!

**Luxury Yacht is open source and free for personal and commercial use.** No fees, no subscriptions.

## Why Luxury Yacht?

I'm a Kubernetes admin. I've tried most of the other apps in this space. None of them worked quite the way I wanted. I created Luxury Yacht to close those gaps, and make my job (and hopefully yours) a little easier.

Luxury Yacht has all the standard features of a Kubernetes management app. If you've used k9s, Lens, Headlamp, or similar apps, you know what to expect: cluster summary data, real-time metrics, workload status, detailed drilldown info, pod logs, etc.

### Highlights

Here are some of the features of Luxury Yacht that you might not find in other apps.

- **Maybe the best log viewer you've ever used.** Highlight search text. Invert your search to only show lines without the text. Use regular expressions. Show system timestamps for logs without their own timestamps, or logs that have indecipherable formats like unix epoch time. Customize the timestamp format. Show times in UTC or your local time zone. Toggle support for ASCII color codes. Make JSON logs more readable by showing them in tabular or pretty-print format.

- **Object Maps.** Visualize the relationships between objects in your clusters. View a node-level map, an namespace-level map, or drill down to specific objects.

- **Informative Cluster Overview.** See your cluster's overall utilization and latest warning events at a glance.

- **Attention View.** Quickly identify problems in your cluster. Selectively ignore issues that you don't want to be notified about, per-object, per-cluster, or globally.

- **Split-Pane Workloads View.** See workloads and their associated Pods in a single view. Highlight a specific workload to filter the view to show only that workload's pods.

- **Flexible panel layouts.** Organize your info however you like. Dock panels to the right, bottom, or float them as a resizable window. Open multiple object tabs in each panel. Drag tabs between panels. On macOS and Windows, drag a tab out to create a new floating panel; Linux drag-out is deferred for this release. On Linux, use Float to move the entire panel group into a native window.

- **Object Diff.** Can't understand why a deployment is working correctly in one cluster, but not the other? Open both deployments in the Diff Objects panel to see exactly what the differences are. Compare any kind of object to any other object, in any cluster.

- **Command Palette.** Instant access to nearly everything in the app. Open clusters, toggle settings, select a namespace, go straight to a specific object's details, change the app's appearance, and much more.

- **Favorites.** Save a view and its filter settings for quick access. Favorites can be cluster-specific, or create a generic favorite that works in any cluster.

- **Themes per cluster.** The flexible theme system allows you to assign colors to specific clusters or patterns in cluster names. Assign your dev clusters a blue theme, and your prod clusters a red theme, so you can instantly know when you're working in production. And, of course, you can have light and dark versions of your themes.

- **Zero-touch setup.** Luxury Yacht automatically parses your existing kubeconfig files. If your kubeconfig works in any other app, it will work in Luxury Yacht. It automatically scans the default `~/.kube` location, but can be configured to scan any directory.

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

Luxury Yacht uses GTK4 and WebKitGTK 6.0. Installation will vary depending on your distro.

| Distro      | Installation                                           |
| ----------- | ------------------------------------------------------ |
| Ubuntu 24.04 | `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4`      |
| Debian 13    | `sudo apt install libgtk-4-1 libwebkitgtk-6.0-4`      |

If your distro isn't on this (admittedly short) list, you'll have to search your package manager to determine the exact package name. If you have info you'd like to add to this list, email [admin@luxury-yacht.app](mailto:admin@luxury-yacht.app) or open an issue.
