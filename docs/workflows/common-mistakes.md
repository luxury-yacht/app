# Common implementation mistakes

Read this before editing. When user feedback identifies a recurring mistake,
record the pattern and a concrete prevention check here. Keep entries focused
on reusable rules; omit transient logs, credentials, and session history.

## Treating a passing automated gate as task completion

The gate covers its configured checks. It does not establish that every requested
workflow was exercised, especially native window interactions.

Prevention:

- Follow the [completion evidence gate](completion.md), keeping each requested
  outcome and related lifecycle action tied to explicit evidence.
- Leave required blocked or unrun checks visible and unfinished. Do not replace
  missing runtime verification with a test count or a code-path description.
- Audit guards across asynchronous waits: passing a guard before publication
  does not authorize disposal after the renderer accepts new edits.
- Scope routine cluster-close guards to the affected cluster. Assert that no
  full-window overlay appears and sibling navigation remains usable, while
  edits through both ordinary content and portals stay guarded until selection
  settles. Whole-window transfer and Quit guards are separate contracts.

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
- Keep application Quit distinct from sequential view closure. View-close hooks
  relinquish cluster ownership and persist the reduced selection. Test Quit with
  different clusters in different windows through the real workspace and disk
  persistence consumers, then reload preferences; mocked close callbacks alone
  cannot establish restart behavior. Approved renderers remain frozen until
  shutdown, while rejected handoffs release the entire original participant set.
- Remove renderer readiness and retain its panel placement only after a native
  close is accepted. After a rejected close, repeat the close and prove it still
  reaches the renderer guards.

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
- Distinguish an expired credential from an invalidation that removes its saved
  token. Capture the provider's actual failure shape and exercise it through the
  subprocess, startup projection, and UI guidance before claiming recovery works.
- For cluster closure, interleave real panel synchronization with backend
  membership removal: drain admitted directory reads and opens, pause full-window
  publications, and reject stale callbacks until selection commits. Include a
  canceled close and repeated close gestures. Testing only the close binding
  misses calls issued by subscriptions and menus after membership is revoked.

## Publishing lifecycle readiness before its service exists

Subsystem construction does not establish that aggregate HTTP or stream routing
can serve the cluster. A `loading` event admits namespace requests, so emitting it
during construction exposes an unpublished route.

Prevention:

- Publish routes before generation commit advertises `loading`; preserve Ready
  during a continuously served replacement.
- Test lifecycle events through the real HTTP consumer at startup, selector open,
  and first/sibling auth recovery. Keep pre-publication requests blocked.
- Resume unknown-cluster requests from both lifecycle events and authoritative
  workspace snapshots; keep the readiness edge at their shared state publisher.
- Trigger a namespace readiness build on every committed generation. Prove Ready
  without a frontend request, including a settle ring preceding publication.

## Mutating shared stores inside React state updaters

React may replay updater callbacks during rendering. Cache eviction inside them
can notify another component while rendering and repeat destructive side effects.

Prevention:

- Keep state updaters pure. Compare committed panel ownership in an effect and
  evict only removed panels, retaining caches across cluster switches.
- Exercise transfer, individual close, group close, and cluster removal under
  StrictMode. Assert eviction follows committed removal and occurs once per scope.

## Letting test processes inherit real application state directories

Per-test overrides alone leave unguarded fixtures and late background work able to
write the developer's settings after an override is restored.

Prevention:

- Isolate the backend test process's user config and cache roots before running
  tests; per-test overrides restore to this disposable process root.
- Prove isolation with a child process inheriting fixture user directories and
  writing through the real app-state resolver. Those inherited directories must
  remain untouched.

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
- When tab-movement policy changes, check both cluster and panel sources with one
  tab and multiple tabs, targeting both new and existing windows. Update tests
  that encode superseded behavior; a green assertion of the old exception does
  not prove the user's current contract.

## Confusing group controls with individual tab actions

Panel-header controls apply to the whole group; tab menus and tab drags apply
to one tab. Do not let an unhandled group command fall through to a single-tab
move. Test the actual buttons with multiple tabs and an occupied destination,
then right-click an inactive tab and prove only that tab is affected. Include
the native renderer's docked layout projection when testing menu destinations.

For tab-menu styling, compare the cluster and object-panel menus together,
including docked and native panel variants. Use the shared ContextMenu icon
slot and separator styling consistently; checking one menu in isolation misses
visible differences between equivalent controls. Keep each menu's existing
action scope and availability while aligning its presentation.

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


## Losing recovery while splitting window ownership

Panel ownership bookkeeping shares the cluster selection queue. Test its waiting
and failure paths through the registry and frontend consumers, including:

- A peer connection must not hold the shared panel lock through a backend wait.
  Revalidate admission inside the placement commit, after a possible removal.
- Publication failure must permit retry without a layout change; readiness must
  discard events for transfers that already failed.
- A committed backend close cannot be rolled back by failed frontend follow-up.
  Keep the confirmed selection so other clusters can resume publication.
- Closing the final app window while panels remain must preserve restart state.
  Test the later panel close and reload saved settings from disk.
- Failed native creation must release its provisional backend window entry as
  well as cancel its staged tab. Include that failure before the final app/panel
  close sequence; an empty live window and a non-existent window are different.
- Keep backend retention waits outside panel transfer locks, then revalidate
  pending transfer and source ownership before creating the native window.
- App tab-menu docking names its own destination; panel-window docking may
  select another app view. Test the actual provider route as well as the request
  builder so an unused callback is not mistaken for a user-visible regression.
- Queued auth callbacks retain their turn to check current intent. Pair that test
  with actual selection removal rejecting a late startup client.
- Retained-panel claims must accept subsequent notifications and mount successful
  claims even if a later claim fails.

Run source-inventory tests after binding generation finishes; concurrent generation
creates and removes temporary trees while those tests enumerate frontend files.
