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
- Test explicit cluster-tab close separately from app-window close and tab
  movement. Closing the final cluster tab preflights and closes its shared panel
  windows; closing a renderer or moving its tab preserves them. Include a
  duplicate cluster view and a denied native-panel guard in the regression.
  Record a closing view's removal before checking whether a subsequent close
  owns the final view; separate preflight and selection calls can otherwise
  leave shared panels orphaned.
- Retain cluster runtime for shared panels, including panel-only renderers.
  Test source-app closure, duplicate app views, cancelled queued transfers,
  native-creation failure, and all-renderer quit preflight.

## Testing lifecycle pieces without their real interleavings

A passing ownership test and a passing auth test do not prove that ownership
changes preserve an in-flight startup auth result. Cancellation at either the
selection queue or the per-cluster operation queue can discard that result.

Prevention:

- Block startup client construction, deliver panel/peer ownership changes and
  auth callbacks, then release the builder and assert the published auth state.
- Cover both unchanged process selection and actual cluster removal. The first
  must preserve work; the second must still cancel stale work.
- Exercise a real credential subprocess and the real auth consumer, including
  a healthy sibling and recovery after credentials change. String classifiers
  alone cannot prove that provider stderr survives the execution boundary.
- Test realistic payload combinations: expired credentials with an exec command
  must retain expiry guidance. A missing cache reported by a running helper must
  not produce installation advice. Test these decisions, not sentence spelling.

## Applying shared tab behavior to only one tab kind

A shared drag coordinator does not guarantee that the native drag policy handles
all of its tab kinds. Platform hooks must recognize the markers emitted by every
supported source.

Prevention:

- Exercise cluster and panel tab markers through the native drag callback, both
  as direct pasteboard types and inside WebKit custom data.
- Assert the native animation flag and retain negative cases for unrelated
  drags. Frontend dragend tests alone cannot prove AppKit animation behavior.
- Carry drop coordinates through the request boundary and assert the resulting
  native window options for each tab kind, including negative monitor positions,
  screen origin, and work-area edges. Menu actions have no drop point.
- Put gesture-specific guards on transfer requests, not shared window factories.
  A panel-only cluster must still be able to open an app window for docking.

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
