---
name: No git mutations or worktrees
description: NEVER run state-modifying git commands or create worktrees — user has been very clear about this multiple times
type: feedback
---

NEVER run state-modifying git commands (add, commit, push, reset, checkout, branch -D) or create PRs unless the user EXPLICITLY says "commit this" or "create a PR."

NEVER create git worktrees. The user does not want them. Period.

Read-only git commands (status, log, diff, blame) are fine.

**Why:** AGENTS.md explicitly states this rule. The user has had to correct this violation forcefully. This is a hard rule with zero exceptions unless the user explicitly directs it in that specific message.

**How to apply:** Before any git command, check: is it read-only? If not, STOP. Ask the user. Before suggesting a worktree, STOP. Don't suggest it. Work on the current branch directly.
