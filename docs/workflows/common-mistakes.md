# Common implementation mistakes

Read this before editing. When user feedback identifies a recurring mistake,
record the pattern and a concrete prevention check here. Keep entries focused
on reusable rules; omit transient logs, credentials, and session history.

## Packing resource data into generic columns

A passing field-presence test does not prove a usable resource view. Give table
columns specific names and one value per cell; keep long configuration lists in
Details. Reuse the app's existing browsing and section patterns. Do not introduce
resource tabs to repair overloaded columns without an established product pattern.
Use realistic long lists, sparse objects and narrow panels when reviewing layout;
check hierarchy and scanability separately from data coverage. Preview detail
content under the real `.app` selection reset and verify selecting/copying values,
including lists outside `OverviewItem`. A screenshot cannot establish that text
is selectable; selection overrides must reach the text-bearing descendants.
For minor presentation fixes, use direct interaction checks instead of adding
tests that assert CSS properties or markup. Reserve regression tests for
meaningful application behavior.

Keep table sizing in the production column builder. A story must not add
auto-sizing or other layout transformations that the live view omits; compare
the column-building path before treating a preview as evidence of app layout.

## Missing native behavior changes in dependency upgrades

A framework upgrade can retain a method while making its default implementation
a no-op. Check migration notes and build-tag requirements, then exercise the
native feature through its user entry point. For Inspector support, verify both
right-click Inspect Element and the existing Inspector command in a dev build;
Safari inspection alone does not prove either path. Keep native readiness hooks
in the shared window registry and verify the release build remains excluded.

## Treating an unresolved design choice as selected

When work is limited to investigation or implementation has been paused, keep
design discussion within that boundary. Distinguish agreement on behavior from
agreement on specific keys, and distinguish a selected option from its alternatives.
Before editing behavior, check the current authorization and the exact selected
scope. Record accepted choices in the existing plan without implementing choices
that remain open.

Keyboard access does not authorize adding visible controls or changing spacing
and layout. Before editing, distinguish the requested interaction from a proposed
UI change; preserve the existing appearance unless that change was requested.

## Treating a passing automated gate as task completion

The gate covers its configured checks. It does not establish that every requested
workflow was exercised, especially native window interactions.

For keyboard workflows, verify focus position, visible indication, and the
resulting action separately. Reproduce mouse click → Tab/Shift+Tab → Enter/Space
through the real component and keyboard owners. A list's key handler must not
intercept activation of sibling controls. Check focus styling after pointer use,
when `:focus-visible` may not match. Audit every region and portaled surface
that shares the contract; include actions that disable or unmount their own
focused control. When removing a local focus walker, restore its consumers
to the shared tab-stop contract. Clarify the failing keys before attributing
a report to the list's arrow-navigation design.

Exercise popovers through the real region provider and portal: an isolated
React key handler can pass while the app's earlier keyboard owner takes the key.
Browsers reject focus on `visibility: hidden` elements; jsdom does not model
that restriction. Reveal a positioned menu before focusing it and verify the
first arrow/activation in a rendered browser. For programmatically focused
read-only bodies, test the actual preceding/following control by name, rather
than asserting the same last-element fallback used by the implementation.

Prevention:

- Focus restoration tests for popups must use the app's `StrictMode` wrapper.
  Capture the invoking element before menu focus, and preserve it across effect
  replay; otherwise the menu can remember itself and leave focus on the body.
- Pointer-normalized focus is not keyboard entry. Test hover → action click →
  pointer leave through the real provider, and option click → typing/list keys
  through the actual combobox. Keep virtual-focus owners on their search field
  or trigger, and use `preventScroll` for pointer focus normalization. Exercise
  long portaled menus at non-default zoom so their last item remains reachable.
- Exercise Tab across row boundaries in every dropdown variant, including rows
  with trailing actions. A virtual-focus option must stay outside the Tab order
  even when its action controls are separate Tab stops.
- Check the semantics of the whole composite after moving nested controls.
  Exposing a button outside a tab does not prove that its tablist allows that
  button as a child; combine rendered accessibility rules with native checks.
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
- Keep lifecycle input guards independent of progress presentation. Routine
  transfers must preserve the visible workspace; show a compact delayed status
  for longer waits. Check quick completion, overlapping transfers, and timer
  cleanup without weakening the publication or readiness guard.

## Treating entry-point cleanup as file consolidation

Keep the root Go package limited to `main.go` with embedded assets and the startup
call. Move helpers and their tests to the package that owns their responsibility:
window forwarding in `internal/appwindow`, reporting in `internal/sentry`, and
process orchestration and Wails composition in `internal/bootstrap`.

Do not replace extra root files by growing `main.go`, or move unrelated helpers
into one catch-all package. Update source-based architecture checks to inspect
the actual owners, and preserve checks for startup order, the single service
registration, stream wiring, and construction-cycle handling after a move.

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

## Rendering portal loading feedback in the page layout

A lazy panel's inline fallback participates in its caller's layout even when the
loaded panel renders through a portal. This can create a temporary app-grid row
on the first open in a fresh window.

Prevention:

- Keep panel and modal lazy fallbacks out of ordinary layout. Use the shared
  `withLazyBoundary` null-message option for surfaces that own portal placement.
- Hold module resolution in a regression test; assert the pending component adds
  no layout child, then resolve it and check the actual portal destination.
- Check route spinners, import errors, and closure before module resolution.

## Mutating shared stores inside React state updaters

React may replay updater callbacks during rendering. Cache eviction inside them
can notify another component while rendering and repeat destructive side effects.

Prevention:

- Keep state updaters pure. Compare committed panel ownership in an effect and
  evict only removed panels, retaining caches across cluster switches.
- Exercise transfer, individual close, group close, and cluster removal under
  StrictMode. Assert eviction follows committed removal and occurs once per scope.

## Publishing virtual row measurements during ref commits

Measuring a newly visible row can change the virtual range and mount more rows.
Synchronous React state updates from those refs can exceed the update-depth
limit when wrapped rows are much taller than the estimate.

Prevention:

- Coalesce measurement notifications into an animation frame, and cancel pending
  work on unmount. Preserve measurement setup across StrictMode effect replay.
- Test scrolling into unmeasured, tall rows with actual measurement callbacks;
  zero-height jsdom fixtures do not exercise this path.
- Include padding in unmeasured-height baselines, and prove measurement assertions
  fail when measurements are disabled. Exercise replay before viewport sizing so
  an unrelated state update cannot conceal a lost measurement notification.
- Measure convergence work separately from crash prevention. Keep a runaway
  guard distinct from the frame budget, and measure browser settling time rather
  than inferring it from a nominal display refresh rate.
- Check resizing, filtering, tail-following, and observer cleanup with the shared
  viewer consumers as well as the measurement hook.

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

## Leaving related resource kinds out of object-map support

When adding map support for a resource family, check both namespaced and
cluster-scoped variants. A frontend allowlist alone does not supply graph nodes
or links. Verify registry collectors, ingest projections, relationship builders,
namespace/object snapshots, and the table and panel navigation consumers. Include
bindings that cross the variants, such as a RoleBinding referencing a ClusterRole.

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

## Linting generated coverage reports

Generated HTML under `frontend/coverage` can enter the frontend lint scope and
produce parser errors during the prerelease gate. If this happens, preserve the
generated reports outside the frontend tree and rerun the unchanged gate. Keep
coverage summaries available for completion evidence; do not weaken source lint
rules to accommodate generated reports.

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

## Resource-family integration

- Keep an optional family filter in every catalog scope transformation, including
  normalization, metadata queries, continuation signatures, pages, and exports.
  A view-only filter does not constrain server counts or later pages.
- Register new table view IDs with persistence cleanup. Keep the view configuration's
  `viewId` explicit so the registry contract test can trace its consumer.
- When a live dynamic detail read shares a cached header with snapshot versioning,
  refresh the header from the same object. Test two changed resource versions
  through the snapshot builder before relying on panel refresh behavior.
- Exercise the actual casing sent by object-panel detail scopes. Preserve the
  API object's canonical kind when projecting a dynamic resource; a normalized
  request kind is a lookup key, not a replacement for returned identity.
