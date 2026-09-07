# Common implementation mistakes

Read this before editing. When user feedback identifies a recurring mistake,
record the pattern and a concrete prevention check here. Keep entries focused
on reusable rules; omit transient logs, credentials, and session history.

## Confusing renderer placement with cluster ownership

A native window is a place to render content. Shared cluster panels and their
runtime lifetime must not depend on the app window that first opened them.

Prevention:

- Carry cluster and complete object identity independently of window identity.
- Validate the complete source set before changing any shared placement.
- Commit destination publication and transfer ownership together; keep staged
  target copies provisional until reconstruction is acknowledged.
- Seed a new app view before renderer startup, and delay queued work until
  cluster hydration and coordinator subscriptions are ready.
- Retain cluster runtime for shared panels, including panel-only renderers.
  Test source-app closure, duplicate app views, cancelled queued transfers,
  native-creation failure, and all-renderer quit preflight.

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
