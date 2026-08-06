# Plan: Go S3776 Remediation

Prepared 2026-08-05 from SonarQube Cloud analysis at
`2026-08-05T21:46:23Z` and repository revision
`a271cf66d09d025818a7e45416d807b55a882d9d`.

## Goal

Reduce every open `go:S3776` finding to the configured maximum cognitive
complexity of 15 without changing user-visible behavior, weakening
cluster/object identity, or disturbing refresh, permission, lifecycle, and
cleanup ordering. Every remediation change must leave its behavior easier to
state, test, and review; lowering a score by merely relocating branches is not
success.

The prevention controls already accepted by the maintainer are treated as the
baseline for this plan. This plan covers only the remaining remediation work
and the per-change safety loop.

## Target model

- An orchestration function reads as a short sequence of named domain stages.
- Pure decisions are separated from I/O, mutation, concurrency, and event
  emission so they can be tested directly.
- Stateful operations use typed intermediate results or explicit transitions;
  callers do not infer partially completed state from nullable fields or
  loosely related booleans.
- Error, cancellation, permission-denied, teardown, and partial-result behavior
  remain explicit at the owning boundary.
- All boundary-crossing Kubernetes references retain `clusterId`, group,
  version, kind, namespace, and name as applicable.
- Each merged remediation reduces the Sonar issue count and never increases
  another affected function's complexity.

## Non-goals

- No rule suppression, false-positive marking, threshold increase, or source
  exclusion to make the inventory smaller.
- No behavior or appearance changes bundled into complexity refactors.
- No broad subsystem rewrites, compatibility layers, new framework, or
  dependency replacement.
- No arbitrary helper extraction whose only purpose is to move branches out of
  the reported function.
- No revival of settled/dismissed architecture proposals such as snapshot
  engine consolidation, one global cancellation hub, or permission-cache
  unification.
- No generated-source edits.

## Baseline inventory

SonarQube Cloud reports 48 open findings across 36 files. The reported
complexities sum to 2,094, which is 1,374 points above the permitted aggregate
for those functions.

| Complexity | Finding count |
|---:|---:|
| 16-20 | 6 |
| 21-30 | 2 |
| 31-50 | 28 |
| 51-75 | 7 |
| Above 75 | 5 |

Inventory maintenance rules:

- Function identity, not the reported line number, owns a work item because
  line numbers will move during refactoring.
- Refresh the Sonar inventory after every merged batch and update this plan.
- A finding removed by deletion or exclusion does not count as remediated
  unless the owning behavior is intentionally removed and its consumers prove
  that contract change.
- Newly reported findings are added to the earliest applicable phase and must
  not be deferred behind the historical backlog.

## Safety loop for every finding

Each finding follows this checklist. High-risk functions use a separate
test-hardening PR before their production refactor.

- [ ] Record the current Sonar score, local score if available, function
      coverage, callers, inputs, outputs, side effects, and owning docs.
- [ ] Identify failure, cancellation, permission, cleanup, ordering, and
      cluster/object-identity invariants before editing.
- [ ] Identify every producer and affected consumer when the function crosses a
      refresh, lifecycle, permission, cache/stream, or backend/frontend
      boundary; document readiness ordering and circular-dependency risk in the
      PR description.
- [ ] Add missing characterization tests against the current behavior and run
      them green. A pure refactor has no intended red phase.
- [ ] If a behavior defect is discovered, stop the refactor and fix the defect
      separately with a failing test first.
- [ ] Refactor one responsibility at a time, rerunning the focused test after
      each extraction or control-flow change.
- [ ] Prefer guard clauses, typed stage results, pure decision functions, and
      explicit transition/command values. Preserve effects at their owning
      boundary.
- [ ] Reject helpers that still require the caller and helper to be read
      together to understand one decision.
- [ ] Run focused package tests and `-race` for goroutine, channel, mutex,
      informer, stream, retry, or lifecycle changes.
- [ ] Measure directly affected statement coverage. Reach 80% or report the
      measured gap and pause for maintainer guidance.
- [ ] Run `mise exec -- mage qc:prerelease` on the latest worktree and inspect
      the worktree afterward for formatter changes.
- [ ] Wait for Sonar analysis; confirm the target issue closed, no new S3776
      issue appeared, and no grandfathered score increased.
- [ ] Update this plan's inventory and checkboxes only after those results are
      visible.

## PR boundaries

- One PR owns one runtime contract and normally one to three findings.
- Test-hardening-only PRs are encouraged for concurrency, lifecycle, stream,
  permission, and cache code.
- Do not combine changes merely because the functions share a Sonar rule.
- Do not combine behavior fixes with S3776 refactors.
- A wave is complete only after all its PRs have landed and a fresh main-branch
  Sonar analysis confirms the expected reduction.

---

## Phase 1: Remove the nine recent regressions

**Outcome:** the findings introduced by the Sentry and forbidden-permission
work are removed while their design context is recent. Split this phase into
telemetry/privacy, settings, auth, and resource-stream PRs; do not make it one
nine-function sweep.

### 1A. Telemetry, privacy, and logging

- [ ] 37 — `addKubernetesStatusTags`, `internal/sentry/reporter.go`.
- [ ] 33 — `(*sentryReporter).withHub`, `internal/sentry/reporter.go`.
- [ ] 23 — `telemetryReplacements`, `internal/sentry/privacy.go`.
- [ ] 21 — `sanitizeOperationTelemetryContext`,
      `internal/sentry/operation.go`.
- [ ] 19 — `(*Logger).log`, `backend/logger.go`.
- [ ] 16 — `prepareEventForSend`, `internal/sentry/privacy.go`.

Required characterization:

- nil and partially populated events/hints;
- Kubernetes status forms, wrapped errors, and non-status errors;
- privacy replacement precedence and mutation/copy behavior;
- disabled reporter, missing hub, panic containment, and capture callback
  behavior;
- structured fields, cluster metadata, source metadata, and log level parity.

Likely seams: classify/extract status facts as a pure result, separate privacy
replacement discovery from application, separate logger field assembly from
dispatch, and make hub acquisition/capture lifecycle explicit. Keep the
durable contract aligned with `docs/architecture/error-reporting.md`.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Characterized private cluster/resource tag extraction, typed Kubernetes
      status replacement, nil inputs, fallback aliases, private-tag removal,
      and replacement application across event text, exceptions, threads,
      breadcrumbs, tags, and contexts.
- [x] Split `telemetryReplacements` into ordered tag extraction and typed
      Kubernetes-status classification while preserving cluster-first
      replacement discovery.
- [x] Reduced `prepareEventForSend` to the ordered privacy pipeline used as the
      reporter's `BeforeSend` hook; event-surface mutation now lives in bounded
      policy helpers.
- [x] Characterized capability-batch sanitization for both supported serialized
      slice shapes, invalid counts and entries, field allowlisting, and
      source-map non-mutation.
- [x] Reduced `sanitizeOperationTelemetryContext` to a type dispatcher backed
      by bounded request decoding, count validation, check extraction, and batch
      reconstruction stages.
- [x] Characterized nil/non-status inputs, wrapped status errors, name-only
      details, all optional status facts, invalid cause reasons and fields, and
      the privacy-only resource-name tag.
- [x] Reduced `addKubernetesStatusTags` to status-fact extraction followed by
      one Sentry scope application; status details and causes now have bounded
      sanitization stages.
- [x] Characterized disabled capture, isolated hub cloning, lifecycle read-lock
      protection during callbacks, and lock release with panic propagation.
- [x] Reduced `(*sentryReporter).withHub` to the ordered capture lifecycle;
      operation correlation, breadcrumb projection, scope tags, and structured
      error context now have bounded stages.
- [x] Characterized nil loggers, bounded source metadata, debug/warn/unknown
      level parity, error-capture suppression, structured cause and panic
      routing, operation identity, buffer trimming, event emission, and Sentry
      frame grouping.
- [x] Reduced `(*Logger).log` to entry recording followed by unlocked event and
      reporter dispatch; entry construction, bounded storage, breadcrumb data,
      and error routing now have bounded stages.
- [x] Focused package tests and `-race` pass. `telemetryReplacements`,
      `sanitizeOperationTelemetryContext`, `addKubernetesStatusTags`,
      `(*sentryReporter).withHub`, `(*Logger).log`, and every new logger helper
      are 100.0%; `prepareEventForSend` is 92.3%.
- [x] The repository backend coverage task passes and records 88.7% statement
      coverage for `internal/sentry` and 76.7% for `backend`; directly affected
      logger coverage is 100.0%.
- [x] `gocognit` v1.2.1 measures the six refactored functions at 2, 1, 2, 2,
      1, and 1 respectively on the current worktree; no function in the four
      affected source files exceeds the configured limit of 15.
- [x] The full `mage qc:prerelease` gate passes on the refactored source.
- [x] SonarCloud's 2026-08-06 analysis of PR #282 at `003321e4` reports zero
      S3776 issues and zero code smells for the five refactors currently pushed.
- [ ] Confirm all six findings close in the next Sonar analysis without
      creating or increasing another S3776 finding; keep the target boxes above
      open until that evidence exists.

### 1B. Settings side effects

- [ ] 17 — `(*App).applySettingsSideEffects`, `backend/app_settings.go`.

Required characterization: each effect flag independently, combined flags,
nil reporter, reporter failure, disabled/enabled transitions, registration
scheduling, limiter absence, and per-cluster metrics retiming. Likely seam:
one stage per side-effect family, driven by the already prepared effect set;
do not create new preference-specific mutation paths.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Characterized missing and failing reporters, enabled/disabled transitions,
      registration scheduling, all five combined effect flags, lazy global
      limiter creation, persistence-before-dispatch, and live metrics retiming
      across valid, nil, and partially constructed cluster subsystems.
- [x] Reduced `(*App).applySettingsSideEffects` to one ordered dispatch call per
      effect family; reporter, rate-limit, per-scope/global log-limit, and
      metrics-retiming policy now live in bounded stages.
- [x] Focused tests and `-race` pass; the dispatcher and all six extracted
      stages have 100.0% statement coverage.
- [x] The repository backend coverage task passes and records 76.8% statement
      coverage for `backend`.
- [x] `gocognit` v1.2.1 measures `(*App).applySettingsSideEffects` at 0, with
      the most complex extracted stage at 4.
- [x] The full `mage qc:prerelease` gate passes on the refactored source.
- [ ] Confirm the finding closes in the next Sonar analysis without creating
      or increasing another S3776 finding; keep the target box above open until
      that evidence exists.

### 1C. Cluster auth event handling

- [ ] 17 — `(*App).handleClusterAuthStateChange`,
      `backend/cluster_auth.go`.

Required characterization: valid/recovering/invalid transitions, cause/no-cause
diagnostics, selected and background clusters, event payload identity, and the
rule that heavy rebuild/teardown work does not run under the auth-manager
mutex. Likely seam: state-specific command construction with one asynchronous
dispatch boundary. Keep `docs/architecture/auth.md` authoritative.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Traced the per-cluster auth-manager callback, lifecycle state, Wails
      auth-event consumers, and refresh pause/resume consumers; every affected
      event and mutation remains keyed by the callback's `clusterId`.
- [x] Characterized valid, recovering, invalid-with-cause, and
      invalid-without-cause transitions; full diagnostic payload identity;
      foreground/background isolation; unknown states; and lifecycle state.
- [x] Proved through the real auth-manager callback that a recovering
      transition returns while the coordinated selection boundary is blocked,
      keeping teardown/rebuild work outside the manager-held mutex.
- [x] Reduced `(*App).handleClusterAuthStateChange` to command construction and
      four ordered applications: reporting, event emission, lifecycle state,
      and one asynchronous mutation dispatch boundary.
- [x] Focused tests and `-race` pass; the handler and all seven extracted
      command/reporting/lifecycle/dispatch helpers have 100.0% statement
      coverage.
- [x] The repository backend coverage task passes and records 76.9% statement
      coverage for `backend`; the directly affected 1C coverage is 100.0%.
- [x] `gocognit` v1.2.1 measures
      `(*App).handleClusterAuthStateChange` at 3, with the most complex
      extracted helper at 2.
- [x] The full `mage qc:prerelease` gate passes on the refactored source.
- [ ] Confirm the finding closes in the next Sonar analysis without creating
      or increasing another S3776 finding; keep the target box above open until
      that evidence exists.

### 1D. Custom resource informer eligibility

- [ ] 17 — `(*Manager).ensureCustomInformer`,
      `backend/refresh/resourcestream/manager.go`.

Required characterization: namespaced and cluster-scoped CRDs, exact namespace
permission checks, all-denied behavior, reuse versus replacement, no duplicate
informers, and cleanup. Likely seam: pure desired-informer specification
followed by one reconcile/apply stage. Preserve full GVR and cluster scope.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Traced CRD add/update/delete events through the per-cluster dynamic
      client, exact namespace permission checks, namespace/cluster custom stream
      selectors, and terminal manager teardown.
- [x] Characterized restricted and all-namespace namespaced CRDs,
      cluster-scoped CRDs, exact permission targets, partial permission success,
      all-denied removal, incomplete and unknown CRD definitions, identical
      informer reuse, changed-spec replacement, duplicate prevention, event
      mapping, cleanup, and the stopped-manager gate.
- [x] Reduced `(*Manager).ensureCustomInformer` to desired-plan construction,
      exact permission filtering, and one apply call; replacement, map insertion,
      and the terminal stopped check remain inside one `customInformerMu`
      reconcile boundary before informer goroutines start.
- [x] Focused package tests and `-race` pass; the handler and every extracted
      plan/scope/permission/reconcile/construction/event/cleanup helper have
      100.0% statement coverage.
- [x] The repository backend coverage task passes and records 66.6% statement
      coverage for `backend/refresh/resourcestream` and 76.9% for `backend`;
      directly affected 1D coverage is 100.0%.
- [x] `gocognit` v1.2.1 measures `(*Manager).ensureCustomInformer` at 2,
      with the most complex extracted helper at 5.
- [x] The full `mage qc:prerelease` gate passes on the refactored source.
- [ ] Confirm the finding closes in the next Sonar analysis without creating
      or increasing another S3776 finding; keep the target box above open until
      that evidence exists.

---

## Phase 2: Deterministic transformations and projections

**Outcome:** remove eight findings whose core work can be expressed as pure or
request-shaped transformations, establishing small refactoring patterns before
touching concurrent subsystems.

- [ ] 56 — `calculatePodResources`, `backend/resources/pods/helpers.go`.
- [ ] 50 — `buildContainerDetails`, `backend/resources/pods/helpers.go`.
- [ ] 50 — `DescribeContainers`,
      `backend/resources/workloads/helpers.go`.
- [ ] 43 — `normalizeSettingsFile`, `backend/app_settings.go`.
- [ ] 43 — `(*Service).extractResourcesFromManifest`,
      `backend/resources/helm/helm_releases.go`.
- [ ] 37 — `(*Service).buildNodeDetails`,
      `backend/resources/nodes/nodes.go`.
- [ ] 35 — `isRetryableFetchError`, `backend/fetch_helpers.go`.
- [ ] 31 — `(*Service).processPersistentVolumeDetails`,
      `backend/resources/persistentvolume/details.go`.

Required characterization:

- table-driven fixtures for every resource/status/quantity variant;
- stable ordering, nil/empty inputs, defaults, and unknown enum values;
- init and sidecar containers, missing statuses, requests versus limits, and
  restart state;
- multi-document Helm YAML, default namespaces, hooks, invalid documents, and
  identity preservation;
- retry classification for cancellation, authorization, transient transport,
  Kubernetes status, and permanent errors;
- settings normalization idempotence and complete default coverage.

Refactoring direction: introduce small typed accumulators and per-concern pure
functions; avoid parallel resource-kind switch tables. Shared Kubernetes
semantics still belong in `backend/resourcemodel`, not duplicated helpers.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Characterized pod resource aggregation across regular, init, and
      restartable init/sidecar containers; missing quantities; requests versus
      limits; missing/running/waiting/terminated statuses; restart data; and
      stable container ports, mounts, and environment projections.
- [x] Reduced `calculatePodResources` to a typed per-dimension accumulator and
      reduced `buildContainerDetails` and `DescribeContainers` to ordered
      per-concern projections while preserving nil slices, ordering, defaults,
      and each projection's existing environment and mount semantics.
- [x] Characterized settings normalization for complete and partially present
      defaults, explicit false values, bounds, legacy palette migration, theme
      ordering/deduplication, pointer identity, and repeated-call idempotence.
- [x] Reduced `normalizeSettingsFile` to ordered metadata, core preference,
      refresh, Kubernetes API, log, layout, palette, kubeconfig, and theme
      normalization stages.
- [x] Characterized exact retry decisions and reason precedence for nil,
      cancellation, deadlines, network and URL failures, EOF, transient text,
      Kubernetes timeouts, rate limits, 5xx responses, authorization failures,
      not-found responses, and permanent errors.
- [x] Reduced `isRetryableFetchError` to ordered transport-text and Kubernetes
      classifiers without changing retry precedence.
- [x] Characterized Helm multi-document parsing, invalid documents, List item
      API-version inheritance, hooks, namespace fallback, stable deduplication,
      cluster scope, colliding CRD GVKs, and full cluster/GVK/name link identity.
- [x] Reduced `(*Service).extractResourcesFromManifest` to a typed,
      order-preserving manifest accumulator backed by the shared resource-model
      identity resolver.
- [x] Characterized Node detail projection for every pod phase, missing and
      partial CPU/memory quantities, capacity/allocatable/usage values,
      conditions, taints, addresses, restart totals, ordering, and empty pods.
- [x] Characterized PersistentVolume defaults, access-mode ordering and unknown
      values, claim state, affinity and condition ordering, and every supported
      volume-source projection plus the unknown fallback.
- [x] Reduced `(*Service).buildNodeDetails` to a typed pod/resource projection
      and reduced `(*Service).processPersistentVolumeDetails` to per-concern
      pure projections with one volume-source dispatch boundary.
- [x] Focused tests and `-race` pass for `backend`, pods, workloads, Helm,
      Nodes, and PersistentVolumes. All eight target functions and their newly
      introduced projection/classification helpers have 100.0% directly
      affected statement coverage.
- [x] The repository backend coverage task passes and records 77.0% statement
      coverage for `backend`; the directly affected Phase 2 coverage is 100.0%.
- [x] `gocognit` v1.2.1 measures the eight targets, in inventory order, at 2,
      0, 1, 1, 3, 1, 7, and 0 respectively. No newly introduced helper exceeds
      the configured limit of 15.
- [x] The full `mage qc:prerelease` gate passes on the latest Phase 2 worktree.
- [ ] Confirm all eight findings close in the next Sonar analysis without
      creating or increasing another S3776 finding; keep the target boxes above
      open until that evidence exists.

---

## Phase 3: Harden tests for high-risk orchestration

**Outcome:** the riskiest later refactors have contract tests that would catch
lost cancellation, cleanup, ordering, permissions, identity, and partial
results before production code moves.

Measured function coverage on the baseline revision includes:

- `Handler.ServeHTTP`: 56.9%;
- `Streamer.run`: 47.9%;
- `Streamer.followContainer`: 78.1%;
- `ClusterCustomBuilder.Build`: 64.0%;
- `NamespaceCustomBuilder.Build`: 73.1%;
- `Service.evaluateDescriptorsBatch`: 50.8%;
- `objectcatalog.Service.sync`: 79.1%;
- `capabilities.Service.Evaluate`: 92.9%.

- [x] Add handler tests for parse/validation failures, CORS on every early
      response, permission denial, limiter denial, client disconnect,
      heartbeat timeout, partial target errors, warning changes, and final
      event ordering.
- [x] Add streamer tests for cancellation before and after startup, watch
      restart, backoff interruption, channel closure, slow consumers, dropped
      entries, container restart, partial target loss, and cleanup exactly
      once.
- [x] Add custom snapshot tests for empty/denied/partial discovery, namespace
      fan-out, duplicate identities, stale catalog metadata, and cluster
      isolation.
- [x] Add descriptor-batch tests for cancellation, worker failure, partial
      results, stable index association, and permission-client recovery.
- [x] Add cluster-client/kubeconfig tests for concurrent selection changes,
      stale generations, selected/background clusters, and teardown/rebuild
      ordering.
- [x] Run each affected package with `-race` and record directly affected
      coverage. Do not begin its production refactor below 80% without explicit
      maintainer guidance.

This phase is test-only unless a test exposes a real defect; any defect becomes
a separate red/green change.

Local progress through 2026-08-06:

- [x] Handler contracts cover every early CORS response, malformed scope and
      unsupported transport handling, initial and follow permission failures,
      limiter denial/rebalance and warning clearing, partial target tails,
      disconnect flushes, slow-consumer drops, deterministic write failures,
      heartbeat-timeout classification, and monotonic connected/snapshot/data/
      error event sequences.
- [x] Streamer contracts cover pre-start and active cancellation, closed-watch
      restart, interruptible reconnect backoff, closed and irrelevant watch
      events, limiter notification, container loss and restart, pre-cancelled
      followers, transient and terminal failures, filtering, slow consumers,
      both drop-accounting paths, and exactly-once stream close.
- [x] Custom snapshot contracts cover missing dependencies, empty discovery,
      forbidden resources, partial results with stale CRD metadata, scoped
      namespace fan-out, first-class exclusions, colliding Kind/name identities
      across API groups, complete resource identity, and per-cluster metadata.
- [x] Descriptor-batch contracts cover empty/nil services, cancellation,
      namespace fan-out, definitive-answer precedence, stable input indexes,
      partial worker failures, joined descriptor errors, and permission-client
      recovery. Empty object-catalog discovery is also characterized as a
      healthy empty publication.
- [x] Existing selection/lifecycle contracts cover rapid concurrent selection
      churn, stale-generation preemption, selected/background-cluster isolation,
      cluster-scoped cleanup, cold-plan publication before teardown, and stopping
      the previous subsystem before a replacement is installed. The focused
      lifecycle race suite passes.
- [x] Directly affected function coverage, in baseline order, is 83.3%, 82.2%,
      87.7%, 81.4%, 91.4%, 95.4%, 83.7%, and 92.9%. Every target is above the
      80% production-refactor gate.
- [x] Full `-race` package runs pass for container-log streaming, snapshots,
      object catalog, and capabilities; focused backend lifecycle race runs
      pass. Phase 3 changed tests and this plan only; no production defect was
      exposed.
- [x] The repository backend coverage task passes and records 77.0% statement
      coverage for `backend`; the eight directly affected functions are all
      above the Phase 3 80% gate.
- [x] The full `mage qc:prerelease` gate passes on the latest Phase 3 code and
      test worktree.
- [x] `gocognit` v1.2.1 reports no newly added Phase 3 test function above the
      configured complexity limit of 15; its only changed-file findings are
      three pre-existing tests.

---

## Phase 4: Query, catalog, and capability orchestration

**Outcome:** separate normalization, permission evaluation, query execution,
pagination, and publication without changing catalog ownership or query
semantics.

- [ ] 85 — `(*objectcatalog.Service).sync`,
      `backend/objectcatalog/sync.go`.
- [ ] 75 — `(*capabilities.Service).Evaluate`,
      `backend/capabilities/service.go`.
- [ ] 58 — `(*objectcatalog.Service).evaluateDescriptorsBatch`,
      `backend/objectcatalog/sync.go`.
- [ ] 50 — `(*querypage.Store).scopeMatchesBase`,
      `backend/refresh/querypage/store.go`.
- [ ] 46 — `DiscoverGVRByKind`, `backend/resources/common/discover.go`.
- [ ] 39 — `(*App).GetCatalogDiagnostics`,
      `backend/app_object_catalog.go`.
- [ ] 39 — `(*fieldCodec).grow`,
      `backend/refresh/querypage/columnar.go`.
- [ ] 34 — `catalogEngineFacets`,
      `backend/objectcatalog/query_engine.go`.
- [ ] 31 — `(*querypage.Store).Query`,
      `backend/refresh/querypage/store.go`.

Required contracts:

- the object catalog remains the sole owner of existence, discovery, and
  GVK/GVR identity;
- descriptor results retain stable association with their input index;
- cancellation stops new work and does not publish a partial catalog as a
  successful full sync;
- query filters, sort, anchor, pagination, totals, and facet results remain
  identical for empty, narrow, broad, and malformed requests;
- codec growth preserves every existing encoded value and null state;
- diagnostics stay cluster-scoped and describe the same snapshot generation.

Likely seams: preflight/evaluate/summarize/publish stages for catalog sync;
bounded-worker orchestration separated from one capability review; normalized
query plan separated from row matching and page materialization; typed grow
operations per column encoding. Do not introduce a second query engine or
identity resolver.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Traced catalog discovery, capability preflight, cache readiness,
      collection, streaming publication, maintained-query execution, kind-only
      compatibility discovery, and aggregate diagnostics through their owning
      architecture contracts. The object catalog remains the only discovery
      and identity owner; no second resolver or query engine was introduced.
- [x] Characterized descriptor index association, partial capability answers,
      maintained facet intersections, kind/singular/plural discovery matching,
      partial discovery results, CRD storage-version fallback, codec arena
      growth, pointer null state, and diagnostics merge precedence.
- [x] Added a failing cancellation-during-collection test that proved `sync`
      returned success after a canceled list. The red/green fix now returns the
      cancellation, records failed health/telemetry, publishes readiness false,
      and prevents newly scheduled collectors from beginning work after their
      context is canceled.
- [x] Reduced catalog sync to explicit discover, prepare, cache-wait, collect,
      reconcile, publish, and completion stages. Batch RBAC planning and result
      summarization retain positional descriptor indexes and definitive
      per-namespace answers still outrank sibling errors.
- [x] Reduced capability evaluation to batch orchestration around one review,
      failure aggregation, scope metrics, and final reporting while preserving
      caller-supplied result order, rate limiting, retries, and partial results.
- [x] Separated query facet matching, search matching, cursor normalization,
      index walking, row materialization, cursor construction, maintained facet
      collection, and typed codec-column growth. Existing empty, filtered,
      malformed-cursor, forward/backward, anchor, total, facet, promotion, and
      map-oracle tests remain green.
- [x] Separated kind-only discovery into preferred/fallback resource-list
      selection, top-level resource matching, and CRD fallback without changing
      its documented first-match compatibility behavior. Direct coverage for
      `DiscoverGVRByKind` increased from 0.0% to 100.0%.
- [x] Separated diagnostics telemetry projection, domain aggregation, single
      catalog health selection, and missing-field merge. Multi-catalog state
      still refuses to imply a preferred cluster, and all values come from one
      `SnapshotSummary` generation.
- [x] Direct target coverage in inventory order is 100.0%, 82.4%, 100.0%,
      83.3%, 100.0%, 81.8%, 100.0%, 84.6%, and 100.0%. Every extracted Phase 4
      seam is at least 80% covered; the broad `backend` package remains 77.1%.
- [x] Full `-race` runs pass for object catalog, capabilities, querypage, common
      discovery, and focused diagnostics. The repository backend coverage task
      and the full `mage qc:prerelease` gate pass on the formatted worktree;
      frontend validation covers 459 files and 3,956 tests, and Trivy reports
      zero dependency vulnerabilities.
- [x] `gocognit` v1.2.1 measures the nine targets, in inventory order, at 3, 5,
      6, 5, 3, 2, 1, 6, and 1. The most complex newly introduced production
      helper is 12, below the configured limit of 15; no new test exceeds 15.
- [ ] Confirm all nine findings close in the next Sonar analysis without
      creating or increasing another S3776 finding; keep the target boxes above
      open until that evidence exists.

---

## Phase 5: Refresh snapshots, registration, and graph construction

**Outcome:** reduce snapshot and refresh complexity while preserving producer
ordering, readiness, permission gates, cache behavior, stream signals, and
cluster-scoped identity.

- [ ] 71 — `(*ClusterCustomBuilder).Build`,
      `backend/refresh/snapshot/cluster_custom.go`.
- [ ] 66 — `(*NamespaceCustomBuilder).Build`,
      `backend/refresh/snapshot/namespace_custom.go`.
- [ ] 44 — `(*objectMapIndex).buildNamespaceGraph`,
      `backend/refresh/snapshot/object_map.go`.
- [ ] 41 — `(*NamespaceChangeNotifier).flush`,
      `backend/refresh/snapshot/namespace_notifier.go`.
- [ ] 41 — `runDomainRegistrations`,
      `backend/refresh/system/registrations.go`.
- [ ] 40 — `(*App).updateRefreshSubsystemSelections`,
      `backend/app_refresh_update.go`.
- [ ] 40 — `(*objectMapIndex).traverseObjectMapDirection`,
      `backend/refresh/snapshot/object_map.go`.
- [ ] 38 — `buildClusterOverviewSnapshot`,
      `backend/refresh/snapshot/cluster_overview.go`.
- [ ] 33 — `(*clusterAttentionIndex).replaceSource`,
      `backend/refresh/snapshot/cluster_attention.go`.
- [ ] 31 — `(*ClusterOverviewListBuilder).Build`,
      `backend/refresh/snapshot/cluster_overview.go`.
- [ ] 31 — `(*snapshot.Service).BuildRequest`,
      `backend/refresh/snapshot/service.go`.
- [ ] 16 — `RegisterNamespaceDomain`,
      `backend/refresh/snapshot/namespaces.go`.

Before each PR, record the producer, every affected consumer, readiness
ordering, permission decision source, refresh signal/fallback, cache key, and
teardown owner. Tests must prove both halves of every gate: invalid early state
is blocked and the operation needed to reach ready state remains allowed.

Required scenarios:

- loading, permission-denied, empty, partial, populated, and recovery states;
- two clusters with overlapping namespaces and resource names;
- catalog not ready versus ready, informer not synced versus synced;
- namespace list denial without catalog-inference fallback;
- object-map traversal cycles, missing endpoints, node limits, both directions,
  and complete object identity;
- notifier coalescing, shutdown, late events, and no post-stop callback;
- selection replacement, rollback on failure, and no stale subsystem retained;
- cache hit/miss/bypass, singleflight behavior, source-version finalization,
  and telemetry parity.

Likely seams: gather/validate/project stages in builders; pure graph-neighbor
selection separated from traversal; registration specification separated from
ordered execution; desired selection diff separated from apply/rollback. Keep
`docs/architecture/data-freshness.md`, `refresh-system.md`, `permissions.md`,
`multi-cluster.md`, and `docs/workflows/object-map.md` authoritative.

Local progress through 2026-08-06 (Sonar confirmation pending):

- [x] Traced custom-resource discovery, snapshot readiness and cache ordering,
      namespace doorbells, ordered registration gates, object-map traversal,
      attention-source replacement, selection churn, and teardown through the
      owning refresh, object-map, and multi-cluster contracts.
- [x] Split both custom-resource builders into discovery, bounded per-CRD
      collection, synchronized aggregation, deterministic sorting, and final
      snapshot stages while preserving partial-result and warning behavior.
- [x] Split namespace graph construction into sorted seed collection,
      cluster-scoped endpoint expansion, and edge projection. Directional
      traversal now owns direction filtering, reverse policy, node admission,
      depth updates, and queueing through explicit traversal state.
- [x] Split namespace notification into locked flush capture, workload/event/
      quota signature evaluation, broadcast, and rearm stages. A failing test
      proved `Stop` could return while a callback was active; the notifier now
      waits for active flushes and rejects late events, so no callback runs
      after `Stop` returns.
- [x] Split registration into skip/require, runtime permission, registration-
      kind validation, and ordered dispatch stages. Split selection updates
      into desired-plan, build/rollback, aggregate publication, catalog start,
      and removed-subsystem teardown without dropping auth-failed clusters
      from aggregate order.
- [x] Split overview list acquisition from typed pod/node projection and
      overview accumulation; split attention replacement into locked upsert,
      removal, ignore pruning, and post-lock callbacks; split snapshot requests
      into permission/readiness preflight, cache/singleflight planning, build,
      finalization, telemetry, and cache publication.
- [x] `RegisterNamespaceDomain` already measured at the configured limit, so
      its production code was left unchanged. Scoped/unscoped registration,
      workload/quota sinks, and namespace/event add-update-delete handlers are
      now characterized directly.
- [x] Direct target coverage in inventory order is 85.7%, 88.9%, 100.0%,
      100.0%, 85.7%, 84.6%, 100.0%, 100.0%, 82.4%, 81.8%, 100.0%, and
      88.2%. The repository backend coverage task passes with 81.6% for
      `backend/refresh/snapshot`, 75.5% for `backend/refresh/system`, and 77.1%
      for `backend`.
- [x] Full latest-worktree `-race` runs pass for `backend/refresh/snapshot`,
      `backend/refresh/system`, and `backend`. The full `mage qc:prerelease`
      gate passes; frontend validation covers 459 files and 3,956 tests, and
      Trivy reports zero dependency vulnerabilities.
- [x] `gocognit` v1.2.1 measures the twelve targets, in inventory order, at 4,
      5, 1, 4, 4, 5, 5, 3, 4, 2, 3, and 15. No function in the affected
      production files exceeds 15, and the most complex newly introduced
      helper is 8.
- [ ] Confirm all twelve findings close in the next Sonar analysis without
      creating or increasing another S3776 finding; keep the target boxes above
      open until that evidence exists.

---

## Phase 6: Streaming, retry, object actions, and cluster lifecycle

**Outcome:** remove the ten highest-risk findings after Phase 3 establishes
their safety net. Split container-log handler, limiter, streamer, fetch/action,
and cluster-lifecycle work into separate PRs.

### 6A. Container-log HTTP and allocation

- [ ] 113 — `(*containerlogsstream.Handler).ServeHTTP`,
      `backend/refresh/containerlogsstream/handler.go`.
- [ ] 42 — `(*GlobalTargetLimiter).allocateLocked`,
      `backend/refresh/containerlogsstream/limiter.go`.

Target structure for the handler: parse request, resolve/authorize target,
acquire limits, start stream, forward protocol events, finalize. Each stage
returns a typed result; the outer handler owns HTTP/SSE writes and cleanup.
The limiter should separate desired allocation calculation from locked state
application and notification. Preserve fairness, stable allocation, and no
callbacks while internal state is inconsistent.

### 6B. Container-log streaming lifecycle

- [ ] 86 — `(*Streamer).followContainer`,
      `backend/refresh/containerlogsstream/streamer.go`.
- [ ] 80 — `(*Streamer).run`,
      `backend/refresh/containerlogsstream/streamer.go`.
- [ ] 31 — `(*Streamer).tail`,
      `backend/refresh/containerlogsstream/streamer.go`.

Target structure: explicit target discovery, watch reconciliation, per-target
follow session, entry/error multiplexing, and termination decision. The outer
loop owns cancellation and channel lifetime; per-target workers do not close
shared channels. Validate with `-race` and the container-log workflow contract
in `docs/workflows/logs/container-logs.md`.

### 6C. Fetch and object-action orchestration

- [ ] 56 — `executeWithRetry`, `backend/fetch_helpers.go`.
- [ ] 31 — `(*App).RunObjectAction`, `backend/object_actions.go`.

Separate retry policy decisions from attempt execution and diagnostics. For
object actions, separate request validation, full identity/capability
resolution, dispatch, and response translation. Preserve `clusterId`, complete
GVK identity, namespace/name, permission denial diagnostics, cancellation, and
no retry of permanent authorization or validation failures.

### 6D. Cluster clients, kubeconfig, and auth rebuild

- [ ] 77 — `(*App).syncClusterClientPoolWithBuilder`,
      `backend/cluster_clients.go`.
- [ ] 52 — `(*App).handleKubeconfigChangeLocked`,
      `backend/kubeconfigs.go`.
- [ ] 32 — `(*App).rebuildClusterSubsystem`,
      `backend/cluster_auth.go`.

Target structure: calculate desired cluster/client transition under explicit
generation and identity, then apply ordered stop/build/swap/start commands with
rollback. Preserve selected/background cluster behavior, do not publish a
partially built subsystem, and do not run callbacks while selection/auth locks
are held. Keep `docs/architecture/auth.md` and `multi-cluster.md` authoritative.

---

## Validation by wave

For each completed wave:

- [ ] Focused tests for every touched package pass.
- [ ] Concurrent packages pass focused `go test -race`.
- [ ] Directly affected coverage is at least 80%, or the measured gap has been
      reported and explicitly accepted.
- [ ] `mise exec -- mage test:backendCoverage` records the repository coverage
      artifact for the latest worktree.
- [ ] `mise exec -- mage qc:prerelease` passes on the latest worktree.
- [ ] `git diff --check` passes.
- [ ] Main-branch Sonar analysis shows the expected issue-count reduction and
      no new/increased S3776 finding.
- [ ] Relevant loading, denial, empty, partial, populated, recovery, and
      interaction states are exercised through the standalone Wails UI when a
      refactor touches rendered behavior or a backend/frontend contract.
- [ ] Any newly clarified durable contract is moved into its owning
      architecture/workflow document or skill before this temporary plan is
      removed.

## Completion criteria

- Sonar reports zero open `go:S3776` findings on main.
- No suppressions, accepted issues, threshold changes, or exclusions were used
  to reach zero.
- Every affected package retains or improves its measured coverage.
- The prevention controls remain active and the baseline contains no
  grandfathered offender.
- Durable behavior discovered during the work is documented outside this
  temporary plan, after which this file can be deleted.

## Open questions

- Decide before Phase 6 whether the handler and streamer test-hardening work
  should be two PRs or one package-level test PR; recommendation: two, because
  HTTP protocol behavior and worker/channel lifecycle are separate contracts.
- Decide whether Sonar-only line moves should update this inventory after each
  PR; recommendation: keep function identity and score only, avoiding noisy
  line maintenance.
- If a directly affected function cannot reach 80% coverage without invasive
  dependency seams, stop and choose explicitly between adding the seam or
  accepting a measured exception; do not silently proceed.
