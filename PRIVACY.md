# Privacy policy

Last updated: 2026-10-13

Luxury Yacht is a desktop app. It has no accounts, and your settings and
cluster data stay on your computer. This policy describes every case in which
the app sends data over the network.

## Your Kubernetes clusters

The app connects to the clusters in your kubeconfig files when you use them,
with the credentials and authentication plugins your kubeconfig configures.
Data you view or change in those clusters goes only between your computer and
the cluster.

## Update checks

At startup and every six hours, the app checks GitHub for the latest Luxury
Yacht release. These requests don't include your installation ID or anything
about your clusters. Updates are downloaded and installed only when you choose
to.

## Error reporting

Official release builds send diagnostics to [Sentry](https://sentry.io) to
help find and fix problems in Luxury Yacht. Error reporting is on by default.
Turn it off in **Settings → Data Management → Telemetry → Error Reporting**.

Before any data is sent, the app removes IP addresses, hostnames, usernames,
email addresses, URLs, common credential formats, home-directory paths,
cluster and namespace names, Kubernetes object names, and request contents.

The only piece of user data that is not pseudonymized is the IP address that
makes the connection to Sentry. Like any web service, Sentry sees the IP
address of the connection. See the [Sentry Privacy Policy](https://sentry.io/privacy/).

When error reporting is enabled, the app sends:

- **Error reports:** the error type and stack trace, recent app log messages,
  the app version, your operating system and CPU architecture, the operation
  that failed, and Kubernetes error details such as status codes and field
  paths.
- **Installation and upgrade counts:** one message when the app first reports,
  and one each time it runs a newer version, containing the version numbers,
  your operating system, and CPU architecture.
- **App-launch sessions:** one each time the app starts, used to count how
  often a release starts without errors.

Some error reports and every app-launch session include a random installation
ID that is generated on your computer and not derived from your hardware or
identity. **Settings → Advanced → Factory Reset** deletes the ID; the app
generates a new one afterward.

## Data stored on your computer

Settings, favorites, saved view state, and update status are stored in your
user configuration and cache directories. **Settings → Advanced → Factory
Reset** deletes them.

## Windows installer

If the Microsoft Edge WebView2 Runtime isn't installed, the Windows installer
runs Microsoft's WebView2 installer, which downloads the runtime from
Microsoft. See the
[Microsoft Privacy Statement](https://www.microsoft.com/privacy/privacystatement).

## Changes and contact

Changes to this policy are recorded in this file's history. Questions:
[admin@luxury-yacht.app](mailto:admin@luxury-yacht.app).
