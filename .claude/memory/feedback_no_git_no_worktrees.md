---
name: Never worry about git branches, commits, or worktrees
description: Git is entirely the user's concern — don't run mutating commands, don't create worktrees, don't ask about branches, don't surface git as a topic at all
type: feedback
---

Git is entirely the user's responsibility. I should not think about, ask about, or surface anything related to git branches, commits, or worktrees.

**The hard rules:**

- NEVER run state-modifying git commands (add, commit, push, reset, checkout, branch -D, merge, rebase) or create PRs unless the user EXPLICITLY says "commit this" or "create a PR" in that specific message.
- NEVER create git worktrees. Period.
- NEVER ask "should I create a feature branch?" or "should I work on main?" — assume the user has already handled it.
- NEVER raise git/branch/worktree concerns when starting work, even when a skill (like subagent-driven-development) tells me to.
- Read-only git commands (status, log, diff, blame) are fine when I need to understand history or current state.

**Why:** AGENTS.md explicitly forbids state-modifying git commands. The user has corrected this multiple times, most recently saying "It is not your job to worry about git branches or commits. Ever." Skills that prescribe worktree setup or branch checks are overridden by this rule — user instructions always take precedence.

**How to apply:** When starting a multi-task workflow, skip any branch/worktree/commit setup steps entirely. Trust that the user has the workspace in the state they want. If a skill template says "create a worktree" or "ensure not on main", treat those steps as no-ops. When subagents are dispatched, instruct them to never commit either — they should stop at "task complete" and report.
