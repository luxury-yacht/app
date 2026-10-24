# Code signing policy

## What is signed

### macOS

The macOS app is signed with a Developer ID certificate that Apple issues
through the Apple Developer Program, then notarized by Apple. Both steps run in
the same [Release workflow](.github/workflows/release.yml) on GitHub-hosted
runners. Before packaging the app into the DMG and the updater archive, the
workflow verifies the signature, confirms that Gatekeeper accepts the app, and
validates the stapled notarization ticket. macOS signing has no separate
approval step.

### Windows

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

The Windows executables and installers attached to
[GitHub Releases](https://github.com/luxury-yacht/app/releases) are built from
this repository by the [Release workflow](.github/workflows/release.yml) on
GitHub-hosted runners, then signed through SignPath. An approver listed below
manually approves every release signing request.

## Team roles

- Committers and reviewers: [John Jeffers](https://github.com/johnjeffers)
- Approvers: [John Jeffers](https://github.com/johnjeffers)

Changes from anyone other than a committer arrive as pull requests and are
reviewed before merging.

## Privacy

See the [Luxury Yacht privacy policy](PRIVACY.md).
