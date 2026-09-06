# Common implementation mistakes

Read this before editing. When user feedback identifies a recurring mistake,
record the pattern and a concrete prevention check here. Keep entries focused
on reusable rules; omit transient logs, credentials, and session history.

## Adding cognitive complexity without measuring it

Recovery guards and channel-close handling can become deeply nested inside
loops, selects, and operation callbacks. Relying only on the prerelease gate
misses this: its task list in [Taskfile.yml](../../Taskfile.yml) does not run a
local cognitive-complexity analyzer or fetch Sonar findings.

Prevention:

- Identify separate responsibilities and extract cohesive helpers before
  adding more nesting.
- Measure every changed production function and new helper after editing and
  before the final gate. Target a local score of 12 or lower using the commands
  in [the Sonar remediation contract](../frontend/sonar.md).
- Preserve guard timing, cancellation ownership, publication order, and terminal
  cleanup. Confirm characterization cases before refactoring and rerun them
  afterward.
- Refactor responsibilities instead of suppressing the rule, raising thresholds,
  weakening tests, or accepting increased complexity in a baseline.
- Treat local scores as directional. Confirm remote closure with Sonar analysis
  of the pushed revision; commit and push only when explicitly authorized.

## Putting shared prevention rules in ignored memory

Shared guidance must travel with the repository. `.agents/memory/` is ignored
by Git and is reserved for per-clone context under the
[agent memory policy](../../.agents/setup/agent-memory.md).

Prevention:

- Keep recurring mistakes and shared prevention checks in this document, with
  an entry point in `AGENTS.md`.
- Check `git status --short` and `git check-ignore` when adding shared guidance
  to confirm it can be included in the repository's normal changes.
