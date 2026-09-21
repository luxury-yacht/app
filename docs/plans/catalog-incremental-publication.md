# Catalog incremental publication

## Scope and target

Preserve catalog identity, query results, metadata, readiness, and signal ordering
while maintaining published indexes incrementally after watch/ingest changes.
Keep discovery, full resync, source adapters, and contention recovery. Table and
panel refactors are separate follow-up work.

## Ownership and ordering

- Producers: informer/custom watch batches and ingest upsert/delete/replace sinks.
- Owner: the per-cluster catalog index and its publication boundary.
- Consumers: catalog/catalog-diff snapshots, identity/UID lookup, namespace and
  kind metadata, finalizer findings, and the catalog doorbell bridge. Browse and
  custom-resource tables consume the resulting scoped snapshots.
- Publish rows, lookup indexes, facets, and finalizer findings before signals.
  Full resync retains warm query results until replacement publication.
- Preserve `syncMu` before catalog publication locking. Ingest callbacks must
  enqueue reconciliation rather than waiting while holding a source-store lock.
  Keep the existing catalog-owned interfaces to avoid a stream-manager cycle.
- Incremental mutation makes query-store pointers mutable; page, total, and
  facet reads must share catalog publication ownership for a consistent result.

## Work and evidence

- [x] Add and run failing incremental-publication regression; benchmark baseline.
- [x] Maintain published query/identity/facet/finalizer indexes from changes.
- [x] Preserve resync contention, recreation, and publication-before-signal.
- [x] Run focused catalog, snapshot, bridge, and Browse tests.
- [x] Measure backend coverage and changed-function complexity.
- [x] Exercise live Browse create/update/delete and record freshness evidence.
- [x] Run prerelease gate and inspect its formatting changes.
- [x] Update the owning [catalog contract](../architecture/catalog.md).

## Validation record — 2026-09-20

All repository commands used `mise exec --`, with Go caches under `/tmp`.

- Red: `go test ./backend/objectcatalog -run '^TestIncrementalCatalogPublication$'
  -count=1` failed on both watch and ingest paths: three changes increased the
  full-rebuild counter from 1 to 4. The same regression passed after implementation.
- Focused: `go test ./backend/objectcatalog ./backend/refresh/snapshot ./backend
  -run 'Test(Incremental|Catalog|SourceReplay|IngestReplacement|WatchChangeDuring|Gateway)'
  -count=1` passed. Coverage includes UID recreation, query equivalence, concurrent
  publication consistency, replay signal ordering, unchanged finalizer findings,
  full-sync contention recovery, production Gateway informer handlers, snapshots,
  and catalog bridges.
- Frontend: `npm --prefix frontend run test -- --run src/modules/browse` passed
  107 tests in 12 files, including catalog freshness integration tests.
- Coverage: `wails3 task test:backend-coverage` passed after the final tests.
  Object catalog: 89.1%; the six changed production files with logic changes:
  741/805 statements (92.0%); new incremental publication helpers: 100%.
- Complexity: pinned `gocognit@v1.2.1` scanned those six production files.
  Maximum local score: 12. This is local analysis, not a pushed Sonar result.
- Final gate: `wails3 task qc:prerelease` exited 0, including Go race tests,
  vet/staticcheck, bindings, frontend lint/types, 5,049 tests across 524 frontend
  files, Knip, documentation links, and the configured vulnerability scan.
  Worktree inspection found only the intended catalog code, tests, and docs.

### Native freshness check

Used the native Wails development build and a disposable Kind cluster,
`codex-catalog-check`, namespace `catalog-refactor-check`. The app reported Ready.
The standalone Playwright check first encountered `/wails/runtime` 404s on the
Vite URL; server mode then rejected native workspace identity. Native computer
interaction supplied the live evidence instead; no mocked bridge was used.

Native accessibility observations during external `kubectl` mutations:

1. Namespace Browse loaded its two initial objects: the root CA ConfigMap and
   default ServiceAccount.
2. Creating `catalog-publication-check` added a ConfigMap row. A temporary custom
   label column displayed `catalog-check=created`.
3. Updating the label changed the visible cell to `updated` without manual refresh.
4. Creating `catalog-facet-check` added a ResourceQuota row and ResourceQuota to
   the Kinds vocabulary. A name filter reported `Showing 1 of 4 items`.
5. Completed external deletion of both objects changed that filtered view to
   `Showing 0 of 2 items` and its empty state. Clearing the filter restored the two
   baseline rows; ResourceQuota disappeared from the Kinds vocabulary.
6. Native Cluster Data diagnostics reported catalog healthy/delivering and
   connected, one full catalog resync, zero fallbacks, eight delivered batches,
   and zero dropped messages. Changes were observed before the five-minute full
   resync interval. The disposable cluster had no metrics-server; metrics errors
   were separate from the healthy catalog feed.

The temporary column was removed, the cluster tab closed, the development
processes stopped, and the Kind cluster and its two kubeconfig files deleted.
After the user's follow-up authorization, the two pre-test saved cluster
selections were restored and read back on 2026-09-20. The active cluster remains
empty; other preferences were preserved.

### Publication microbenchmark

`BenchmarkCatalogIncrementalPublication`, five iterations per sample, three
samples on Apple M2 Max, measured one ingest update against a populated catalog.

| Catalog size | Before | After |
| --- | --- | --- |
| 10,000 objects | 95–99 ms/update | 0.119–0.137 ms/update |
| 100,000 objects | 1.36–1.41 s/update | 0.129–0.134 ms/update |

These measure backend publication cost, not end-to-end UI latency. Updates still
rebuild the small kind/namespace vocabulary, and whole-kind replacement scans the
membership map. Queries hold the publication read lock for consistent rows,
counts, and facets; long queries can delay a publisher. Full resync, source
adapters, retry policy, and recovery remain in place.


## Follow-up: shared query-page mechanics

### Scope, ownership, and constraints

Consolidate search debounce, applied cursor/page state, request delivery, and
query stream identities across typed tables and Browse. Preserve their distinct
payload interpretation, warm-up retry, navigation rollback, quiet-request
coalescing, metadata scopes, and reset timing. No new source mode or UI behavior.

- Producers remain typed refresh query snapshots and catalog query snapshots.
  Data access owns temporary query leases and acquire/fetch/read/release.
- Typed queries remain declarative. Browse keeps its imperative cursor requests
  and separately subscribed base and metadata scopes. The shared session owns
  only applied cursor/footer state, not requested-cursor or payload policy.
- Query readiness must still permit acquisition/acknowledgement needed to become
  ready. Discard results after scope changes or supersession; preserve the
  existing adapter-specific error delivery and loading cleanup.
- Reset rows before commit on hard scope changes. Publish landed cursors and
  position together; payload writes must not look like new stream signals.
- Core stream helpers depend only on core refresh/data access. Shared query-page
  helpers depend on data access, never on Browse, preventing a dependency cycle.
- Existing contract tests cover cluster/namespace isolation, readiness,
  cancellation, warm-up, rollback, cursor expiry, anchors, numbered jumps,
  structural sharing, live signals, and exports. Add gaps at consumer boundaries.

### Resource-table inventory

The production classification remains enforced by
`gridTableViewRegistry.contract.test.ts`, including direct GridTable exceptions.

| Surface | Source and mode | Affected path |
| --- | --- | --- |
| Browse and custom resources | Catalog query, static page | Browse adapter |
| Aggregated config/RBAC/storage/network/CRD/quota/autoscaling views | Typed query, static page | Typed adapter |
| Namespace Pods/Workloads and cluster Nodes | Typed query, dynamic metrics page | Typed adapter |
| Namespace Events/Helm, cluster Events/Attention | Typed query, static page | Typed adapter |
| Object-panel Pods | Typed query with owner predicates | Typed adapter |
| Global clusters and namespace summary | Bounded inventory | Unchanged |
| Object-panel related-resource tables and Events | Bounded/explicit partial | Unchanged |
| Parsed logs and diagnostics | Explicit non-inventory exceptions | Unchanged |

Backend queries continue to own global search, sort, facets, and counts. Page
limits remain bounded by the existing options; exports retain the shared full
cursor walk. Visible-row actions retain complete object identity and cluster
scope. No frontend loaded-prefix inference is introduced.

### Work and evidence

- [x] Baseline: 86 tests in five query/signal suites passed before edits.
- [x] Consolidate mechanics and migrate both adapters.
- [x] Run focused adapter, freshness, table-classification, and request tests.
- [x] Measure affected coverage and changed-function complexity.
- [x] Exercise representative typed and Browse query interactions in Wails.
- [x] Run prerelease gate and inspect final worktree.
- [x] Document the shared boundary and record cleanup/remaining verification.

### Query validation record — 2026-09-20

- Focused suites: 210 tests across 21 files passed, covering query adapters,
  Browse/custom-resource consumers, stream signals, table classification, and
  data access. Added numbered-jump/self-cursor reconciliation and overlapping
  quiet-refresh/user-navigation coverage. Adapter tests mock the data-access
  response boundary; native checks below exercise the actual backend.
- Full frontend coverage suite: 5,050 tests across 524 files passed. The six
  changed production files covered 597/644 statements (92.70%). File coverage:
  Browse 94.73%, typed query 91.63%, query wrapper 86.17%, page session 97.36%,
  request delivery 100%, and stream hooks 97.36%.
- Local complexity: Biome with a temporary maximum of 12 reported no changed
  function or new helper above 12. Its only finding was the unchanged focus
  request effect in `useAnchorOnUnmatchedFocusRequest` (14); the full-file
  command therefore exited 1. The diff changes only signal consumption in
  that file, outside the flagged function. No repository thresholds or
  suppressions changed. No pushed Sonar analysis was requested.
- Final gate: `mise exec -- wails3 task qc:prerelease` exited 0, including Go
  race tests, vet/staticcheck, bindings, frontend lint/types, 5,050 tests in 524
  files, Knip, documentation links, and the configured vulnerability scan.
  The gate reported no frontend formatting changes. Final worktree inspection
  found only the intended query code, tests, and documentation changes.

### Native query checks and cleanup

Used the native Wails development build with disposable Kind cluster
`codex-query-check`, namespace `query-refactor-check`, and 260 test ConfigMaps.
The existing 250-row preference was preserved.

1. Browse displayed its loading state, then 262 catalog objects. Next/previous
   navigation and the numbered page control moved between pages one and two.
2. On Browse page two, external deletion of `query-check-260` removed its row,
   changed the footer from 251–262 of 262 to 251–261 of 261, and retained page two.
3. Typed Config displayed 260 rows after that deletion. Next/previous and the
   numbered control moved between pages one and two.
4. On typed page two, externally adding a data key to `query-check-259`
   changed its visible Data Items cell from 1 item to 2 items without navigation.
5. Both tables retained keyboard focus while searching for that object,
   displayed one matching row, displayed an empty result after adding a
   nonmatching suffix, and returned to page one after clearing the filter.
6. Switching to namespace `default` replaced the test namespace's rows:
   typed Config showed only its root CA ConfigMap; Browse showed the root CA,
   Kubernetes Service/EndpointSlice, and default ServiceAccount.

The direct Playwright navigation to the emitted Vite URL again reported
`/wails/runtime` 404s because native bindings are unavailable there. Native
interaction supplied the runtime evidence. Error, warm-up retry, cancellation,
and permission cases are covered by automated adapter tests, not native error
injection. This cluster had no metrics-server; no live metric-sort claim is made.

The development app and its processes were stopped. The disposable cluster and
both temporary kubeconfigs were deleted. The saved cluster selections and active
state captured before this phase were restored and read back successfully.
The [query contract](../architecture/large-data-query.md) now records the shared
mechanics and adapter-owned policies. Panel placement remains a separate phase.

## Follow-up: panel placement consolidation

### Ownership and ordering

The shared Go directory remains the cross-window owner. Within a renderer,
tab-group membership will be the only writable placement projection. Object
state will own local object references, active views, and pending native opens;
layout state will own geometry/open/maximize state. Remove the separate object
dock-edge/native-location indexes and per-panel geometry position field.

The app and native layouts also own a declarative panel portal layer. Its ref
publishes the live DOM destination to the provider; panel rendering and geometry
consume that same destination. This removes the one-time DOM lookup that could
retain a detached host after reconstruction. React owns host replacement and
cleanup; the layer introduces no dependency on object state or transfer owners.

Producers include object opens, retained-directory reconstruction, group docking,
panel-tab insertion, and cluster-view insertion. Consumers include AppLayout,
DockablePanel, workspace publication, close preflight, native shortcuts, focus,
and cache/layout cleanup. Reuse one reconstruction boundary across transfers.

Preserve group/tab ordering, active views, isolated pending float groups,
cluster identity, provisional-source retention, readiness acknowledgement,
publication flushing, and rollback. Intra-renderer moves retain their current
local behavior; cross-window protocols still own acknowledgements and guards.
Object state must not reach into a globally selected layout store. Cleanup uses
the owning cluster's layout and runs outside React state updater callbacks.

This renderer consolidation precedes merging the three Go transfer lifecycles.
Their platform-specific preparation and settlement contracts require separate
analysis; do not replace them with a generic transaction before identifying all
participants, reservation, rollback, and empty-source close guarantees.

### Acceptance and evidence

- [x] Establish baseline panel, object-state, shortcut, and protocol suites.
- [x] Remove duplicate renderer placement writes and global layout selection.
- [x] Share reconstruction and preserve source/target publication ordering.
- [x] Verify automated contracts for local moves/reorders, focus, cluster switches,
      geometry handoff, close eviction, transient-unmount retention, and rollback.
- [x] Measure changed-function complexity and affected coverage.
- [x] Exercise actual macOS panel moves, dock-back, close guards, and drops.
- [x] Record Windows native validation availability and outstanding checks.
- [x] Run prerelease gate and inspect the final worktree.
- [x] Assess and consolidate transfer lifecycle ownership.


### Renderer validation record — 2026-09-20

- Baseline: 356 tests across 28 frontend suites passed before edits; Go
  `internal/appwindow` and `internal/panelwindow` protocol suites also passed.
- Focused after edits: 358 tests across 29 suites passed. Coverage includes
  source retention/rollback, readiness, group moves, geometry handoff, cluster
  switching, true-close cache eviction, active views, and keyboard focus.
  Native transport is mocked in coordinator tests.
- New provider integration uses real object and layout providers to restore
  placement before object content and remove an inactive cluster's panel without
  clearing the active cluster's geometry. It mocks kubeconfig selection and
  refresh-domain eviction. It does not replace native transfer validation.
- Red/green: restored membership initially reported the default right position
  in `useDockablePanelState`; the hook now derives placement from groups.
- Native validation found an additional initialization regression: newly mounted
  controlled panels removed preinstalled bottom membership while geometry was
  still in its initial closed state. `DockablePanel.behavior.test.tsx` reproduced
  the empty bottom group before the fix and passed afterward. Synchronization
  now waits for initialization; the real component test includes the dynamic
  mount-position projection used by AppLayout.
- Keyboard fixtures now provide their own layout context instead of depending
  on the removed global singleton; 212 tests in those nine suites passed.
- Local Biome complexity analysis used a temporary maximum of 12 across all
  20 changed/new production files and reported no violations. Repository
  thresholds and suppressions were unchanged. No pushed Sonar analysis exists.
- A second native check found transferred content rendered into a detached portal
  host. The source snapshot and destination object/group state contained both
  panels. A real-component regression reproduced disappearance when the content
  surface was replaced. `DockablePanelLayer` now belongs to each layout, and its
  ref updates the destination consumed by panel portals and geometry. That
  regression and the other 40 tests in the two component suites passed.
- Temporary diagnostics for both native findings were removed.
- A subsequent native trace found a separate stale directory response: after
  workspace-2 reconstructed both tabs, a response still placing them in
  workspace-1 removed the destination's local copies. The new
  `WorkspacePanelSync.test.tsx` regression failed with that removal, then passed
  after cluster-scoped read invalidation was added around staging and settlement.
  It also proves that a later authoritative move still removes the old copy.
  All 16 sync tests passed. The temporary trace was removed.
- The final native recheck of that race fix is **blocked**: computer-use reported
  that the Mac was locked and could not be unlocked automatically. The
  development app/server were stopped before rerunning coverage.
- Final frontend coverage: 5,054 tests in 525 files passed. The instrumented
  changed production files covered 1,854 of 2,023 statements (91.65%).
  `AppLayout.tsx` and `AppDebugOverlays.tsx` were not instrumented by this suite;
  the percentage does not claim coverage for them. Whole-suite statement
  coverage was 89.71%.
- Final local complexity: all 20 changed/new production files passed Biome's
  cognitive-complexity check with a temporary maximum of 12 after the race fix.
- Final `mise exec -- wails3 task qc:prerelease` exited 0 after the stale-read
  fix, including backend race tests, vet/staticcheck, binding checks, frontend
  lint/types and 5,054 tests, Knip, documentation checks, and the configured
  vulnerability scan. The gate reported no frontend formatting changes.
  Final worktree inspection found the panel production changes, supporting test
  fixtures/regressions, and the two owning documentation files. `git diff --check`
  passed. No Go protocol implementation changed in this step.

### Native evidence and remaining checks

Using disposable Kind cluster `codex-panel-check`, namespace
`panel-refactor-check`, and ConfigMaps `panel-alpha`/`panel-beta`, the native macOS
development app exercised the following before the final stale-read fix:

- Whole-group Float and Dock to bottom preserved two tabs, their order, the
  selected beta YAML view, namespace, and ConfigMap UID.
- Menu-based tab reorder and single-tab Float retained source content. Focusing
  beta from its table row brought back the existing native panel. Docking that
  tab into the occupied bottom group selected beta and closed the empty native
  source.
- An unsaved YAML draft blocked dock-back, window close, and Quit. Cancelling
  the edit discarded the draft; it was not saved to Kubernetes.
- Cluster Move to new window restored navigation/table state but lost the
  panels. This is the **failed** native case traced to the stale directory read;
  automated red/green evidence does not count as its native recheck.
- Automated drag attempts did not change tab order or deliver a destination
  drop. A real manual destination drop, tear-off/phantom-animation check, and
  full native transfer matrix remain **pending**.
- Windows validation remains **pending**. A Windows environment was requested;
  none has been provided in this task.

This phase is unfinished while the native regression recheck and required
platform/drop checks remain outstanding. The backend consolidation below is
also still pending.

The native app/server were stopped. The original selected/active kubeconfig
preferences were restored from the pre-test snapshot and read back successfully.
The disposable Kind cluster and both temporary kubeconfigs were removed.

### Remaining backend transfer boundary

No Go protocol changes are included in this renderer step. The three existing
protocols still need consolidation. Inspection identified distinct commitments:

- Whole-group open/dock combines `panelIndex` state with cluster reservations,
  runtime retention, hidden-window creation, readiness, and directory placement
  (`internal/appwindow/registry.go`, `internal/appwindow/panel.go`).
- Panel-tab transfer tracks requested/inserting/opening phases. Existing targets
  commit on exact snapshot publication; a new target delegates to the whole-group
  opening protocol (`internal/appwindow/panel_tab_transfer.go`).
- Cluster-view transfer stages backend view membership and navigation, preserves
  an existing target's navigation, and closes empty source/provisional windows
  after releasing transfer locks (`internal/appwindow/cluster_tab_transfer.go`).

The next backend change must unify transaction ownership and settlement while
preserving those preparation policies, authenticated callers, replay rejection,
source retention, timeout rollback, and synchronous native-close lock ordering.
It remains pending; removing renderer copies does not complete that change.

### Backend continuation — 2026-09-21

Consolidate the three lifecycle implementations into one typed transfer owner
for admission/replay rejection, awaiting-source/awaiting-target phases, timeout
replacement, and terminal removal. Keep protocol payloads and preparation
policies typed: group transfers own native-role snapshots, tab transfers commit
exact publication, and cluster transfers stage backend view membership. Separate
typed instances preserve the existing ID namespaces, including the deliberate
same-ID handoff from a tab transfer to new-window opening.

Producers are the group open/dock, tab request/accept, and cluster request/accept
entry points. Consumers are readiness acknowledgements, panel publication,
provisional publication filtering, cluster-close preflight, window-close cleanup,
and timeout handlers. Existing adapter locks continue to serialize the actual
directory/backend mutation. The shared owner adds no mutex; callbacks acquire
the existing adapter locks through protocol failure entry points. Cluster
transfers release the workspace lock around backend selection and release both
transfer/workspace locks before native closure.

The shared owner depends only on the standard library. It must not import the
registry or backend, avoiding reverse dependencies. Preserve the existing
protocol characterization suites for caller checks, replay, retained sources,
exact publication, timeout rollback, and reentrant native closure. Re-run native
checks after integrating all adapters.

Native renderer recheck on 2026-09-21 passed before the backend rebuild:
cluster-tab “Move to new window” retained alpha/beta, bottom placement, order,
beta's selected YAML view, and the disposable ConfigMap's namespace/UID in the
destination (native accessibility and screenshot inspection). The user then
confirmed that actual beta tear-off and return drops preserved YAML and closed
the empty floating window: “Both drops worked.”

### Final continuation evidence — 2026-09-21

This record supersedes the pending native/backend statuses above.

- Backend implementation: group, panel-tab, and cluster-view adapters now use
  `transferLifecycle[T]` for replay admission, acknowledgement phases, timeout
  replacement, and settlement. Preparation and commit policies remain in their
  adapters. The durable contract is in
  [acknowledged handoffs](../frontend/dockable-panels.md#acknowledged-handoffs).
- Regression: `TestLivePanelSnapshotCannotAdoptAnotherWindowsTransfer` first
  failed because a live snapshot adopted another window's opening state. It
  passed after binding pending group operations to their native window. The
  test also proves closing that live window cannot cancel the other opening.
- Characterization: closing an unrelated native window leaves a pending tab
  transfer usable; closing its actual destination reports failure to both
  participants, preserves source identity/placement, and rejects late acceptance.
  `TestClosingTransferTargetPreservesSourceAndIgnoresUnrelatedWindowClosure`
  passed. Its native-close callback is a stub; the separate native checks below
  establish actual window behavior.
- macOS final backend build: native accessibility and screenshot checks passed
  for two-tab group Float/dock-bottom, beta-only context-menu Float/dock-bottom,
  and cluster-tab Move to new window. The destination retained alpha/beta order,
  bottom placement, beta's selected YAML view, namespace, and ConfigMap UID
  `add6d075-d060-4528-9f7d-6c303aed4552`. The empty floating source closed on return.
  An unsaved beta YAML draft blocked Quit; canceling the disposable draft allowed
  clean quit. Actual drag/drop evidence is the user's manual check above; the
  final rebuild used native menu/button transfers, not synthesized drops.
- Windows: the user reported, “I ran the windows check. It looks good.” Recorded
  as user-performed acceptance, not agent-observed Windows execution; no build
  identifier was supplied.
- Cleanup: the native app and development server stopped. Original selected and
  active kubeconfig preferences were restored from the pre-test snapshot and
  read back. Kind deletion reported removal of `codex-panel-final-control-plane`;
  both temporary kubeconfig files were removed. Other settings were preserved.
- Local complexity: pinned `gocognit@v1.2.1` measured 138 functions across the
  eight changed production files; maximum score 11. This is local evidence;
  no pushed revision or current Sonar PR analysis is available for these edits.
- Final backend coverage: `wails3 task test:backend-coverage` exited 0 after the
  destination-close test was added. The eight changed production files measured
  1,292/1,470 statements (87.89%); every file exceeded 80%. The shared lifecycle
  measured 34/37 (91.89%), tab transfer 161/195 (82.56%), and the appwindow package
  89.1%. Coverage measures automated contracts; it does not replace native checks.
- Final automated gate: `wails3 task qc:prerelease` exited 0 after the added
  destination-close characterization test. Go race tests, vet/staticcheck,
  bindings, frontend lint/types, 5,054 tests across 525 frontend files, Knip,
  Markdown links, and the configured vulnerability scan passed. The first run
  stopped on Go formatting in the mechanically updated test fixture; it was
  corrected before the passing final run. Worktree inspection found only the
  intended transfer code, tests, and these owning-contract/completion docs.

The requested implementation and recorded acceptance work are complete. Changes
remain uncommitted; no Git state-changing commands or PR creation were performed.

### Windows floating-window latency investigation — 2026-09-21

The user reports approximately one second of visible “Moving panels…” status
before a new window appears, using `wails3 dev` on a separate Windows machine.
The agent host is macOS. Windows latency has not been reproduced or attributed.

Prepare opt-in timing capture before attempting an optimization. Producers are
source float/tear-off, frontend bootstrap/readiness, and backend panel creation
and acknowledgement. The existing Application Logs are the consumer. Correlate
by transfer ID and cluster, record local monotonic elapsed times, and emit batched
samples after each measured phase. Keep source retention, guard decisions,
publication ordering, and native show timing unchanged. The frontend recorder
must not import the logging/module graph on startup; load its existing logger
only when emitting. The backend accepts a logging callback from composition;
it does not import backend implementations. Recorder tests cover clock units,
interleaved transfer isolation, opt-in behavior, and destination deduplication;
existing transfer/bootstrap suites cover the surrounding operational contract.

The recorder is implemented. Remaining work is to capture the reported behavior
on the user's Windows development build, identify the dominant interval, then
reproduce and verify an appropriate fix. Local passing tests cannot establish
Windows latency or improvement.

Recorder validation:

- New recorder tests first failed because the implementation did not exist, then
  passed. Interleaved frontend samples exposed a concurrent lazy-import issue
  during validation; sharing one logger import promise made both samples arrive.
- Focused existing transfer/bootstrap suites passed. The backend opt-in test
  exercises the real registry with native show stubbed and proves showing still
  waits for acknowledgement with tracing enabled and disabled.
- Both required coverage tasks passed: 5,057 frontend tests in 526 files;
  directly changed frontend files 589/653 statements (90.20%), backend files
  561/641 (87.52%). Each new recorder measured 100% statement coverage; every
  changed file exceeded 80%.
- Local Go complexity maximum 11. The six changed TypeScript production files
  passed Biome's cognitive-complexity rule with an explicit maximum of 12.
  No remote Sonar analysis of this uncommitted instrumentation is available.
- Tracing-enabled frontend validation passed: 56 transfer/bootstrap workflow
  tests in four files with `VITE_PANEL_OPEN_TIMING=1`.
- Final `mise exec -- wails3 task qc:prerelease` passed, including the backend
  race suite, 5,057 frontend tests, typechecking, lint, documentation checks,
  dependency checks, and vulnerability scan. The gate formatted one frontend
  file; post-gate worktree inspection found only the intended diagnostic code,
  tests, and this completion record. Windows performance capture remains pending.

Capture on Windows after bringing the diagnostic changes into that checkout:

```powershell
$env:VITE_PANEL_OPEN_TIMING = "1"
mise exec -- wails3 dev
```

Stop an existing dev session first so both the native executable and Vite inherit
the flag. Float and dock back three times, then perform one drag-out. In the
workspace, open View → Application Logs, include Info messages, filter for
`[DEBUG-panel-open]`, and copy the filtered logs with “Copy logs to clipboard.”
All four phases use the existing app log buffer: `source`, `backend-create`,
`destination`, and `backend-ready`. Transfer IDs join the samples; cluster metadata
remains scoped. No object contents are included. These diagnostics are local
Application Logs, with the same existing logging/reporting policy as other app
logs; they do not add a reporting endpoint.

`elapsedMs` is cumulative within its phase; subtract adjacent marks to obtain
individual stage costs. Destination elapsed time begins at the browser's
navigation time origin, so `entry-module-evaluated` includes time before the
entry module starts. `startedUnixMs` is for approximate cross-process alignment;
use local monotonic elapsed times for durations. Backend creation measures the
Wails creation call's return, not a promise that the webview has finished loading.
Source `settled` includes either completion or cancellation. Compare repeated
samples to distinguish first-use costs from costs on every float.

After capture, stop the dev session and remove the flag before restarting:

```powershell
Remove-Item Env:VITE_PANEL_OPEN_TIMING
```

The `[DEBUG-panel-open]` instrumentation is temporary investigation work. Remove
it when the Windows measurement and any resulting fix have been verified.
