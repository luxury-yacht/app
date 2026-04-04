---
name: draft-release-notes
description: Generate release notes from git log since last tag, following [Keep a Changelog](https://keepachangelog.com) and project conventions
---

# Release Notes

Generate formatted release notes by reading commits since the last git tag.

## Usage

`/draft-release-notes` — generate notes from the last tag to HEAD
`/release-notes <from-tag>` — generate notes from a specific tag to HEAD
`/release-notes <from-tag> <to-tag>` — generate notes between two tags

## Steps

1. **Determine range.** If no arguments, find the latest tag with `git tag --sort=-v:refname | head -1` and use `<latest-tag>..HEAD`. If arguments provided, use those.

2. **Read commits.** Run `git log <range> --oneline --no-merges` to get the commit list. Also run `git log <range> --oneline --merges` to capture PR merge commits (these have the PR title and number).

3. **Read changed code when needed.** For commits with unclear messages, read the actual changed files (`git show <sha> --stat` then read key files) to understand what the change does from a user's perspective.

4. **Categorize.** Group changes using Keep a Changelog types. Only include categories that have entries:
   - **Added** — new features, new UI elements, new capabilities
   - **Changed** — modifications to existing functionality, UX changes, behavior changes
   - **Fixed** — bug corrections, stability improvements
   - **Security** — vulnerability patches, auth fixes
   - **Deprecated** — features marked for future removal
   - **Removed** — features that were deleted

5. **Format output.** Use this template:

```markdown
## v<version> — <YYYY-MM-DD>

**Added:**

- Description of feature
- Sub-detail of feature if it has multiple notable parts

**Changed:**

- Description of change

**Fixed:**

- Description of fix
```

## Writing Style

Follow the conventions established in existing releases:

- **Write for users, not developers.** Describe what the user sees or can do, not implementation details. "Favorites feature enabling users to save views with associated filters" not "implement fav persistence layer with JSON serialization."
- **Lead with the feature/area name** when describing additions. "Rollback functionality for Deployments, Daemonsets, Statefulsets" not "Added a new modal that lets you roll back."
- **Use sub-bullets** for notable details of a larger feature. The first bullet names the feature, subsequent bullets describe specifics (e.g., "Heart icon to mark/unmark favorite views", "Cluster-specific or universal favorite support").
- **Group related fixes** under a single descriptive bullet when they're part of one effort. "Improved reliability and user experience of pod logs viewer" not three separate bullets for each small fix.
- **Bold the category name** followed by a colon — `**Added:**`, `**Fixed:**` — not markdown headers for categories.
- **No PR numbers or commit hashes** in the output. The release notes are for users.
- **Omit version bump commits**, merge commits, and CI/build-only changes.
- **Omit the Deprecated, Removed, and Security sections** unless there are actual entries — but never omit them if there ARE entries. Deprecations, removals, and breaking changes are the most important things to document.
