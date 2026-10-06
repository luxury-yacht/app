---
name: draft-release-notes
description: Generate release notes from git log since last tag, following [Keep a Changelog](https://keepachangelog.com) and project conventions
---

# Release Notes

Draft the unreleased notes in `docs/release/pending.md` from commits since the
last tag. `cmd/project/release.go` inserts that file verbatim below the
`## Release` / `## Beta Release` heading and version lines from
`docs/release/template.md`, so the file holds only category sections and
bullets: no version, date, or release heading.

## Usage

`/draft-release-notes [<from-tag> [<to-ref>]]` — the range defaults to the
latest tag (`git tag --sort=-v:refname | head -1`) through `HEAD`.

## Steps

1. **Read the current notes.** Compare `docs/release/pending.md` with
   `git show <from-tag>:docs/release/pending.md`. Identical content is the
   already-tagged release: start a fresh file. Otherwise the entries are
   unreleased: keep their wording and merge into them.
2. **Read commits.** Run `git log <range> --oneline --no-merges`, plus
   `git log <range> --oneline --merges` for PR merge commits (they carry the PR
   title and number). For unclear messages, run `git show <sha> --stat` and
   read key files to understand the user-visible effect.
3. **Categorize** with Keep a Changelog types, in this order and only when a
   category has entries: **Added** (new features, UI elements, capabilities),
   **Changed** (existing functionality, UX, behavior), **Deprecated** (marked
   for future removal), **Removed** (deleted features), **Fixed** (bugs,
   stability), **Security** (vulnerabilities, auth).
4. **Merge** each item into its section: fold it into an existing area bullet
   as a sub-bullet, or tighten that bullet, before adding a new one. Never
   duplicate an entry already present.
5. **Write** `docs/release/pending.md` and show the diff. If the update rewrites
   or removes existing unreleased entries rather than only adding, show the
   proposed file and wait for approval before writing.

```markdown
### Added

- Area or feature with a short summary
  - Notable detail
  - Notable detail

### Changed

- Short description of the change

### Fixed

- Short description of the fix
```

## Writing Style

- **Write for users skimming what changed.** "Favorites save views with their
  filters", not "implement fav persistence layer with JSON serialization."
- **Lead with the feature or area name.** "Rollback for Deployments,
  DaemonSets, and StatefulSets", not "Added a new modal that lets you roll
  back."
- **Group by area.** A plain lead bullet names the area; two-space-indented
  sub-bullets give specifics. Keep each bullet to one short sentence; no
  paragraph-length entries.
- **Group related fixes** from one effort under one bullet ("Pod logs viewer
  is more reliable").
- **Section headings are `###` Markdown headings** (`### Added`); do not bold
  category or area names.
- **Leave out** PR numbers and commit hashes, version bumps, merge commits,
  CI/build-only and internal changes without a user-visible effect, cosmetic
  details (spacing, icon sizes), and fixes to features that are new in these
  same unreleased notes.
- **Deprecated, Removed, and Security** appear only with entries, but never
  omit them when they have entries: deprecations, removals, and breaking
  changes are the most important things to document.
