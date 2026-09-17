# Repository simplification ledger

Baseline: `6d93acb773ab245e79b9e5c932fc2e87e9d5a8c0` (2026-09-16).
Scope: the repository, including quiet code; recency does not restrict selection.
Follow the [systematic workflow](../workflows/code-simplification.md).

## Target and non-goals

Reduce the number of independently understood policies, representations, state
owners, and control-flow paths needed to change a workflow. Preserve behavior,
identity, error handling, performance contracts, and UI. Prefer the established
shared owner. No new framework, dependency, compatibility layer, behavior fix,
commit, or PR is implied by this ledger.

## Baseline evidence and limits

The tracked-file inventory at the revision above contains **1837
implementation files**, **299678 physical lines**, and **236 review buckets**:
991 Go files, 705 JS/TS files, and 141 style/script/markup/installer files.
An additional 1,111 source files were classified as tests, stories, benchmarks,
or test support; 111 were classified as generated source. These are inventory
classifications, not reviewed production/validation guarantees.

A full local scan found **90 Go** functions and **132 JS/TS** functions above 12.
Go used pinned gocognit v1.2.1; JS/TS used the installed Biome with a temporary
limit of 12. These are investigation signals, not 222 confirmed simplification
opportunities. Do not combine analyzer scores or claim remote Sonar closure.
Zero flags does not remove a bucket from review.

Inventory recipe:

- Enumerate `git ls-files` at the baseline revision; retain authored
  `.go/.ts/.tsx/.js/.jsx/.mjs/.cjs/.css/.sh/.ps1/.grit/.html/.nsi/.nsh` source.
  Include C/C++/Objective-C source if introduced later.
- Identify generated source from `frontend/bindings/`, generated filename
  markers, and generation headers in the first 1,000 characters. Review its
  generator instead. Verify ambiguous classifications while reviewing a unit.
- Separate `_test.go`, `.test/.spec/.stories/.bench` files, test/support/fixture
  directories, Vitest setup, and refresh test builders. Inspect their meaningful
  coverage with the owning implementation; they are not simplification targets
  merely because they repeat fixture setup.
- Bucket backend root files by their first underscore-separated filename token;
  these labels are search buckets, not assertions about architectural ownership.
  Bucket backend resources, refresh, internal, and kind code by child package.
  Bucket frontend core/modules/ui by child directory, shared components by
  component family, other frontend source by its first shared directory, and
  remaining source by its top-level package/directory. Root bucket rows exclude
  their separately listed child buckets.
- Go measurement: `GOCACHE=/tmp/luxury-yacht-go-build mise exec -- go run github.com/uudashr/gocognit/cmd/gocognit@v1.2.1 -json backend internal cmd`;
  retain only authored implementation paths. Top-level `main.go` remains in
  the review ledger although it was outside that analyzer invocation.
- JS/TS measurement: run installed `biome lint` over the authored JS/TS paths
  with only `lint/complexity/noExcessiveCognitiveComplexity`, using a temporary
  configuration with `maxAllowedComplexity: 12`. Do not change repository lint
  thresholds or the Sonar baseline.
- Refresh the file inventory at the start of each pass. Carry new files into
  their bucket and record splits/renames; retain completed review evidence.

Configuration, CI definitions, dependency manifests, documentation, assets, and
signing/public-key metadata are outside source counts. They remain companion
scope for their owning review: generators and tooling include CI/build inputs;
UI includes CSS/assets; each domain includes its docs/tests. Do not claim these
companions have been audited from the numeric inventory.

## Rotation through review domains

This is an investigation order, not a list of approved rewrites. Each visit
reviews a substantial subsystem scope and groups its related simplifications
into one delivery batch. Incremental edits get focused checks; the full
repository gate runs at the batch boundary. Record the remaining domain scope.
After domain 14, restart with unreviewed responsibilities. Record any
correctness-driven interruption and resume the rotation afterwards.

| Order | Domain | Initial scope and required adjacent paths | Status |
| --- | --- | --- | --- |
| 1 | Shared tables | Shared table hooks/rendering; resource-grid adapters; snapshot/querypage consumers | S001 sizing/measurement inspected; remaining scope below |
| 2 | Catalog and resource projections | Object catalog; per-kind resources; kind/model contracts; Browse adapters | S002 query/facet/snapshot batch; remaining scope recorded |
| 3 | Cluster/workspace/auth | Backend cluster/workspace owners and auth helpers; Kubernetes/cluster workspace contexts | S003 selection/hydration batch; remaining scope recorded |
| 4 | Refresh and data access | Refresh APIs, stores, snapshots, ingestion, streams, metrics and governor; frontend refresh/data brokers | Next: S004 |
| 5 | Object details and panels | Object-panel overview/YAML/actions; detail gateway; panel-window ownership | Inventoried |
| 6 | Operations | Shell/debug, logs, port-forward, drain, runtime registry; detail/event consumers | Inventoried |
| 7 | Object map | Backend graph producers and relationships; frontend graph, layout and renderer | Inventoried |
| 8 | Permissions and mutations | Capability policy, permission caches, object actions/YAML; frontend availability gates | Inventoried |
| 9 | Navigation and interaction | Sidebar, routing, shortcuts, command palette, modals, shared inputs and menus | Inventoried |
| 10 | Preferences and persistence | Settings, favorites, UI state, import/export/reset; frontend state hydration | Inventoried |
| 11 | Errors and diagnostics | Error classification/reporting, logs, telemetry, request diagnostics | Inventoried |
| 12 | Native lifecycle and windows | Bootstrap, app lifetime, desktop transport, peer windows, dockable ownership | Inventoried |
| 13 | Updates and engineering tooling | Updater/installers; generators; project tasks; build/CI; lint rules and test infrastructure | Inventoried |
| 14 | Shared primitives and remaining inventory | Utility/formatting/identity helpers, types, styles, root source, and unclaimed companion files | Inventoried |

The unit ledger below prevents this domain rotation from silently omitting a
package. Assign each visited unit a primary domain in its pass record. Cross-layer
consumers may be inspected in several passes; that does not automatically close
all responsibilities in those consumers. Split oversized buckets before review.

## S003 — cluster/workspace selection and hydration

**Status: selected batch implemented; affected checks and final gate passed.** Baseline:
`2e6b4a5d410f525ebca19e733b988ffb10d29fba`; `git status --short` was empty.
Inventory refresh (`git diff --name-status 6d93acb7 HEAD`) showed no authored
production file additions/removals since the source baseline. S003 adds
`frontend/src/modules/kubernetes/config/kubeconfigSelection.ts` to the existing
Kubernetes bucket; source counts in the table below remain baseline counts.

Inspected: workspace selection/restore/prune/close ownership, client pool
construction/removal, mutation generations and runtime intents, auth recovery
manager and event projection, frontend workspace hydration, kubeconfig provider,
and lifecycle/auth/readiness selector seams. Preserve independent owner locks,
the auth retry loop, queued callback admission, and visible versus committed
frontend selection; these encode documented ordering, not duplicate ownership.

Implemented candidates:

- Centralize normalize-and-validate in Cluster Runtime for startup restore,
  startup connection, and selection commands; retain each caller's error policy.
  Reuse the existing path/context identity key for watcher deselection.
- Give frontend selection rules one local model: parsing/identity, normalization,
  active-tab planning, and cluster-ID projection in `kubeconfigSelection.ts`.
  Resolve the next active tab once per transition and reuse existing
  visible/committed update helpers during
  hydration. Keep RPCs, event order, rollback, and async guards in the provider.
- Represent live hydration fields directly by cluster and typed field instead
  of encoded strings and repeated prefix scans. Keep markers per in-flight read,
  preserve later-authoritative healing, and publish before waking readiness.

Producer/consumer boundaries: discovered kubeconfigs feed all three backend
selection paths; runtime events and workspace RPCs feed the existing frontend
store; provider selection feeds tabs, panel preflights, auth overlay, and refresh
context. No wire DTO, import direction, owner lock, callback order, readiness
gate, or runtime dependency changes are intended. The selection model depends
only on backend model types and the existing tab-order helper, not its provider.
Characterization covers tolerant restore versus rejecting commands, independent
live fields during overlapping reads, removal/re-addition, stale requests,
foreground activation, and cluster-close rollback.

Validation:

- New characterization cases passed on the original code before refactoring:
  `TestWorkspaceSelectionResolutionPreservesRestoreAndCommandPolicies` and
  the overlapping-read case in `clusterWorkspaceStore.test.ts`. Focused baseline
  logs: `/tmp/luxury-yacht-s003-before-backend.log` and
  `/tmp/luxury-yacht-s003-before-frontend.log`.
- Incremental selection, store, and provider checks passed after their edits.
  Logs: `/tmp/luxury-yacht-s003-selection.log`,
  `/tmp/luxury-yacht-s003-store.log`, `/tmp/luxury-yacht-s003-provider.log`.
- Affected backend suites passed with coverage: `backend` 80.0%,
  `backend/internal/authstate` 93.0%. Changed production functions are 89.5–100%
  covered. Evidence: `/tmp/luxury-yacht-s003-backend-coverage.log` and
  `/tmp/luxury-yacht-s003-backend-functions.txt`. The linker printed macOS
  deployment-target warnings in both baseline and final package runs; both
  exited successfully.
- Frontend selection/store and adjacent tab/auth/lifecycle/readiness consumers
  passed 10 files / 117 tests with affected coverage: workspace store 89.33%,
  provider 90.79%, selection model 84.72%. Log:
  `/tmp/luxury-yacht-s003-frontend-coverage.log`. These exercise real React/store
  owners with backend/native calls mocked; native window placement, focus, and
  destruction were not changed or claimed as validated.
- Typecheck passed. All changed Go functions score 2–8 under pinned gocognit
  v1.2.1; Biome's isolated complexity check passed all three changed TS/TSX
  sources at threshold 12. Logs: `/tmp/luxury-yacht-s003-typecheck.log`,
  `/tmp/luxury-yacht-s003-go-complexity.json`, and
  `/tmp/luxury-yacht-s003-ts-complexity.log`. No remote Sonar result is claimed.
- One final `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` passed, including backend race tests, frontend checks and 4,766 tests, Knip, and Trivy. Log: `/tmp/luxury-yacht-s003-prerelease.log`. Post-gate `git status --short` and diff inspection showed only the eight production files, two characterization test files, and this ledger; no additional formatter changes. `git diff --check` passed. The final ledger update receives a separate `qc:docs` check.

Remaining domain scope: kubeconfig discovery internals/watch delivery, transport
health/heartbeat, API diagnostics, native panel transfer/close implementations,
and credential-helper internals. Their call sites/contracts were inspected where
needed; this batch does not close those responsibilities. Rejected consolidation:
client-removal loops differ in auth shutdown, operation cleanup, metrics, and
publication order; combining them behind flags would obscure those contracts.
The established auth retry state machine and separate owner locks remain intact.

## Next batch: S004 — refresh and data access

Review refresh scheduling, state ingestion, and frontend data-access ownership.
Start from the freshness contract and retained/background demand boundaries;
collect related simplifications before editing, with focused incremental checks
and one final repository gate.

S001 established an inefficient delivery size: a one-file production change paid
for a full frontend coverage run and a full repository gate. Future batches
follow the revised workflow's validation levels; S001 is not the throughput model.

## S002 — catalog query, facets, and snapshot assembly

**Status: selected batch implemented; affected checks and final gate passed.**
Baseline remains `3741bafe3443346cbf8190fc2cad7327ea4f824d`; S001's uncommitted
changes were preserved. The batch removes three related sources of repetition:

- `backend/objectcatalog/query_engine.go`: two facet-filter representations,
  constructors, dependency matchers, and collection loops become one owner.
  Maintained-store and snapshot selectors retain their different namespace
  universes through an explicit predicate and retain cached/approximate behavior.
  Named facet sets replace positional map tuples with different return orders.
- `backend/refresh/snapshot/catalog.go` and `catalog_refresh_adapter.go`: parse
  validated Browse scopes directly into `objectcatalog.QueryOptions`, removing
  the duplicate 16-field `browseQueryOptions` and field-copy method. Same-cluster
  anchor validation still precedes the service-local anchor conversion; query
  signature, cursor, structural scope, and readiness ordering stay in their
  existing owners. Snapshot pagination fallback is expressed once.
- Four snapshot slice-copy implementations become `cloneCatalogValues`, retaining
  detached slice storage and non-null empty arrays. Tests cover input mutation
  after snapshot assembly and the JSON empty-items contract.

Inspected source scope: catalog query normalization/execution/facets, index and
query-store interfaces, summary construction and metadata, registry-backed RBAC
summary producers, snapshot parsing/assembly/adapter, and their tests. Consumer
seams checked: Browse baseline/page reconciliation and filter options, command
palette catalog results, ObjectDiff namespace options, catalog-diff snapshot
merge, and catalog diagnostics. The stateful catalog collect/watch/sync lifecycle
and other per-kind projections remain unreviewed. Existing registry dispatch and
separate maintained/snapshot result policies remain warranted; no new catalog
engine, kind registry, or cross-owner state was introduced.

The producer chain remains validated scope → per-cluster catalog query → snapshot
assembly → existing refresh consumers. The changes introduce no package import
direction or runtime dependency. Five facet characterization scenarios and two
snapshot ownership/JSON scenarios passed before refactoring. Existing anchor,
family, scope, cursor, and query-oracle assertions are retained; test call sites
now use the single options type.

Validation:

- Focused query and catalog snapshot tests passed before and after their edits;
  no unrelated full-suite baseline was run.
- Both affected package suites passed with coverage: `backend/objectcatalog`
  86.3%, `backend/refresh/snapshot` 82.6%. Directly changed functions range from
  81.5% to 100%; the shared facet path and copy helper are 100%. Evidence:
  `/tmp/luxury-yacht-s002-coverage.log` and
  `/tmp/luxury-yacht-s002-function-coverage.txt`.
- Frontend consumer selection passed 15 files / 166 tests (Browse, command
  palette, ObjectDiff, snapshot merge, catalog diagnostics). These use the test
  environment and do not establish native layout behavior; no UI interaction or
  appearance behavior was changed.
- All changed Go functions/new helpers are at most 12 under pinned gocognit
  v1.2.1; the generic copy helper is 0. This is local complexity evidence, not a
  claim about remote Sonar analysis.
- Existing 10,000-row query microbenchmarks ran twice at 10 iterations using a Go overlay for the original implementation. Empty-search samples were 8.96–9.27 ms before / 8.72–8.78 ms after; namespace-filter samples were 10.73–11.02 ms before / 10.91–10.97 ms after, with approximately the same allocations. This limited local sample is not a system-performance result. Logs: `/tmp/luxury-yacht-s002-benchmark-before.log` and `/tmp/luxury-yacht-s002-benchmark-after.log`.
- One final `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` passed for the accumulated batch, including backend race tests, frontend checks and 4,765 tests, Knip, and Trivy. Log: `/tmp/luxury-yacht-s002-prerelease.log`. Post-gate `git status --short` and `git diff --stat` showed the expected S002 files plus preserved S001 changes, with no additional formatter changes; `git diff --check` passed. Only this validation record was finalized after the gate; `qc:docs` was rerun for the documentation update.

Remaining domain scope includes lifecycle/ingest, descriptor discovery and lookup,
action-fact enrichment, and other kind projections. This closes the selected
query/facet/snapshot responsibility only, not the whole catalog domain. S001-C2
remains a separately deferred behavior issue.

## S001 — table sizing and measurement

Baseline: `3741bafe3443346cbf8190fc2cad7327ea4f824d`. A read-only
`git diff --name-only 6d93acb7 HEAD` before editing listed only the four workflow,
skill, and ledger documents; the authored-source inventory still had 79 table
files. Source counts below retain the original baseline rather than mixing old
and new physical line counts.

### Review partition and inspected scope

| Responsibility | Baseline files | Baseline lines | Biome signals | Review status |
| --- | ---: | ---: | ---: | --- |
| Sizing/measurement | 8 | 2059 | 7 | Inspected; dispositions below |
| Columns/persistence | 18 | 3281 | 5 | Inventoried; width persistence seam inspected only |
| Filtering/pagination | 13 | 2613 | 2 | Inventoried |
| Keyboard/selection/menus | 15 | 2546 | 4 | Inventoried |
| Rendering/virtualization/composition | 25 | 4084 | 7 | Inventoried; sizing invalidation seam inspected only |

These subgroups partition the original 79-file bucket; they are not five
completed subsystem reviews. Assign files in order: the eight sizing files
below; filenames containing `Filter`, `Pagination`, `pageSize`, or
`MetadataSearch`; filenames containing `Keyboard`, `Focus`, `Hover`,
`ContextMenu`, `Shortcuts`, `RowControls`, `Interaction`, `FrameSampler`,
`HeaderActions`, or `Keys`; the persistence directory and filenames containing
`Column`, `column`, `Metadata`, or `restartCount` except `Virtualization`;
finally the remaining rendering/composition files. Revise these search buckets
when a later owner trace establishes a better boundary.

All eight sizing sources were read under
`frontend/src/shared/components/tables/hooks/`:
`gridTableColumnWidthMath.ts`, `useColumnResizeController.ts`,
`useGridTableAutoWidthMeasurementQueue.ts`, `useGridTableColumnLayout.ts`,
`useGridTableColumnMeasurer.ts`, `useGridTableColumnWidths.helpers.ts`,
`useGridTableColumnWidths.ts`, and `useGridTableExternalWidths.ts`.

Additional inspected seams: the controller's column-layout call and virtual-row
invalidation effect; `useGridTableBinding.ts` width-prop forwarding;
`useGridTablePersistence.ts` width setter and save effect; the relevant sizing,
measuring, resize, queue, and GridTable interaction tests. Reading these seams
does not close the containing files' other responsibilities.

### Contract and decisions

The layout hook passes the page-backed measurer and controlled widths to the
width owner. That owner creates the dirty queue; the resize controller produces
manual-resize events, while the table controller marks visible automatic
columns dirty after virtual-row bounds change. Width changes flow through the
notifier to the persistence-backed callback. The sizing path consumes column
keys, not Kubernetes object references; no cluster/object boundary was changed.

Preserved ordering: clear pending measurements before entering drag; clear
per-column state before leaving drag; allow the queue to admit work only outside
drag; clear stale signatures before auto-size/reset; reset additionally queues
all automatic columns. Missing rendered cells retry after the existing throttle,
page replacement retains its independent full-page measurement, and unmount
retains timer cleanup. Imports and dependency directions were not changed; no
new helper or runtime dependency was introduced.

- **S001-C1 — queue event/admission duplication: validated.**
  `useGridTableAutoWidthMeasurementQueue.ts` had repeated drag/drag-end cleanup
  and auto-size/reset setup. Grouped their shared switch cases while retaining
  distinct phase changes and reset scope. Combined the admission guards and
  removed the duplicate drag guard from the caller. Removed `pendingRetryRef`:
  a whole-file search found its declaration and assignments, with no reads;
  the retry set and timer continue to own pending work. Production diff is one
  file; the consolidation introduces no additional helpers.
- **S001-C2 — delayed width notification: deferred behavior issue.** A new
  characterization probe on the pre-refactor code measured delayed cells at 220
  after initialization at 100. The width record read 220, but the expected
  `onColumnWidthsChange` callback did not run. Temporary instrumentation showed
  notifier effects only for 150 and 100. This is hook-level evidence, not a claim
  about the rendered/native app. Suspected cause: the initial width plan returns
  the same object for `widths` and `naturalWidths`, while the dirty flush mutates
  natural widths after scheduling a state update. Investigate state aliasing
  under a separately scoped behavior fix; preserve current behavior here.
  Reproduce by adding a callback assertion after the 220-width assertion in
  `useGridTableColumnWidths.test.tsx`'s “retries unrendered cells” case, using the
  existing setup callback, cleared after initialization. The new passing test
  deliberately asserts retry/measurement/deduplication only; it does not establish
  notification correctness. Diagnostic log:
  `/tmp/luxury-yacht-s001-notifier-diagnostic.log` (temporary evidence).
- **S001-C3 — merge page measurement with the dirty queue: not warranted.**
  `gridtable-sizing.md` and `useGridTableColumnWidths.helpers.ts` require page
  replacement to shrink widths even without rendered cells; the dirty queue
  deliberately waits for visible signatures and normally only grows widths.
  Combining them would obscure two different invalidation contracts.
- **S001-C4 — general table configuration/width-state replacement: not warranted
  by this pass.** Existing layout, persistence, resize, and inert-measurement
  owners already separate these responsibilities. The settled table-schema
  finding remains applicable. The unchanged per-column dirty-flush callback
  still has a local Biome score of 23; do not claim the whole file is below 12.
  Reconsider that callback while investigating C2 rather than layering new
  helpers over an unresolved state-ownership question.

### Validation evidence

- Before refactoring, all 60 table test files / 436 tests passed
  (`mise exec -- npm run test --prefix frontend -- src/shared/components/tables`).
- Four new characterization cases passed against the original implementation:
  delayed-cell retry and signature deduplication; auto-size shrink scope;
  reset remeasurement scope; drag cancellation, notification suspension, and
  resumed automatic measurement. They use the real width-state hook, fake
  timers, synthetic DOM cells, and a stubbed measurer; they do not prove browser
  layout or native window behavior. Existing assertions were not changed.
- After refactoring, the same table command passed 60 files / 440 tests.
- `mise exec -- wails3 task test:frontend-coverage` passed 512 files / 4765 tests.
  Statement coverage: queue 92.76%, width owner 92.24%, width helpers 95.3%.
  Reports moved to `/tmp/luxury-yacht-s001-coverage` before repository lint.
- Local Biome checks: changed queue admission 18 → 10; resize dispatcher 13 → 11;
  changed flush function 12; shared case callbacks 4 each; caller and outer hook
  at most 1. All changed functions are at most 12. The unchanged inner flush
  callback remains 23. These are local signals, not remote Sonar closure.
- `mise exec -- npm run typecheck --prefix frontend` passed.
  `mise exec -- npm run build:dev --prefix frontend` passed with the Vite warning
  about chunks larger than 500 kB; no rendered/native interaction claim is made.
  The production diff changes queue bookkeeping, not sizing geometry, gesture
  coordinates, markup, or native window calls.
- `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` passed, including race tests, frontend checks/tests, Knip, and Trivy. Log: `/tmp/luxury-yacht-s001-prerelease.log`. The final worktree contains only this ledger, the queue source, and its added width-hook characterization cases; no formatter changes outside that scope were present. `git diff --check` passed. After this evidence update, `qc:docs` was rerun.

Remaining table scope: C2, the dirty-flush callback, and the other four review
subgroups. The eight-source review and validated refactor must not be reported
as completion of the entire table bucket or resolution of the deferred bug.

## Pass record format

Each pass records: domain/unit and baseline; exact inspected files and consumers;
maintenance cost with evidence; target model and removed complexity; alternatives
and intentional complexity; ordering/identity/cycle risks; validation required
and actual results; candidate disposition; remaining unit scope; next domain.
Use `not warranted` for an evidence-backed decision to keep the code, and
`deferred` with a re-entry condition for outstanding work. Unrun required checks
remain pending. A candidate is not confirmed merely because its score exceeds 12.

## Earlier local work

Commit `6d93acb7` contains the earlier client/orchestrator, session-hydration,
and telemetry edits plus their characterization tests. Those were local passes,
not reviews of the containing subsystems. The new ledger therefore begins with
**zero fully reviewed units**. Existing validation does not carry forward as
proof for a future worktree; rerun affected checks after new changes.

## Review-unit ledger

Every row below starts **inventoried**. Counts refer only to the baseline source
classification above. `Go / JS` counts functions above 12 separately; a dash
means no signals in that language, not no review work. Update the last column
with reviewed scope and a pass reference, or split the row before reviewing.

| Review bucket | Files | Physical lines | Go / JS signals | Review |
| --- | ---: | ---: | ---: | --- |
| `.claude/hooks` | 1 | 86 | — / — | Inventoried |
| `.github/actions` | 1 | 180 | — / — | Inventoried |
| `backend/(root: app)` | 3 | 327 | — / — | Inventoried |
| `backend/(root: application)` | 6 | 1084 | 1 / — | Inventoried |
| `backend/(root: auth)` | 1 | 185 | — / — | Inventoried |
| `backend/(root: autoscaling)` | 1 | 60 | — / — | Inventoried |
| `backend/(root: cluster)` | 23 | 3451 | 1 / — | Reviewing: S003 selection resolution; remaining scope recorded |
| `backend/(root: crd)` | 1 | 28 | — / — | Inventoried |
| `backend/(root: data)` | 2 | 517 | 1 / — | Inventoried |
| `backend/(root: desktop)` | 10 | 1689 | — / — | Inventoried |
| `backend/(root: devmode)` | 2 | 10 | — / — | Inventoried |
| `backend/(root: error)` | 2 | 253 | 1 / — | Inventoried |
| `backend/(root: events)` | 1 | 149 | — / — | Inventoried |
| `backend/(root: exec)` | 4 | 277 | — / — | Inventoried |
| `backend/(root: favorites)` | 2 | 572 | — / — | Inventoried |
| `backend/(root: fetch)` | 1 | 395 | — / — | Inventoried |
| `backend/(root: generate)` | 1 | 17 | — / — | Inventoried |
| `backend/(root: generic)` | 1 | 39 | — / — | Inventoried |
| `backend/(root: helm)` | 2 | 104 | — / — | Inventoried |
| `backend/(root: kubeconfig)` | 4 | 928 | 1 / — | Inventoried |
| `backend/(root: kubernetes)` | 1 | 83 | — / — | Inventoried |
| `backend/(root: logger)` | 1 | 371 | — / — | Inventoried |
| `backend/(root: menu)` | 1 | 246 | — / — | Inventoried |
| `backend/(root: node)` | 3 | 145 | — / — | Inventoried |
| `backend/(root: object)` | 11 | 2243 | — / — | Inventoried |
| `backend/(root: operations)` | 2 | 323 | — / — | Inventoried |
| `backend/(root: pod)` | 3 | 161 | — / — | Inventoried |
| `backend/(root: portforward)` | 6 | 1133 | 2 / — | Inventoried |
| `backend/(root: preferences)` | 5 | 2301 | 2 / — | Inventoried |
| `backend/(root: refresh)` | 18 | 4252 | 4 / — | Inventoried |
| `backend/(root: resource)` | 6 | 1450 | — / — | Inventoried |
| `backend/(root: response)` | 3 | 687 | — / — | Inventoried |
| `backend/(root: runtime)` | 2 | 304 | 1 / — | Inventoried |
| `backend/(root: settings)` | 1 | 229 | — / — | Inventoried |
| `backend/(root: shell)` | 2 | 765 | 1 / — | Inventoried |
| `backend/(root: static)` | 1 | 83 | — / — | Inventoried |
| `backend/(root: theme)` | 1 | 132 | — / — | Inventoried |
| `backend/(root: types)` | 1 | 82 | — / — | Inventoried |
| `backend/(root: ui)` | 2 | 334 | — / — | Inventoried |
| `backend/(root: update)` | 8 | 1186 | — / — | Inventoried |
| `backend/(root: window)` | 1 | 112 | — / — | Inventoried |
| `backend/(root: workload)` | 2 | 502 | 1 / — | Inventoried |
| `backend/(root: workspace)` | 16 | 2130 | — / — | Reviewing: S003 selection/restore/prune; remaining scope recorded |
| `backend/capabilities` | 4 | 866 | — / — | Inventoried |
| `backend/internal/applog` | 6 | 323 | — / — | Inventoried |
| `backend/internal/appupdates` | 2 | 1125 | 1 / — | Inventoried |
| `backend/internal/authstate` | 4 | 683 | — / — | Inventoried |
| `backend/internal/cachekeys` | 1 | 18 | — / — | Inventoried |
| `backend/internal/config` | 1 | 551 | — / — | Inventoried |
| `backend/internal/containerlogs` | 5 | 495 | 1 / — | Inventoried |
| `backend/internal/credentialerrors` | 1 | 226 | — / — | Inventoried |
| `backend/internal/errorcapture` | 4 | 589 | — / — | Inventoried |
| `backend/internal/genappbindings` | 2 | 306 | — / — | Inventoried |
| `backend/internal/genobjectactions` | 1 | 24 | — / — | Inventoried |
| `backend/internal/genrefreshcontracts` | 5 | 856 | 1 / — | Inventoried |
| `backend/internal/k8sretry` | 1 | 105 | 1 / — | Inventoried |
| `backend/internal/lifecycle` | 1 | 42 | — / — | Inventoried |
| `backend/internal/linescanner` | 1 | 20 | — / — | Inventoried |
| `backend/internal/logclassify` | 1 | 74 | — / — | Inventoried |
| `backend/internal/logsources` | 1 | 27 | — / — | Inventoried |
| `backend/internal/parallel` | 1 | 71 | — / — | Inventoried |
| `backend/internal/timeutil` | 2 | 107 | — / — | Inventoried |
| `backend/kind/kindregistry` | 2 | 168 | — / — | Inventoried |
| `backend/kind/kindspec` | 1 | 176 | — / — | Inventoried |
| `backend/kind/objectmap` | 1 | 54 | — / — | Inventoried |
| `backend/kind/objectmapnode` | 2 | 134 | — / — | Inventoried |
| `backend/kind/objectmapspec` | 2 | 183 | — / — | Inventoried |
| `backend/kind/streamrows` | 2 | 601 | — / — | Inventoried |
| `backend/kind/streamspec` | 1 | 64 | — / — | Inventoried |
| `backend/nodemaintenance` | 1 | 584 | — / — | Inventoried |
| `backend/objectaction` | 1 | 150 | — / — | Inventoried |
| `backend/objectcatalog` | 25 | 5995 | 8 / — | Reviewing: S002 query/facets; other responsibilities remain |
| `backend/objectyaml` | 1 | 130 | — / — | Inventoried |
| `backend/refresh` | 6 | 804 | 2 / — | Inventoried |
| `backend/refresh/api` | 1 | 304 | — / — | Inventoried |
| `backend/refresh/containerlogsstream` | 4 | 2200 | 3 / — | Inventoried |
| `backend/refresh/domain` | 2 | 264 | — / — | Inventoried |
| `backend/refresh/domainpermissions` | 2 | 754 | — / — | Inventoried |
| `backend/refresh/eventstream` | 2 | 484 | — / — | Inventoried |
| `backend/refresh/informer` | 4 | 1065 | 1 / — | Inventoried |
| `backend/refresh/ingest` | 6 | 2779 | 3 / — | Inventoried |
| `backend/refresh/metrics` | 4 | 999 | 2 / — | Inventoried |
| `backend/refresh/permissions` | 2 | 457 | — / — | Inventoried |
| `backend/refresh/querypage` | 10 | 3065 | 5 / — | Inventoried |
| `backend/refresh/resourcestream` | 20 | 3531 | 2 / — | Inventoried |
| `backend/refresh/ringbuffer` | 1 | 68 | — / — | Inventoried |
| `backend/refresh/snapshot` | 77 | 20864 | 11 / — | Reviewing: S002 catalog snapshot; other domains remain |
| `backend/refresh/streammux` | 3 | 844 | 2 / — | Inventoried |
| `backend/refresh/system` | 9 | 2505 | 1 / — | Inventoried |
| `backend/refresh/telemetry` | 1 | 707 | — / — | Inventoried |
| `backend/resourcecontract` | 1 | 200 | — / — | Inventoried |
| `backend/resourcekind` | 2 | 113 | — / — | Inventoried |
| `backend/resourcemodel` | 15 | 1977 | 3 / — | Inventoried |
| `backend/resources` | 1 | 12 | — / — | Inventoried |
| `backend/resources/admission` | 12 | 775 | — / — | Inventoried |
| `backend/resources/apiextensions` | 8 | 461 | 1 / — | Inventoried |
| `backend/resources/appbinding` | 1 | 22 | — / — | Inventoried |
| `backend/resources/argocd` | 3 | 497 | — / — | Inventoried |
| `backend/resources/backendtlspolicy` | 12 | 303 | — / — | Inventoried |
| `backend/resources/certmanager` | 1 | 224 | — / — | Inventoried |
| `backend/resources/clusterrole` | 13 | 381 | — / — | Inventoried |
| `backend/resources/clusterrolebinding` | 13 | 310 | — / — | Inventoried |
| `backend/resources/common` | 11 | 764 | — / — | Inventoried |
| `backend/resources/configmap` | 11 | 344 | — / — | Inventoried |
| `backend/resources/crdfacts` | 3 | 199 | — / — | Inventoried |
| `backend/resources/cronjob` | 11 | 746 | — / — | Inventoried |
| `backend/resources/customresource` | 6 | 601 | 1 / — | Inventoried |
| `backend/resources/daemonset` | 11 | 514 | — / — | Inventoried |
| `backend/resources/deployment` | 11 | 723 | — / — | Inventoried |
| `backend/resources/endpointslice` | 12 | 524 | — / — | Inventoried |
| `backend/resources/events` | 7 | 436 | — / — | Inventoried |
| `backend/resources/externalsecrets` | 1 | 182 | — / — | Inventoried |
| `backend/resources/gateway` | 12 | 327 | — / — | Inventoried |
| `backend/resources/gatewayapi` | 3 | 147 | — / — | Inventoried |
| `backend/resources/gatewayclass` | 12 | 307 | — / — | Inventoried |
| `backend/resources/generic` | 3 | 269 | 1 / — | Inventoried |
| `backend/resources/grpcroute` | 11 | 262 | — / — | Inventoried |
| `backend/resources/helm` | 5 | 750 | — / — | Inventoried |
| `backend/resources/hpa` | 12 | 866 | — / — | Inventoried |
| `backend/resources/httproute` | 11 | 257 | — / — | Inventoried |
| `backend/resources/ingress` | 13 | 604 | 2 / — | Inventoried |
| `backend/resources/ingressclass` | 11 | 340 | 1 / — | Inventoried |
| `backend/resources/job` | 10 | 501 | — / — | Inventoried |
| `backend/resources/karpenter` | 1 | 232 | — / — | Inventoried |
| `backend/resources/limitrange` | 10 | 316 | — / — | Inventoried |
| `backend/resources/listenerset` | 12 | 331 | — / — | Inventoried |
| `backend/resources/namespaces` | 8 | 511 | — / — | Inventoried |
| `backend/resources/networkpolicy` | 13 | 540 | — / — | Inventoried |
| `backend/resources/nodes` | 10 | 1846 | — / — | Inventoried |
| `backend/resources/persistentvolume` | 12 | 632 | — / — | Inventoried |
| `backend/resources/persistentvolumeclaim` | 12 | 516 | 1 / — | Inventoried |
| `backend/resources/poddisruptionbudget` | 13 | 451 | — / — | Inventoried |
| `backend/resources/pods` | 13 | 1954 | 5 / — | Inventoried |
| `backend/resources/prometheus` | 1 | 181 | — / — | Inventoried |
| `backend/resources/referencegrant` | 12 | 368 | — / — | Inventoried |
| `backend/resources/replicaset` | 11 | 514 | 1 / — | Inventoried |
| `backend/resources/resourcequota` | 10 | 375 | — / — | Inventoried |
| `backend/resources/role` | 12 | 310 | — / — | Inventoried |
| `backend/resources/rolebinding` | 13 | 319 | — / — | Inventoried |
| `backend/resources/secret` | 11 | 365 | — / — | Inventoried |
| `backend/resources/service` | 13 | 674 | — / — | Inventoried |
| `backend/resources/serviceaccount` | 12 | 377 | — / — | Inventoried |
| `backend/resources/statefulset` | 11 | 631 | 1 / — | Inventoried |
| `backend/resources/storageclass` | 11 | 447 | — / — | Inventoried |
| `backend/resources/tlsroute` | 11 | 242 | — / — | Inventoried |
| `backend/resources/types` | 9 | 1096 | — / — | Inventoried |
| `backend/resources/workloads` | 2 | 308 | — / — | Inventoried |
| `build/linux` | 7 | 403 | — / — | Inventoried |
| `build/windows` | 4 | 552 | — / — | Inventoried |
| `cmd/project` | 20 | 3081 | 5 / — | Inventoried |
| `frontend` | 2 | 225 | — / — | Inventoried |
| `frontend/.storybook` | 10 | 331 | — / 1 | Inventoried |
| `frontend/biome-plugins` | 6 | 217 | — / — | Inventoried |
| `frontend/scripts` | 3 | 1306 | — / 3 | Inventoried |
| `frontend/src/(root)` | 7 | 1007 | — / — | Inventoried |
| `frontend/src/core/app-state-access` | 4 | 75 | — / — | Inventoried |
| `frontend/src/core/backend-api` | 2 | 166 | — / — | Inventoried |
| `frontend/src/core/capabilities` | 11 | 2623 | — / 5 | Inventoried |
| `frontend/src/core/cluster-workspace` | 2 | 755 | — / — | S003 store/hydration inspected and simplified |
| `frontend/src/core/codemirror` | 3 | 640 | — / — | Inventoried |
| `frontend/src/core/connection` | 1 | 237 | — / — | Inventoried |
| `frontend/src/core/contexts` | 11 | 1875 | — / 1 | Inventoried |
| `frontend/src/core/data-access` | 6 | 700 | — / — | Inventoried |
| `frontend/src/core/desktop-runtime` | 1 | 81 | — / — | Inventoried |
| `frontend/src/core/events` | 3 | 317 | — / — | Inventoried |
| `frontend/src/core/logging` | 1 | 112 | — / — | Inventoried |
| `frontend/src/core/navigation` | 5 | 489 | — / — | Inventoried |
| `frontend/src/core/panel-windows` | 17 | 2600 | — / — | Inventoried |
| `frontend/src/core/persistence` | 2 | 448 | — / — | Inventoried |
| `frontend/src/core/read-diagnostics` | 2 | 312 | — / — | Inventoried |
| `frontend/src/core/refresh` | 60 | 17381 | — / 9 | Inventoried |
| `frontend/src/core/resource-metrics` | 6 | 726 | — / 2 | Inventoried |
| `frontend/src/core/settings` | 4 | 1890 | — / — | Inventoried |
| `frontend/src/core/telemetry` | 2 | 1175 | — / — | Inventoried |
| `frontend/src/core/window-identity` | 1 | 9 | — / — | Inventoried |
| `frontend/src/hooks` | 8 | 746 | — / 1 | Inventoried |
| `frontend/src/modules/browse` | 13 | 3294 | — / 1 | Inventoried |
| `frontend/src/modules/cluster` | 26 | 5362 | — / — | Inventoried |
| `frontend/src/modules/global` | 5 | 773 | — / 2 | Inventoried |
| `frontend/src/modules/kubernetes` | 1 | 856 | — / — | S003 provider inspected; adds selection model |
| `frontend/src/modules/namespace` | 30 | 4701 | — / 1 | Inventoried |
| `frontend/src/modules/object-map` | 38 | 8546 | — / 12 | Inventoried |
| `frontend/src/modules/object-panel` | 141 | 32321 | — / 31 | Inventoried |
| `frontend/src/modules/port-forward` | 4 | 874 | — / 1 | Inventoried |
| `frontend/src/modules/resource-grid` | 15 | 4107 | — / 1 | Inventoried |
| `frontend/src/shared/actions` | 4 | 772 | — / — | Inventoried |
| `frontend/src/shared/components` | 26 | 3064 | — / — | Inventoried |
| `frontend/src/shared/components/aria` | 1 | 25 | — / — | Inventoried |
| `frontend/src/shared/components/diff` | 6 | 1327 | — / 3 | Inventoried |
| `frontend/src/shared/components/drain` | 3 | 784 | — / 4 | Inventoried |
| `frontend/src/shared/components/dropdowns` | 9 | 2392 | — / — | Inventoried |
| `frontend/src/shared/components/errors` | 9 | 1119 | — / — | Inventoried |
| `frontend/src/shared/components/IconBar` | 1 | 115 | — / — | Inventoried |
| `frontend/src/shared/components/icons` | 9 | 2018 | — / — | Inventoried |
| `frontend/src/shared/components/inputs` | 1 | 84 | — / — | Inventoried |
| `frontend/src/shared/components/kubernetes` | 5 | 413 | — / — | Inventoried |
| `frontend/src/shared/components/modals` | 14 | 2617 | — / — | Inventoried |
| `frontend/src/shared/components/status` | 2 | 233 | — / — | Inventoried |
| `frontend/src/shared/components/tables` | 79 | 14583 | — / 25 | Reviewing: S001 sizing 8 files inspected; 71 remain; C2 deferred |
| `frontend/src/shared/components/tabs` | 9 | 1470 | — / — | Inventoried |
| `frontend/src/shared/components/yaml` | 3 | 807 | — / 2 | Inventoried |
| `frontend/src/shared/constants` | 2 | 139 | — / — | Inventoried |
| `frontend/src/shared/events` | 4 | 532 | — / — | Inventoried |
| `frontend/src/shared/hooks` | 9 | 1969 | — / 1 | Inventoried |
| `frontend/src/shared/resources` | 1 | 111 | — / — | Inventoried |
| `frontend/src/shared/scrollbars` | 3 | 1685 | — / 3 | Inventoried |
| `frontend/src/shared/terminal` | 1 | 211 | — / 1 | Inventoried |
| `frontend/src/shared/utils` | 17 | 1401 | — / 1 | Inventoried |
| `frontend/src/types` | 4 | 136 | — / — | Inventoried |
| `frontend/src/types/navigation` | 1 | 63 | — / — | Inventoried |
| `frontend/src/types/shortcuts` | 1 | 48 | — / — | Inventoried |
| `frontend/src/ui/command-palette` | 3 | 2242 | — / — | Inventoried |
| `frontend/src/ui/dockable` | 17 | 4616 | — / 4 | Inventoried |
| `frontend/src/ui/errors` | 5 | 562 | — / — | Inventoried |
| `frontend/src/ui/favorites` | 6 | 2351 | — / 5 | Inventoried |
| `frontend/src/ui/layout` | 27 | 6864 | — / 2 | Inventoried |
| `frontend/src/ui/modals` | 9 | 3171 | — / 1 | Inventoried |
| `frontend/src/ui/navigation` | 2 | 30 | — / — | Inventoried |
| `frontend/src/ui/overlays` | 2 | 183 | — / — | Inventoried |
| `frontend/src/ui/panels` | 2 | 1250 | — / 2 | Inventoried |
| `frontend/src/ui/settings` | 10 | 3639 | — / — | Inventoried |
| `frontend/src/ui/shortcuts` | 20 | 2997 | — / 2 | Inventoried |
| `frontend/src/ui/status` | 10 | 1811 | — / 2 | Inventoried |
| `frontend/src/utils` | 14 | 1803 | — / 3 | Inventoried |
| `frontend/styles` | 29 | 5412 | — / — | Inventoried |
| `internal/appstate` | 1 | 45 | — / — | Inventoried |
| `internal/appwindow` | 19 | 3689 | — / — | Inventoried |
| `internal/bootstrap` | 2 | 200 | — / — | Inventoried |
| `internal/panelwindow` | 8 | 1009 | — / — | Inventoried |
| `internal/sentry` | 6 | 1477 | 1 / — | Inventoried |
| `internal/updateconformance` | 3 | 286 | 2 / — | Inventoried |
| `internal/updateidentity` | 8 | 686 | — / — | Inventoried |
| `internal/updatestate` | 3 | 780 | 3 / — | Inventoried |
| `internal/updatetemp` | 4 | 506 | 2 / — | Inventoried |
| `internal/windowsinstall` | 3 | 104 | — / — | Inventoried |
| `main.go` | 1 | 14 | — / — | Inventoried |
