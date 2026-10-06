# Project-Local Agent Memory

This policy applies to every agent working in this repository.

## Storage Contract

- Store repository-specific persistent memory only under
  `<project-root>/.agents/memory/` (ignored by Git), never in a user-global or
  home-directory memory location.
- Never store credentials, secrets, tokens, kubeconfigs, captured user data,
  generated artifacts, or transient debugging output there.
- Memory holds per-clone agent context that does not belong in version control;
  durable architecture and workflow contracts belong in tracked docs.

## Runtime Configuration

- Claude Code: merge
  `{ "autoMemoryDirectory": "<project-root>/.agents/memory" }` into
  `.claude/settings.local.json`, preserving existing settings and using the
  absolute repository path.
- Other runtimes: point the equivalent persistent-memory setting at the absolute
  `<project-root>/.agents/memory/` path. If the location is not configurable,
  use session state and tracked docs instead of home-directory memory.
