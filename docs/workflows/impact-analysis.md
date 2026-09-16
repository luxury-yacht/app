# Claude Code impact-analysis prerequisite

Use this workflow before editing production source through Claude Code's
`Edit`, `Write`, or `MultiEdit` tools. The hook is registered in
[settings.json](../../.claude/settings.json); its implementation is
[impact-gate.sh](../../.claude/hooks/impact-gate.sh).

## Before the edit

Create or refresh `.claude/impact-analysis.md` within the last 60 minutes.
For the current change, name every target by its repository-relative path and
record, for each:

- affected consumers and callers;
- dependencies;
- states and edge cases;
- downstream and runtime effects.

Mark each item VERIFIED when supported by inspected producers/consumers or
measurements, or ASSUMED when unresolved. Resolve assumptions before production
edits. Keep the artifact current as the affected file set changes.

The hook checks the artifact's age and target-path coverage. It does not prove
the analysis or verify the VERIFIED/ASSUMED labels; that remains the agent's
responsibility. A denial identifies the missing prerequisite; update the
analysis and retry the authorized edit.

## Scope

The configured gate covers Go, TypeScript, TSX, JavaScript, and JSX source.
It exempts `_test.go`, `.test.ts[x]`, `.spec.ts[x]`, documentation, and `.claude/`
files so the failing-test step can precede production changes. The analysis
artifact is ignored by Git.

This is a Claude Code tool prerequisite, not an additional approval requirement.
Other runtimes still follow the root producer/consumer, ordering, TDD, and
completion contracts; they do not need to create a Claude-specific artifact.
