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
| 1 | Shared tables | Shared table hooks/rendering; resource-grid adapters; snapshot/querypage consumers | S001 catch-up: shared-table responsibilities revisited; C2 remains |
| 2 | Catalog and resource projections | Object catalog; per-kind resources; kind/model contracts; Browse adapters | S002 catch-up: catalog lifecycle and descriptor model revisited; per-kind scope remains |
| 3 | Cluster/workspace/auth | Backend cluster/workspace owners and auth helpers; Kubernetes/cluster workspace contexts | S003 catch-up: client/recovery and discovery/watch revisited |
| 4 | Refresh and data access | Refresh APIs, stores, snapshots, ingestion, streams, metrics and governor; frontend refresh/data brokers | S004 catch-up: snapshot/store/mux/metrics reviewed; large lifecycle owners remain |
| 5 | Object details and panels | Object-panel overview/YAML/actions; detail gateway; panel-window ownership | Expanded S005 batch and final gate passed; remaining scope recorded |
| 6 | Operations | Shell/debug, logs, port-forward, drain, runtime registry; detail/event consumers | S006 owner/consumer review, batch implementation, coverage and final gate passed |
| 7 | Object map | Backend graph producers and relationships; frontend graph, layout and renderer | S007 batch, coverage and final gate passed; limits recorded |
| 8 | Permissions and mutations | Capability policy, permission caches, object actions/YAML; frontend availability gates | S008 query/store/hook batch, coverage and final gate passed; remaining scope recorded |
| 9 | Navigation and interaction | Sidebar, routing, shortcuts, command palette, modals, shared inputs and menus | S009 keyboard/palette/global shortcut batch, coverage and final gate passed; remaining scope recorded |
| 10 | Preferences and persistence | Settings, favorites, UI state, import/export/reset; frontend state hydration | S010 mutation/editor/theme/import batch, coverage and final gate passed; remaining scope recorded |
| 11 | Errors and diagnostics | Error classification/reporting, logs, telemetry, request diagnostics | S011 policy/context/session/snapshot batch, coverage and final gate passed; remaining scope recorded |
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
| `backend/(root: error)` | 2 | 253 | 1 / — | S011: reporting service inspected; consent and reset ownership retained |
| `backend/(root: events)` | 1 | 149 | — / — | Inventoried |
| `backend/(root: exec)` | 4 | 277 | — / — | Inventoried |
| `backend/(root: favorites)` | 2 | 572 | — / — | Inventoried |
| `backend/(root: fetch)` | 1 | 395 | — / — | Inventoried |
| `backend/(root: generate)` | 1 | 17 | — / — | Inventoried |
| `backend/(root: generic)` | 1 | 39 | — / — | Inventoried |
| `backend/(root: helm)` | 2 | 104 | — / — | Inventoried |
| `backend/(root: kubeconfig)` | 4 | 928 | 1 / — | Inventoried |
| `backend/(root: kubernetes)` | 1 | 83 | — / — | Inventoried |
| `backend/(root: logger)` | 1 | 371 | — / — | S011: logger capture/emission order reviewed and retained |
| `backend/(root: menu)` | 1 | 246 | — / — | Inventoried |
| `backend/(root: node)` | 3 | 145 | — / — | Inventoried |
| `backend/(root: object)` | 11 | 2243 | — / — | Partial S005: detail/Helm read ownership and YAML mutation admission; other enrichments and mutation internals remain |
| `backend/(root: operations)` | 2 | 323 | — / — | S006: coordinator and drain-registration ownership reviewed; distinct cleanup retained |
| `backend/(root: pod)` | 3 | 161 | — / — | Inventoried |
| `backend/(root: portforward)` | 6 | 1133 | 2 / — | S006: target, port, session and lifecycle files reviewed; projections/retry handling simplified |
| `backend/(root: preferences)` | 5 | 2301 | 2 / — | Inventoried |
| `backend/(root: refresh)` | 18 | 4252 | 4 / — | Inventoried |
| `backend/(root: resource)` | 6 | 1450 | — / — | Partial S008: permission query preparation/fallback/diagnostics and mutation permission checks inspected |
| `backend/(root: response)` | 3 | 687 | — / — | Partial S008: cached-response permission recheck inspected; cache lifetime remains |
| `backend/(root: runtime)` | 2 | 304 | 1 / — | Partial S006: operation registry reviewed; runtime setting policies remain |
| `backend/(root: settings)` | 1 | 229 | — / — | Inventoried |
| `backend/(root: shell)` | 2 | 765 | 1 / — | S006: session/lifecycle owners reviewed; frontend orchestration simplified |
| `backend/(root: static)` | 1 | 83 | — / — | Inventoried |
| `backend/(root: theme)` | 1 | 132 | — / — | Inventoried |
| `backend/(root: types)` | 1 | 82 | — / — | Inventoried |
| `backend/(root: ui)` | 2 | 334 | — / — | Inventoried |
| `backend/(root: update)` | 8 | 1186 | — / — | Inventoried |
| `backend/(root: window)` | 1 | 112 | — / — | Inventoried |
| `backend/(root: workload)` | 2 | 502 | 1 / — | Partial S008: mutation validation, HPA scale guard, permission/write/cache order inspected |
| `backend/(root: workspace)` | 16 | 2130 | — / — | Reviewing: S003 selection/restore/prune; remaining scope recorded |
| `backend/capabilities` | 4 | 866 | — / — | S008: SSAR worker and SSRR cache/rule matching reviewed; shared retry policy and singleflight error return |
| `backend/internal/applog` | 6 | 323 | — / — | Partial S011: report_error adapter inspected; other adapters remain |
| `backend/internal/appupdates` | 2 | 1125 | 1 / — | Inventoried |
| `backend/internal/authstate` | 4 | 683 | — / — | Inventoried |
| `backend/internal/cachekeys` | 1 | 18 | — / — | Inventoried |
| `backend/internal/config` | 1 | 551 | — / — | Inventoried |
| `backend/internal/containerlogs` | 5 | 495 | 1 / — | Partial S006: shared unavailable classifier added; existing selection/target helpers inspected through consumers |
| `backend/internal/credentialerrors` | 1 | 226 | — / — | Inventoried |
| `backend/internal/errorcapture` | 4 | 589 | — / — | S011: capture, expected-error policy and stderr assembly reviewed and retained |
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
| `backend/kind/kindregistry` | 2 | 168 | — / — | Partial: S004 ingest-owned descriptor contract |
| `backend/kind/kindspec` | 1 | 176 | — / — | Inventoried |
| `backend/kind/objectmap` | 1 | 54 | — / — | Inventoried |
| `backend/kind/objectmapnode` | 2 | 134 | — / — | Inventoried |
| `backend/kind/objectmapspec` | 2 | 183 | — / — | Inventoried |
| `backend/kind/streamrows` | 2 | 601 | — / — | Inventoried |
| `backend/kind/streamspec` | 1 | 64 | — / — | Inventoried |
| `backend/nodemaintenance` | 1 | 584 | — / — | S006: store/history/cancellation reviewed and shared terminal updates implemented |
| `backend/objectaction` | 1 | 150 | — / — | Inventoried |
| `backend/objectcatalog` | 25 | 5995 | 8 / — | Reviewing: S002 query/facets; other responsibilities remain |
| `backend/objectyaml` | 1 | 130 | — / — | Inventoried |
| `backend/refresh` | 6 | 804 | 2 / — | Inventoried |
| `backend/refresh/api` | 1 | 304 | — / — | Inventoried |
| `backend/refresh/containerlogsstream` | 4 | 2200 | 3 / — | S006: handler/streamer/limiter reviewed and simplified; wire DTO unchanged |
| `backend/refresh/domain` | 2 | 264 | — / — | Inventoried |
| `backend/refresh/domainpermissions` | 2 | 754 | — / — | Inventoried |
| `backend/refresh/eventstream` | 2 | 484 | — / — | Inventoried |
| `backend/refresh/informer` | 4 | 1065 | 1 / — | Inventoried |
| `backend/refresh/ingest` | 6 | 2779 | 3 / — | Partial: S004 bundle queue and partition replacement |
| `backend/refresh/metrics` | 4 | 999 | 2 / — | Inventoried |
| `backend/refresh/permissions` | 2 | 457 | — / — | Inventoried |
| `backend/refresh/querypage` | 10 | 3065 | 5 / — | Inventoried |
| `backend/refresh/resourcestream` | 20 | 3531 | 2 / — | Inventoried |
| `backend/refresh/ringbuffer` | 1 | 68 | — / — | Inventoried |
| `backend/refresh/snapshot` | 77 | 20864 | 11 / — | S002 catalog and S007 object-map assembly reviewed; other domains remain |
| `backend/refresh/streammux` | 3 | 844 | 2 / — | Inventoried |
| `backend/refresh/system` | 9 | 2505 | 1 / — | Partial: S004 ingest readiness hub |
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
| `backend/resources/helm` | 5 | 750 | — / — | Partial S005: detail/manifest/values acquisition; other Helm operations remain |
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
| `backend/resources/nodes` | 10 | 1846 | — / — | Partial S006: node/drain and logs reviewed; other per-kind projection files remain |
| `backend/resources/persistentvolume` | 12 | 632 | — / — | Inventoried |
| `backend/resources/persistentvolumeclaim` | 12 | 516 | 1 / — | Inventoried |
| `backend/resources/poddisruptionbudget` | 13 | 451 | — / — | Inventoried |
| `backend/resources/pods` | 13 | 1954 | 5 / — | Partial S006: debug, logs and forward-target reader reviewed; other pod projections remain |
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
| `frontend/src/core/capabilities` | 11 | 2623 | — / 5 | S008: store/query/hook, feature/spec and identity responsibilities reviewed; shared state projection and obsolete catalog removal |
| `frontend/src/core/cluster-workspace` | 2 | 755 | — / — | S003 store/hydration inspected and simplified |
| `frontend/src/core/codemirror` | 3 | 640 | — / — | Inventoried |
| `frontend/src/core/connection` | 1 | 237 | — / — | Inventoried |
| `frontend/src/core/contexts` | 11 | 1875 | — / 1 | Inventoried |
| `frontend/src/core/data-access` | 6 | 700 | — / — | Partial: S004 broker, leases, lifecycle/readers |
| `frontend/src/core/desktop-runtime` | 1 | 81 | — / — | Inventoried |
| `frontend/src/core/events` | 3 | 317 | — / — | Inventoried |
| `frontend/src/core/logging` | 1 | 112 | — / — | S011: app-log client reviewed and retained |
| `frontend/src/core/navigation` | 5 | 489 | — / — | Inventoried |
| `frontend/src/core/panel-windows` | 17 | 2600 | — / — | Inventoried |
| `frontend/src/core/persistence` | 2 | 448 | — / — | Inventoried |
| `frontend/src/core/read-diagnostics` | 2 | 312 | — / — | Partial S011: request store lifecycle/correlation reviewed and retained |
| `frontend/src/core/refresh` | 60 | 17381 | — / 9 | Partial: S004 store/runtime/scheduler and orchestrator seams; S006 container-log buffer/fallback paths reviewed |
| `frontend/src/core/resource-metrics` | 6 | 726 | — / 2 | Inventoried |
| `frontend/src/core/settings` | 4 | 1890 | — / — | Inventoried |
| `frontend/src/core/telemetry` | 2 | 1175 | — / — | S011: telemetry/expected errors reviewed; context and alias projection shared |
| `frontend/src/core/window-identity` | 1 | 9 | — / — | Inventoried |
| `frontend/src/hooks` | 8 | 746 | — / 1 | Inventoried |
| `frontend/src/modules/browse` | 13 | 3294 | — / 1 | Inventoried |
| `frontend/src/modules/cluster` | 26 | 5362 | — / — | Inventoried |
| `frontend/src/modules/global` | 5 | 773 | — / 2 | Inventoried |
| `frontend/src/modules/kubernetes` | 1 | 856 | — / — | S003 provider inspected; adds selection model |
| `frontend/src/modules/namespace` | 30 | 4701 | — / 1 | Inventoried |
| `frontend/src/modules/object-map` | 38 | 8546 | — / 12 | S007 production owner/consumer review and batch; limits recorded |
| `frontend/src/modules/object-panel` | 141 | 32321 | — / 31 | Partial S005: panel reconciliation, tab composition, YAML baseline, Overview rendering, log presentation, Helm read model; S006 shell/debug and node/container-log consumers reviewed; remaining scope recorded |
| `frontend/src/modules/port-forward` | 4 | 874 | — / 1 | Inventoried |
| `frontend/src/modules/resource-grid` | 15 | 4107 | — / 1 | Inventoried |
| `frontend/src/shared/actions` | 4 | 772 | — / — | Partial S008: object action client, policy and generated kind lookup inspected; contract generation remains |
| `frontend/src/shared/components` | 26 | 3064 | — / — | Inventoried |
| `frontend/src/shared/components/aria` | 1 | 25 | — / — | Inventoried |
| `frontend/src/shared/components/diff` | 6 | 1327 | — / 3 | Inventoried |
| `frontend/src/shared/components/drain` | 3 | 784 | — / 4 | Inventoried |
| `frontend/src/shared/components/dropdowns` | 9 | 2392 | — / — | Inventoried |
| `frontend/src/shared/components/errors` | 9 | 1119 | — / — | Partial S011: ErrorBoundary, ErrorSurface and ErrorNotificationSystem reviewed; other surfaces remain |
| `frontend/src/shared/components/IconBar` | 1 | 115 | — / — | Inventoried |
| `frontend/src/shared/components/icons` | 9 | 2018 | — / — | Inventoried |
| `frontend/src/shared/components/inputs` | 1 | 84 | — / — | Inventoried |
| `frontend/src/shared/components/kubernetes` | 5 | 413 | — / — | Inventoried |
| `frontend/src/shared/components/modals` | 14 | 2617 | — / — | Inventoried |
| `frontend/src/shared/components/status` | 2 | 233 | — / — | Inventoried |
| `frontend/src/shared/components/tables` | 79 | 14583 | — / 25 | S001 catch-up: shared-table production responsibilities reviewed; C2 deferred |
| `frontend/src/shared/components/tabs` | 9 | 1470 | — / — | Inventoried |
| `frontend/src/shared/components/yaml` | 3 | 807 | — / 2 | Inventoried |
| `frontend/src/shared/constants` | 2 | 139 | — / — | Inventoried |
| `frontend/src/shared/events` | 4 | 532 | — / — | Inventoried |
| `frontend/src/shared/hooks` | 9 | 1969 | — / 1 | Partial S008: object action permission/navigation/default-handler composition inspected; other hooks remain |
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
| `frontend/src/utils` | 14 | 1803 | — / 3 | Partial S011: errorHandler category presentation consolidated; other utilities remain |
| `frontend/styles` | 29 | 5412 | — / — | Inventoried |
| `internal/appstate` | 1 | 45 | — / — | Inventoried |
| `internal/appwindow` | 19 | 3689 | — / — | Inventoried |
| `internal/bootstrap` | 2 | 200 | — / — | Inventoried |
| `internal/panelwindow` | 8 | 1009 | — / — | Inventoried |
| `internal/sentry` | 6 | 1477 | 1 / — | Partial S011: reporter/privacy reviewed; session resets consolidated; operation schema remains |
| `internal/updateconformance` | 3 | 286 | 2 / — | Inventoried |
| `internal/updateidentity` | 8 | 686 | — / — | Inventoried |
| `internal/updatestate` | 3 | 780 | 3 / — | Inventoried |
| `internal/updatetemp` | 4 | 506 | 2 / — | Inventoried |
| `internal/windowsinstall` | 3 | 104 | — / — | Inventoried |
| `main.go` | 1 | 14 | — / — | Inventoried |

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
