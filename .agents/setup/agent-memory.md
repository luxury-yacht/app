# Project-Local Agent Memory

This policy applies to every agent working in this repository.

## Storage Contract

- Store repository-specific persistent memory under
  `<project-root>/.agents/memory/`.
- Do not store repository-specific memory in a user-global or home-directory
  memory location.
- Do not store credentials, secrets, tokens, kubeconfigs, captured user data,
  generated artifacts, or transient debugging output in persistent memory.
- Keep durable architecture and workflow contracts in the appropriate tracked
  documentation. Project-local memory is for per-clone agent context that does
  not belong in version control.

`.agents/memory/` is ignored by Git.

## Runtime Configuration

### Claude Code

Merge this field into `.claude/settings.local.json`, preserving existing
settings and replacing `<project-root>` with the absolute repository path:

```json
{ "autoMemoryDirectory": "<project-root>/.agents/memory" }
```

### Other Agent Runtimes

Configure the runtime's equivalent persistent-memory setting to use the absolute
`<project-root>/.agents/memory/` path. If the runtime does not expose a
configurable persistent-memory location, do not create repository-specific
memory in the user's home directory; use session state and tracked repository
documentation instead.
