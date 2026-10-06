---
name: code-simplification
description: Simplifies code for clarity. Use when refactoring code for clarity without changing behavior. Use when code works but is harder to read, maintain, or extend than it should be. Use when reviewing code that has accumulated unnecessary complexity.
---

# Code Simplification

Adapted from the
[Claude Code Simplifier plugin](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md).

Reduce complexity while preserving exact behavior. The goal is faster
comprehension, not fewer lines: would a new team member understand the result
faster than the original?

A local pass defaults to recently modified code; do not refactor unrelated code
unless asked. For a repository-wide or systematic effort, follow the
[systematic simplification workflow](../../../docs/workflows/code-simplification.md)
and resume its active ledger under `docs/plans/`; it owns inventory, domain
rotation, batch sizing, validation cadence, and coverage tracking.

Do not simplify code that is already clear, code you do not yet understand, a
performance-critical path where the simpler form is measurably slower, or a
module about to be rewritten.

## Principles

1. **Preserve behavior exactly.** Same output for every input, same error
   behavior, same side effects and ordering, existing tests passing unmodified.
   If unsure, do not make the change.
2. **Follow project conventions.** Match neighboring code's imports, function
   style, naming, error handling, and type-annotation depth. Inconsistent
   "simplification" is churn.
3. **Prefer clarity over cleverness.** Explicit beats compact when the compact
   form needs a mental pause: replace a nested ternary chain with early
   returns; replace a spread-accumulating `reduce` with a named `Map` and loop.
4. **Keep balance.** Do not inline a helper that names a concept, merge
   unrelated logic, remove abstractions that serve testability or real
   extension, or optimize for line count.

## Process

1. **Understand first (Chesterton's Fence).** Know the code's responsibility,
   callers and callees, edge and error paths, defining tests, and why it was
   written this way (performance, platform constraint, history; check
   `git blame`). If you cannot answer these, read more first.
2. **Find concrete signals** from the table below.
3. **Apply incrementally.** One simplification at a time with focused tests
   after each; on failure, revert and reconsider. Never batch untested changes.
   Keep refactors separate from feature or bug-fix changes. Beyond ~500 touched
   lines, use automation (codemods, scripted or AST edits), not hand edits.
4. **Verify the whole.** Keep the result only if it is genuinely easier to
   understand, adds no pattern inconsistent with the codebase, and is a clean,
   reviewable diff. Not every attempt succeeds.

## Signals

| Signal | Simplification |
| --- | --- |
| Nesting 3+ levels | Guard clauses or named helpers |
| Function 50+ lines with several responsibilities | Focused, descriptively named functions |
| Nested ternaries | `if`/`else`, `switch`, or a lookup object |
| Boolean flag parameters (`doThing(true, false, true)`) | Options object or separate functions |
| Same conditional in several places | Named predicate |
| Generic names (`data`, `result`, `temp`, `val`, `item`) | Name the content (`validationErrors`) |
| Abbreviations (`usr`, `cfg`, `btn`, `evt`) | Full words unless universal (`id`, `url`, `api`) |
| Misleading name (a `get` that mutates) | Rename to the actual behavior |
| Comment restating what (`// increment counter`) | Delete; keep comments explaining why |
| Same 5+ lines in several places | Shared function |
| Unreachable branches, unused variables, commented-out blocks | Remove after confirming they are dead |
| Wrapper adding nothing; factory-for-a-factory; one-strategy strategy | Call the underlying code directly |
| Redundant type assertion | Remove it |

TypeScript/React idioms:

- An `async` wrapper that only does `return await other()` can return the
  promise directly.
- `let x; if (a) x = a; else x = b;` becomes `const x = a || b`.
- A loop that pushes matching items becomes `filter`/`map`.
- `if (cond) return true; return false;` becomes `return cond`.
- JSX branches that differ only in props: compute the props, render once.
- Prop drilling is a judgment call (context or composition); flag it, do not
  auto-refactor.

## Rejected rationalizations

- "It works; leave it." Hard-to-read code is hard to fix when it breaks.
- "The types self-document." Types document structure, not intent.
- "This abstraction might be useful later." Remove speculative abstractions;
  re-add when needed.
- "The author must have had a reason." Check (Chesterton's Fence), but much
  complexity is residue of iteration under pressure.

## Done criteria

- Existing tests pass unmodified (needing changes means behavior likely
  changed); build, lint, and format pass with no new warnings.
- Error handling is intact, not removed or weakened "for cleanliness".
- No dead leftovers remain (unused imports, unreachable branches).
- The diff is incremental, reviewable, in scope, convention-consistent, and a
  net improvement a reviewer would approve.
