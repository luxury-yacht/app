# Repository simplification ledger

Baseline: `6d93acb773ab245e79b9e5c932fc2e87e9d5a8c0` (2026-09-16).
Scope: the repository, including quiet code; recency does not restrict selection.
Follow the [systematic workflow](../workflows/code-simplification.md).

## Current status: reopened for thorough review

The earlier domain dispositions do not establish exhaustive implementation-file
coverage. The user's correction reopens this effort. The [file review manifest](code-simplification-review.json)
now records the implementation inventory separately from inspected source hashes,
candidate decisions, consumer traces, and validation. An inventory path absent
from its review records is pending; historical domain labels below do not close it.
Review records and passing tests establish different things. No repository-wide
completion claim is warranted until the pending inventory and required checks
are resolved.

Continuation after the user's `1a73f747` check-in: the manifest now records
1,713 of 1,845 baseline implementation files fully inspected, with 132 still
pending. The remaining inventory is frontend source; all
baseline backend implementation paths have an inspection record. Inspection
does not close the outstanding candidates or runtime and final validation.
The D055 prerelease result predates this continuation and is not evidence for
the current worktree.

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

## Reopened review — S001 through S004

The user requested a fresh review from the beginning after the earlier batches
left substantial responsibilities unexamined. Baseline for this continuation:
`0451eb93`; the worktree was clean. Preserve the earlier records as batch evidence,
not subsystem completion. Revisit all four domains before resuming S006.

**Catch-up batch: implementation, focused checks and prerelease gate passed.**
The earlier pass records below describe their delivered changes, not an exhaustive
review. This continuation revisits their unexamined responsibilities in order.

### Review scope and disposition

| Pass | Revisited responsibilities | Changes in this batch | Retained contracts and remaining work |
| --- | --- | --- | --- |
| S001 tables | All shared-table production files: persistence, filtering, menus/focus, export, rendering, row/column virtualization, widths/measurement, metadata columns, factories, pagination, diagnostics; resource-grid binding/query consumers | Share load/save normalization; share CSV action lifetime; share header/cell sort policy and combine header-menu state; remove the unreachable empty-area menu path through controller/body/wiring; resolve the visible column window once per render; centralize diagnostics churn eligibility | Keep independent controlled/local filter ownership, page-replacement versus dirty-cell measurement, virtual sizing/hysteresis, focus restoration, and cached cell content. C2 remains a separately identified behavior issue, not a refactor. Individual resource-view column definitions remain in their owning domains. |
| S002 catalog | Discovery and descriptor construction; collection plans, API/informer/ingest collection; permission preflight, synchronization/publication; watch/stream delivery; identity/lookup/action enrichment; catalog indexes, query/facet/cursor mapping, health and finalizer consumers | Use the existing public Descriptor throughout and derive GVR from its canonical fields; remove descriptor conversion layers; remove the unused collection ordinal through the collection/emission chain; reuse namespace list targets; share catalog-row selection across collection/reconciliation/sink replacement | Preserve discovery identity versus permission-filtered published rows; retain the ordinal used to associate permission results; preserve cold progressive publication versus warm replacement, failed-resource retention, exact/UID lookup, and distinct snapshot/maintained facet policies. Per-kind projections outside objectcatalog remain a separate catalog-domain responsibility. |
| S003 cluster/auth | Kubeconfig discovery and watcher delivery; selection/client pool and client construction; transport health, auth manager/transport, fresh-credential recovery and exec diagnostics; workspace hydration, event projection and kubeconfig provider | Share fresh REST-config loading for initial clients and recovery probes; use one watch-directory/filter accumulator and projection in discovery and watcher reconciliation | Keep path normalization, filesystem validation, locks, transport wrapping, diagnostic/error policies, retry ownership, and recovery timeouts at their existing boundaries. Visible/committed selection, read generations, activation counts, and publish-before-notify remain distinct. Operation-specific shutdown remains with the operations review. |
| S004 refresh | Snapshot service/cache/generation flights; stream mux routing, ACK/replay/reset/cancellation/backpressure; resource-stream manager and HPA/pod-owner notifications; projecting reflector/store read, index, rewrite, relist, spill/restore paths; metric poller/demand/retry; governor assignment, permission registration/revalidation; frontend broker/lifecycle and stream connection/health consumers | Share terminal snapshot-flight completion; share projected-row reads, indexed-key selection and relist row delivery; retain normalized stream Config directly through handler/session; remove the test-only workload-lister fallback and migrate its tests onto real ingest projection; share node/pod metric retry policy | Preserve cancellation outside the flight lock, indexed-key snapshot before rewrites, sink order under the store lock, subscription replacement delivery locks, partial replay reset and independent metric source clocks. The full ingest manager/dynamic-reflector lifecycle, governor executor/cooling, and frontend stream protocol/orchestrator still need dedicated deeper reviews; this batch does not close those large owners from adjacent reads. |

The changes consolidate existing ownership and representations; no new dependency,
wire contract, permission policy, native interaction, commit, or PR is included.
The catalog service continues to provide cluster scope for its local indexes;
workload signals still carry the complete cluster/GVK/namespace/name/UID reference.
The ingest manager and governor executor also received source inspection in this
batch. Their distinct readiness, retained-data, cooling and lock responsibilities
remain open for a deeper review of their consumers and lifecycle contracts.

### Contract evidence

- Tables: the original table/resource-grid selection passed **78 files / 660
  tests**. New export pending/failure/cleanup and sticky-column-window cases passed
  against the original implementations. The empty-area integration case proves no
  menu opens and default handling remains untouched before removing its internal
  plumbing. Existing pointer, keyboard, modifier, focus, sort and selection checks
  survive. Logs: `/tmp/luxury-yacht-revisit-tables-before.log`,
  `/tmp/luxury-yacht-revisit-export-characterization.log`,
  `/tmp/luxury-yacht-revisit-row-characterization.log`,
  `/tmp/luxury-yacht-revisit-menu-before.log`.
- Catalog: the full original package passed, then the refactored package passed.
  Descriptor fixture changes preserve the existing assertions while using the
  canonical representation. Cold/warm publication, cursor/facet behavior, discovery,
  ingest and lookup tests remain in that package. Logs:
  `/tmp/luxury-yacht-revisit-catalog-before.log` and
  `/tmp/luxury-yacht-revisit-catalog-after2.log`.
- Cluster/auth: the original focused cluster/auth/credential selection passed.
  The new watcher case passed before extraction and proves filename-filter union,
  full-directory precedence in both input orders, and filename admission. The
  initial-client and recovery loading statements were compared before extraction;
  timeout/diagnostics/transport setup remain in their callers. Logs:
  `/tmp/luxury-yacht-revisit-cluster-before.log`,
  `/tmp/luxury-yacht-revisit-watch-characterization.log`,
  `/tmp/luxury-yacht-revisit-cluster-catalog-after.log`.
- Refresh: snapshot, streammux, ingest, resourcestream and system suites passed
  before and after the batch. Existing flight tests cover independent waiter
  cancellation and cancellation of a generation followed by a fresh build. Store
  tests cover projected halves, relist delivery and owner-heal indexed rewrites.
  Mux tests cover ACK, replay/reset, replacement, cancellation and backpressure.
  Four HPA/pod-owner tests passed with the production projector/store before the
  lister fallback was removed. Logs:
  `/tmp/luxury-yacht-revisit-refresh-before.log`,
  `/tmp/luxury-yacht-revisit-refresh-after.log`,
  `/tmp/luxury-yacht-revisit-workload-characterization.log`.
- Metrics: new node/pod recovery, exhaustion and unavailable-API cases passed on
  the original retry implementations, including pod namespace routing. Existing
  cancellation-without-failure-reporting tests remain. Logs:
  `/tmp/luxury-yacht-revisit-metrics-before.log` and
  `/tmp/luxury-yacht-revisit-metrics-after.log`.

### Accumulated validation

- Latest focused frontend selection: **108 files / 1,099 tests passed**, covering
  tables, workspace/kubeconfig, refresh and data-access. Resource-grid consumers:
  **18 files / 220 tests passed** separately. Typecheck passed. Logs:
  `/tmp/luxury-yacht-revisit-frontend-coverage.log`,
  `/tmp/luxury-yacht-revisit-resource-grid.log`,
  `/tmp/luxury-yacht-revisit-typecheck2.log`.
- Latest backend coverage selection passed all ten packages. Statement coverage:
  backend **80.4%**, catalog **86.2%**, authstate **93.0%**, credentialerrors
  **93.2%**, snapshot **82.6%**, streammux **76.4%**, ingest **83.4%**,
  resourcestream **70.3%**, metrics **83.5%**, system **79.6%**. Package gaps are
  recorded, not hidden by the refactor. New config-loading/watch helpers and
  snapshot terminal completion are **100%** covered; projected-row/index helpers
  **100%**; metrics retry **89.5%**, terminal classification **100%**. Workload
  lookup is **78.6%**; mux subscription/error/connection branches retain gaps.
  These are internal refactors, with no native-window validation claim. Logs:
  `/tmp/luxury-yacht-revisit-backend-coverage.log` and
  `/tmp/luxury-yacht-revisit-backend-functions.txt`.
- Local complexity: pinned cached gocognit v1.2.1 and Biome threshold 12 scanned
  changed production files. No changed function/helper exceeds 12. Eight Go
  findings and three TypeScript findings are in unchanged functions within those
  files (including catalog broadcast/run loop, watcher event loop, store index
  removal, table body width/empty-row rendering and keyboard-menu targeting).
  Logs: `/tmp/luxury-yacht-revisit-go-complexity.json` and
  `/tmp/luxury-yacht-revisit-ts-complexity.log`. This is not remote Sonar evidence.
- The matching before/after table/resource-grid selections passed 78 files / 660
  tests on HEAD and 79 files / 663 tests in the worktree. Table statement coverage
  moved from **3,621/4,041 (89.61%)** to **3,585/3,982 (90.03%)**. After removal
  of the empty-area menu path and its internal tests, context-menu hook coverage
  is **27/31 (87.09%)**, previously **42/47 (89.36%)**; menu items **37/37
  (100%)**, previously **38/39 (97.43%)**; wiring **44/46 (95.65%)**, previously
  **49/52 (94.23%)**; body remains **56/60 (93.33%)**. The integration assertion
  for ignored empty-area context menus and selection/keyboard assertions remain.
  Baseline ran from a read-only git archive with the same installed dependencies.
  Its first attempt hit an out-of-tree Wails drag-module resolution error;
  copying that installed package into the archive fixed the harness and the
  unchanged 660-test baseline passed. Logs:
  `/tmp/luxury-yacht-revisit-table-baseline-coverage2.log` and
  `/tmp/luxury-yacht-revisit-tables-coverage.log`.
- AST comparison identifies **120 changed Go function declarations**, maximum
  local score **12**. The three flagged TypeScript function bodies match HEAD.
  Evidence: `/tmp/luxury-yacht-revisit-complexity-disposition.log`.
- `mise exec -- wails3 task qc:prerelease` passed on the accumulated batch:
  documentation, formatting, generated bindings, vet, staticcheck, backend race
  tests, frontend checks/typecheck, **513 frontend files / 4,782 tests**, Knip and
  Trivy. The first invocation stopped at gofmt before the expensive suites;
  formatting the import block in `query_anchor_test.go` resolved that failure.
  Logs: `/tmp/luxury-yacht-revisit-prerelease.log` and
  `/tmp/luxury-yacht-revisit-prerelease2.log`.
- Post-gate SHA-256 comparison found the same **67 changed files**, with no
  content changes from the gate; `git diff --check` passed. Of those files,
  **38 are production source**. Evidence:
  `/tmp/luxury-yacht-revisit-post-gate.log`. The subsequent ledger-only update
  receives a separate documentation check. A passing gate does not close the
  remaining large owners identified in the review table.
- `gh pr view` reported no pull request for branch `code-simplification`, so
  there is no current PR Sonar result to claim. Evidence:
  `/tmp/luxury-yacht-revisit-pr-status2.log`.

## Rotation through review domains

This is an investigation order, not a list of approved rewrites. Each visit
reviews a substantial subsystem scope and groups its related simplifications
into one delivery batch. Incremental edits get focused checks; the full
repository gate runs at the batch boundary. Record the remaining domain scope.
After domain 14, restart with unreviewed responsibilities. Record any
correctness-driven interruption and resume the rotation afterwards.

| Order | Domain | Initial scope and required adjacent paths | Status |
| --- | --- | --- | --- |
| 1 | Shared tables | Shared table hooks/rendering; resource-grid adapters; snapshot/querypage consumers | Reviewed in S001 and catch-up; C2 is deferred behavior work |
| 2 | Catalog and resource projections | Object catalog; per-kind resources; kind/model contracts; Browse adapters | Catalog, per-kind detail/facts, Browse and projection follow-through recorded below |
| 3 | Cluster/workspace/auth | Backend cluster/workspace owners and auth helpers; Kubernetes/cluster workspace contexts | Selection, workspace, client/auth recovery and discovery/watch review recorded |
| 4 | Refresh and data access | Refresh APIs, stores, snapshots, ingestion, streams, metrics and governor; frontend refresh/data brokers | Lifecycle, ingest, governor, stream protocol, builders and notifier follow-through recorded below |
| 5 | Object details and panels | Object-panel overview/YAML/actions; detail gateway; panel-window ownership | Overview descriptors, YAML/actions and panel ownership follow-through recorded below |
| 6 | Operations | Shell/debug, logs, port-forward, drain, runtime registry; detail/event consumers | Operations owner/consumer review and validation recorded in S006 |
| 7 | Object map | Backend graph producers and relationships; frontend graph, layout and renderer | Object-map owner/consumer review and validation recorded in S007 |
| 8 | Permissions and mutations | Capability policy, permission caches, object actions/YAML; frontend availability gates | Permission, generation and mutation follow-through recorded below |
| 9 | Navigation and interaction | Sidebar, routing, shortcuts, command palette, modals, shared inputs and menus | Keyboard/palette, native command and modal/input follow-through recorded below |
| 10 | Preferences and persistence | Settings, favorites, UI state, import/export/reset; frontend state hydration | Settings, descriptor/schema and Favorites migration follow-through recorded below |
| 11 | Errors and diagnostics | Error classification/reporting, logs, telemetry, request diagnostics | Diagnostics, operation schema and current Sonar follow-through recorded below |
| 12 | Native lifecycle and windows | Bootstrap, app lifetime, desktop transport, peer windows, dockable ownership | Native registry, transfers, bootstrap and dockable review/implementation recorded below |
| 13 | Updates and engineering tooling | Updater/installers; generators; project tasks; build/CI; lint rules and test infrastructure | Updater, installers, generators, project tasks and CI review/implementation recorded below |
| 14 | Shared primitives and remaining inventory | Utility/formatting/identity helpers, types, styles, root source, and unclaimed companion files | Primitive and quiet-owner follow-through recorded below |

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

## S004 — refresh state, demand, scheduling, and readiness

**Status: selected batch implemented; affected checks and final gate passed.** Baseline:
`218e1760786444fe929f9ca6ddf4253a1256ec32`; `git status --short` was empty.
Inventory refresh (`git diff --name-status 6d93acb7 HEAD`) found only the new
production selection model already recorded in S003. S004 adds no source files;
the inventory retains its baseline counts.

Inspected: frontend retained store and diagnostics readers, scoped runtime and
orchestrator fetch/lease/stream ownership, scheduler cadence and cancellation,
data-access broker/readers/lifecycle hooks; backend ingest hub, asynchronous
bundle sink, partition replacement, and registry ownership. Preserve separate
query/snapshot demand, stream acknowledgement/source clocks, fetch generations,
and the ordered asynchronous bundle queue.

Implemented candidates, in ownership order:

- Make the scoped store the sole snapshot representation. Repository searches
  find the unscoped get/set/reset API only in its tests; diagnostics reads scoped
  entries and pending requests. Remove the parallel domain initializer/API and
  centralize map/entry publication so both views update before notification.
  Retain the notification assertions against the scoped API.
- Remove the runtime's write-only known-domain set and its orchestrator marker;
  scoped records already own the active/known scope queries. Consolidate broker
  lease-option construction so acquisition/release use one demand policy.
- Consolidate scheduler interval replacement, retaining caller-specific state
  transitions, cooldowns, and the initial-run policy.
- Index ingest-owned resource keys directly to GVRs at hub construction. Both
  readiness paths use that index instead of a set plus repeated registry scans.
  Keep missing-store settlement distinct from typed data readiness.

These are internal representations in existing owners. Producers remain snapshot
fetches/streams, consumer leases, scheduler commands, and the kind registry;
consumers remain retained-data hooks/diagnostics, scoped runtime, and refresh
readiness gates. Publication precedes notification; acquisition precedes reads;
ingest starts before the factory readiness wait. No dependency directions or wire
types change. Characterization covers store view consistency and isolation,
lease demand, cadence replacement, and ingest/factory readiness routing. Focused
tests run during edits; affected coverage and one repository gate close the batch.

Validation:

- The baseline refresh/data-access selection passed 44 files / 607 tests.
  Characterization cases passed against the original production code: 82
  frontend tests and the ingest hub tests. Logs:
  `/tmp/luxury-yacht-s004-characterization-frontend.log` and
  `/tmp/luxury-yacht-s004-characterization-backend.log`.
- Incremental store/diagnostics/orchestrator checks passed 169 tests; subsequent
  runtime/broker/scheduler checks passed 228 tests; ingest hub checks passed.
  Logs: `/tmp/luxury-yacht-s004-store.log`,
  `/tmp/luxury-yacht-s004-runtime-broker-scheduler.log`, and
  `/tmp/luxury-yacht-s004-hub.log`.
- Final affected frontend coverage passed 44 files / 613 tests. Statement
  coverage: broker 83.33%, scheduler 96.05%, orchestrator 83.12%, runtime 97.23%,
  scoped store 91.13%. Overall affected coverage moved from 89.09% to 89.30%.
  Store coverage moved from 88/96 statements (91.66%) to 72/79 (91.13%) after
  removing the unscoped API; its notification assertions now exercise the scoped
  API. The obsolete helper assertion became an unknown-resource readiness
  assertion, and unused diagnostics fixture data was removed without deleting
  test cases. Logs: `/tmp/luxury-yacht-s004-before-frontend.log` and
  `/tmp/luxury-yacht-s004-frontend-coverage.log`.
- Backend system, ingest, and adjacent snapshot suites passed with statement
  coverage of 79.6%, 83.2%, and 82.6%. All three changed hub functions are 100%
  covered; the system package baseline was 79.2%. Logs:
  `/tmp/luxury-yacht-s004-backend-coverage.log` and
  `/tmp/luxury-yacht-s004-backend-functions.txt`.
- Typecheck passed. Changed Go functions score 1, 8, and 9 under gocognit
  v1.2.1. Biome's threshold-12 scan reports no changed function; its one failure
  is the untouched scheduler `statusFor` at 13, reproduced on HEAD before the
  changes. Logs: `/tmp/luxury-yacht-s004-typecheck.log`,
  `/tmp/luxury-yacht-s004-go-complexity.json`,
  `/tmp/luxury-yacht-s004-ts-complexity.log`, and
  `/tmp/luxury-yacht-s004-ts-complexity-before.log`.
  `gh pr view code-simplification` found no PR; no remote Sonar result is claimed.
- One final `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` passed, including backend race tests, frontend checks and tests, Knip, and Trivy. Log: `/tmp/luxury-yacht-s004-prerelease.log`. Post-gate worktree inspection and SHA-256 comparison found no additional files or formatter changes (`/tmp/luxury-yacht-s004-post-gate.log`); `git diff --check` passed. Only this ledger is finalized afterwards, with a separate `qc:docs` check.

The frontend checks exercise real store/runtime/scheduler owners with transport
and native calls mocked. This batch changes internal representation and shared
bookkeeping; it makes no native window or rendered-layout validation claim.

Remaining domain scope: backend snapshot/service internals, stream delivery and
recovery implementations, metrics/governor policies, permission revalidation,
and the ingest manager/reflector/store internals. The inspected bundle queue and
partition replacement retain their ordering and namespace-specific behavior;
combining them would obscure distinct contracts.

## S005 — object-panel Helm content and read ownership

**Status: selected batch implemented; affected checks and final gate passed.** Baseline:
`ebd67a62b253940e72a6cdc53484cc134904b802`; `git status --short` was empty.
Inventory refresh (`git diff --name-status 6d93acb7 HEAD`) found only the new
production selection model already recorded in S003. S005 adds `helmValues.ts`
within the object-panel Helm directory; the inventory retains baseline counts.

Inspected: object-detail dispatch and cache paths, Helm service/content snapshots,
panel composition, tab eligibility, scoped lifecycle/refresh hooks, detail-model
derivations, panel-open/close hook and state-provider seams, Helm tabs, and the
documented overview/YAML/native ownership boundaries. Existing generated detail
dispatch, descriptor-driven overview, shared action controller, and retained
YAML/logs mounting stay in their owners.

Implemented batch:

- Replaced the Values tab's repeated full-path walks and callback dependency chain
  with a pure Helm-values model. Traverse matching subtrees directly; preserve
  own-property checks, atomic arrays, nulls, defaults/overrides/merged behavior,
  legacy payloads, serialization, and value order. Nested edge cases were
  characterized against the original component before editing.
- Centralized Helm release acquisition in the Helm service for details, manifest,
  and values, and the provider's manifest/values cache-read-fetch-store-
  revision sequence. These remove repeated read and error policy within each
  existing owner, without changing action configuration or snapshot interfaces.
  Cache authorization, content-before-revision ordering, best-effort revision,
  and per-cluster keys remain explicit; validate through release/storage tests
  and provider reads against a local Kubernetes API fixture.
- Removed the panel hook's global test-only close callback, ref, and registration
  effect. `git grep -n closeObjectPanelGlobal HEAD -- frontend/src` found its only
  caller in the hook test. The surviving close-all workflow test now opens two
  panels before exercising the hook's real close method.

Producer/consumer path: Helm storage → service → cluster-scoped detail provider
→ content snapshot → refresh handle → Helm tab → shared YAML editor. The new
value model has no imports; existing service/provider import directions remain.
Wire DTOs, native transfer, editor mechanics, and mutation policy were not edited.
Scope admission, cache authorization, and failure behavior were characterized
before consolidation.

Validation:

- Original-code characterization passed for nested value modes and provider
  content/cache reads. Provider cases cover cluster isolation, wrong-type cache
  entries, authorization revocation, content retention during revision failure,
  and missing cluster scope. Logs:
  `/tmp/luxury-yacht-s005-characterization-frontend.log` and
  `/tmp/luxury-yacht-s005-characterization-backend.log`.
- Incremental Helm tab, panel hook, and backend read tests passed after their
  edits. A deterministic differential check compared the extracted selector
  against the original callbacks across 3,000 generated inputs in all three
  modes: all 9,000 results matched. Log:
  `/tmp/luxury-yacht-s005-values-comparison.log`. This establishes those sampled
  outputs, not exhaustive equivalence or runtime performance.
- Object-panel and adjacent panel-window tests passed 101 files / 877 tests.
  Affected statement coverage: Values tab 92.59%, value model 90%, panel hook
  88.33%; combined 89.76% (114/127). Removing the global helper's test and
  implementation changed hook coverage from 62/69 (89.85%) to 53/60 (88.33%);
  surviving branch coverage remains 26/33. Logs:
  `/tmp/luxury-yacht-s005-before-frontend.log` and
  `/tmp/luxury-yacht-s005-frontend-coverage.log`.
- Backend, Helm service, and adjacent snapshot suites passed with statement
  coverage of 80.3%, 90.8%, and 82.6%. Changed Go functions are 86.7–100%
  covered; the new acquisition and provider helpers are 100%. Logs:
  `/tmp/luxury-yacht-s005-backend-coverage.log` and
  `/tmp/luxury-yacht-s005-function-coverage.txt`. macOS deployment-target linker
  warnings appeared in baseline and affected runs; both exited successfully.
- Typecheck passed. Changed Go functions score 0–5 under gocognit v1.2.1;
  Biome's threshold-12 check passed all three changed TS/TSX sources. Logs:
  `/tmp/luxury-yacht-s005-typecheck.log`,
  `/tmp/luxury-yacht-s005-go-complexity.json`, and
  `/tmp/luxury-yacht-s005-ts-complexity.log`.
  `gh pr view code-simplification` found no PR; no remote Sonar result is claimed.
- One final `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease` passed, including backend race tests, frontend checks and 4,772 tests, Knip, and Trivy. Log: `/tmp/luxury-yacht-s005-prerelease.log`. Post-gate SHA-256 comparison and worktree inspection found no additional files or formatter changes; `git diff --check` passed (`/tmp/luxury-yacht-s005-post-gate.log`). Only this ledger is finalized afterwards, with a separate `qc:docs` check.

Frontend tests mock native calls and refresh transport; provider tests use local
API fixtures. No native window or rendered-layout validation is claimed.

Remaining domain scope: full capability resolution, overview widgets/descriptors,
YAML transaction/merge/ownership internals, panel-state reconciliation, native
transfer implementations, and detail enrichments. Their interfaces were inspected
where needed; this pass does not close those responsibilities.

## S005 continuation — panel state, YAML, tab composition, and log presentation

**Status: expanded batch implemented; affected checks and final gate passed.** The initial Helm
batch left too much panel scope unexamined. This continuation revisits the domain
before rotating to operations. The original S005 work is preserved in `28c2687a`;
this record describes the subsequent worktree changes. Inventory counts remain
at baseline: `containerLogColumns.tsx` replaces the deleted `Overview/registry.ts`
in the production file count, and `object_yaml_admission_test.go` adds tests.

Implemented responsibilities and evidence:

- Panel placement/removal: `ObjectPanelStateContext.tsx` centralizes detached
  copies of the five panel indexes, insertion, and removal. Group docking and
  native upsert share placement reconciliation; close and ownership removal
  share collection cleanup. Caller-specific admission and layout handoff remain
  at their call sites. The new docking test checks published-map immutability,
  tab order, pending handoff removal, and retention of previously owned panels.
- YAML transaction: `yamlTransaction.ts` replaces three independently maintained
  baseline fields with one identity/YAML pair; baseline resource version derives
  from identity. Latest-live and merged identity resolution use one helper.
  `isEditing` stays separate because reload can capture a baseline outside edit
  mode. The manual override remains an object to retain effect-trigger identity.
- YAML mutation admission: `prepareAuthorizedYAMLMutation` owns the existing
  prepare-then-authorize sequence for validate, apply, and ownership checks.
  Five unread fields leave the private mutation context. Dry-run/update/apply
  options and post-apply invalidation remain with each operation. The new test
  checks all three APIs reject missing cluster, malformed draft, and denied patch
  permission before sending a PATCH; existing tests exercise admitted operations.
- Tab composition: `ObjectPanelContent.tsx` shares the error/loading boundary and
  routes transient tabs through a keyed renderer map. Logs and YAML retain their
  separate lifetime owners. Tests check error recovery after changing tabs while
  retaining mounted log/YAML nodes, plus unknown restored tab names. Scope cleanup
  and YAML visitation still occur before the deleted-object guard.
- Overview rendering: `OverviewRenderer.tsx` and `schema.ts` narrow the existing
  union directly. `index.tsx` renders `GenericOverview` directly, removing the
  single-component registry wrapper; the typed descriptor registry remains.
  Gateway reference groups use one namespace grouper and Map insertion order.
  Existing grouping/descriptor tests and a new raw-DTO/generic-fallback dispatch
  test cover these paths. The owning component-structure doc follows the new call.
- Log presentation: container metadata columns move out of `LogViewer.tsx` into
  `containerLogColumns.tsx`; container and node logs share CSV headers, row order,
  and escaping in `buildParsedLogCsv`. Each source retains its value policy:
  container CSV reserves metadata keys even with hidden metadata columns, while
  node CSV treats those keys as user fields. A proposed column-owned export policy
  was rejected during review because it changed this distinction. New UI copy
  tests cover both policies, false/zero/nested values, and CSV escaping.

The boundary map is unchanged: panel state publishes cluster-indexed collections;
committed removal triggers cache eviction; layout handoff precedes close cleanup;
the native coordinator owns transfer admission. YAML parsing, mapping, live read,
UID/field policy, and patch construction precede permission checks; ownership
warnings stay advisory. Tab consumers retain their scope/reset keys and lazy
loading. The log-column helpers depend on shared formatting/export utilities, not
on the components or transport that call them, so they add no reverse imports.
Regression evidence is in the focused tests listed below; no native interaction
or transport behavior is inferred from those mocks.

Investigation dispositions and remaining scope:

- Read the complete panel-state provider, YAML transaction, capability descriptor
  construction, and tab composition. Read affected backend YAML admission and
  ownership functions plus mutation/merge seams; other mutation/merge internals
  are not closed by this pass.
- Read Overview schema/renderer/fallback, data/container sections, Gateway grouping,
  workload helper excerpts, and selected operator sections. Keep existing workload
  and per-kind descriptor helpers where presentation, actions, or object-reference
  semantics differ. This is not a review of every descriptor/widget.
- Keep capability policies distinct for logs, exec, ephemeral containers, and Helm.
  Keep YAML apply, ownership dry-run, and reload/merge execution policies separate.
  Native transfer implementation, detail enrichments, remaining Overview widgets,
  and complete capability consumers remain open.
- Shell start/status/attach excerpts expose repeated session/ref/status cleanup
  and replay ordering worth reviewing with backend session producers. Its local
  complexity signals include 17, 23, 26, 27, and 29; those are investigation signals,
  not reviewed defects. S006 should start with session transitions, late-start
  cancellation, attach replay, and native terminal ownership. Container/node log
  transport and reconnect internals were not audited by this presentation pass.

Validation evidence:

- Before edits: panel/YAML/Overview tests passed 280 tests in 42 files; logs passed
  197 in 16 files; focused backend YAML tests passed. Logs:
  `/tmp/luxury-yacht-s005b-before-frontend.log`,
  `/tmp/luxury-yacht-s005b-before-backend.log`,
  `/tmp/luxury-yacht-s005b-logs-before.log`.
- Original-code characterizations passed for group docking, transient-tab error
  recovery, node CSV, and backend admission. The latter used a Go build overlay
  after automatic review rejected temporary replacement of worktree files.
  Reserved container-key CSV behavior also passed against the original LogViewer
  through a read-only Vite loader. Logs:
  `/tmp/luxury-yacht-s005b-characterization.log`,
  `/tmp/luxury-yacht-s005b-routing-characterization.log`,
  `/tmp/luxury-yacht-s005b-node-csv-characterization.log`,
  `/tmp/luxury-yacht-s005b-yaml-admission-characterization.log`,
  `/tmp/luxury-yacht-s005b-csv-original.log`.
- Affected frontend coverage run passed 880 tests in 101 files at 84.69% statements
  across the selected sources. Final routing tests passed 24 tests in two files:
  content 90.14%, Overview wrapper 76.92%. The wrapper gap is in HPA and node
  maintenance branches; the added dispatch test checks raw DTO and generic
  fallback behavior. No presentation-only tests were added to inflate coverage.
  Logs: `/tmp/luxury-yacht-s005b-frontend-coverage.log`,
  `/tmp/luxury-yacht-s005b-routing-coverage.log`.
- Final log presentation tests passed 199 tests in 16 files with 85.24% statement
  coverage across the four changed log sources (83.04% LogViewer, 96.55% container
  columns, 96.96% shared columns/CSV, 87.66% NodeLogsTab). Log:
  `/tmp/luxury-yacht-s005b-logs-final.log`.
- Backend coverage passed (`backend` 80.3%). With the new admission cases,
  changed functions measure Validate 100%, Apply 92.3%, preparation/authorization
  81.5%, and ownership 95.5%. The full backend profile under-reports the unchanged
  `objectyaml` helper package when exercised through its consumers; a separate
  `-coverpkg` run measured 74.5% from backend consumers. Coverage profiles/logs:
  `/tmp/luxury-yacht-s005b-backend.out`,
  `/tmp/luxury-yacht-s005b-yaml-final.out`,
  `/tmp/luxury-yacht-s005b-field-policy-coverage.log`.
- All 12 changed TypeScript production sources pass the local threshold-12
  complexity check; changed Go functions score 3, 3, 6, and 9. Typecheck passed
  on the final tree in the prerelease gate.
  Logs: `/tmp/luxury-yacht-s005b-ts-complexity-final.log`,
  `/tmp/luxury-yacht-s005b-go-complexity.json`,
  `/tmp/luxury-yacht-s005b-typecheck-final.log`.
  `gh pr view code-simplification` found no PR
  (`/tmp/luxury-yacht-s005b-pr-status.log`); no remote Sonar closure is claimed.

- One final `GOCACHE=/tmp/luxury-yacht-go-build STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`
  passed, including backend race tests, frontend checks and 4,779 tests in 512
  files, Knip, and Trivy. Log: `/tmp/luxury-yacht-s005b-prerelease.log`.
  Post-gate SHA-256 comparison found no formatter changes or additional paths
  across the 23 changed files (`/tmp/luxury-yacht-s005b-post-gate.json`);
  `git diff --check` passed. Only this ledger is finalized after the gate,
  followed by `qc:docs` and another diff check.

These are behavior-preserving refactors. Tests mock native calls and refresh
transport; no native window, terminal interaction, or rendered-layout validation
is claimed. Remaining domain responsibilities stay open for later batches.

## S006 — operations

**Status: batch implemented; coverage and final prerelease gate passed.**
Baseline `1d065d81`; the worktree was clean at the start of this batch. The
focused baseline passed 393 frontend tests in 33 files and the backend operations,
drain, pod/node and container-log selections. Logs:
`/tmp/luxury-yacht-s006-frontend-before.log` and
`/tmp/luxury-yacht-s006-backend-before.log`.

### Inspected scope and candidate dispositions

The reviewed owners and consumers are listed below; this does not close entire
parent packages or the repository inventory. Changes span 14 production files.
Two authored files join the baseline inventory: `backend/internal/containerlogs/errors.go`
and `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellConnectionControls.tsx`;
the inventory table's numeric counts remain the original baseline counts.

| Responsibility | Inspected implementation and consumers | Implemented simplification / retained policy |
| --- | --- | --- |
| Shell/debug | `backend/shell_sessions.go`, `shell_sessions_lifecycle.go`, `resources/pods/debug.go`; frontend `ShellTab.tsx`, shell app-state/data readers, ObjectPanelContent shell mounting and dockable-panel lifecycle contracts | Separate start admission, tracked-session installation, backlog replay/flush, terminal close handling, debug RPC/result validation and connection controls. Share shell-command fields across ordinary/debug forms. Keep configuration lifetime in ShellTab, terminal ownership, detach-without-stop, late-start closure, replay overlap and native input/resize behavior. |
| Container logs | `backend/refresh/containerlogsstream/{handler,streamer,limiter,types}.go`, `resources/pods/logs.go`; frontend `containerLogsStreamManager.ts`, fallback manager/hook and LogViewer fallback request/projection consumers | Replace eight positional tail results with the existing named result; share initial/live target selection, cluster/session round-robin allocation and unavailable-container classification. Combine entries and their counters in one scoped buffer. Keep API-not-found handling, watch versus follow retries, timestamp-parser cutoffs, nil/empty filters and independently retained backend warnings. |
| Node logs | `backend/resources/nodes/logs.go`; frontend `nodeLogsApi.ts`, `NodeLogsTab.tsx` | Share source metadata construction and query suffix assembly. Keep discovery/probing, path versus service validation, binary filtering, truncation, fetch/append and cache lifetimes. |
| Port-forward | `backend/portforward.go`, `portforward_{types,lifecycle,resolve,targets,ports}.go`; frontend `PortForwardModal.tsx`, operation status hook/adapter and `SessionsStatus.tsx` | One locked session snapshot and target projection for execution, re-resolution, runtime records, lists and events; shared status assignment; separate retry policy/publication from cancellable backoff. Keep initial-ready versus activated registration, epoch rejection, direct-Pod versus workload reconnect, Service port resolution and modal request cancellation. |
| Drain | `backend/nodemaintenance/store.go`, `resources/nodes/nodes.go`, `operations_drain_registration.go`, `resource_gateway_node_actions.go`, `refresh/snapshot/node_maintenance.go`; frontend `DrainNodeModal.tsx`, model/view, `drainProgress.ts`, `DrainProgressCard.tsx` | Share validation/store/idle admission and lifecycle terminal updates. Keep user cancellation's `canceling` transition, callbacks outside locks, one version advance per bulk cancellation, bounded per-cluster history, uncached snapshots and separate start/cancel permissions. |
| Shared operation lifetime | `backend/operations_coordinator.go`, `runtime_operations.go`; shutdown and workspace close/prune/client-pool cleanup callers; frontend runtime-operation status envelope | Retain coordinator/registry ownership, remove-before-callback ordering, process/cluster epoch gates, detail-store ownership and authoritative frontend operation envelopes. Startup readiness and distinct shell/forward/drain cleanup policies do not justify another shared cleanup abstraction. |

The recurring cost addressed here is duplicated policy and state: two log
allocation loops, two target-selection paths, repeated log-error/source mapping,
two log-buffer maps, repeated drain admission/cancellation and repeated locked
port-forward projections. Shell orchestration also mixed UI controls, RPC
admission, replay and terminal status handling in nested callbacks. These changes
reuse their existing owners; the shared log classifier stays in the existing
`backend/internal/containerlogs` dependency, and the shell view imports only shared
UI components. Neither dependency points back at its consumer.

### Required cluster-identity correction

Tracing ShellTab found that its target lifetime used namespace/name but omitted
cluster identity. Pending attachment, backlog, discovery and debug-creation
responses could then update a different cluster's terminal or controls. The
repository's touched-cluster contract required correcting that path during this
batch. The target token now includes cluster/namespace/pod; target changes reset
session/container state, obsolete completions are ignored, and unmount invalidates
pending attachment/replay. Debug actions still carry complete Pod identity through
the existing object-action boundary.

Acceptance evidence:

- **Passed:** switching between identically named pods detaches the old terminal
  and attaches/input-routes to the matching cluster; late lookup/backlog results
  cannot replace the new session/output. Three failures before the correction,
  then 31 passing shell tests: `/tmp/luxury-yacht-s006-shell-identity-red.log` and
  `/tmp/luxury-yacht-s006-shell-identity-green.log`.
- **Passed:** late container discovery and debug success/failure cannot alter the
  new target; discovered container selection resets and a new target can still
  create/connect its own debug container. Four failures before correction, then
  35 passing tests after refactoring: `/tmp/luxury-yacht-s006-shell-target-red.log`
  and `/tmp/luxury-yacht-s006-shell-final.log`.
- **Passed:** the same shell suite retains success/failure, capability denial,
  detach/reattach, clipboard/input, replay-overlap and late-start cleanup checks.
  Backend RPC, events, xterm and clipboard are mocked in these React tests.
  They are not native terminal/window interaction evidence; native window
  placement/destruction and terminal resource ownership were not changed.
- **Passed against baseline:** new limiter redistribution and cleanup cases
  characterize same-scope ordering, demand limits, release, bulk drain callback
  re-entry/publication, port-forward retry exhaustion and cancellation during
  backoff. Logs: `/tmp/luxury-yacht-s006-limiter-before.log` and
  `/tmp/luxury-yacht-s006-cleanup-characterization.log` (original Go sources loaded
  through a temporary overlay, with current tests). Existing assertions were
  retained; no presentation-test pruning is included.

### Batch validation

- **Passed:** focused drain, node-log, container-stream/pod-log, port-forward and
  frontend log-buffer checks during implementation. Logs:
  `/tmp/luxury-yacht-s006-drain-after.log`,
  `/tmp/luxury-yacht-s006-node-logs-after.log`,
  `/tmp/luxury-yacht-s006-log-stream-after.log`,
  `/tmp/luxury-yacht-s006-log-errors-after.log`,
  `/tmp/luxury-yacht-s006-portforward-after2.log`,
  `/tmp/luxury-yacht-s006-log-buffer-after.log`.
- **Passed:** final frontend typecheck:
  `/tmp/luxury-yacht-s006-typecheck-final.log`.
- **Passed locally:** 35 changed/new Go functions score at most 12 using pinned
  gocognit v1.2.1, including both new helpers and changed callers; all three changed
  production TS/TSX files pass Biome at maximum 12. Logs:
  `/tmp/luxury-yacht-s006-go-complexity-summary.txt` and
  `/tmp/luxury-yacht-s006-ts-complexity6.log`. The all-rule audit of existing PR
  #355 reports zero open/confirmed new-code issues, but the published head remains
  baseline `1d065d81`, not this uncommitted batch. Logs:
  `/tmp/luxury-yacht-s006-sonar-pr.log` and
  `/tmp/luxury-yacht-s006-pr-context.log`. Local results do not establish remote
  Sonar closure for these changes.
- **Passed:** `mise exec -- wails3 task test:frontend-coverage`: 513 files / 4,791
  tests. Changed-source statement coverage: ShellTab 85.09%, connection controls
  85.71%, container-log stream manager 87.45%. Report:
  `/tmp/luxury-yacht-s006-frontend-coverage.log`; HTML/JSON moved to
  `/tmp/luxury-yacht-s006-frontend-coverage` before repository lint.
- **Passed:** `mise exec -- wails3 task test:backend-coverage`. Package statement
  coverage: backend 80.6%, node maintenance 89.2%, container-log streams 82.0%,
  nodes 82.6%, pods 79.7%. Per-package tests report shared container logs at 63.9%;
  instrumenting that package through pod/stream consumers measures 87.1%, with
  the moved classifier at 100%. Logs:
  `/tmp/luxury-yacht-s006-backend-coverage.log`,
  `/tmp/luxury-yacht-s006-shared-log-coverage.log` and
  `/tmp/luxury-yacht-s006-shared-log-coverage.out`.
- Coverage limitations: the pod package remains below 80% while its changed
  log-fetch function is 100%; port-forward execution includes unexercised live
  SPDY transport paths (9.8% function coverage). These backend changes preserve
  behavior; the changed shell behavior exceeds 80% statement coverage. No
  low-value presentation or private-helper tests were added to raise percentages.
  Function report: `/tmp/luxury-yacht-s006-function-coverage.txt`.
- **Passed against baseline:** a further port-forward re-resolution case uses
  identically named Services in two fake clusters to check the original target's
  cluster/namespace/kind/name and retention of the last destination on failure.
  `/tmp/luxury-yacht-s006-reconnect-before.log`. The fixture uses real EndpointSlice
  and ready-Pod resolver paths; it does not establish a live SPDY connection.
- **Passed in current code:** the port-forward lifecycle/re-resolution selection
  with the added case. Re-resolution measures 84.6% and target projection 100%;
  retry policy is 100% and the runner 83.3%. Evidence:
  `/tmp/luxury-yacht-s006-forward-coverage.log` and
  `/tmp/luxury-yacht-s006-forward-coverage.out`.
- **Passed:** one final `GOCACHE=/tmp/luxury-yacht-go-build
  STATICCHECK_CACHE=/tmp/luxury-yacht-staticcheck mise exec -- wails3 task qc:prerelease`:
  docs, formatting, bindings, vet/staticcheck, all backend race tests, frontend
  lint/typecheck, 513 files / 4,791 tests, Knip and Trivy. Log:
  `/tmp/luxury-yacht-s006-prerelease.log`. The before/after path and SHA-256
  comparison found no changes to the 20-file batch and no additional paths;
  `git diff --check` passed. Comparison:
  `/tmp/luxury-yacht-s006-after-gate.json`. Only this evidence record was updated
  afterwards; `qc:docs` and `git diff --check` were rerun for that final update.
  macOS linker deployment-target warnings in direct Go runs and jsdom's navigation
  warning did not fail the suites.

Next scheduled domain after this batch: S007 object-map relationships, layout and
rendering. Operation behavior outside the explicitly inspected files above remains
in its owning inventory unit; the full repository review is still in progress.

S001 established an inefficient delivery size: a one-file production change paid
for a full frontend coverage run and a full repository gate. Future batches
follow the revised workflow's validation levels; S001 is not the throughput model.

## S007 — object-map projection, traversal and rendering

**Status: batch implemented; local checks and final gate passed.** Baseline: `8cbebce9`; initial
`git status --short` was empty. This batch follows the graph from snapshot
collection through directional filtering, kind contraction, layout, selection,
and renderer updates. It does not close the entire snapshot or resources tree.

Selected candidates:

- Give directional filtering and selection one adjacency/reachability owner;
  preserve each consumer's admission rules and whether its result includes the seed.
- Separate hidden-path enumeration from path counting/canonical selection and
  synthetic-edge projection. Preserve all simple paths, tie-breaking and order.
- Share lane spacing and bounds calculation, and separate geometric routing from
  edge metadata projection. Preserve lane packing, cycles, duplicate-ID behavior,
  card dimensions and tooltip midpoints.
- Share hover decoration between pointer updates and selection reapplication;
  retain partial versus full graph patches. Make the apply queue's attribute
  comparison allowlists explicit without broadening patch admission.
- Centralize snapshot record metadata projection for typed, Gateway and HPA
  collection; retain their permission, presence, namespace and status policies.
  Share pod candidate iteration while preserving the two selector semantics.

Boundary review: per-kind collectors and ingest projectors produce records for
one cluster-owned index. Catalog records merge before typed/ingest enrichment;
relationship resolution precedes graph traversal. The frontend model filters
before layout; visible state and selection feed G6 data and event handlers.
Helpers remain within the snapshot package or frontend object-map leaves, with
no new provider, runtime owner, wire type or reverse import. Render readiness,
latest-update admission, drag viewport preservation and delayed graph disposal
remain in their existing owners. Existing snapshot, model, layout, apply-queue
and component tests exercise these consumer contracts.

Retained candidates: separate data/selection queues and graph lifecycle because
readiness and disposal ordering differ; per-kind registry facets because kind
ownership is established; mixed versus directional backend walks because their
admission and depth policies differ; React controls and debug overlays because
moving declarations alone would not reduce repeated policy. Per-kind status/lister
wrappers retain their registry-owned shape. Tooltip/card
text measurement retains its distinct fallback and truncation policies. Palette,
viewport/app-zoom suppression, legend dragging, collapse/deduplication, debug
publication and navigation retain their existing owners and ordering.

Inspected scope:

- Snapshot `object_map.go`, assembler, collector/edge registries and relationship
  policies; neutral `objectmap` status/action facts, `objectmapnode` collector and
  intake projection, and `objectmapspec/edge.go`. Inspected the implementation
  bodies of every per-kind production `objectmap*.go` facet under
  `backend/resources` (33 kind directories), including typed, Gateway, HPA
  and ingest-owned producers. This does not close their model/detail/action packages.
- Frontend map shell and G6 renderer; model, visible-state, directional filter,
  selection, kind contraction, layout, collapse and deduplication; apply queue,
  G6 data, event bindings, interactions, gesture state, graph lifecycle,
  viewport helpers/hook, palette helpers/hook, card/path extensions, tooltip
  layout/overlay, renderer options/types, constants/card style, edge registry,
  legend dragging, scope/navigation/payload/loading helpers and debug store.
  Styles, stories and performance-fixture generation were not refactored.
- Consumer evidence includes snapshot recursive/namespace/Gateway/HPA/RBAC tests,
  filtering/layout tests, pointer-event and selection-state tests, queue tests,
  ObjectMap component tests and existing 500/1000-node performance checks.

Implemented the five candidate groups above plus shared renderer node/edge
lookups and one node-gesture completion handler for drag-end and pointer-up.
Added `objectMapTraversal.ts`; original inventory counts remain baseline counts.
The diff retains queue scheduling, provider lifecycle, kind semantics, payloads,
CSS, dependencies and native window contracts.

Validation:

- Baseline snapshot `go test ./backend/refresh/snapshot -run ObjectMap` passed;
  frontend object-map baseline passed 174 tests in 23 files. Cycle/dangling-edge/
  hidden-path characterization passed before traversal and kind refactoring.
  Incremental focused checks passed after each candidate group.
- Combined object-map run passed **179 tests in 23 files**. Added event-binding
  cases prove drag-end and pointer-up each finish a gesture once, including a
  later duplicate pointer-up; existing modifier-navigation assertions survive.
- External before/after comparison matched complete layout outputs on **500
  deterministic graphs**, including cycles, missing endpoints/seed, duplicate
  IDs, mixed kinds, metadata and split lanes. Script/baselines:
  `/tmp/luxury-yacht-s007-layout-{parity.mjs,before.ts,after.ts}`. This proves data
  parity for those fixtures, not native rendering or all possible inputs.
- `test:frontend-coverage` passed **4,796 tests in 513 files**, **87.64%** repository
  statement coverage. Changed production files combined: **852/933 (91.32%)**;
  traversal/filter/selection 100%, kind filter 94.20%, layout 97.15%, data 91.26%,
  queue 89.90%, interactions 89.28%. Event bindings remain **69.47%** for the whole
  file; unexercised wheel/error/event paths are not claimed covered. No behavior
  change or coverage-only test padding is included.
- `test:backend-coverage` passed. Ten changed/new Go functions cover **56/67
  statements (83.58%)**; metadata construction and typed/Gateway item projection
  are 100%. Existing nil/list-error/selector-invalid branches leave `collectHPAs`
  and map selector matching at 75%, label-selector matching at 71.43%.
  Counts: `/tmp/luxury-yacht-s007-coverage-report.txt`.
- Typecheck passed. Local complexity: **37 changed/new TypeScript functions**
  have no Biome finding above 12; **10 changed/new Go functions** score 0–6 with
  pinned gocognit v1.2.1. AST comparison confirms three retained Biome findings
  are unchanged functions: selection/data queue runners (21/27) and node-data
  projection callback (13). These are not Sonar closure claims.
- PR #355 audit at published head `8cbebce958211cc0ec6b57274dbfb383d38b53a0`
  reports three findings in earlier passes: S6759 `ShellConnectionControls.tsx:30`,
  S7737 `useGridTableContextMenuItems.tsx:76`, S6478 `ObjectPanelContent.tsx:72`.
  They are outside S007's diff and remain in the follow-up queue. The uncommitted
  S007 work has no remote Sonar analysis. Logs:
  `/tmp/luxury-yacht-s007-{sonar.log,pr.json}`.
- Native Wails interaction was not run for this behavior-preserving batch.
  Automated layout/state/interaction evidence does not claim native window or
  canvas visual verification.

Final `mise exec -- wails3 task qc:prerelease` passed (exit 0): docs, formatting,
bindings, vet/staticcheck, full backend race suite, frontend checks/typecheck,
4,796 frontend tests, Knip and Trivy. Log:
`/tmp/luxury-yacht-s007-prerelease.log`. Before/after tracked and new-file hash
comparison found **no gate modifications**; `git diff --check` passed. Manifest:
`/tmp/luxury-yacht-s007-after-gate.json`. Final diff comprises **10 production
files, five test files and this ledger**. Only this ledger changed afterwards;
`qc:docs` and `git diff --check` were rerun for that update.

Next scheduled domain: **S008 permissions and mutations**, with earlier-pass Sonar findings
retained explicitly for follow-up. The repository-wide review remains in progress.

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

Rows began **inventoried**. The review column now points to the inspected
responsibilities recorded in the pass history and completion continuation; it is
not a claim that every line, visual state or possible future refactor was audited.
Counts refer only to the baseline source classification above. `Go / JS` counts functions above 12 separately; a dash
means no signals in that language, not no review work. Update the last column
with reviewed scope and a pass reference, or split the row before reviewing.

| Review bucket | Files | Physical lines | Go / JS signals | Review |
| --- | ---: | ---: | ---: | --- |
| `.claude/hooks` | 1 | 86 | — / — | Reviewed scope: S014 impact-gate hook source; retained as Claude-specific tooling |
| `.github/actions` | 1 | 180 | — / — | Reviewed scope: S013 shared CI action and release workflow companions |
| `backend/(root: app)` | 3 | 327 | — / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: application)` | 6 | 1084 | 1 / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: auth)` | 1 | 185 | — / — | Reviewed scope: S003 cluster/auth/workspace selection, client lifetime and event projection |
| `backend/(root: autoscaling)` | 1 | 60 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: cluster)` | 23 | 3451 | 1 / — | Reviewed scope: S003 cluster/auth/workspace selection, client lifetime and event projection |
| `backend/(root: crd)` | 1 | 28 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: data)` | 2 | 517 | 1 / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: desktop)` | 10 | 1689 | — / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: devmode)` | 2 | 10 | — / — | Reviewed scope: S013 generated bindings, platform build and updater wiring |
| `backend/(root: error)` | 2 | 253 | 1 / — | Reviewed scope: S011 error reporting and logger emission |
| `backend/(root: events)` | 1 | 149 | — / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: exec)` | 4 | 277 | — / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: favorites)` | 2 | 572 | — / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: fetch)` | 1 | 395 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: generate)` | 1 | 17 | — / — | Reviewed scope: S013 generated bindings, platform build and updater wiring |
| `backend/(root: generic)` | 1 | 39 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: helm)` | 2 | 104 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: kubeconfig)` | 4 | 928 | 1 / — | Reviewed scope: S003 cluster/auth/workspace selection, client lifetime and event projection |
| `backend/(root: kubernetes)` | 1 | 83 | — / — | Reviewed scope: S003 cluster/auth/workspace selection, client lifetime and event projection |
| `backend/(root: logger)` | 1 | 371 | — / — | Reviewed scope: S011 error reporting and logger emission |
| `backend/(root: menu)` | 1 | 246 | — / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: node)` | 3 | 145 | — / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: object)` | 11 | 2243 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: operations)` | 2 | 323 | — / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: pod)` | 3 | 161 | — / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: portforward)` | 6 | 1133 | 2 / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: preferences)` | 5 | 2301 | 2 / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: refresh)` | 18 | 4252 | 4 / — | Reviewed scope: S004 domain registration, lifecycle, permissions and governor execution |
| `backend/(root: resource)` | 6 | 1450 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: response)` | 3 | 687 | — / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: runtime)` | 2 | 304 | 1 / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: settings)` | 1 | 229 | — / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: shell)` | 2 | 765 | 1 / — | Reviewed scope: S006 operation routing, session ownership and cleanup |
| `backend/(root: static)` | 1 | 83 | — / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: theme)` | 1 | 132 | — / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: types)` | 1 | 82 | — / — | Reviewed scope: S014 app-level DTO aliases |
| `backend/(root: ui)` | 2 | 334 | — / — | Reviewed scope: S010 persistence, schema migration, import/export/reset and runtime settings |
| `backend/(root: update)` | 8 | 1186 | — / — | Reviewed scope: S013 generated bindings, platform build and updater wiring |
| `backend/(root: window)` | 1 | 112 | — / — | Reviewed scope: S012 process/window lifecycle, desktop bridge and native menu dispatch |
| `backend/(root: workload)` | 2 | 502 | 1 / — | Reviewed scope: S005/S008 detail reads, YAML preparation and mutation admission |
| `backend/(root: workspace)` | 16 | 2130 | — / — | Reviewed scope: S003 cluster/auth/workspace selection, client lifetime and event projection |
| `backend/capabilities` | 4 | 866 | — / — | Reviewed scope: S008 SSAR worker, SSRR cache and matching |
| `backend/internal/applog` | 6 | 323 | — / — | Reviewed scope: S011/S014 reporting and scoped forwarding |
| `backend/internal/appupdates` | 2 | 1125 | 1 / — | Reviewed scope: S013 coordinator, scheduler and event publication |
| `backend/internal/authstate` | 4 | 683 | — / — | Reviewed scope: S003 manager and transport recovery |
| `backend/internal/cachekeys` | 1 | 18 | — / — | Reviewed scope: S014 cachekeys leaf policies and consumers |
| `backend/internal/config` | 1 | 551 | — / — | Reviewed scope: S014 config leaf policies and consumers |
| `backend/internal/containerlogs` | 5 | 495 | 1 / — | Reviewed scope: S006 log target/selection/classification |
| `backend/internal/credentialerrors` | 1 | 226 | — / — | Reviewed scope: S003/S011 classifier precedence |
| `backend/internal/errorcapture` | 4 | 589 | — / — | Reviewed scope: S011 capture policy and stderr assembly |
| `backend/internal/genappbindings` | 2 | 306 | — / — | Reviewed scope: S013 generator and registration inputs |
| `backend/internal/genobjectactions` | 1 | 24 | — / — | Reviewed scope: S013 generator and registration inputs |
| `backend/internal/genrefreshcontracts` | 5 | 856 | 1 / — | Reviewed scope: S013 generator and registration inputs |
| `backend/internal/k8sretry` | 1 | 105 | 1 / — | Reviewed scope: S014 k8sretry leaf policies and consumers |
| `backend/internal/lifecycle` | 1 | 42 | — / — | Reviewed scope: S014 lifecycle leaf policies and consumers |
| `backend/internal/linescanner` | 1 | 20 | — / — | Reviewed scope: S014 linescanner leaf policies and consumers |
| `backend/internal/logclassify` | 1 | 74 | — / — | Reviewed scope: S014 logclassify leaf policies and consumers |
| `backend/internal/logsources` | 1 | 27 | — / — | Reviewed scope: S014 logsources leaf policies and consumers |
| `backend/internal/parallel` | 1 | 71 | — / — | Reviewed scope: S014 parallel leaf policies and consumers |
| `backend/internal/timeutil` | 2 | 107 | — / — | Reviewed scope: S014 timeutil leaf policies and consumers |
| `backend/kind/kindregistry` | 2 | 168 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/kindspec` | 1 | 176 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/objectmap` | 1 | 54 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/objectmapnode` | 2 | 134 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/objectmapspec` | 2 | 183 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/streamrows` | 2 | 601 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/kind/streamspec` | 1 | 64 | — / — | Reviewed scope: S002/S007 registry and per-kind model/table/map producer contracts |
| `backend/nodemaintenance` | 1 | 584 | — / — | Reviewed scope: S006 store/history/cancellation and terminal updates |
| `backend/objectaction` | 1 | 150 | — / — | Reviewed scope: S008 canonical action metadata and generated consumers |
| `backend/objectcatalog` | 25 | 5995 | 8 / — | Reviewed scope: S002 discovery/collection/publication, query/facets, lookup and lifecycle |
| `backend/objectyaml` | 1 | 130 | — / — | Reviewed scope: S008 merge projection and mutation field policy |
| `backend/refresh` | 6 | 804 | 2 / — | Reviewed scope: S004 shared domain/scope/stream contracts |
| `backend/refresh/api` | 1 | 304 | — / — | Reviewed scope: S004 api contract and lifecycle owners |
| `backend/refresh/containerlogsstream` | 4 | 2200 | 3 / — | Reviewed scope: S006 handler, streamer, limiter and wire DTO |
| `backend/refresh/domain` | 2 | 264 | — / — | Reviewed scope: S004 domain contract and lifecycle owners |
| `backend/refresh/domainpermissions` | 2 | 754 | — / — | Reviewed scope: S004 domainpermissions contract and lifecycle owners |
| `backend/refresh/eventstream` | 2 | 484 | — / — | Reviewed scope: S004 eventstream contract and lifecycle owners |
| `backend/refresh/informer` | 4 | 1065 | 1 / — | Reviewed scope: S004 informer contract and lifecycle owners |
| `backend/refresh/ingest` | 6 | 2779 | 3 / — | Reviewed scope: S004 store/reflector/manager/partition/resume lifetime |
| `backend/refresh/metrics` | 4 | 999 | 2 / — | Reviewed scope: S004 poller/demand/retry and source clocks |
| `backend/refresh/permissions` | 2 | 457 | — / — | Reviewed scope: S004 permissions contract and lifecycle owners |
| `backend/refresh/querypage` | 10 | 3065 | 5 / — | Reviewed scope: S004 filter/sort/cursor/query execution |
| `backend/refresh/resourcestream` | 20 | 3531 | 2 / — | Reviewed scope: S004 manager, delivery, notifiers and descriptor consumers |
| `backend/refresh/ringbuffer` | 1 | 68 | — / — | Reviewed scope: S004 ringbuffer contract and lifecycle owners |
| `backend/refresh/snapshot` | 77 | 20864 | 11 / — | Reviewed scope: S004 service/flights/query/maintained-store responsibilities; S002 catalog, S005 content, S006 maintenance, S007 map; completion follow-through adds overview/attention/workload/event/Helm/custom builders and namespace notifiers |
| `backend/refresh/streammux` | 3 | 844 | 2 / — | Reviewed scope: S004 streammux contract and lifecycle owners |
| `backend/refresh/system` | 9 | 2505 | 1 / — | Reviewed scope: S004 registration, readiness and generation lifetime |
| `backend/refresh/telemetry` | 1 | 707 | — / — | Reviewed scope: S011 recorder/aggregate ownership and locking |
| `backend/resourcecontract` | 1 | 200 | — / — | Reviewed scope: S002/S007 resource projection contracts and registry dependency direction |
| `backend/resourcekind` | 2 | 113 | — / — | Reviewed scope: S002 canonical kind/family identity |
| `backend/resourcemodel` | 15 | 1977 | 3 / — | Reviewed scope: S002/S014 metadata, status, relationships, facts and quantity maps |
| `backend/resources` | 1 | 12 | — / — | Reviewed scope: S002 resource-package ownership declaration |
| `backend/resources/admission` | 12 | 775 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/apiextensions` | 8 | 461 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/appbinding` | 1 | 22 | — / — | Reviewed scope: S013 per-kind binding metadata contract |
| `backend/resources/argocd` | 3 | 497 | — / — | Reviewed scope: S002/S005 facts, status, destinations and shared scalar readers |
| `backend/resources/backendtlspolicy` | 12 | 303 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/certmanager` | 1 | 224 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/clusterrole` | 13 | 381 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/clusterrolebinding` | 13 | 310 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/common` | 11 | 764 | — / — | Reviewed scope: S002/S014 dependencies, copies, ports, identity, managed fields and discovery |
| `backend/resources/configmap` | 11 | 344 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/crdfacts` | 3 | 199 | — / — | Reviewed scope: S002 scalar/condition/selector primitives; copy semantics retained |
| `backend/resources/cronjob` | 11 | 746 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/customresource` | 6 | 601 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/daemonset` | 11 | 514 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/deployment` | 11 | 723 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/endpointslice` | 12 | 524 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/events` | 7 | 436 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/externalsecrets` | 1 | 182 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/gateway` | 12 | 327 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/gatewayapi` | 3 | 147 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/gatewayclass` | 12 | 307 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/generic` | 3 | 269 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/grpcroute` | 11 | 262 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/helm` | 5 | 750 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/hpa` | 12 | 866 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/httproute` | 11 | 257 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/ingress` | 13 | 604 | 2 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/ingressclass` | 11 | 340 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/job` | 10 | 501 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/karpenter` | 1 | 232 | — / — | Reviewed scope: S002/S005 facts, links, quantities and shared scalar readers |
| `backend/resources/limitrange` | 10 | 316 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/listenerset` | 12 | 331 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/namespaces` | 8 | 511 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/networkpolicy` | 13 | 540 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/nodes` | 10 | 1846 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/persistentvolume` | 12 | 632 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/persistentvolumeclaim` | 12 | 516 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/poddisruptionbudget` | 13 | 451 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/pods` | 13 | 1954 | 5 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/prometheus` | 1 | 181 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/referencegrant` | 12 | 368 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/replicaset` | 11 | 514 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/resourcequota` | 10 | 375 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/role` | 12 | 310 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/rolebinding` | 13 | 319 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/secret` | 11 | 365 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/service` | 13 | 674 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/serviceaccount` | 12 | 377 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/statefulset` | 11 | 631 | 1 / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/storageclass` | 11 | 447 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/tlsroute` | 11 | 242 | — / — | Reviewed scope: S002/S005 typed detail/facts and S007 registry/map projection review; per-kind policies retained |
| `backend/resources/types` | 9 | 1096 | — / — | Reviewed scope: S002/S005/S006/S010 shared DTO contracts with their producers |
| `backend/resources/workloads` | 2 | 308 | — / — | Reviewed scope: S002 workload and pod-aggregation helpers |
| `build/linux` | 7 | 403 | — / — | Reviewed scope: S013 portable/AppImage packaging sources |
| `build/windows` | 4 | 552 | — / — | Reviewed scope: S013 installer sources and installation/drill ownership |
| `cmd/project` | 20 | 3081 | 5 / — | Reviewed scope: S013 all project task owners, generators and release preparation |
| `frontend` | 2 | 225 | — / — | Reviewed scope: S013 Vite/test configuration and HTML entry |
| `frontend/.storybook` | 10 | 331 | — / 1 | Reviewed scope: S013 Storybook setup and component fixtures |
| `frontend/biome-plugins` | 6 | 217 | — / — | Reviewed scope: S013 repository lint plugins |
| `frontend/scripts` | 3 | 1306 | — / 3 | Reviewed scope: S013 lint, error-boundary and Sonar audit scripts |
| `frontend/src/(root)` | 7 | 1007 | — / — | Reviewed scope: S012 app roots, provider ordering and panel-window composition |
| `frontend/src/core/app-state-access` | 4 | 75 | — / — | Reviewed scope: S011/S014 app-state request instrumentation and explicit generated-binding facades |
| `frontend/src/core/backend-api` | 2 | 166 | — / — | Reviewed scope: S011/S014 app-state request instrumentation and explicit generated-binding facades |
| `frontend/src/core/capabilities` | 11 | 2623 | — / 5 | Reviewed scope: S008 capability and action identity, availability and execution |
| `frontend/src/core/cluster-workspace` | 2 | 755 | — / — | Reviewed scope: S003 workspace selection, connection and Kubernetes provider |
| `frontend/src/core/codemirror` | 3 | 640 | — / — | Reviewed scope: S005/S014 YAML editor and CodeMirror search/theme/native adapters |
| `frontend/src/core/connection` | 1 | 237 | — / — | Reviewed scope: S003 workspace selection, connection and Kubernetes provider |
| `frontend/src/core/contexts` | 11 | 1875 | — / 1 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/core/data-access` | 6 | 700 | — / — | Reviewed scope: S004 scoped refresh, broker/lease lifecycle and resource metrics |
| `frontend/src/core/desktop-runtime` | 1 | 81 | — / — | Reviewed scope: S012 native window and dockable panel composition |
| `frontend/src/core/events` | 3 | 317 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/core/logging` | 1 | 112 | — / — | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/core/navigation` | 5 | 489 | — / — | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/core/panel-windows` | 17 | 2600 | — / — | Reviewed scope: S012 native window and dockable panel composition |
| `frontend/src/core/persistence` | 2 | 448 | — / — | Reviewed scope: S010 settings, persistence, hydration and favorites |
| `frontend/src/core/read-diagnostics` | 2 | 312 | — / — | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/core/refresh` | 60 | 17381 | — / 9 | Reviewed scope: S004 scoped refresh, broker/lease lifecycle and resource metrics |
| `frontend/src/core/resource-metrics` | 6 | 726 | — / 2 | Reviewed scope: S004 scoped refresh, broker/lease lifecycle and resource metrics |
| `frontend/src/core/settings` | 4 | 1890 | — / — | Reviewed scope: S010 settings, persistence, hydration and favorites |
| `frontend/src/core/telemetry` | 2 | 1175 | — / — | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/core/window-identity` | 1 | 9 | — / — | Reviewed scope: S012 native window and dockable panel composition |
| `frontend/src/hooks` | 8 | 746 | — / 1 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/modules/browse` | 13 | 3294 | — / 1 | Reviewed scope: S001/S002 query/table binding and catalog-backed consumers |
| `frontend/src/modules/cluster` | 26 | 5362 | — / — | Reviewed scope: S002/S004 resource view/column declarations and overview/attention consumers |
| `frontend/src/modules/global` | 5 | 773 | — / 2 | Reviewed scope: S002/S004 resource view/column declarations and overview/attention consumers |
| `frontend/src/modules/kubernetes` | 1 | 856 | — / — | Reviewed scope: S003 workspace selection, connection and Kubernetes provider |
| `frontend/src/modules/namespace` | 30 | 4701 | — / 1 | Reviewed scope: S002/S004 resource view/column declarations and overview/attention consumers |
| `frontend/src/modules/object-map` | 38 | 8546 | — / 12 | Reviewed scope: S007 graph projection, layout, navigation and rendering |
| `frontend/src/modules/object-panel` | 141 | 32321 | — / 31 | Reviewed scope: S005/S006/S008/S012 panel reconciliation, every Overview descriptor, YAML/actions/logs/shell/debug and native consumers |
| `frontend/src/modules/port-forward` | 4 | 874 | — / 1 | Reviewed scope: S006 operation UI and cleanup |
| `frontend/src/modules/resource-grid` | 15 | 4107 | — / 1 | Reviewed scope: S001/S002 query/table binding and catalog-backed consumers |
| `frontend/src/shared/actions` | 4 | 772 | — / — | Reviewed scope: S008 capability and action identity, availability and execution |
| `frontend/src/shared/components` | 26 | 3064 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/components/aria` | 1 | 25 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/components/diff` | 6 | 1327 | — / 3 | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/shared/components/drain` | 3 | 784 | — / 4 | Reviewed scope: S006 operation UI and cleanup |
| `frontend/src/shared/components/dropdowns` | 9 | 2392 | — / — | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/shared/components/errors` | 9 | 1119 | — / — | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/shared/components/IconBar` | 1 | 115 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/components/icons` | 9 | 2018 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/components/inputs` | 1 | 84 | — / — | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/shared/components/kubernetes` | 5 | 413 | — / — | Reviewed scope: S005 shared resource header/status/metadata/action presentation |
| `frontend/src/shared/components/modals` | 14 | 2617 | — / — | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/shared/components/status` | 2 | 233 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/components/tables` | 79 | 14583 | — / 25 | Reviewed scope: S001 shared-table production owners; dirty-width C2 remains deferred behavior work |
| `frontend/src/shared/components/tabs` | 9 | 1470 | — / — | Reviewed scope: S014 tab drag/listener ownership and scrollbar geometry |
| `frontend/src/shared/components/yaml` | 3 | 807 | — / 2 | Reviewed scope: S005/S014 YAML editor and CodeMirror search/theme/native adapters |
| `frontend/src/shared/constants` | 2 | 139 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/events` | 4 | 532 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/hooks` | 9 | 1969 | — / 1 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/resources` | 1 | 111 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/shared/scrollbars` | 3 | 1685 | — / 3 | Reviewed scope: S014 tab drag/listener ownership and scrollbar geometry |
| `frontend/src/shared/terminal` | 1 | 211 | — / 1 | Reviewed scope: S006 operation UI and cleanup |
| `frontend/src/shared/utils` | 17 | 1401 | — / 1 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/types` | 4 | 136 | — / — | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/types/navigation` | 1 | 63 | — / — | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/types/shortcuts` | 1 | 48 | — / — | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/ui/command-palette` | 3 | 2242 | — / — | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/ui/dockable` | 17 | 4616 | — / 4 | Reviewed scope: S012 native window and dockable panel composition |
| `frontend/src/ui/errors` | 5 | 562 | — / — | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/ui/favorites` | 6 | 2351 | — / 5 | Reviewed scope: S010 settings, persistence, hydration and favorites |
| `frontend/src/ui/layout` | 27 | 6864 | — / 2 | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/ui/modals` | 9 | 3171 | — / 1 | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/ui/navigation` | 2 | 30 | — / — | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/ui/overlays` | 2 | 183 | — / — | Reviewed scope: S009 popup/input/focus policies; S008 action and S009 diff modal consumers |
| `frontend/src/ui/panels` | 2 | 1250 | — / 2 | Reviewed scope: S011 error/reporting/telemetry and request diagnostics |
| `frontend/src/ui/settings` | 10 | 3639 | — / — | Reviewed scope: S010 settings, persistence, hydration and favorites |
| `frontend/src/ui/shortcuts` | 20 | 2997 | — / 2 | Reviewed scope: S009 navigation registry, sidebar, keyboard/menu dispatch and focus |
| `frontend/src/ui/status` | 10 | 1811 | — / 2 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/src/utils` | 14 | 1803 | — / 3 | Reviewed scope: S014 quiet context/event/status and primitive follow-through |
| `frontend/styles` | 29 | 5412 | — / — | Reviewed scope: S014 cascade entry, base/reset/layout, focus/motion and scrollbar tokens; appearance/component rules remain with their consumers |
| `internal/appstate` | 1 | 45 | — / — | Reviewed scope: S010 persistent-state root manifest |
| `internal/appwindow` | 19 | 3689 | — / — | Reviewed scope: S012 registry, native roles, geometry, close/quit and transfers |
| `internal/bootstrap` | 2 | 200 | — / — | Reviewed scope: S012 startup composition and platform bootstrap |
| `internal/panelwindow` | 8 | 1009 | — / — | Reviewed scope: S012 model, ownership, publication and transfers |
| `internal/sentry` | 6 | 1477 | 1 / — | Reviewed scope: S011 reporter, privacy, operation schema and session lifecycle |
| `internal/updateconformance` | 3 | 286 | 2 / — | Reviewed scope: S013 updateconformance validation, ownership and cleanup contracts |
| `internal/updateidentity` | 8 | 686 | — / — | Reviewed scope: S013 updateidentity validation, ownership and cleanup contracts |
| `internal/updatestate` | 3 | 780 | 3 / — | Reviewed scope: S013 updatestate validation, ownership and cleanup contracts |
| `internal/updatetemp` | 4 | 506 | 2 / — | Reviewed scope: S013 updatetemp validation, ownership and cleanup contracts |
| `internal/windowsinstall` | 3 | 104 | — / — | Reviewed scope: S013 windowsinstall validation, ownership and cleanup contracts |
| `main.go` | 1 | 14 | — / — | Reviewed scope: S012 bootstrap delegation |

## S008 — permissions and mutations

**Status: selected batch implemented; focused, coverage and final gate passed.** Baseline `c9f56a24e72937040ee682b4e0002d790af13f3f`;
worktree clean at entry. This batch follows the permission query from the backend
review service/cache through the frontend store and named-object capability hook,
then checks the action consumers. It also addresses the three recorded earlier-pass
Sonar findings on PR #355 (audit of the baseline head, not of these local edits).

### Responsibility review and selected changes

| Responsibility inspected | Disposition |
| --- | --- |
| Frontend permission store: query keys/GVK, pending/materialized status, namespace chunking, cluster/kind queries, diagnostics, TTL refresh and lifecycle replay | Consolidate response/error projection, payload construction and successful diagnostic completion. Preserve the different namespace, cluster and lazy-kind freshness/error policies, asynchronous notification channels, and namespace interest replay. |
| Capability hook: unnamed store lookup, named RPC, readiness wait, operational-event retry and result publication | Separate pure state derivation from synchronization; give copy/update/publication of named results one owner. Preserve effect order, retained named results, dropped missing-cluster requests, and transient errors remaining pending. |
| Backend SSAR worker service, SSRR cache/rule matching, QueryPermissions preparation/fallback/diagnostics and mutation permission checks | Use singleflight's existing error return and one permission-review retry policy in the capabilities package. Keep distinct SSAR/SSRR/read-check caches, locks and cancellation ownership. Retain exact catalog resolution and the gateway's indexed parallel response assembly. |
| Object action request dispatch, workload mutation validation/permission/write/cache ordering, frontend action target/client and controller handler construction | Retain generated action ownership and operation-specific validation/order. The shared action controller already owns navigation, permission lookup and confirmations; no new generic mutation executor or action matrix. |
| Earlier-pass Sonar findings: shell connection controls, grid sort items, panel tab fallback | Read-only props, stable default labels, and module-level fallback renderer factory without changing the ErrorBoundary API. |

Inspected scope includes `core/capabilities/{permissionStore,hooks,permissionRead,
permissionTypes,permissionFeatures,permissionSpecs,catalog,utils,types}`, backend `capabilities/{service,
rules,query}`, `resource_gateway_permissions.go`, `resource_permission.go`,
`response_cache_permissions.go`, `object_actions.go`, `workload_actions.go`,
`refresh/permissions/resource_requirement.go`, `refresh/snapshot/runtime_permissions.go`,
`objectActionClient.ts`, and the permission/navigation/default-handler portions of
`useObjectActionController.tsx`. The complete `objectActionPolicy.ts` and generated
kind-capability lookup were read; panel-capability composition was partly inspected.
YAML mutation internals, node/operation services, full action-controller modal
execution, backend permission generation and refresh gate/revalidation
are not closed by this batch.

The producer chain stays Kubernetes reviews → QueryPermissions → permission read
broker → store or hook-local named results → action/tab consumers. No wire types,
provider order, readiness transitions or import direction change. State helpers
import only permission types/transient-error classification; they do not import
the store or hook. Readiness still blocks named-object queries while allowing
cluster activation and operational-event retries. Existing readiness/recovery,
namespace spec-set deduplication and notification tests provide regression coverage;
seven characterization cases for mixed result/error states, diagnostic completion,
custom-kind identity and retry intervals passed against the original implementations. Focused checks run per change; coverage, complexity and the
prerelease gate run at the batch boundary.

Follow-through inspection found the former `CLUSTER_CAPABILITIES` catalog has no
repository runtime consumer: repository-wide symbol/path search finds its
implementation, barrel export, one catalog-only test, and a stale spec comment.
Dynamic capability imports are confined to existing tests and do not read that
export. `permissionStore.ts` reads `CLUSTER_PERMISSIONS` directly. Removed the
241-line duplicate catalog and export, retaining the runtime spec lists and their
feature/diagnostics tests. The pre-removal coverage run and surviving consumer
checks are recorded below. The permission catalog and spec source
have now been inspected in full; backend generation remains outside this batch.


### Validation and remaining scope

- Focused baseline: 115 frontend tests and backend capability/query/action tests
  passed. Seven new characterization cases passed before the corresponding
  refactors (capabilities: 61 tests). Incremental store/hook/backend checks passed;
  expanded object-panel/action consumer run passed **98 files / 858 tests**;
  Sonar companion paths passed **5 files / 74 tests**. Catalog removal passed
  surviving capability/diagnostics/namespace-context tests (**9 files / 106 tests**).
  Logs: `/tmp/luxury-yacht-s008-{frontend-before,backend-before,characterization,
  store-after,hooks-after,backend-after,sonar-fixes-after,catalog-after}.log`.
- Both repository coverage tasks passed. Frontend: **513 files / 4,802 tests**,
  87.74% aggregate statement coverage. Directly touched runtime owners:
  `permissionStore.ts` **89.14%**, `hooks.ts` **92.85%**, `capabilityState.ts`
  **100%**, `ObjectPanelContent.tsx` **90.41%**, `ShellConnectionControls.tsx`
  **85.71%**, grid context-menu items **100%**. Report moved outside the tree
  before lint: `/tmp/luxury-yacht-s008-frontend-coverage/coverage-summary.json`.
  Go's two changed functions cover **18/18 statements (100%)** in
  `build/coverage/backend.coverage.out`.
- Pruning impact: removed one test that exercised only the deleted static catalog;
  its pre-removal report contains **3/3 statements and 1/1 function**. No runtime
  spec/diagnostics assertions were removed. Report:
  `/tmp/luxury-yacht-s008-catalog-before-coverage/coverage-summary.json`.
- Typecheck passed. Local complexity: **38 changed/new TypeScript functions**
  have no Biome finding above 12; the two changed Go functions score **0 and 1**
  with gocognit v1.2.1. AST comparison identifies two retained, unchanged store
  functions: public-map rebuilding (13) and TTL refresh scheduling (14). Their
  materialized-before-pending precedence and staggered refresh policies remain
  explicit rather than being folded into the query-completion helpers. Evidence:
  `/tmp/luxury-yacht-s008-{complexity-audit,go-functions,go-complexity}.json`.
- PR #355 all-rule audit at published head
  `c9f56a24e72937040ee682b4e0002d790af13f3f` reported S6759 in shell controls,
  S7737 in grid sort defaults and S6478 in the panel tab boundary. Local edits
  address each cause; remote Sonar closure requires analysis of a later published
  revision. No push was requested. Audit: `/tmp/luxury-yacht-s008-sonar.log`.
- Native Wails interaction was not run for this behavior-preserving batch.
  The automated consumer tests do not establish native-window visual behavior.

Next domain in the recorded rotation: **S009 navigation and interaction**
(sidebar/routing, shortcuts, command palette, modal and shared-input/menu owners).
The remaining S008 mutation/generation/refresh responsibilities above stay in the
next-cycle inventory; this batch does not close the entire permissions domain.


Final `mise exec -- wails3 task qc:prerelease` passed (exit 0): docs, formatting,
generated bindings, vet/staticcheck, full backend race suite, frontend checks and
typecheck, **4,802 frontend tests**, Knip and Trivy. Log:
`/tmp/luxury-yacht-s008-prerelease.log`. The before/after file-hash comparison found
**no gate modifications**; `git diff --check` passed. Manifest:
`/tmp/luxury-yacht-s008-after-gate.json`. The diff covers **11 production files,
three test files and this ledger**, with **329 fewer production lines** including
the new `capabilityState.ts` and removed `catalog.ts`. Source inventory counts
above remain baseline counts; these path replacements are recorded here. Only
this ledger changed after the gate; its final update passed `qc:docs` and
`git diff --check`.

## S009 — navigation and interaction

**Status: selected batch implemented; focused, coverage, complexity and final gate passed.**
Baseline `a1b984d0`; worktree clean at entry. Follow keyboard dispatch from surface
registration through ordinary keys, Escape and native actions, then simplify the
command palette's result interactions, selection movement and action handling.

| Responsibility inspected | Disposition |
| --- | --- |
| Keyboard provider surface ranking and dispatch; shortcut hook registration, publication and disposal | Use one ranked candidate list for keyboard/native dispatch; remove duplicate handler/registration refs while preserving effect publication before registration and local cleanup identity. |
| Palette result rows, open/close state reset, six navigation keys and shortcut help registrations | Give shared row interaction, reset state and selection publication one owner; derive surface dispatch and help registration from the same local shortcut definitions. Preserve wrapping, clamping, mouse arming, delayed actions and mode-specific Escape. |
| Palette navigation/settings/application commands | Consolidate the repeated asynchronous error-reporting policy while retaining each operation's action label and routing order. |
| Sidebar route/group/namespace expansion, ViewStateContext and modal focus trap | Retain existing ownership and order: staged cluster routes, namespace selection, persistent disclosure, modal stack/inert state and portal-aware focus are different contracts. |
| ContextMenu and Dropdown keyboard/state hooks | Retain their distinct disabled-row, focus restoration, Tab, selection and outside-click policies; no generic popup navigation abstraction. |

Read in full: `CommandPalette.tsx`, `CommandPaletteCommands.tsx`, shortcut
`context.tsx` and `hooks.ts`, `Sidebar.tsx`, `ViewStateContext.tsx`,
`ContextMenu.tsx`, `useModalFocusTrap.ts`, Dropdown `useKeyboardNavigation.ts`
and state hook. Test review includes shortcut provider/surfaces/hooks and palette
interaction/command consumers. This is not a closure claim for all app-shell code:
The follow-through review below covers Sidebar keyboard navigation and menu
consumers. Settings, native command producers, dockable panels, Favorites and
remaining shared input owners remain in inventory.

Surface registration produces active roots and routing metadata; keyboard/native
handlers consume the same ordering (containment depth, blocking/capture status,
priority, then registration order). Escape/Tab may continue through candidates;
ordinary keys/native actions select the first. Publication effects still precede
registration; cleanup removes only that effect's registrations. No provider order,
cluster/object identity, import direction or readiness gate changes. Existing
nested-surface, capture/blocking fallback, native action, fresh-handler and focus
restoration tests cover these contracts; add navigation boundary characterization
before the corresponding refactor. Run focused checks per responsibility and
coverage/complexity/prerelease once at the batch boundary.

Follow-through review read `SidebarKeys.ts`, `applicationMenuCommands.ts` and
`GlobalShortcuts.tsx` in full. Retain Sidebar's preview/pending/committed selection
and focus listeners; retain application menu descriptors as the accelerator source.
Add GlobalShortcuts to the batch: its ref-publication effect runs before both
animation checks, so those checks compare the new state with itself. Remove that
ineffective animation bookkeeping and use the shortcut hook's existing current
handler publication for Escape; remove the object-panel prop whose only consumer
is an empty branch. Two characterization cases cover immediate help reopen,
settings exclusion and Escape state changes before this edit. Repository search
locates the sole production GlobalShortcuts caller in `App.tsx`.

PR #355 at published head `a1b984d07009fce6aa3ea27c927d79c8c23485be` reports one
new-code issue, `typescript:S4138` / `AaCxPE6g7XSI2CXwtM4v`, in the earlier
`objectMapTraversal.ts` pass. Replace its indexed queue iteration with `for-of`,
which continues visiting appended entries in the same order. Both consumers
(selection and directional filtering) were read; existing cycle and multi-hop
chain tests characterize the traversal. No graph identity or direction policy changes.

Also read `PanelWindowShortcuts.tsx`, `ApplicationMenuShortcuts.tsx` and
`AppMenuBar.tsx` in full as keyboard consumers. Their current role-specific
close/transfer guards, publication acknowledgements and menu focus restoration
stay separate. Panel-window snapshot projection and repeated group selection
are candidates for S012, where their lifecycle producers can be reviewed together;
reading this consumer alone does not close native-window ownership. Application
menu command descriptors remain the shared accelerator source, and menu invocation
continues restoring prior content focus before dispatch.

### Validation and remaining scope

- Focused baseline: **41 files / 422 tests** passed. Seven palette characterization
  cases passed before their refactors (**60 palette tests**); two GlobalShortcuts
  characterization cases passed before that refactor (**24 tests** with graph
  consumers). Incremental shortcut, palette row/reset, navigation and command
  checks passed. Expanded consumers passed **44 files / 443 tests**. Logs:
  `/tmp/luxury-yacht-s009-{before,characterization,shortcuts,palette-rows,
  palette-navigation,palette-commands,follow-through-before,expanded}.log`.
- Frontend coverage passed: **513 files / 4,811 tests**, **87.81%** aggregate
  statement coverage. Changed implementation owners: palette **89.51%**, palette
  commands **93.79%**, GlobalShortcuts **92.30%**, keyboard provider **90.71%**,
  shortcut hooks **100%**, graph traversal **100%**. `App.tsx` remains **57.62%**
  (34/59 statements); its sole edit removes a prop connected only to the removed
  empty branch, with no executable statement change. No unrelated root-app tests
  were added to inflate this file-level metric. Report:
  `/tmp/luxury-yacht-s009-frontend-coverage/coverage-summary.json`.
- Typecheck and targeted Biome check passed. Local complexity: **58 changed/new
  TypeScript functions**, none above 12, with no retained findings in the checked
  files. Evidence: `/tmp/luxury-yacht-s009-{typecheck,format}.log` and
  `/tmp/luxury-yacht-s009-complexity-audit.json`. No tests were deleted.
- The published PR audit reports only S4138 in graph traversal at baseline head
  `a1b984d07009fce6aa3ea27c927d79c8c23485be`; the three S008 findings are absent
  from that audit. The local loop change addresses S4138; remote closure requires
  analysis after a later authorized push. No push was requested. Audit:
  `/tmp/luxury-yacht-s009-sonar.log`.
- Native Wails interaction was not run for this behavior-preserving batch.
  Automated focus/keyboard tests do not establish native-window visual behavior.

Next domain: **S010 preferences and persistence** — settings, favorites, UI-state
hydration, import/export/reset and their persistence owners. Native panel-window
producer/consumer follow-through remains assigned to S012. No files were added or
removed from the source inventory by S009.


Final `mise exec -- wails3 task qc:prerelease` passed (exit 0): docs, formatting,
generated bindings, vet/staticcheck, full backend race suite, frontend checks and
typecheck, **4,811 frontend tests**, Knip and Trivy. Log:
`/tmp/luxury-yacht-s009-prerelease.log`. SHA-256 comparison of **3,243 files** found
**no gate modifications**; `git diff --check` passed. Manifest:
`/tmp/luxury-yacht-s009-after-gate.json`. The diff covers **seven production files,
three test files and this ledger**, with **223 fewer production lines**. Only this
ledger changed after the gate; the final update is checked with `qc:docs` and
`git diff --check`.

## S010 — preferences and persistence

**Status: selected batch implemented; affected checks and final gate passed.** Baseline `472fd284`; clean
worktree at entry. Review settings from frontend metadata/cache and editor state
through backend persistence, plus Favorites/UI-state and import/export/reset owners.

| Responsibility | Selected disposition |
| --- | --- |
| `appPreferences.ts`: metadata, hydration, typed mutations, notifications, bootstrap mirrors and debounce workflows | One mutation representation drives both optimistic cache updates and the persisted change list. Remove the duplicate update map and forwarding layer; preserve change/event order, rollback, broadcast timing and normalization. Keep fallback/schema metadata and type-specific normalization explicit. |
| Appearance controls and theme editing | Move hex draft/edit/validation into the existing color-control component; give palette field edits/resets one preview/persistence path. Keep accent/link runtime effects distinct and preserve draft cancellation, debounce and saved-theme behavior. |
| Backend theme CRUD and cache synchronization | One theme-library transaction owns lock/load/normalize/save/cache synchronization. Keep validation before writes, default-theme protection, insertion/reorder rules and persistence-before-cache ordering. |
| Import/export UI | One operation lifecycle owns busy/status/error/finally handling. Keep settings/favorites rehydration distinct and only run it after an uncanceled import. |
| UI-state single/batch deletion | Delegate single-entry deletion to the existing batch owner, retaining empty-key no-op and missing-file behavior. |
| Favorites cache/context, cluster-tab hydration, backend reset/import orchestration | Retain separate stores and lifetimes; do not introduce a generic persistence cache or merge leaf-owner locks. Favorites order and navigation semantics remain explicit. |

Read in full: frontend `core/settings/appPreferences.ts`, `core/persistence/{favorites,
clusterTabOrder}.ts`, `core/contexts/FavoritesContext.tsx`, `AppearanceSection.tsx`,
`useThemes.ts`, `DataManagementSection.tsx`, `SettingsControls.tsx`; backend
`data_management_{coordinator,import_export}.go`, `preferences_domain_repositories.go`,
`ui_state_store_persistence.go`. Read PreferencesService lazy load/reset (through
DispatchDefaults), theme normalization and settings file load/save/atomic writes, theme CRUD,
preference batch preparation, and Favorites persistence CRUD/load/save. Backend
metadata descriptors and full Favorites migration are not closed by this batch. The current baseline has Favorites migrations beyond the
older documentation; they are preserved and are not candidates for removal.

Producer/consumer chain: settings controls → typed preference workflows → optimistic
cache/events/bootstrap mirrors → UpdateAppPreferences → backend validation/persistence
→ runtime effects; theme library mutations persist before updating the preferences
cache used by later settings writes. Color draft state has two independent component
instances; its callbacks still enter the same parent preview and persistence path.
No provider ordering, readiness, cluster/object identity, wire shape, or import
boundary changes. The color component imports only React; it cannot cycle back into
settings state. Theme mutations retain the existing preferences mutex and file owner.
Existing rollback/event-order/debounce/schema, theme ordering/protection, import
cancel/error and UI-state round-trip tests are the regression base; characterize
missing editor and persistence-failure cases before edits. Focused checks follow each
responsibility; coverage, complexity and prerelease run once at the batch boundary.

### Implementation and follow-through

- Preference mutations now carry only ordered changes and storage options. The
  optimistic cache derives its patch from those same changes; scalar, palette
  and layout builders no longer assemble duplicate payloads. The fire-and-forget
  error boundary is owned directly by `commitPreferenceMutation`.
- `AppearanceColorControl.tsx` owns each swatch's draft, normalization and
  Enter/Escape/blur behavior. Appearance retains the accent/link preview effects,
  immediate reset versus debounced edit commits, and cancellation on unmount.
  Palette edits and resets share `updatePaletteField`, which retains the other
  two current values; inline editing uses the same field path.
- `updateThemeLibrary` owns the preferences lock, file load, normalization,
  atomic save and cache publication for Save/Delete/Reorder. Validation order,
  first-match replacement, default-theme ordering, and existing reorder input
  semantics remain in their operations. ApplyTheme remains separate because it
  updates active appearance fields as well as the library cache.
- Data Management has one busy/status/error/finally lifecycle for four operation
  descriptors. Canceled imports return before hydration; pending import hydration
  continues disabling all four operation buttons. Telemetry retains its existing
  previous-value rollback and error-report ordering.
- Single GridTable deletion enters the batch deletion owner after its empty-key
  guard. A focused regression also covers missing files and blank-key deletion
  with an invalid persistence file, so that no-op cannot accidentally load/write.

Read all four remaining settings sections during follow-through: `DisplaySection`,
`ObjectPanelSection`, `AdvancedSection`, `KubeconfigsSection`. Retain the existing
shared toggle/input owners and distinct draft-versus-committed layout values.
Kubeconfig updates intentionally reload persisted paths before discovered configs;
factory reset clears appearance before backend reset, then tables/storage before
reload. These orderings are not interchangeable generic settings mutations.
Kubeconfig native-dialog behavior and native layout application remain outside
this batch's automated evidence. Backend descriptor generation and Favorites
schema migrations remain on the next rotation's unreviewed list.

Inventory delta from `6d93acb7` to entry HEAD was captured in
`/tmp/luxury-yacht-s010-inventory-delta.txt`. This batch adds one production file,
`AppearanceColorControl.tsx`, to the existing settings bucket; no production files
are removed. Bulk changes were applied with temporary Python codemods under
`/tmp/luxury-yacht-s010-*.py`.

### Validation and remaining scope

- Baseline: **28 frontend files / 227 tests**, plus the focused backend settings,
  themes, favorites, import/export/reset and UI-state selection passed. Before
  production edits, six new frontend cases passed with their owners (**71 tests**)
  and three theme persistence-failure cases passed against the original code.
  Logs: `/tmp/luxury-yacht-s010-{frontend,backend}-before.log` and
  `/tmp/luxury-yacht-s010-characterization-{frontend,backend}.log`.
- Incremental mutation, import/export and appearance checks passed. Expanded
  frontend consumers passed **28 files / 233 tests**; focused backend regression
  selection passed. Logs: `/tmp/luxury-yacht-s010-{preferences,data-management,
  appearance,expanded,backend}.log`.
- Full frontend coverage passed **513 files / 4,817 tests**, **87.97%** statements.
  Changed owners: appPreferences **95.38%**, AppearanceColorControl **93.10%**,
  DataManagementSection **93.18%**. AppearanceSection remains **55.61%** (223/401);
  the larger saved-theme workflow is a coverage gap, not a claim of full UI
  verification. This batch preserves behavior; unrelated theme tests were not
  added just to raise the file percentage. Report:
  `/tmp/luxury-yacht-s010-frontend-coverage/coverage-summary.json`.
- Full backend coverage passed, **78.6%** aggregate. Changed theme functions:
  updateThemeLibrary **92.3%**, SaveTheme **94.7%**, DeleteTheme and ReorderThemes
  **100%**. The initial single-delete coverage was **75%**; after the added
  missing/blank-key regression, focused theme/GridTable coverage measured
  **100%** for that function. Logs/profiles:
  `/tmp/luxury-yacht-s010-backend-coverage.log`,
  `build/coverage/backend.coverage.out`, and
  `/tmp/luxury-yacht-s010-targeted-backend.coverage.out`. No tests were deleted.
- Typecheck and targeted Biome passed after correcting test helper arguments,
  a computed-property inference issue, and an empty deferred-test initializer.
  Local complexity covers **37 changed/new TypeScript functions** with no
  findings above 12, and **five Go declarations including their closures** with
  scores 1–12. Evidence: `/tmp/luxury-yacht-s010-{typecheck,format}.log`,
  `/tmp/luxury-yacht-s010-complexity-audit.json` and
  `/tmp/luxury-yacht-s010-go-complexity-audit.json`.
- Published PR #355 at `472fd284f314881497c1987a217a685a1244f52a` has **zero
  open/confirmed new-code Sonar findings**. This is entry-HEAD evidence; it does
  not analyze these local edits. No push was requested. Evidence:
  `/tmp/luxury-yacht-s010-pr-head.json`, `/tmp/luxury-yacht-s010-sonar.log`.
- Native Wails interaction was not run for this behavior-preserving batch.
  Automated editor tests establish callback and cancellation contracts, not
  native-window visual behavior.

Next rotation domain: **S011 errors and diagnostics** — classification, reporting,
logging/telemetry and request diagnostics. Preferences descriptors and Favorites
migration remain explicitly unreviewed responsibilities for a later rotation;
this batch does not close every preferences-related file.

Final `mise exec -- wails3 task qc:prerelease` passed (exit 0): docs, formatting,
generated bindings, vet/staticcheck, full backend race suite, frontend lint and
typecheck, **4,817 frontend tests**, Knip and Trivy. Log:
`/tmp/luxury-yacht-s010-prerelease.log`. SHA-256 comparison of **3,244 files** found
**no gate modifications**; `git diff --check` passed. Manifest:
`/tmp/luxury-yacht-s010-after-gate.json`. The batch covers **six production files,
five test files and this ledger**, with **195 fewer production lines** including
the extracted color control. Only this ledger changed after the gate; its final
update is checked with `qc:docs` and `git diff --check`.

## S011 — errors and diagnostics

**Status: batch implementation, coverage and final prerelease gate passed.**
Entry `ae9249cb`, clean worktree.
Inventory delta: `/tmp/luxury-yacht-s011-inventory-delta.txt`.

| Responsibility | Candidate disposition |
| --- | --- |
| Frontend error presentation | Consolidate category severity, retryability, message and recovery suggestions into one policy table. Keep classification precedence and distinct global/inline/operational reporting decisions. Return fresh suggestion arrays. |
| Frontend telemetry context | Share breadcrumb field sets by category family, alias allocation and navigation-tag projection. Preserve independent cluster/namespace numbering, clearing absent isolation tags versus omitting absent per-error tags, closed field sets and correlation order. |
| Backend reporter session | Give hub replacement one lock-held owner for clearing breadcrumbs and aliases. Derive alias numbering from the owning map. Preserve opt-out close without flush, shutdown flush, enable idempotence and capture locking. |
| Selection diagnostic snapshots | Project counters directly into the snapshot while locked; calculate each phase's positive-value percentiles with one collection/sort helper after release. Preserve sample order, retention and percentile formula. |
| Redaction, expected failures, notification timers, stderr capture | Retain the distinct privacy transforms and policy boundaries. Notification subscription and animation timers have different cleanup lifetimes. Stderr capture remains local and bounded. |

Read in full: frontend `utils/errorHandler.ts`, telemetry `sentry.ts` and
`expectedErrors.ts`, read-diagnostics store, ErrorContext, ErrorBoundary,
ErrorSurface, ErrorNotificationSystem, appLogsClient; backend Logger,
ErrorReportingService and installation telemetry, errorcapture package,
app-log report_error adapter, API/exec/selection diagnostics; internal Sentry
reporter and privacy boundary. Read ViewState/Namespace telemetry producers,
selection mutation producer, desktop/client forwarding and diagnostics-panel
polling/summary consumers. The full diagnostics panel/row model, credential
classifier internals, operation schema, and native diagnostic dumps are not
closed by this batch.

Ordering: UI classification → describe → report → history/listeners → custom
handler remains intact. Navigation aliases project into scope and breadcrumbs;
request/action correlation and final redaction remain separate. Go reporter
state changes stay under its existing mutex, transport close/flush outside it.
Selection counters and samples are captured under the same lock, with percentile
work after release. Public APIs, diagnostic DTOs, provider order, readiness and
cluster identity do not change; new helpers stay inside their owning modules,
so no import cycles are introduced. Characterize category defaults, alias/tag
lifetimes, breadcrumb family allowlists, reporter re-enable and exact phase
percentiles before production edits. Use incremental focused checks, then one
coverage and prerelease boundary for the batch.

### Validation and remaining scope

- Baseline: **16 frontend files / 191 tests** and the Go reporter, errorcapture,
  applog and backend package selection passed. Before production edits, all
  **19 new frontend cases** passed with their owners (**2 files / 121 tests**),
  and the two new backend characterization tests passed. Logs:
  `/tmp/luxury-yacht-s011-{frontend,backend}-before.log` and
  `/tmp/luxury-yacht-s011-characterization-{frontend,backend}.log`.
- Incremental error policy checks passed **8 files / 76 tests**; telemetry and
  adjacent consumer checks passed **6 files / 128 tests**. Go reporter and
  selection diagnostics checks passed. Logs:
  `/tmp/luxury-yacht-s011-error-policy.log`,
  `/tmp/luxury-yacht-s011-telemetry-context.log` and
  `/tmp/luxury-yacht-s011-backend-refactor.log`.
- Full frontend coverage passed **513 files / 4,836 tests**, **87.98%** statements.
  Changed owners: errorHandler **95.23%** and telemetry/sentry **96.69%**. Report:
  `/tmp/luxury-yacht-s011-frontend-coverage/coverage-summary.json`; log:
  `/tmp/luxury-yacht-s011-frontend-coverage.log`.
- Full backend coverage passed, **78.6%** aggregate. Changed functions:
  GetSelectionDiagnostics **95.5%**, selectionPhasePercentiles **100%**,
  replaceHubLocked **100%**, SetEnabled **88.2%**, Shutdown **87.5%** and
  aliasForCluster **100%**. No tests were deleted. Evidence:
  `/tmp/luxury-yacht-s011-backend-coverage.log`,
  `/tmp/luxury-yacht-s011-backend-function-coverage.txt` and
  `/tmp/luxury-yacht-s011-backend.coverage.out`.
- Targeted Biome and typecheck passed. Local complexity checked **12 changed/new
  TypeScript functions** with no findings above 12, and **six Go declarations
  including their closures**, scores **0–6**. The unchanged error classifier
  retains its existing Biome score of **16**; explicit ordered predicates keep
  permission/auth precedence, timeout/network exclusion and gateway/server
  handling visible. This pass does not claim closure of that finding. Logs:
  `/tmp/luxury-yacht-s011-{format,typecheck}.log`,
  `/tmp/luxury-yacht-s011-complexity-audit.json` and
  `/tmp/luxury-yacht-s011-go-complexity-audit.json`.
- Published PR #355 at `ae9249cb1db48ff0e2206455822c126774bf5afe` has **zero
  open/confirmed new-code Sonar findings**. This is entry-HEAD evidence, not
  analysis of these local edits; no push was requested. Evidence:
  `/tmp/luxury-yacht-s011-pr-head.json`, `/tmp/luxury-yacht-s011-sonar.log`.
- Native Wails interaction and live Sentry transport were not exercised. The
  automated checks cover diagnostic data, privacy, consent and capture contracts,
  not native window behavior or production delivery to Sentry.

Next rotation domain: **S012 native lifecycle and windows**, including the
panel-window producer/consumer follow-through carried from S005 and S009. Full
diagnostics-panel/row-model review, credential classifier internals, operation
schema, native diagnostic dumps and refresh telemetry recording remain open for
subsequent domain visits. No production files were added or removed in S011;
bulk edits used temporary Python codemods under `/tmp/luxury-yacht-s011-*.py`.


Final `mise exec -- wails3 task qc:prerelease` passed (exit 0): docs, formatting,
generated bindings, vet/staticcheck, full backend race suite, frontend lint and
typecheck, **4,836 frontend tests**, Knip and Trivy. Log:
`/tmp/luxury-yacht-s011-prerelease.log`. SHA-256 comparison of **3,244 files** found
**no gate modifications**; manifest: `/tmp/luxury-yacht-s011-after-gate.json`.
The batch covers **four production files, four test files and this ledger**, with
**120 fewer production lines** (`git diff --numstat` against entry HEAD). Only
this ledger changed after the gate; its final update is checked with `qc:docs`
and `git diff --check`.


## Completion continuation — remaining review and implementation

The user requested completion of the remaining work. Entry `77d07a6f`, clean
worktree (`git status --short`, `git log -3 --oneline`). Continue through open
S011 responsibilities, S012–S014 and the earlier explicitly unreviewed units;
do not treat another small delivery batch as completion of this request.

### S011 diagnostics follow-through

Read the full diagnostics panel, diagnostic row model and cluster-data row
model, credential classifier, Sentry operation schema, native dump handlers,
refresh telemetry recorder and aggregate. Keep credential predicate precedence,
known-versus-fallback classification, bounded opt-in native dumps, recorder
locking/retention and distinct socket/domain/scope/target counters. The full
panel uses scoped-store hooks whose cached array identities drive subscriptions;
the whole-store object is mutable, so it cannot replace those hooks unchanged.

Implemented so far:

- One diagnostics polling owner applies settled results with shared retained-data,
  failure-report and recovery handling. The three reads still start together and
  settle before publication; closing invalidates the cycle before any update.
  Its panel consumer retains separate telemetry/selection/API summary policies.
- Recorder batch projection now takes the existing SnapshotRecord directly,
  removing its private duplicate representation. The snapshot service still
  stamps cluster identity before recording; summaries keep existing copies and
  scope keys.
- Capability-batch telemetry creation and final sanitization use one serializer.
  The boundary still parses only supported map/check/count types and revalidates
  all structural strings, without retaining private request fields.

Baseline passed: 5 frontend files / 64 tests and recorder, Sentry and credential
packages (`/tmp/luxury-yacht-remaining-{diagnostics,reporting}-before.log`). Two
new panel cases passed on the original implementation (3 files / 44 tests):
retained data with independent source recovery, and late failure after close.
The same selection passed after extraction; recorder/Sentry tests also passed
(`/tmp/luxury-yacht-remaining-diagnostics-{characterization,polling}.log`,
`/tmp/luxury-yacht-remaining-reporting-after.log`). No changed diagnostics
TypeScript function exceeds local complexity 12
(`/tmp/luxury-yacht-remaining-biome-complexity.json`). Completion-continuation coverage and final gate evidence are recorded below.

### S012 — native lifecycle and panel ownership

Inspected the complete native registry, application/panel roles, workspace and
cluster/panel transfer paths, publication/close/quit protocols, desktop bridge,
bootstrap and application lifecycle. Followed these through every frontend
panel-window coordinator, root app composition, and all dockable TypeScript
production owners (store, tab groups, provider, controls, layout, drag, resize,
maximize and bounds). CSS remains companion review in S014.

Consolidated authorization/close/failed-close cleanup and lock-held transfer
removal; platform window defaults now have one owner with role-specific options
left in the callers. Dockable state shares tab removal/active repair and geometry
handoff. Removed the registered-but-never-invoked close callback map and its
registration plumbing after tracing all references. Existing close/guard paths
retain their controlled-sync suppression. Native docking/publication now use the
existing complete tab serializer, and position controls share action descriptors.

Retained reservation rechecks, distinct provisional/committed ownership,
publication acknowledgements, cancellation outside locks, per-cluster activity,
native sender validation, quit preflight, and resize/maximize timing. The local
object-panel snapshot spread preserves extension fields and was not replaced.
Combining pending-float structures was rejected because stale rejection handling
could change; no lifecycle redesign is part of this refactor.

Two characterization cases passed before editing: duplicate tab membership with
active repair, and geometry handoff preserving destination ownership and copied
sizes (51 tests). Native appwindow/panelwindow/bootstrap packages passed before
and after. Frontend dockable and panel-window selections passed 24 files / 296
tests after the batch; a subsequent control-flow edit receives another focused
check. Logs: `/tmp/luxury-yacht-remaining-native-{before,after}.log`,
`/tmp/luxury-yacht-remaining-dockable-{characterization,after2}.log`.
Native window interaction has not been exercised; these are source and automated
contract checks, not a native runtime validation claim.

### S013 — updates and engineering tooling

Read the update coordinator/scheduler and backend command/config/provider wiring,
updateidentity, updatestate, updatetemp, updateconformance and Windows installation
packages; project task implementation, frontend lint/Sonar/error-boundary scripts,
Biome plugins, Storybook setup, bindings/refresh generators, Linux portable and
AppImage tooling, NSIS source, and shared CI actions. Platform task definitions
and release/drill workflows were subsequently read in the companion follow-through.

Consolidated snapshot equality and progress copying without changing value versus
pointer semantics; shared skip-persistence failure completion and staging-path
cleanup; retained the explicit Wails DTO while using a type conversion instead
of its repeated field projection. Release preparation now names input validation
and artifact staging, and asset admission has one predicate. Signature/path/link
validation, cleanup ownership, overwrite/exclusive-copy distinctions, separate
Download/Restart consent, publication order and reset quiescence remain explicit.
Generator optionality and canonical-reference rules were retained after tracing
their differing policies. No release, installation or remote mutation was run.

New characterization cases passed before production edits: progress value
deduplication and detached publication; failed staging cleanup survives Reset and
is retryable. Focused package checks passed before and after, including project
release tooling. Evidence: `/tmp/luxury-yacht-remaining-updates-before.log`,
`/tmp/luxury-yacht-remaining-update-characterization.log`,
`/tmp/luxury-yacht-remaining-updates-after.log`, and
`/tmp/luxury-yacht-remaining-tooling-after.log`.

### S014 — shared primitives

Read shared utility/identity/relationship/quantity helpers, stable selection,
age clock, metrics banner and sorting hooks; application log adapters, parallel
worker and Kubernetes retry primitives. Scoped logging now has one forwarding
owner, with cluster and operation constructors supplying only their metadata
slots. Explicit values, extra arguments, original caller slices, structured
errors/panics and scope composition are retained. Node/table overcommit wrappers
now use the existing shared calculation policy after their original parsers.

Characterizations passed on the original implementation for caller metadata
preservation and invalid/nonpositive capacity. After refactoring, the primitives,
dockable and panel-window frontend selection passed **36 files / 416 tests**;
Go applog/logclassify/parallel/k8sretry passed. Evidence:
`/tmp/luxury-yacht-remaining-{scoped,resource}-characterization.log`,
`/tmp/luxury-yacht-remaining-primitives-{go,ts}-after.log`.

### S004 deeper lifecycle follow-through

Read the full ingest manager, dynamic reflector, partition and resume paths;
governor policy/executor/cooling/preparation; full resource-stream protocol and
its message routing/effect consumers. Shared partition construction and existing
leaf-lock store lookup replace repeated typed/dynamic/sink setup. Cooling now
has one final catalog-stop/heap-reclaim/log sequence, with store installation
and partial-failure ownership explicit. Modern and legacy stream messages use
one canonical projection, and preserved-health handling is shared between
resync and acknowledgement phases.

Retain readiness versus settlement, on-demand reflector exclusion, per-partition
resume versions, planned versus applied governor tiers, generation-local Cold
preparation, cancellation outside locks, signal-clock validation, strict modern
routing, acknowledgement health and ordered protocol effects. Baseline lifecycle
checks passed (`/tmp/luxury-yacht-remaining-refresh-lifecycle-before.log`);
post-edit checks and orchestrator follow-through passed as recorded below.

### S008 mutation and S009/S005 interaction follow-through

Read the complete YAML mutation, reload/merge, ownership, resolver and field-policy
owners, response-cache invalidation and permission revalidation. Normalize/diff
and merge preparation now share the existing sanitization policy; merge alone
also strips resourceVersion. Removed the private resolver compatibility wrapper
and its ignored selection-key plumbing. Cluster-scoped dependencies and the
apply cache-invalidation key remain. Collision tests call the canonical resolver
with the same fallback policy. Focused YAML/ownership/reload/identity checks
passed before and after (`/tmp/luxury-yacht-remaining-yaml-{before,after}.log`).

Read the full action controller, ObjectDiff modal selection/matching/rendering,
Rollback modal and shared diff utilities. Confirmation handlers now use the
existing action executor for error handling and final cleanup; delete preserves
close-before-refresh callback order, and editable scale retains its retry/error
state. Both object-diff sides share cascading selection resets; stale-match
cancellation, selected-object retention and refresh effect order remain.
Rollback/ObjectDiff share budget-warning selection, with their existing budget
precedence. The timeline separates run positioning and tick construction and
uses first-fit row lookup without its extra placed flag. The overlap/row-reuse
characterization passed before production edits. Logs:
`/tmp/luxury-yacht-remaining-{diff-before,diff-after,final-followthrough,actions-before,actions-after,diff-selection-after,timeline-characterization}.log`.

### S010/S012/S013 companion follow-through

Completed the previously listed reads of preferences schema normalization and
migration, Favorites migration/pane/filter normalization, native geometry and
application menu routing. Retain cache publication after atomic save,
first-default-theme precedence, supported-schema migration, per-window geometry,
role-authenticated menu routing and separate process/window commands. Settings
repositories and descriptors already own their shared policies. No external
editor launch implementation was found by the repository-wide editor search;
the earlier shorthand referred to settings editing, not a separate launcher.

Read the remaining platform task definitions, release-workflow sections,
Windows package drill and refresh-contract registration table. Platform-specific
build flags, signed-versus-development bundle paths, installer scope checks,
release preparation/publication ordering and generator optionality are retained.
This is source review; release, installation and native-dialog drills were not run.

### S014 scrolling and tab follow-through

Read all scrollbar activity, virtual scrollbar and token owners; shared tab base,
drag provider/source/target and their contracts; CodeMirror search/theme/native
adapters and SearchInput. Keep virtual versus DOM geometry/clamping distinct,
hover/drag retention, ancestor clipping and native wheel routing. Consolidated
DOM overlay construction, rectangle projection and overflow admission; removed
a branch that returned the same boolean disjunction in both orders. Scrollbar
focused checks passed before/after (`/tmp/luxury-yacht-remaining-scrollbars-{before,after}.log`).

The drag provider's target map was only written/deleted; DOM drop listeners own
all dispatch. Whole-repository reference inspection found no reader of that map.
Removed the map, registration interface, target IDs and hook registration
plumbing while retaining native listeners, MIME admission, current-drag refs,
listener cleanup and tear-off handling. Tab/cluster/dockable focused checks are
recorded in `/tmp/luxury-yacht-remaining-tabs-{before,after}.log`.

The full refresh follow-through now passed: ingest/system/backend lifecycle
checks and 44 frontend files / 615 tests, including orchestrator stop and blocked
stream paths. Evidence: `/tmp/luxury-yacht-remaining-refresh-lifecycle-after.log`
and `/tmp/luxury-yacht-remaining-orchestrator-after.log`. Coverage and final-gate results are tracked in the validation record below.


### S002/S005 — resource and overview follow-through

Inspected the per-kind detail services and their facts/model/identity consumers,
including Pod/Node/workload enrichment, Gateway API, policy, storage, configuration,
RBAC, custom resources and operators. Reused `crdfacts` scalar readers in Argo CD
and Karpenter; retained Argo's no-copy generic decoder and Karpenter's differing
quantity formatting. Quota and LimitRange detail maps now share
`resourcemodel.QuantityMapStrings`, including their nil/empty and canonical
quantity-string policy. Existing per-kind nil-client, error/warning, UID/owner,
copy-versus-alias and PVC fallback policies remain explicit.

Finished the Overview descriptor/widget reads: workload/job, pod/node, policy,
storage, RBAC, config/secret/event, network, operator/Argo/Karpenter and the five
operator section owners, alongside the previously reviewed Gateway/Helm/shared
renderers. Deployment/StatefulSet/ReplicaSet replica-state and up-to-date displays
share projections; rollout status/message share the completion predicate. Kept
per-kind sections, optional fields, tooltip text, resource links and status
precedence instead of introducing a generic detail framework.

Operator checks passed before/after across Argo CD, Karpenter, cert-manager,
External Secrets and Prometheus; workload/renderer/drift checks passed 3 files /
54 tests. Quantity packages passed before/after. Logs:
`/tmp/luxury-yacht-remaining-operators-{before,after}.log`,
`/tmp/luxury-yacht-remaining-workload-{before,after}.log`,
`/tmp/luxury-yacht-remaining-quantity-{before,after}.log`.

### S002 — Browse page-state follow-through

Read the full Browse catalog hook, query-plan/page projection, scope utilities,
custom-row adapter, page/export hydration and cluster/namespace custom consumers;
followed the catalog snapshot producer and its existing typed query boundary.
Browse remains Query Backed Static: backend scopes own global filtering, sorting,
counts, facets and cursor windows; the frontend retains the current row window.

Whole-repository reference inspection found that the persisted UID-to-position
map was rebuilt and forwarded but never read. Removed that map, its rebuilding
helper, duplicate collection/result representation, empty-collection factory and
ignored prior-collection page argument. The hook now retains only the row array;
deduplication retains its operation-local index. Baseline structural sharing,
last-duplicate replacement at the first position, missing-UID rows, page/export
order, cursor invalidation, structural-scope reset and stale-request cleanup stay
at their existing boundaries. No import dependency or provider order changed.

Existing Browse/custom consumer checks passed before (13 files / 149 tests).
A duplicate/missing-UID/order/nonmutation characterization passed on the original
implementation. Afterward the same consumer selection passed 13 files / 150
tests with coverage. Existing pagination assertions remain; one projection test
no longer constructs the prior collection its callee never consumed. No tests
were deleted. Evidence: `/tmp/luxury-yacht-remaining-browse-{before,
characterization,after}.log` and
`/tmp/luxury-yacht-remaining-browse-coverage/coverage-summary.json`.

### Quiet-owner and retained-candidate dispositions

- Read cluster/global/namespace view and column owners with their refresh and
  catalog producers. Keep query-backed static versus dynamic membership, current
  namespace readiness, per-cluster joins, exact/approximate count presentation,
  per-view links/defaults and the established column factories. No second grid
  framework or speculative generic per-kind service is warranted by these reads.
- Read the complete cluster attention/overview, namespace workloads, Helm/custom
  and event builders, typed domain wrappers and namespace/object-event notifiers.
  Retain independent grace/readiness clocks, generation-stamped deadlines,
  source-error policy, serve-time metric joins, grouped Helm revision selection,
  custom-resource partial-result differences and notifier drain/stop ownership.
  Similar-looking namespace/cluster custom accumulators have different error,
  version and result policies, so merging them would obscure the contract.
- Read quiet event/context/status/hooks and primitive owners: event bus/Wails
  adapters, zoom/appearance/sidebar/modal contexts, app-state access and explicit
  binding facades, global-view ownership, resource loading/status controls,
  icon discovery and type vocabularies. Keep subscription ordering, once-listener
  exception behavior, per-window zoom, focus ownership and generated-boundary
  export lists. Their wrappers carry contracts, not duplicate policy.
- Reviewed the style cascade entry, base/reset/layout, focus/motion utilities and
  scrollbar tokens with the corresponding owners. Retain cascade/specificity,
  zoom geometry, reduced-motion and native focus treatment. No CSS or icon asset
  edits or rendered appearance claims are part of this batch.
- Read the quiet backend adapters/configuration, app-state roots and cleanup,
  kind/stream/model declaration leaves with their producers. Keep complete object
  identity at boundaries and cluster-local cache ownership. Declarative per-kind
  records and generated DTOs are not candidates merely because they repeat fields.

The 236 baseline buckets now point to their inspected responsibilities rather
than stale `Inventoried` labels. This is responsibility-level review coverage;
it does not claim every source line or runtime/visual state was examined. The
updated source inventory contains 1,845 implementation files / 297,236 physical
lines, 111 generated files and 1,115 validation files in the same 236 buckets.
Inventory: `/tmp/luxury-yacht-remaining-inventory.json`; baseline-to-worktree delta:
`/tmp/luxury-yacht-remaining-inventory-delta.txt`. The new polling hook belongs to
the existing refresh bucket. Earlier pass records remain historical evidence;
the rotation table and this continuation supersede their next-domain pointers.

### Completion-continuation validation

- Full backend coverage task passed. Changed Go production functions cover
  **693/787 statements (88.06%)** in the ordinary profile. A consumer-instrumented
  quota/LimitRange run covers the shared quantity helper **6/6**, giving
  **699/787 (88.82%)** across affected functions. Duplicate package coverage blocks
  were merged by source location. The ordinary profile cannot count calls made
  into an uninstrumented dependency. Evidence:
  `/tmp/luxury-yacht-remaining-backend-coverage.log`,
  `/tmp/luxury-yacht-remaining-quantity-coverage.log`,
  `/tmp/luxury-yacht-remaining-go-coverage.json`.
- Full frontend coverage passed **513 files / 4,845 tests**, **88.10% statement
  coverage** before the final Browse refactor; its subsequent affected coverage
  selection passed 150 tests, including the added characterization. Browse data
  projection is **100%**, catalog hook **93.92%**, utilities **92.85%**. The complete
  report is outside the tree so generated HTML/JS does not enter lint:
  `/tmp/luxury-yacht-remaining-frontend-coverage/coverage-summary.json`.
- The first full frontend coverage attempt timed out at the first YAML-tab test
  (5 seconds), followed by 31 failures in that file. The isolated unchanged test
  file passed all 34 tests; rerunning the full coverage task after backend coverage
  finished passed all 4,845. No timeout, worker, assertion or production behavior
  was changed to obtain the pass. Logs preserve both attempts:
  `/tmp/luxury-yacht-remaining-frontend-coverage{,2}.log` and
  `/tmp/luxury-yacht-remaining-yamltab-investigation.log`.
- Directly touched frontend file coverage is above 80% except `RollbackModal.tsx`
  (**78.12%**). Remaining Go function gaps include scoped structured-operation
  forwarding, skip/error paths, YAML reload/merge, mmap cooling, controller
  namespace lookup, updater preparation, native transfer commit and state-file
  removal. These are measured gaps in this behavior-preserving batch, not claims
  of complete error-path/native coverage. No presentation-only tests were added
  to inflate coverage and no tests were pruned. Detailed file/function reports:
  `/tmp/luxury-yacht-remaining-{ts,go}-coverage.json`.
- Typecheck passed. Local complexity covers **76 changed Go functions** (maximum
  **12**) and **115 changed/new TypeScript functions** (none above **12**). Four
  unchanged TypeScript functions retain pre-existing findings. No thresholds,
  suppressions or Sonar baseline changes. Evidence:
  `/tmp/luxury-yacht-remaining-go-complexity-audit.json`,
  `/tmp/luxury-yacht-remaining-complexity-audit.json`,
  `/tmp/luxury-yacht-remaining-local-checks7.log`.
- Read-only PR #355 Sonar audit at published head `77d07a6fb89e05c82d0b96f61155dba5781177f1`
  reports three S6551 findings in the prior telemetry
  pass, keys `AaCyYfpMyY0DVTevpCYD`, `AaCyYfpMyY0DVTevpCYE` and
  `AaCyYfpMyY0DVTevpCYF`. The local producer now retains its inferred string fields
  and the consumer derives its parameter from that producer, removing the
  `Record<string, unknown>` type erasure without changing runtime coercion. All
  81 telemetry tests passed before/after. Remote findings remain open until a
  published revision is analyzed; no push was requested. Audit and tests:
  `/tmp/luxury-yacht-remaining-sonar-online.log`,
  `/tmp/luxury-yacht-remaining-sonar-{before,after}.log`.
- Native window interaction, live Kubernetes transport, installation and release
  drills were not run. Automated refactor checks do not substitute for those
  runtime checks.

All fourteen scheduled domains have a recorded disposition and the confirmed
behavior-preserving candidates in this continuation are implemented. S001-C2
remains a separately scoped behavior defect: the dirty-width notifier aliases
its stored snapshot. Re-entry requires a failing workflow regression followed by
a behavior fix; it was not silently folded into this refactor. Do not interpret
this review cycle as a claim that the repository has no further simplification
opportunities or that deferred behavior/runtime work is complete.


Final `mise exec -- wails3 task qc:prerelease` **passed (exit 0)**: docs,
formatting, generated bindings, vet/staticcheck, full backend race suite,
frontend lint and typecheck, **513 frontend files / 4,846 tests**, Knip and
Trivy (zero high/critical dependency findings). Log:
`/tmp/luxury-yacht-remaining-prerelease.log`.

The before/after SHA-256 comparison inspected **3,245 files**. Only this ledger
changed during the gate, through the review-record update; no production,
test or generated file changed. Manifest:
`/tmp/luxury-yacht-remaining-after-gate.json`. `git diff --check` passed.
The continuation changes **55 production files, 13 test files and this ledger**,
with **630 fewer production lines**, including the new polling hook. These are
entry-HEAD diff counts, not a measure of how much code was reviewed. No commit,
push or PR mutation was made. Only the ledger was updated after the gate; its
final update passed `qc:docs` and `git diff --check`
(`/tmp/luxury-yacht-remaining-docs.log`).

## D001/D002 — review restarted from source, September 18

The reopened inventory begins at `616adb20`. The file manifest records full
inspection of 98 frontend table/resource-grid/selection/Favorites/AppLogs files
and all 25 production files in `backend/objectcatalog`: 123 of 1,845 authored
implementation paths. The other 1,722 paths remain pending in this restarted
review, including files with earlier historical dispositions. External consumer
reads and passing suites do not count as full file review.

Implemented work:

- Shared table width projection, resize flushing and column reorder policy;
  moved synchronization bookkeeping to its owning hooks; removed the unused
  resize input, width callback and definition-only width resolver. Preserved
  filter hydration and save-debounce effect dependencies.
- Consolidated multiselect normalization with explicit comparison policy,
  Favorites draft construction/footer rendering, and resource-grid Favorites
  integration. Removed pagination/filter forwarding copies and a single-use
  query filter wrapper.
- Corrected two contracts discovered on those paths: published width snapshots
  shared the mutable measurement cache, and cluster selections folded distinct
  IDs by case. Existing/new workflow tests failed before each correction. Exact
  cluster comparison now covers table options, persistence, Favorites and
  Application Logs, including pruning after new log entries.
- Removed catalog `summaryChunk` publication scaffolding and the production
  wrapper used only by query fixtures. Row publication and pre-publication
  snapshot fallback share query-store construction. Fixture migration used a
  Go AST codemod; query assertions were retained.
- Unified single/batched catalog permission-result policy and unstructured port
  eligibility. Existing namespace fan-out tests now also check the single-check
  fallback; protocol characterization covers Pod, Service and workload paths.

Rejected consolidations and retained complexity are recorded per candidate in
the manifest. In particular, body-column rendering and width measurement use
non-equivalent comparisons for invalid bounds; that proposed consolidation was
reverted. Catalog cold incremental publication, warm replacement, source
readiness/fallback paths, namespace facets, and ingest/watch contention recovery
retain their distinct contracts.

### Validation record for this worktree

Logs are temporary local artifacts under `/tmp/luxury-yacht-deep-*`:

- Width mutation regression: `width-red.log` then `width-green.log`.
- Case-distinct cluster IDs: `cluster-red.log`/`cluster-green.log`,
  `favorite-red.log`/`selection-after.log`, and
  `applogs-red.log`/`applogs-green2.log` (25 tests in the latter).
- Frontend coverage task: `frontend-coverage-final.log`, 513 files / 4,852 tests,
  88.16% statements (37,177/42,166). Changed behavior paths exceed 80%; the
  lowest changed frontend file before the column-window rollback was filter
  wiring at 80.82%. After rollback, the focused three-file window suite passed
  10 tests (`window-retained.log`); its subset coverage is not full-suite
  coverage of the restored layout function.
- Width helper assertion pruning: 41/42 statements before, 35/35 after;
  surviving helper tests pass (`width-coverage-before.log`,
  `width-coverage-after.log`). Removed assertions belonged to a resolver with
  no production references in the captured repository search.
- Catalog characterization passed before edits (`catalog-before.log`). Full
  catalog tests passed after publication refactoring
  (`catalog-publication-escalated.log`). The first default-sandbox attempt was
  blocked by the localhost `httptest` listener, not an assertion failure.
  Permission and action-fact focused checks passed
  (`catalog-permissions.log`, `catalog-action-facts.log`).
- Local complexity: 75 changed/new TypeScript functions have no Biome findings
  above 12 (`complexity-audit.log`); seven unchanged function findings remain.
  The 11 changed/new Go functions score 1–9 with gocognit v1.2.1
  (`catalog-complexity.json`). These are local signals, not Sonar closure.
- The read-only PR #355 Sonar audit reports zero open/confirmed new-code issues
  (`sonar-escalated.log`). It analyzes the published revision, not these
  uncommitted changes.
- Backend coverage task passed (`backend-coverage.log`): 78.23% statements
  repository-wide (33,791/43,194). The catalog publication/query construction
  functions and permission-result policy have 100% statement coverage;
  batched permission evaluation has 94.1%. `action_facts.go` has 69.41%, with
  unchanged HPA helpers contributing to the gap; the changed port helpers have
  90.9% and 100%. These catalog changes preserve behavior.
- The full `qc:prerelease` gate passed (exit 0, `prerelease.log`): docs,
  formatting, bindings, vet/staticcheck, backend race tests, frontend lint,
  typecheck and 4,852 tests, Knip, and Trivy. This validates the D001/D002
  worktree; it does not close the pending repository review.

Native Wails observations: Nodes displayed a loading state and then three
rows. A temporary unmatched text filter displayed zero rows; clearing it
restored the rows. The Favorites draft displayed the current table settings,
and keyboard column reordering moved Version before Name. Cancel closed the
unsaved draft and the live table retained its order. A pointer-drag attempt did
not visibly reorder and is not counted as passing. The standalone browser URL
served Vite but lacked `/wails/runtime`; it is not native interaction evidence.
Case-distinct cluster selection and the width mutation are covered by automated
workflow regressions; those exact states were not available in the connected
native cluster.

Native Browse also displayed its loading state, then 678 objects with rows
1–250 on page 1/3. Next displayed rows 251–500 on page 2/3, and Previous returned
to rows 1–250. Navigation was restored to Overview before stopping the owned
development process and running the prerelease gate. No resource or Favorites
mutation was saved during these interaction checks.

## Reopened deep review: D003 and D004

The manifest now records 237 fully inspected implementation paths and 1,608
pending paths. This is an in-progress repository review, not a completion claim.
File hashes, consumer paths, retained alternatives and candidate decisions are
in `code-simplification-review.json`. Passing tests do not count as inspection
of the remaining source.

### D003: cluster, auth and workspace ownership

Inspected 63 implementation files covering runtime clients, lifecycle,
heartbeats, auth recovery, selection/close/transfer, kubeconfig discovery,
exec-provider diagnostics and frontend workspace/context ownership.

- Centralized the snapshot of cluster clients under the map lock. Auth state
  checks, heartbeat work, recovery shutdown and rate-limit updates now operate
  on that snapshot after releasing the map lock. The new concurrency regression
  first reproduced a healthy-cluster lookup blocked by another cluster's auth
  callback (`auth-lock-red2.log`), then passed (`auth-lock-green.log`).
- Split per-cluster heartbeat work from batch iteration while retaining the
  state publication → event → log → auth report ordering.
- Removed forwarding helpers and repeated selection copies; retained ordered
  selection equality, non-null empty selection results and exact cluster IDs.
- Removed test-only frontend auth transition exports. All twelve existing
  scenarios now exercise the workspace store's production event adapters.
- Retained distinct close/recovery phases, selection versus committed selection,
  authoritative generations and hydration field guards; their ownership and
  ordering differ and are documented per candidate in the manifest.

Focused backend workspace/auth tests passed (`workspace-batch.log`), as did
six frontend suites with 78 tests (`auth-workflows-after.log`). The backend
coverage task passed (`backend-coverage-d003.log`): 78.22% overall statements,
with the changed auth scan at 83.3% and client snapshot at 80.0%. Repository-wide
coverage is not a claim that every backend path reaches the target. The local
Go token/AST comparison and gocognit audit covered 33 changed/new functions,
all at or below 12 (`go-complexity-audit.json`).

The first D003 frontend coverage attempt failed on a 5-second YAML test timeout
(`frontend-coverage-d003.log`). The unchanged 34-test YAML suite passed separately
(`yaml-timeout-check.log`). The cause of the timeout was not established. The
later full D004 coverage run passed that test and all other tests.

### D004: panel identity, permission projection and details

Inspected 51 additional implementation paths, including panel state/lazy
modules, scope construction, tab/refresh/capability hooks, detail derivation,
rendering infrastructure and the shared capability owner. The remaining tabs
and descriptor families are still pending; this does not close object-panel
review.

- Shared invalid-scope projection and removed redundant scope construction,
  constant state, duplicate callbacks and an unused refresh prop.
- Fixed deletion markers crossing cluster-case/group/version identities and
  namespace permission deduplication ignoring cluster changes. Four regressions
  failed before the fix (`panel-identity-red.log`) and passed afterward
  (`panel-core-green.log`).
- Shared descriptor identity validation and projection across YAML, shell,
  debug, logs, generated actions and Helm reads. Explicit core API group survives
  normalization. Five cases prove missing identity blocks checks and subsequent
  complete identity enables them (`panel-permissions-red.log`,
  `panel-permissions-green.log`).
- Named capability results now carry complete descriptor identity and reject
  superseded success/error responses. Six regression cases cover reused action
  IDs and out-of-order replies (`permission-isolation-red.log`,
  `permission-and-data-before.log`). Shared map keys retain exact cluster case;
  the batch/lookup regression preserves opposite grants for case-distinct
  clusters (`permission-store-red2.log`).
- Permission-store reset now invalidates earlier namespace, cluster and lazy-kind
  requests, including their cleanup, and cancels staggered refresh timers. Four
  failing reset regressions passed after the fix (`permission-reset-red2.log`,
  `permission-reset-green.log`). Fresh queries after reset remain permitted.
- Shared text/binary data item rendering, removed repeated entry enumeration and
  isolated secret encoding fallback. Characterization retains empty/Unicode
  fallback values, binary clipboard values, decode toggles and copy feedback.
- Retained descriptor visibility-before-render, ordering, generic fallback,
  finalizer permission distinctions, node discovery cancellation and independent
  refresh leases. The possible cross-object HPA-state issue was rejected for
  the inspected production mount: `AppLayout.tsx` keys the parent boundary by
  the canonical full-identity panel ID. No behavior change was made there.

Validation logs use the `/tmp/luxury-yacht-deep-` prefix. The broader panel and
permission suite passed 97 files / 852 tests (`panel-batch.log`). Typecheck passed
(`typecheck-d004-final.log`). The first full D004 coverage run passed 513 files /
4,870 tests at 88.19% statements (`frontend-coverage-d004.log`); all changed
frontend files exceeded 80%, including panel capabilities at 94.66%, named hooks
at 93.79% and permission store at 89.12%. That run preceded the reset fix. The fresh coverage task passed 513 files /
4,874 tests at 88.25% statements (`frontend-coverage-d004-final.log`). The local
complexity audit reports 142 changed/new TypeScript functions and 33 Go functions
at or below 12; unchanged findings remain explicitly recorded. Native observations are recorded below. The first prerelease attempt passed
backend race tests and then failed on 18 frontend lint errors (required braces
and one JSX guard). Those lint errors were corrected. The fresh full prerelease gate passed
(exit 0, `prerelease-d004-final.log`): docs/format/bindings, vet/staticcheck,
backend race, frontend lint/typecheck and 4,874 tests, Knip and Trivy (zero
reported high/critical vulnerabilities). The post-gate worktree was inspected. Earlier D001/D002 native
observations do not prove the D004 panel changes.

D004 native observations (2026-09-18): the Wails app showed Nodes loading and
then three rows. Opening a Node displayed its populated Details and utilization
sections; YAML showed a loading state and then content with an Edit control;
Events displayed the object's event row. A ConfigMap opened in a second panel
with its metadata and data value. The rendered data card was inspected in a
native screenshot. Both verification panels were closed together and the
cluster Overview was restored. No object mutation was performed. Case-distinct
clusters, invalid refs, permission reset races and deletion-state changes were
validated by automated regressions, not reproduced against this live cluster.

The directly registered Playwright server reached the emitted Vite URL but
reported `/wails/runtime` 404 and unavailable backend calls. Its browser preview
is not counted as native evidence; the interaction observations above came
from native accessibility and screenshot tools. The browser evidence is in
`.playwright-mcp/console-2026-09-18T16-32-25-946Z.log` (temporary, ignored).

Final diff review retained the original secret conversion assignment semantics
instead of the proposed `Object.fromEntries` shortcut, whose treatment of special
object keys differs. Focused surviving data-section tests pass with 87.5%
statement coverage on the latest file (`data-final.log`, 42/48). The subsequent
frontend lint/error-boundary/suppression checks pass (`frontend-lint-d004-final.log`).

## Reopened deep review: D005 and D006

The manifest records 282 of 1,845 baseline implementation paths inspected, with
1,563 pending, plus the new resource-link hook. These batches cover detail
descriptor families, operator sections, their identity producers and consumers.
They do not close the remaining panel tabs or repository review.

### Changes and retained contracts

- Removed descriptor guards already enforced by hidden-before-render admission;
  shared Pod/workload toleration filtering and Helm reference construction.
  Retained family-specific rollout, metric, pressure, policy and list semantics.
- Centralized related-object identity projection. Built-in version inference now
  requires the matching group, and explicit core group survives normalization.
  IngressClass parameter links carry their actual API group. Eleven failing
  identity regressions passed after correction.
- EndpointSlice and PVC detail DTOs now use the established ResourceLink boundary.
  EndpointSlice projection retains target cluster, GVK, namespace and UID instead
  of flattening to Kind/name. PVC sources preserve source precedence and namespace;
  custom sources without a known version remain display-only. Generated Wails
  bindings were regenerated. Existing PVC status tests remain intact.
- Native inspection exposed an additional case: live EndpointSlice targets omitted
  API version. The new resource-link hook resolves their exact cluster/UID through
  the existing catalog owner. Pending/missing entries remain display-only; stale
  resolutions cannot publish across target or case-distinct cluster changes.
- Shared ArgoCD/Prometheus absent-list projection, CertManager owner tuple mapping,
  ExternalSecrets remote-reference fields and JobTimeline time tick formatting.
  Retained section accessibility/wrappers, capacity/progress semantics and greedy
  timeline placement because those contracts differ.
- The stricter identity boundary rejects incomplete custom-resource references
  before offering actions. Updated regression asserts no action, no modal and
  subsequent admission with complete identity; no fallback identity was added.

### Validation and limits

Logs below have prefix `/tmp/luxury-yacht-deep-`. Identity and wire/UI regressions
failed before fixes and passed afterward: `identity-d005-{red,green}.log`,
`endpoints-d005-{red,green}.log`, `endpoints-ui-d005-{red,green}.log`,
`pvc-d005-{red,green}.log`, `pvc-ui-d005-{red,green}.log`, and
`target-resolution-{red,green}.log`. The final pair covers pending-to-openable
identity and late replies after a target/cluster change.

The backend coverage task passed (`backend-coverage-d005.log`), with 78.8% overall
statements. Changed EndpointSlice projection has 100%, PVC processing 88.5% and
source identity construction 100%. The initial frontend coverage run failed on
the moved custom-resource admission boundary; the corrected regression and both
custom-grid suites passed 46 tests (`custom-grid-d005.log`). The subsequent full
frontend coverage run passed 513 files / 4,887 tests at 88.26% statements
(`frontend-coverage-d005-final.log`). Changed identity files exceeded 80%.
That full run preceded the new UID hook and D006 edits.

The later overview-focused coverage run passed 32 files / 183 tests
(`overview-d006.log`), with the new hook at 94.73% statements. This subset does
not establish whole-suite coverage of operator sections. Two additional
ExternalSecrets mapping tests passed (`operator-mapping-d006.log`), preserving
remote/extract fields and find/generator data. Typecheck passed
(`typecheck-d006-final.log`). Local complexity reports 207 changed/new TypeScript
functions and 36 changed/new Go functions at or below 12
(`complexity-audit-d006.log`, `go-complexity-d005.log`); unchanged findings remain,
and these checks do not establish pushed Sonar closure.

Native Wails observations: kube-system Network loaded four rows. Opening the
metrics-server EndpointSlice displayed two ready addresses; after catalog
resolution both Pod target buttons appeared. A target opened the expected
populated Pod, and its owner link opened the Deployment showing 2/2 ready and
rolling-update configuration. The Node link also opened populated details.
Verification tabs were closed and cluster Overview restored before stopping
the owned development process. No resources were mutated. PVC custom/cross-
namespace cases were exercised by automated fixtures, not live resources.

The first combined D005/D006 prerelease gate passed backend race tests, then
failed on one shadowed-variable lint error in the new hook
(`prerelease-d006.log`). The variable was renamed; subsequent targeted lint
and typecheck passed. Final combined validation is pending with D007.

## Reopened deep review: D007

The manifest now records 316 baseline implementation paths inspected and 1,529
pending, plus two newly authored helpers. This batch reads the entire container
and node log source families, their styles, fallback manager, and three Helm
read-tab files. Shell, YAML transactions, other panel tabs and the remaining
repository inventory still require review.

Implemented simplifications:

- Removed unconsumed selected-container and available-container reducer slots,
  their actions, and the obsolete preference field. Repository-wide production
  references are captured in `log-state-consumers.txt`. Multi-source selection
  remains owned by selectedFilters.
- Replaced the five-reducer chain/registry with one action switch, keeping the
  existing mode-transition helpers and unknown-action behavior.
- Shared source-prefix classification and workload pod-name projection. Kept
  inventory effect timing and palette snapshots. One blocking-state renderer
  now determines loading/paused/error precedence, and RawLogViewer owns the
  existing virtualization defaults.
- Shared log overlap matching between Node incremental fetch and anchored
  container history, preserving each source's identity and newline policy.
  Container sequences remain excluded from content comparison.
- Simplified ANSI extended-color target assignment and removed duplicate color
  range admission. Parameter consumption, resets, dim/inverse behavior remain.
- Removed production acceptance of the bare Node-log response shape supplied
  only by tests. Migrated 25 response fixtures to the actual executed/data
  envelope and typed the mock from the real adapter.
- Removed legacy maximize, placeholder, control, copied-cell animation, tooltip
  and old HTML-table styles after tracing their source consumers. Current
  IconBar/Dropdown, GridTable and raw-log selectors remain.

Retained policies are recorded per candidate. Node/container transports, search
whitespace, CSV metadata reservation, ANSI wrapper markup, stream recovery phases,
parsed snapshot publication, gesture-driven tail-following and layout settling
have distinct contracts. The duplicate-looking fallback update may publish
refresh state while paused; it was retained after inspecting enable/disable.
Log settings restore the current value for invalid numeric input, whereas the
shared integer commit helper persists a default; no unification changed that
policy. Helm defaults, overrides and merged recursion also retain their distinct
key/absence rules.

Validation logs below use `/tmp/luxury-yacht-deep-`. The baseline log suite passed
16 files / 199 tests (`logs-d007-before.log`). After refactoring, the first run
failed one error-reporting assertion because the fixture codemod also wrapped
an expected error-context object; the original assertion was restored. The
next run passed all 199 tests (`logs-d007-final.log`), with 84.89% focused
statements. Removing assertions only for the removed reducer fields leaves
reducer coverage at 67/67 statements versus 89/89 before. LogViewer has 83.01%,
NodeLogsTab 87.22%, filtering 95.06% and the shared overlap helper 82.75%. ANSI
has 75.3% in this subset; this refactor preserves behavior and the existing
foreground/background, indexed/truecolor, reset and dim/inverse tests passed.
This is focused coverage, not coverage of every inspected file.

Typecheck passed (`typecheck-d007-final.log`). Local complexity found no scores
above 12 in 234 changed/new TypeScript functions (`complexity-audit-d007.log`);
unchanged findings remain. An additional temporary comparison tested 132,496
pairs of sequences over a/b/empty-string, lengths 0–5: shared overlap agreed
with descending exact suffix/prefix matching for every pair. That is data-
contract evidence, not a system throughput measurement.

Native Wails checks observed namespace loading and populated workload logs.
An unmatched text filter produced zero matching rows; clearing it restored logs.
A Pod metadata click selected one Pod with 24 matching rows. Operator JSON logs
switched to a populated parsed table and then Pretty JSON; screenshots were
inspected after the stylesheet removal. Closed all verification panels, cleared
the workload selection, collapsed namespace navigation and restored Overview.
Node fetch/append and ANSI cases remain automated-fixture evidence in this batch.
The full frontend coverage task then passed 514 files / 4,891 tests, with
88.3% statements (37,187/42,112; `frontend-coverage-d007.log`). The final
combined prerelease gate remains pending.

## Reopened deep review: D008

The file manifest records 332 baseline files inspected, 1,513 pending, and three
new helpers. Reviewed panel Pods/Jobs/Events/Map, namespace Pods, their identity
and event helpers, Pod row/ingest producers, and Shell UI/lifecycle/styles.
YAML and the remaining inventory are still pending.

- Jobs now uses the existing resource-grid identity adapter and backend summary
  type. Events builds related-object input once for display, admission, open and
  navigation; occurrence fields and related-object projection have separate
  responsibilities. Removed two unconsumed EventDisplay fields.
- Both Pod tables share owner identity and namespace-permission target
  projection. Owner links preserve producer-supplied API version; incomplete
  identity stays display-only. Namespace Pods reuses the row identity adapter
  and declares sorting at column creation instead of finding/patching columns.
- Retained metric-column differences, Map destination callbacks, Event age sort
  semantics, refresh ordering, and Shell replay/attach/disposal distinctions.
  The manifest records the rejected consolidations and their reasons.

Logs use `/tmp/luxury-yacht-deep-`. Ten owner-link regressions failed before the
fix (`owner-d008-red.log`); 48 Pod tests passed afterward. Added three workflow
checks for node/namespace routing, CPU/memory values and freshness, and Job
navigation. The final focused run passed eight files / 133 tests at 85.03%
statements (`navigation-coverage-d008-final.log`): panel Pods 93.18%, namespace
Pods 81.2%, Events 82.17%, new shared helper 93.75%, Jobs 79.59%. Jobs is a
behavior-preserving adapter refactor; its remaining coverage gap is recorded,
not filled with presentation tests. Typecheck and lint passed. An initial local
complexity check flagged the changed Event projection at 16; separating its
related-object projection also removed duplicate field mapping. The subsequent
check found no scores above 12 in 270 changed/new TypeScript functions
(`complexity-audit-d008-final.log`); this is not pushed Sonar analysis.

D007 final validation is still open. The first combined gate scanned generated
coverage HTML and failed; the report was moved outside frontend. The next gate
passed backend race, lint, typecheck and all 4,891 frontend tests, then failed
Knip on a leftover DEFAULT_TOLERATION_RE export. Removed the export. The next
combined gate will include D008. No repository completion claim is warranted.

Direct Playwright navigation to the emitted development URL returned HTTP 200,
but the browser lacked `/wails/runtime` (404), so its empty workspace does not
prove app behavior. Native Wails checks opened a Deployment from its namespace Pod owner link,
loaded two workload-scoped panel Pods, followed a Node link to populated details,
and showed two Node Event rows with related-object activation. Node-scoped Pods
showed three namespaces; a namespace link selected the corresponding populated
Workloads view. Closed verification tabs, collapsed namespace navigation and
restored Overview before stopping the owned dev process. Custom owner-kind
collisions, missing-version admission and Jobs remain automated fixture evidence.

## Reopened deep review: D009

The manifest now records 350 inspected baseline implementation files, 1,495
pending, and three new helpers. Read all YAML tab implementation/styles and its
backend read, mutation, ownership, reload/merge, resolver and field-policy paths.

Consolidated request identity and generated response types across apply,
ownership and reload/merge; reused comment-preserving draft preparation; removed
an unused validator argument through both production and tests; unified diff
admission/rendering and blocking-state selection. Retained different parsing,
field-preservation, patch/merge, snapshot-adoption and verification contracts.

The new merge workflow test found that clearing a manual read override could
replace the merged draft with unedited live YAML. Both timing cases (matching
snapshot before or after the merge response) failed before the correction.
Removed the competing synchronization effect and three coordination refs;
editor actions own the draft while snapshot adoption continues to own read-mode
YAML. Tests also assert exact cluster/GVK/UID, original baseline resourceVersion,
merged fields, continued editability and no apply operation during merge.

Logs use `/tmp/luxury-yacht-deep-`. `yaml-merge-timing-d009-red.log` records two
new failures; `yaml-coverage-d009-final.log` then passed eight files / 73 tests,
with 88.86% statement coverage (734/826), transaction 87.76%, utils 86.84%, and
validation 95.09%. Existing save, ownership-warning, validation, clipboard,
protected-field, stale-snapshot and UID-recreation tests passed. Typecheck and
lint passed. Local complexity reports no score above 12 in 292 changed/new
TypeScript functions (`complexity-audit-d009-final.log`); this is not pushed
Sonar analysis.

Native validation remains open: the computer-use tool reported the Mac locked
and automatic unlock unavailable. Requested the user unlock it; stopped the
owned development process while continuing automated checks and source review.
Full frontend coverage and the combined prerelease gate are pending. No YAML
resource writes were performed during this batch.

D009 full frontend coverage passed 514 files / 4,908 tests at 88.51% statements
(37,202/42,027; `frontend-coverage-d009.log`). The generated report was moved to
`/tmp/luxury-yacht-deep-full-coverage-d009` before the formatter gate.

## Reopened deep review: D010

Read the 21 remaining object-panel stylesheets and traced their selector
producers, including dynamically assembled Karpenter lifecycle states. The
manifest now records 371 inspected baseline files and 1,474 pending. Object-panel
source coverage does not close its outstanding native checks or the repository.

Removed styles for the former flyout header/close/animation and plain-pre Helm
Values UI, unused overview selectors and the old scale-input.small variant.
Current producers use DockablePanel, YamlEditor and the shared controls. Kept
live header/content/retained-tab styles, descendant selection overrides, link
specificity, dynamic state suffixes and distinct card layouts. Adjacent identical
policy-label rules now share their declarations. Consumer-search evidence is in
`/tmp/luxury-yacht-deep-panel-style-consumers-d010.txt` and
`/tmp/luxury-yacht-deep-panel-shell-style-consumers-d010.txt`.

Combined automated gate and native visual checks remain open; native checks
still require the Mac to be unlocked. The stylesheet review is source evidence,
not a claim about rendered appearance.

The combined `qc:prerelease` gate passed after D010
(`/tmp/luxury-yacht-deep-prerelease-d010.log`): docs, formatting, generated
bindings, vet/staticcheck, backend race, frontend lint/typecheck, 514 files /
4,908 frontend tests, Knip and Trivy. Inspected the worktree afterward;
`git diff --check` passed and recorded source hashes were unchanged. This closes
the automated gate for D005–D010; D009/D010 native checks remain open.

## Reopened deep review: D011–D013

Read the refresh scheduler, per-cluster runtime, orchestrator, registration and
scope policies, complete resource-stream receiver, domain/event/view projections,
snapshot store and client. The manifest records 397 inspected baseline files and
1,448 pending; this batch does not close the repository review.

Consolidated streaming admission, scope normalization, callback settlement and
cleanup; removed write-only suspended-domain state and unconsumed outcome data.
Runtime teardown now uses stored domain/scope pairs. A failing auth-event test
proved that decoding keys truncated a cluster ID containing `::`; the corrected
path stops the owning scope and leaves another cluster running.

Removed the receiver's unique-scope fallback, which could route foreign-cluster
control frames into the only local subscription. Seven new socket-boundary cases
failed before correction. Cluster identity and scope prefixes are checked before
subscription lookup; subsequent valid owning-cluster ACKs still progress. Removed
obsolete per-cluster arguments from the one shared connection, and consolidated
its close/error recovery. Legacy frame interpretation, tokenless resets, resume
sequence, ACK trust, retained data and independent clocks remain.

Resource-domain membership and scope descriptors now derive from the existing
backend-authored contract; event types and view gates share that owner. Existing
order, domain scope tests, view admission and metric polling exceptions remain.
No runtime cycle was added: the event bus imports only descriptor types and the
descriptor module no longer imports the event bus.

Evidence uses `/tmp/luxury-yacht-deep-`: `refresh-d011-red.log` records the
teardown regression; `stream-routing-d012-red.log` records seven stream boundary
failures. `refresh-coverage-d012-final.log` passed 42 files / 611 tests with 91%
changed-file statements; scheduler 97.08%, runtime 97.23%, orchestrator 84.98%,
connection 84.61%, manager 91.75%, protocol 92.38%, subscriptions 90.8%. The
wrapper-only refresherConfig change remains 75% due to its unregistered-name
error branch. `refresh-d013.log` passed 43 files / 612 tests after descriptor
consolidation. Initial checks caught stale delegate expectations, an unused
import, optional-text comparison, a helper-name collision and an over-narrow
contract indexing type; corrected before the combined gate.

`frontend-coverage-d013.log` passed full frontend coverage at 88.6% statements
(37,172/41,954). Report moved outside frontend before formatting. Local complexity
found no score above 12 in 333 changed/new TypeScript functions
(`complexity-audit-d013.log`); unchanged findings and pushed Sonar remain separate.
Combined prerelease pending. D009/D010 native checks still require Mac unlock.

The combined `qc:prerelease` gate passed after D013
(`/tmp/luxury-yacht-deep-prerelease-d013.log`), including backend race, frontend
lint/typecheck/full tests, generated bindings, docs, Knip and Trivy. Inspected
the worktree afterward: `git diff --check` passed and recorded production hashes
differed only in resourceStreamDomains import ordering. Inspected that formatter
change and refreshed its recorded hash. Native D009/D010 checks remain open.

## Reopened deep review: D014

Read the complete backend resource-stream implementation, mux, ringbuffer and
related descriptor/projection producers. Removed discarded row projections and
the stateless subscription wrapper; Manager now owns the subscription path
directly. Snapshot invalidation still precedes delivery, and Pod projection
remains for owner/node scope fanout. Subscription and resume now reject missing
or foreign cluster identity; two regression tests failed before that correction.

Removed an AST guard requiring the discarded row argument. Replaced a registry
membership assertion with real informer registration against fake clients,
Gateway delivery and LIST/WATCH selector checks for duplicate ingest watches.
Race tests passed for resourcestream, streammux and system
(`/tmp/luxury-yacht-deep-stream-d014-after-final.log`). Resource-stream statement
coverage increased from 70.2% to 73.0%; the changed identity paths range from
81.2% to 100%. Package coverage remains below 80%. The full backend coverage
run passed at 78.9% (`backend-coverage-d014.log`, same temporary log prefix).
Local complexity found no score above 12 in 55 changed/new Go functions
(`go-audit-d014.log`). Combined prerelease remains pending.

Retained mux ordering, bounded queues, replay, independent clocks, dynamic
topology lookup, custom informer permission partitions and relationship fanout.
The manifest records the inspected files and candidate decisions. Remaining
files and D009/D010 native validation are still open.

D014 combined prerelease passed (`/tmp/luxury-yacht-deep-prerelease-d014.log`).
Post-gate inspection found no changes to recorded source hashes, and
`git diff --check` passed. The manifest now records 429 inspected baseline
files and 1,416 pending. Native D009/D010 validation remains open.

## Reopened deep review: D015

Read the informer, ingestion and permission packages, composite readiness hub
and projector registration. Consolidated relist projection/error handling,
full-row sink/index updates, manager and factory snapshots, permission priming
and readiness bookkeeping. Removed the pass-through reflector wrapper while
retaining its convergence/cancellation tests against the same client-go API.
Partition publication, bulk publication, async cross-store sinks, readiness
versus settlement, permission scopes and resume clocks remain distinct.

The permission review uncovered two different local result types sharing a
singleflight key. A deterministic foreground/background overlap reproduced a
TypeAssertionError (`/tmp/luxury-yacht-deep-permissions-d015-red.log`); one shared
review result contract fixes that path, and the permission race suite passed
(`permissions-d015-green.log`, same prefix). The regression asserts the new
denial reaches the waiting caller and cache with only one authorization review.

Focused race suites passed for ingestion, informer, permissions, system and
resource streams (`ingest-d015-after.log`). The three changed packages measured
83.5%, 83.1% and 83.2% statement coverage respectively. Local complexity is <=12
for 85 changed/new Go functions (`go-audit-d015.log`). Full backend coverage
is running after the last preflight/decision cleanup; combined prerelease and
D009/D010 native checks remain open.

D015 full backend coverage passed after final cleanup at 78.8% statements
(`/tmp/luxury-yacht-deep-backend-coverage-d015.log`). The shared permission-review
helper is 100%; its foreground caller is 94.1%.

## Reopened deep review: D016–D017

Read subsystem registration, domain policies, maintained-store ownership, root
setup, manual queues/execution and their HTTP contracts. Removed unused
dependency plumbing, the catalog-enabled callback, pass-through registration
wrappers and the one-use CRD metadata abstraction. Registration order,
permission gates/fallbacks, source scope and notifier attachment remain explicit.
System/domain permission/domain race suites passed (`registration-d016.log`,
under `/tmp/luxury-yacht-deep-`); registration-source coverage is 84.45%.

Manual enqueue already requires one cluster. Replaced the multi-child status
model with one explicit cluster and owning child queue/job, removing reduction
flags and unread cluster-order state. Queue replacement retains terminal jobs
and migrates unfinished jobs with compare-before-install protection. Expanded
characterizations passed before refactoring, then race checks passed afterward
(`manual-d017-before.log`, `manual-d017-after.log`). The queue file measured
86.21% statements. A late older migration cannot replace the newer child in
the exercised concurrent test.

Separated manual execution from status publication and removed the unconsumed
result Error field. Six workflow cases cover snapshot version, action-version
precedence, retry success, action failure, snapshot failure and absent snapshot
service; they passed before extraction and afterward under race detection
(`manual-execution-d017-before.log`, `manual-execution-d017-after.log`). Cache
bypass, operation identity, cluster scope and previous-version retention are
asserted. Local complexity is <=12 for 104 changed/new Go functions
(`go-audit-d017.log`). Combined prerelease remains pending with D015; native
D009/D010 validation is still open.

The manifest now records 463 inspected baseline files and 1,382 pending.
Manual execution is 100% covered and job-state publication 81.0%; the unchanged
retry helper is 68.0%. These checks do not close uninspected source or native
validation.

D015–D017 combined prerelease passed
(`/tmp/luxury-yacht-deep-prerelease-d017-final.log`). The first attempt stopped
at an obsolete registry-test reference to the removed result Error field;
the surviving returned-error assertion and refresh/domain/API race suites passed
after removal (`manual-d017-surviving.log`, same prefix). Post-gate inspection
found no changes to recorded source hashes, and `git diff --check` passed.
The reopened review inventory uses baseline
`616adb20abc55707f28ad41b7a4d3c1d8f48f025`; the earlier baseline above describes
the historical pass. Native D009/D010 checks remain pending.

## Reopened deep review: D018–D022

Read the metrics/telemetry producers, snapshot service/lifecycle, catalog assembly,
eight typed table domains and query/descriptor contracts, plus the network
snapshot/ingest/join path. The manifest now records 500 inspected baseline files
and 1,345 pending; review remains in progress.

Metrics projection uses Kubernetes CPU/memory accessors and one copying helper;
removed unused poller timestamp and disabled-recorder plumbing. Sparse samples,
container sums and timestamps passed before/after checks. Metrics/telemetry/system
race suites passed (`/tmp/luxury-yacht-deep-metrics-d018-after.log`); metrics
coverage is 83.0%. Snapshot service now uses its owning cluster directly, domain
cache policies directly, one permission-error publication path and standard FNV-1a.
Service/cancellation/readiness/cache regressions passed (`service-d019-after.log`,
same prefix); service file coverage is 90.66% and the fixed wire checksum passed
before replacement.

Catalog builder owns assembly directly; removed the stateless adapter, assembly
wrapper, duplicate stats computation and unused logger dependency. The initial
focused run found remaining test calls to the removed adapter; migrated them to
the public builder path with assertions retained. Catalog/system race cases then
passed (`catalog-d020-final.log`), with catalog/assembly file coverage 83.2%/87.0%.
Nine schemas now derive sortable fields from published capabilities; eight domain
specs reuse adapter kind accessors, and shared descriptor-source collection owns
permission/readiness projection. Focused typed-table checks passed
(`tables-d021-final.log`); broader registration coverage is still pending.

A network regression reproduced cached HTTPRoute rows still served after runtime
permission denial in both table modes (`network-d022-red.log`). Gateway rows now
use the existing source state for admission. Tests cover denial, unavailable
readiness and restored access without rebuilding retained stores; network/service/
endpoint race checks and query/sort equivalence passed (`network-d022-green.log`,
`network-d022-refactor.log`). Local complexity is <=12 for 145 changed/new Go
functions (`go-audit-d022.log`). Full backend coverage and combined prerelease
remain pending. Native access became available again; D009/D010 interaction
checks are being resumed against a freshly started development build.

D009/D010 native access was restored. Fresh-build CUA observations covered YAML
loading/read mode, managed-field visibility, mutable draft editing, protected-name
rejection, cancellation and maximization, plus populated NodePool overview in
right/bottom docks. The original cluster selection was restored and the owned
dev process stopped. Native Save/conflict/error paths and populated Helm Values
remain unrun (both inspected Helm lists were empty). Exact observations and
limits: `/tmp/luxury-yacht-deep-native-validation-d022.md`.

D018–D022 combined prerelease passed
(`/tmp/luxury-yacht-deep-prerelease-d022.log`); 503 recorded source hashes were
unchanged after the gate and `git diff --check` passed. Full backend coverage
also passed (`backend-coverage-d022.log`, same prefix); Go reports 78.9% total.
The changed network admission function is 100% covered and Build is 94.1%;
the network file is 75% because registration is unexercised. Typed-domain
registration files remain at 46.67–57.89%; those workflow gaps remain explicit.

## Reopened deep review: D023–D025

Object details/events share canonical scope and numeric-version parsing; removed
alias/wrapper indirection and the custom min. Event/Helm/CRD schemas derive sort
fields from capabilities; single Helm reaggregation uses the single-row mapper.
Object/map/events/Helm/CRD race checks passed (`object-d023-after.log`, under
`/tmp/luxury-yacht-deep-`). Custom-resource builders were read fully and retained:
namespace fanout and partial-error policies differ from cluster behavior.

Query cache entries now use the existing typed result instead of parallel fields
and positional tuples. Query paths share sort/signature construction and paging
dispatch, preserving their different filtered-anchor checks. Scope intersections
are flatter; informer and ingest upserts reuse their existing publication owners.
Cache/anchor/rank/cursor/facet/maintained-store race checks passed
(`query-d025-after.log`); 168 changed/new Go functions have local complexity <=12
(`go-audit-d025.log`). Adjacent event/CRD/Helm checks and combined gate are pending.

## Reopened deep review: D026 pod serving

Removed the bypassed Pod lister/indexer/ReplicaSet fallback and its projection
memo, TTL, callback and duplicate scope/owner logic. Registration already fed the
maintained store without a typed lister. Migrated workflow tests through the
production projector and sink first; row, identity, metric and scope checks passed
before removal and afterward. Version assertions now cover the intake counter.
Replaced old memo-only tests with real refetch/update/delete and invalid/valid-scope
workflows; benchmarks separate query-index construction from query-cache reuse.

The initial new delete test failed because its source omitted production's
`retainTable=true`; correcting that fixture made the characterization pass before
production changes (`pods-d026-before-final.log`, under `/tmp/luxury-yacht-deep-`).
No application bug is claimed for that failure. Snapshot and pod-stream race
checks passed (`pods-d026-final.log`); the focused system package had no matches.
An initial local complexity result of 13 for Build prompted separation of health
counting. All 172 changed/new Go functions are now <=12 (`go-audit-d026-final.log`).
Coverage/pruning impact and the combined D023–D026 gate remain pending.

D023–D026 combined prerelease passed
(`/tmp/luxury-yacht-deep-prerelease-d026.log`), including 514 frontend files and
4,924 tests. Recorded source hashes were unchanged after the gate (one recorded
deletion excluded); `git diff --check` passed. Adjacent query consumers passed
(`query-d025-adjacent.log`). Full backend coverage passed (`backend-coverage-d026.log`);
Go reports 78.9% total. After retiring the lister/cache implementation and its tests,
pod-file coverage is 184/213 statements (86.38%) versus 319/391 (81.59%) before;
served Build is 96.2% and store collection 100%. Query-file coverage is 83.59%.
These results close this automated batch gate, not the remaining repository/native
review.

## Reopened deep review: D027–D031

Read namespace signals/lifecycle, workload intake and joins, node direct-list and
ingest serving, cluster overview, and object-map collection/merge/traversal.
The manifest records file-level inspection and retained alternatives. Namespace
readiness/notifier policies remain separate because throttling, re-arm and stop
contracts differ; tracked GVR metadata now has one owner.

Removed the five workload builders' unused serve joins and builder instances;
intake projects own fields, then one serving path joins pods/metrics/HPA. Tests
use explicit resource/readiness expectations established before removal. Removed
unused logger plumbing. Nodes now share one aggregation path after list/intake
projection. Snapshot domains share version parsing and paired pod-bundle reads.
Overview builds its typed payload once, without a post-build assertion/mutation;
independent list tasks use their existing join barrier rather than callback locks.

Two regressions were reproduced and fixed: workload HPA matching guessed GVK,
and graph HPA enrichment mutated retained ingest facts when catalog publication
had not provided a merge target. Tests cover correct/mismatched identities and
HPA visibility loss without contaminating the stored facts or prior payload.
Graph traversal, catalog merge and relationship policies were retained; removed
unread relationship type copies and duplicate map cloning.

Focused race checks passed (`namespace-d027-after.log`, `workload-d028-final.log`,
`node-d029-after.log`, `overview-d030-after.log`, `aggregation-d031-after.log`, all
under `/tmp/luxury-yacht-deep-`). Ownership regressions are red/green in
`join-ownership-red.log` / `join-ownership-green.log`. Workload compile checks first
found a guessed helper name and unused benchmark import; both were corrected.
All 225 changed/new Go functions are <=12 local complexity (`go-audit-d031.log`).
Full backend coverage and combined gate remain pending.

D027–D031 combined prerelease passed (`/tmp/luxury-yacht-deep-prerelease-d031.log`),
including all 514 frontend files / 4,924 tests. Recorded source hashes were unchanged
after the gate. Full backend coverage passed (`backend-coverage-d031.log` under
`/tmp/luxury-yacht-deep-`), total 78.9%; directly corrected HPA identity matching is
100% and graph HPA enrichment 88.9% (`backend-coverage-functions-d031.txt`).
The repository-wide review and prior native verification gaps remain open.

### D032–D033: Attention and query engine

Full inspected-file hashes and candidate dispositions are in the review manifest.
Attention now enforces index cluster ownership and shares pod/workload evaluation;
its ignored-items modal shares restore state and type sections. Query paging shares
one prepared matcher and one owned-data replacement path; the QPC1 prototype now
lives with its tests. Focused backend race and 13 Attention UI tests passed.
The catalog listener check required an escalated retry, which passed.
Affected coverage, native Attention interaction and the combined gate remain open.
Runtime optional-kind permission loss versus retained Attention rows remains an
explicit investigation, not a completion claim.

### D034–D035: Workload resources and kind contracts

Reviewed all six workload kind packages, common/workload helpers and the named pod
responsibilities in the manifest. Removed discarded metrics work and intermediate
conversions, unified pod ownership resolution, reused canonical model constructors
and condition signal projection. Custom same-kind owners are no longer collapsed
into built-in ancestry (red/green regressions recorded). Focused and adjacent race
checks passed after built-in test fixtures gained their required API versions.
All 296 changed/new Go functions score <=12 locally. Coverage and combined gate
remain pending. Kind registry/DTO/graph leaves were retained for explicit ownership,
type safety and dependency direction; no generic framework was introduced.

### D032–D035 combined validation

The D034 combined prerelease rerun passed: 514 frontend test files / 4,924 tests,
backend race, vet/staticcheck, docs, generated bindings, lint, typecheck, knip
and Trivy (`/tmp/luxury-yacht-deep-prerelease-d034-final.log`). The first run
failed on generated coverage-report files under `frontend/coverage`; moving
that owned output to `/tmp` resolved the lint input problem. Recorded-source
hash audit found zero mismatches across 699 paths.

Full backend coverage passed at 79.0%. Cross-package workload coverage measured
ConditionSignals and owner resolution at 100% through actual resource/snapshot
consumers. Query-page prototype relocation changed its measured coverage from
86.62% to 86.34%, with prototype assertions retained. Attention modal measured
89.18% across 13 passing tests. An existing notifier test confused a quota
broadcast with a workload broadcast; it now observes the workload-read count
at broadcast time and passed 30 repeated race runs before the full gate.

Native YAML Save/conflict/reload/failed-load, populated Helm Values, and Attention
ignored-modal interactions remain outstanding. D032 optional-kind permission
loss is still an investigation. Passing validation does not close uninspected
repository files.

### D036–D038 broker, notification and shell ownership

Inspected the complete read brokers, diagnostic owner, frontend telemetry/error
family, and named shell contexts/navigation/persistence files in the manifest.
Consolidated request bookkeeping while preserving paused-read admission and
original-error correlation. A red regression proved diagnostic cluster/resource
key collisions; keys now encode tuples. Catalog object-match reads take one
complete identity without an unused override channel.

Notification state now contains visible notifications only. Two regressions
proved delayed dismissal could erase new arrivals or evict visible errors. The
hidden state, delayed cleanup owner and duplicate clear-all implementation are
removed; auto-dismiss policy, retry, history and cleanup are exercised. Removed
error-handler scaffolding with no production consumer in repository search.
The development harness has one typed scenario state and no unreachable reset.

Sidebar native-menu publication has one effect owner; a Strict Mode regression
reproduced three calls per toggle before the fix. Favorites context delegates
to its existing async persistence owner without four wrapper callbacks. Zoom
updater side effects remain an explicit investigation, not silently closed.

Focused/adjacent checks: broker134 tests, errors/telemetry150, shell92; combined
coverage210 tests across17 files. ErrorHandler pruning changed statement
coverage92.85%→94.21%; ErrorContext79.77%→98.33% after replacing animation-only
assertions with lifecycle regressions and separating dismissal policy.
Favorites95.55%, Sidebar85.71%, dataAccess85.71%, diagnostic store88.57%.
Fresh local audit:366 changed/new TypeScript functions<=12; unchanged findings
remain recorded separately from Sonar. Combined gate and rendered checks pending.


### D039 preference ownership and zoom follow-up

Settings projection now consumes normalized file fields; default app settings
use the same projection. Frontend metadata, bootstrap reads and palette key
selection each have one owner, using the generated settings payload type.
Focused backend race checks and 89 frontend preference/context tests pass;
typecheck passes (D039 normalization/effects/typecheck logs in `/tmp`).
The refresh settings bridge uses its bound target as the binding state, matching
the rate-limit bridge; existing tests cover early values and duplicate binding.
Favorite migration documentation now describes the tested v1/v2 migration.

Zoom acceptance criteria before implementation: one persistence call per menu
command even under Strict Mode; rapid commands use the latest level; a late
initial read or read failure cannot overwrite a user command; unmounted reads
cannot write DOM; valid/invalid saved levels, bounds, reset and reporting remain
covered. Provider tests mock native reads/events/writes, so native menu checks
remain a distinct required check. The subsequent D040 validation records their red/green and native results.


### D040 settings UI ownership and D039–D040 validation

Inspected every settings section, its shared controls and stylesheet, plus the
backend theme pattern parser and shared ToggleSwitch. Palette controls use one
field-driven renderer and the preference owner's mode-specific key map. New and
existing theme editors share field updates, validation accessibility and keyboard
handling. Appearance and Object Panel choice groups use one typed component;
remaining settings rows use the existing SettingRow. Theme lifecycle, default-last
priority, draft-versus-saved dimensions and section-specific read ordering remain.

Four zoom regressions failed before the lifecycle fix, then all14 passed. Settings
keyboard characterization passed before extraction. Final focused checks pass
118tests10files and typecheck; the unsupported Promise.withResolvers test helper
was replaced with the repository's existing deferred-promise pattern. Coverage:
Appearance82.75%, color93.10%, sharedControls100%, themeHook83.33%, Advanced93.22%,
ObjectPanel83.33%, preferences94.15%, Zoom100%. Full backend coverage79.0%; changed
settings projection/default functions100% and refresh binding91.7%. Local audits
report413 changed/new TypeScript and299 Go functions<=12, distinct from Sonar.

Native checks exercised zoom110/120/reset100, System/Dark/System appearance,
Right/Bottom/Right panel placement, invalid theme-pattern validation/cancel and
kubeconfig row rendering. Restored the original workspace and settings tab; no
temporary theme remained. Browser DOM checks separately verified slider labels,
bounds and equal widths. Evidence: `/tmp/luxury-yacht-deep-native-validation-d040.md`.
The combined prerelease gate passed (D040 log): backend race, docs, bindings,
vet/staticcheck, lint, typecheck, 514 frontend files/4943 tests, Knip and Trivy.
Post-gate existing-source hash audit found zero mismatches. Older YAML/Helm/Attention restoration
runtime checks and preference/favorite concurrency/identity investigations remain
open. Manifest coverage is736/1845 baseline files, with1109 not yet fully inspected.


### D041-D042 RBAC and config resources (in progress)

Full-source inspection covers the five RBAC packages and both ConfigMap/Secret
packages. Candidate dispositions and contracts are in the manifest. Count-only
status/list projections currently build discarded rules, links and sorted keys;
the batch will retain rich detail facts while sharing count projections. The
RBAC baseline race checks passed; characterization precedes implementation.


### D041-D045 resource projection ownership

Full-source review now covers RBAC, ConfigMap/Secret, storage, quota/PDB and HPA
packages. Count-only models and stream rows use their required source fields
without building discarded rule copies, subject links, quantity maps or metrics.
Shared summary/status/default/target helpers replace duplicate owners; rich
facts remain with detail consumers. Removed RBAC, ServiceAccount and policy
model adapters after tracing every caller to the canonical Identity constructor.

A PVC regression showed details omitted requested capacity when status had a
nonnil map without storage; two cases failed before the fix, then passed using
the canonical status-entry/request fallback. Storage-class explicit-empty and
legacy annotation precedence, RBAC blank names/aggregation/deletion, and PDB
health/conditions/deletion are characterized. HPA version assertions now exercise
the actual stream and preserve its primary v2 identity and custom target version.

Affected package/race checks and adjacent RBAC snapshot/stream checks pass.
Local Go audit:361 changed/new functions<=12. Full backend coverage passed at
79.2% overall; changed PVC detail87.0%, capacity helpers100%, shared RBAC summary
helpers100%, HPA status and edge100% in cross-package instrumentation. Combined
prerelease passed (exit0): `/tmp/luxury-yacht-deep-prerelease-d045.log`. Native YAML/Helm/Attention gaps and the previously
recorded concurrency/permission investigations remain open.

### D046-D049 networking, admission and Gateway projections

Inspected the complete Service, EndpointSlice, Ingress, IngressClass,
NetworkPolicy, admission, APIExtensions, shared DTO and eight Gateway kind
packages. Count/status/graph paths now avoid building unrelated detail facts;
canonical kind identity, condition projection and first-link summary policy have
one owner. Removed unpopulated IngressClass/GatewayClass usage fields, obsolete
list DTOs and their backend aliases, and the unused Gateway version-resolver
pipeline. Discovery still records installed kinds independently of typed v1
client selection; partial discovery retains its usable kinds.

Regressions reproduced malformed API versions becoming openable Event,
EndpointSlice and Helm links; Service forwarding accepting incomplete or
cross-namespace endpoint targets; and unknown Gateway/core kinds receiving a
guessed v1. Those cases now pass with display-only unresolved links and complete
same-namespace Pod selection. Timeout characterization preserves caller deadline
and cancellation ownership. Positive forwarding, reconnect, list, detail and
snapshot cases remain exercised; fake clients do not prove a live tunnel.

The first D048 full backend build caught a consumer-search mistake: excluding
all files named types.go hid backend aliases. The corrected search and alias
removal passed the backend retry. Full frontend coverage passed514 files/4943
tests at88.93%; focused surviving overview tests14/14 with Gateway81.67% and
clusterresource92.30%. No test cases were removed with the unused usage fields.
Latest cross-package race coverage passed at92.5% for the instrumented shared
model/common/Service/types/Gateway availability packages; changed parser,
condition projection, discovery and link helpers100%, forwarding90.0%/90.9%.
The separate full backend run measured79.4% overall before the final Gateway
follow-up. Local complexity:430 changed/new Go functions and413 TypeScript
functions<=12 (not a Sonar closure claim). Combined prerelease pending.
Evidence and remaining investigations are recorded in the file manifest.

### D050–D051 — resource projections and operation scheduling

Node status now reads its source object directly, with one cordon signal policy
shared by signals and badges. Removed the redundant Node fact representation;
Node details and snapshot intake read the existing unschedulable source field.
Namespace status no longer builds relationship/detail facts, Event status avoids
rich detail construction, and generic/Namespace finalizer selection shares one
helper while retaining their distinct patch/finalize operations.

A branching Node log tree reproduced a worker-queue deadlock. A coordinator now
owns pending tasks; workers stream discovered children independently of task
completion. Tests cover branching, slow root entries, cancellation, depth,
deduplication and source limits. An initial coordinator implementation delayed
nested work; its failing regression drove streaming child delivery. These are
recorded behavior fixes, not claims of exact preservation of the broken path.

Helm detail no longer parses and resolves a manifest a second time to create
unused resource-link facts. Synthetic status reads release status directly;
summary/detail Notes and History policy remains explicit. Custom-resource facts
now contain the status consumed by details and rows, with conditions parsed once.
Removed unused CRD-link/raw-status materialization and duplicated scalar helpers.
Generic custom-condition coercion remains separate from operator condition policy.
Argo and Karpenter owner tests reproduced incomplete openable references; the
producers now reject those owners while retaining first-valid selection and
Karpenter label fallback.

Focused race checks pass. D050 discovery scheduler coverage is 100%, processing
85.7%/92.9%, Node status/cordon/model 100%, Namespace status 91.3%, Event status 81.8%,
shared finalizer selection 100%. D051 combined coverage 90.7%: Helm 91.2%, custom
resources 84.1%, Argo 93.1%, Karpenter 98.1%, shared CRD facts 89.4%; both changed owner
functions 100%. One obsolete raw-status materialization test was removed; custom
package coverage changed from 86.3% to 84.1% with production statements decreasing from 205 to 176. No tests
were added solely to restore the percentage. The local Go audit covers 467
changed/new functions, all at or below 12; this is not pushed-revision Sonar evidence.

The D049 prerelease attempt failed at lint because a generated coverage HTML
report was inside the frontend tree (3075 parse errors). The report was moved
to `/tmp/luxury-yacht-full-frontend-coverage-d048-report`. The combined gate then passed against D050–D051 (`/tmp/luxury-yacht-deep-prerelease-d051.log`):
514 frontend files / 4943 tests, backend race, docs, formatting/bindings, lint,
typecheck, Knip and Trivy. Detailed commands, logs, candidates and retained policies
are in the file review manifest. Repository review and older native verification
gaps remain open.


### D052–D054 — frontend identity, status and preference ownership

D052 inspected the remaining utility modules and status toolbar files, retaining
quantity parsing, timestamp scanners, selection policies and structural sharing
where their consumers require distinct behavior. Stable list keys now encode base
value and occurrence as a tuple, including every IconBar branch. Red regressions
proved collisions and actual button remounts when removing a neighboring separator.
IconBar shares its action/toggle button rendering; accent palette apply/clear share
one path. Focused validation: 105 tests across nine files.

D053 traced status snapshot/event producers and consumers. Header/About share one
app-info lifecycle hook; live update state survives older metadata reads and modal
opening generations. Runtime status subscribes before reading, preserves newer
full lists, replays early incremental port-forward status and stops after cleanup.
Registry presence, status patches and React keys include cluster/session identity.
Sessions rendering shares identity fields and one shell-open/verify path, with one
pending-jump state. Eight lifecycle regressions plus two cluster-identity cases
failed before the fix; 115 focused tests then passed. Native interaction is still
pending; these tests do not stand in for it.

D054 closes the overlapping-write investigations from D039/D040. One confirmed
preference base plus pending edits now owns cache/events/startup storage. Persistence
and success notifications run in edit order. Hydration waits for writes and retries
invalidated snapshots before publishing metadata or settings. Display/Data Management
controls subscribe to this owner; their separate optimistic rollback state is gone.
Six owner regressions, four control integration regressions and a delayed-notification
ordering regression failed before their respective fixes. Notification failures,
self-triggered hydration and reentrant subscriber edits are also exercised.

The repository frontend coverage task passed 4,970 tests across 516 files:
88.98% statement coverage overall; preference owner 95.83%, settings controls 100%,
Display 94.11%, Data Management 96.87%. It also covers the latest nullable app-info
follow-up: useAppInfo 100%, About 91.13%, Sessions 89.09%, runtime hook 96.22%,
adapter 90.76%, UpdateStatus 100%, stable keys/IconBar/link-color 100%.
Evidence: `/tmp/luxury-yacht-frontend-coverage-d054.log` and
`/tmp/luxury-yacht-frontend-coverage-d054-report/coverage-summary.json`.
The generated report was moved outside frontend before subsequent lint.
Typecheck passes and all 506 changed/new TypeScript functions score at most 12
locally (`/tmp/luxury-yacht-settings-d054-typecheck-final.log`,
`/tmp/luxury-yacht-deep-complexity-audit-d054.log`). The combined prerelease result
still predates these batches, and native gaps remain explicit. Review inventory
stands at 1,175/1,845 baseline files fully inspected; the remaining files are not
counted by passing tests.

### D055–D062 — identity, shared hooks and lifecycle owners

D055 completed favorite identity and navigation handoff changes before the user's
check-in. Its combined prerelease passed; the previously recorded native gaps
remain. D056 centralizes panel mutation lifetime guarding and fixes sidebar resize
cleanup. D057 consolidates log filters and update operation ownership, including
reentrant download/cancellation cases. D058 records retained platform policies.
D059 and D061 share native and renderer panel removal/publication while preserving
detach-before-layout-before-owner removal order. D060 publishes new refresh-store
roots so React consumers observe pending-request changes. D062 consolidates log
level classification and removes the unused About/update forwarding route.

Focused validation evidence and exact source hashes are in the manifest. New
regressions were run red for behavior corrections. Changed hook coverage includes
mutation guard80%, sidebar100%, node actions96.25%, panel removal100%, refresh
store90.78%; native window registries measured88.9%/84.9%. Update lifecycle race
coverage measured84.8%. Native interaction and the continuation's final gate
remain pending.

### D063–D064 — retained authorization and resource identity

Attention serving now applies current source permissions/readiness to retained
rows and query counts without erasing recovery data. Exact group/resource filters
preserve catalog-owned custom kinds that share a built-in kind name. Shared
maintained paging now treats empty required authorization intersections as no
matches, rather than letting the query engine interpret them as unrestricted.
Revocation, restoration, cold-store restoration and empty-scope regressions passed;
the snapshot race suite measured83.0% and query paging86.3%.

BuiltinResource aliases the existing canonical identity type. All forty shared
model constructor caller files no longer pass an empty facts argument; the facts
wire field remains unchanged. Capability wildcard matching and default permission
timeouts share their existing owners. Capability race coverage measured86.1% and
identity81.8%; a stale converter reference in the identity test was corrected
without changing its assertion. The broad command's initial compile failure and
passing follow-up are retained in the manifest.

### D065–D066 — operations and refresh publication

Workload mutations now retain their complete action target, and permission checks
call their shared owner directly. Session cleanup has distinct user, stream and
runtime paths instead of boolean flag combinations. A terminal resize/close panic
was reproduced and fixed by giving the queue one lock for both operations. Drain
history filtering now belongs to its cluster-scoped store; test-only unscoped
creation/reassignment/raw-pointer APIs were removed and their isolation assertions
retargeted. Missing/mismatched snapshot ownership is rejected.

Fetch and follow share a GVK gate before typed Kubernetes reads. Invalid same-kind
API identities and a concurrent global log-limit read/write race were reproduced
and corrected. Pod log services measured82.1% and log streaming82.3% in full race
runs. Operation checks passed with terminal queue100%, drain Snapshot100% and
maintenance domain92.9% for the changed behavior. Full backend coverage is pending;
filtered action/lifecycle runs did not execute every public Start/Stop method.

Refresh aggregates no longer store unused snapshot routing order or stream logger
and recorder copies; telemetry retains its meaningful cluster order. Metrics
configuration reuses the existing subsystem-copy owner. Both installed Kubernetes
informer factory interfaces have the same sync result contract, so their duplicate
catalog wait implementations now share one narrow interface. Generation ownership,
reverse teardown, retained serving, governor planned/applied state and mmap lifetime
remain explicit.

Event subscription send/close racing was reproduced under the race detector.
Subscriptions now own both operations, and delivery has explicit outcomes instead
of panic recovery and three return booleans. The replay buffer stores StreamEvent
directly, removing its duplicate representation and conversion loops. Full event
and ring-buffer race suites passed (71.3% and100% respectively); coverage review and
final validation remain open. The local audit covers134 changed/new Go functions,
all at or below12. This is not a Sonar analysis of a pushed revision.


### D067–D071 — frontend ownership, metrics, logs and diagnostics

The file manifest records the full inspected scope and retained contracts.
Refresh hooks now own their effect subscriptions and callback lifetimes; preference
consumers read the existing cache through `useSyncExternalStore`. Metrics routing
validates complete API identity once and selectors match cluster, GVK, namespace
and name. Container log connections own and settle manual completion, replacement
cleanup checks identity, and visibility suspension preserves current demand.
Diagnostics reads the root store once, shares table controls, retains cluster-owned
row identity, computes performance signals once and avoids overlapping polls.

Red/green evidence is recorded per candidate in D067–D071. Focused runs include
399 log/orchestrator tests, 135 metrics/table tests, 79 preference tests and 168
diagnostics/adjacent tests. The final polling regression selection passes 28 tests.
Typechecking passes. The local complexity audit reports 133 changed/new TypeScript
functions without findings above 12; two unchanged findings remain separate.
Logs: `/tmp/luxury-yacht-d070-logs-green.log`,
`/tmp/luxury-yacht-d068-metrics-green.log`,
`/tmp/luxury-yacht-d069-preferences-green.log`,
`/tmp/luxury-yacht-d071-focused-green.log`,
`/tmp/luxury-yacht-d071-polling-green.log`,
`/tmp/luxury-yacht-d071-typecheck-final.log`, and
`/tmp/luxury-yacht-d071-complexity-final.log`.

The full backend coverage task passed for this continuation (backend 81.0%,
drain 88.4%, stream logs 82.3%, pod resources 82.1%). Cross-package instrumentation
reports 100% for the shared log identity validator. These are automated coverage
results, not native interaction evidence. Logs:
`/tmp/luxury-yacht-continuation-backend-coverage.log` and
`/tmp/luxury-yacht-d065-logs-cross-package.log`.
Frontend coverage, the remaining inventory, native checks and the latest prerelease
gate remain open.


### D072–D073 — build, release and frontend tooling

Read the remaining project commands, platform packaging scripts, Storybook setup,
frontend analysis scripts and boundary export modules. Updater targets now share
one validation/ordering owner; artifact membership uses a set, archive validation
calls its existing owner directly, and copy/close errors join at one return.
Platform identity, signing, install ordering and release publication gates remain
explicit. The project and updateconformance tests pass; target selection preserves
canonical order and input immutability in a characterization test that passed
before and after the change. Local Go analysis reports 144 changed/new functions
at or below 12 (`/tmp/luxury-yacht-d072-tooling-green.log`,
`/tmp/luxury-yacht-d072-go-complexity.log`). No release or install was executed.

The initial full frontend coverage run passed 5,010 tests and failed the Cluster
Overview preference notification fixture. Its mocked cache now changes before
notification, matching the real preference producer; all existing assertions
remain. The focused rerun passes 30 tests
(`/tmp/luxury-yacht-d071-overview-green.log`). The full coverage rerun is pending.


## D074–D078 — shared controls, modal ownership, diff and Browse

Full inspection records and candidate dispositions are in the JSON manifest.
Shared controls now centralize tooltip timers, rely on CSS for search focus,
and remove unreferenced resource-bar presentation. Modal drafts and read
lifetimes are owned per full object identity; rollback validation releases its
mutation guard. Dropdown triggers share markup while preserving their ARIA
modes, and one live-region timer prevents older announcements from clearing
newer ones. Diff YAML has one shared retention/checksum/masking owner keyed by
complete identity, with match generations cancelled on selection, close and
teardown. Browse shares sort and page metadata policies and uses the shared
inventory controls without its obsolete toolbar stylesheet.

Red/green evidence is retained in the manifest, including stale history,
port draft replacement, rollback guard release, announcement timing, cross-cluster
YAML retention in every render, and cancelled initial object matches. Local
complexity passed for 209 changed/new TypeScript functions and typecheck passed
on the D078 source. The full frontend coverage rerun is in progress; native
checks and the final prerelease gate remain open. No completion claim is made.

The earlier continuation frontend coverage rerun passed: 5,011 tests in 520 files,
89.24% statements (37,209/41,694), 79.66% branches, 88.22% functions and 89.21% lines
(`/tmp/luxury-yacht-continuation-frontend-coverage-final.log`). That result predates
D074–D078 and is not the final validation evidence.


## D079–D082 — cluster, namespace and global views

Full-file inspection and candidate dispositions are recorded in the manifest.
This batch consolidates aggregated identity columns and namespace routing,
replaces overlapping namespace-metrics bookkeeping with shared scoped leases,
and tags retained namespace/overview state with its cluster owner. It also
preserves full workload action identity and scopes metric transitions by
canonical resource identity. Obsolete workload-only helpers/tests and CSS
without consumers were removed. The AppLayout tab-change forwarding and
namespace-map lifecycle candidates remain explicitly open for their next batches.

Red/green evidence covers per-cluster error deduplication, Strict Mode and
concurrent metric owners, supplied workload GVK, equal-name metric transitions,
and every-render isolation on a cold namespace-cluster switch. The view batch
passed 364 tests /44 files and the later retention batch passed 65 tests /3 files;
latest coverage, native checks and the final prerelease gate remain open.

The D078 full frontend coverage run passed 5,021 tests /522 files, with 89.32%
statements (37,145/41,585), 79.76% branches, 88.29% functions and 89.29% lines
(`/tmp/luxury-yacht-d078-frontend-coverage.log`). All touched D074–D078 files
were at least 80% statements, including the manual-loading hook and new diff
retention owner at 100%. The raw summary is saved at
`/tmp/luxury-yacht-d078-coverage-summary.json`; it predates D079–D082.


## D083 — object-map model, renderer and ownership

All object-map implementation files were inspected in full. The duplicated data
and selection queues now share explicit run ownership, preventing an old graph
completion from consuming replacement work. Namespace maps use scoped leases;
map navigation validates supplied identity at one shared boundary. Seed matching
is cluster-scoped. Duplicate selection computation, endpoint indexing, renderer
subscriptions, handler construction and tooltip forwarding were consolidated.
The manifest records the graph/layout/lifecycle contracts retained unchanged.

Six new regressions failed before their fixes; 199 tests /26 files passed after
the changes (`/tmp/luxury-yacht-d083-map-green.log`). The final tooltip extraction
has local complexity evidence and remains included in the next combined test run.
Native map interaction, affected coverage and the latest full gate remain open.

D082 full frontend coverage passed 5,026 tests /523 files: statements 89.47%
(37,126/41,491), branches 79.79%, functions 88.84%, lines 89.45%.
Evidence: `/tmp/luxury-yacht-d082-frontend-coverage.log`; summary copied to
`/tmp/luxury-yacht-d082-coverage-summary.json`. This includes D081 test pruning:
the retained workload search helper is 95.83% statements (23/24). The D078
aggregate was 89.32%; the denominator changed with pruning/refactoring and this
comparison does not imply additional scenario coverage.
