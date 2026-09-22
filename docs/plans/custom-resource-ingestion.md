# Custom-resource ingestion completion record

Status: implementation and automated gates passed; required rendered verification
is blocked. This record remains until the outstanding workflows below are checked.

## Delivered scope

- Removed the legacy `namespace-custom` / `cluster-custom` full-list refresh
  domains, exclusive snapshot builders, generated payloads and diagnostic entries.
  The existing catalog-backed views, navigation and table-persistence IDs remain.
- Moved dynamic LIST/WATCH lifecycle ownership into ingest. Runtime sources use
  the existing projected stores and permission-filtered namespace partitions.
  Removed stream-owned custom informers and the inbound stream-cache/catalog loop.
- Kept catalog discovery, identity, query publication, page/export hydration and
  the outbound catalog-to-stream notification bridge. Confirmed CRDs are watched
  independent of count where LIST/WATCH is permitted. Unclassified/non-CRD
  sources retain the existing 5,000-object promotion policy.
- Added source replacement by served version, scope and CRD UID; cancellation and
  join ordering; generation guards; detachable consumers; and cache invalidation
  before catalog notification. Pending and LIST-only partitions use bounded LIST
  collection, with previous rows retained on collection failure.

Durable guidance is captured in [catalog](../architecture/catalog.md),
[data layer](../architecture/data-layer.md),
[namespace scope](../architecture/namespace-scope.md),
[refresh system](../architecture/refresh-system.md) and
[large data producers](../architecture/large-data-producers.md).
Refresh/add-resource skill references were inspected for ownership changes.
No dependency or transport was added. No commit or PR was created.

## Acceptance evidence

| Workflow or contract | Status | Evidence and limits |
| --- | --- | --- |
| Retired domains rejected; Custom view persistence retained | Passed automated | `TestCustomTablesSubscribeThroughCatalogOnly` ran red before removal and green after; persistence-GC regression and surviving catalog view/export/hydration tests passed. Frontend view hooks use mocks; rendered checks remain below. |
| Production source → catalog → cache invalidation → stream notification, below promotion threshold | Passed automated and live backend | `TestCatalogCustomResourceWatchReconcilesTableMembership` uses real subsystem construction and state owners with fake Kubernetes clients. A temporary real-client probe passed external creation/update/completed deletion, finalizer retention and detail-cache eviction on two disposable Kind clusters. It did not render a frontend consumer. |
| Single dynamic watch owner | Passed automated | `TestSubsystemOwnsOneBelowThresholdCustomResourceWatch` counts fake-client API watches after production construction. No live watch-count or memory comparison was made. |
| Per-namespace LIST/WATCH, LIST-only and denied access | Passed automated and constrained live backend | Dynamic admission/catalog tests cover these partitions. Real restricted identity returned two authorized Widget rows; only `ingest-allowed` had a ready watch. `ingest-list-only` had LIST but no WATCH; `ingest-denied` contributed no row. See startup limitation below. |
| Unsynced dynamic source does not block readiness; first LIST includes it; timeout retains rows; recovery avoids duplication | Passed automated | `TestPendingDynamicSourceAllowsCatalogCollectionAndRecovery` uses real HTTP clients, ingest and catalog; red/green exposed and fixed empty all-namespace target normalization and timeout retention. Uses a 100 ms caller deadline, not a performance measurement of the production 30 s limit. |
| Served-version replacement, scope replacement, CRD deletion/new UID | Passed automated and live backend | Ingest lifecycle tests cover late events, unchanged specifications, incomplete definitions and static-source precedence. A real API-server probe changed v2 from served to unserved, observed v1 retain the object, deleted the CRD, then recreated its name with a new UID and cluster scope; the catalog published the replacement object. |
| New CRD discovered before periodic resync | Passed automated and live backend | `TestNewCRDAppearsWithoutWaitingForPeriodicCatalogRefresh`; live probe created a new RuntimeWidget definition while the catalog ran. |
| Publication bursts, callbacks during baseline, detach and terminal shutdown | Passed automated | Real ingest/catalog composition tests include a burst larger than 8,192 objects while publication is blocked, consumer detach/reattach, generation rejection and shutdown. Kubernetes API clients are fake in these regressions. |
| Non-CRD and LIST-only source policy | Passed automated | Collection/promotion and permission tests preserve the threshold policy. Real Kind discovery was captured; no aggregated extension API fixture was installed. |
| Cluster identity/isolation | Passed automated; rendered pending | Tests cover cluster identity and same-name object boundaries. Live backend probes ran against two distinct clusters sequentially; they do not prove simultaneous UI cluster switching. |
| Open Browse, cluster/namespace Custom and family views: rows, counts/facets, external mutations, detail/YAML | Blocked | Native Mac is locked. Vite browser URL cannot make Wails calls; supported server mode rejects `browser-1` as a non-live workspace. No UI behavior is claimed from backend probes. |
| Disconnect/reconnect and governor cooling/re-warm with these views | Pending runtime | Existing lifecycle/governor suites passed in the gate; the complete live consumer workflow remains unrun. |
| Saved settings, filtering/paging and export in the actual views | Blocked rendered | Surviving automated tests passed; same native/browser blockers. |

## Validation results

Phases 1, 2 and 3 each passed `mise exec -- wails3 task qc:prerelease` after
corrections. Phase 3 final log: `/tmp/custom-ingestion-phase3-gate.log`, exit 0,
including full Go race tests, 528 frontend files / 5,084 tests, generated bindings,
documentation, lint/typecheck, Knip and Trivy. Worktree formatting was inspected
and `git diff --check` passed. The final cleanup gate also passed, as recorded below.

Backend coverage passed (`/tmp/custom-ingestion-phase3-coverage.log`): catalog
89.5%, ingest 81.8%, system 80.4%. Stream tests alone cover 69.6%; instrumenting
real backend/subsystem construction and merging duplicate profile blocks by
source range gives ingest 88.5%, catalog 90.4%, stream 80.2%, system 88.6% and
snapshot 85.5% (`/tmp/custom-ingestion-merged.cover`). New dynamic lifecycle and
consumer files range from 84.9% to 100%.

Phase 1 frontend statement coverage: diagnostics 88.41%, stream-view mapping
95.23%, refresher types 100%; overall 89.77%. No before-pruning baseline was
measured for the removed exclusive snapshot tests. Surviving hydration conversion
and link-resolution functions measured 100% in the composition profile.

Changed Go production functions and new helpers score at most 12 with gocognit
v1.2.1. Existing unchanged `waitForIngest` and `parsePodSelector` score 13.
Changed frontend production files passed the local complexity check. Remote
Sonar is unrun: this work has no pushed revision or PR. Windows/Linux UI is unrun.
No memory, speed or live API-count improvement is claimed.

## Real-cluster probe and limitations

The temporary backend probe used real clients against task-owned Kind clusters
`codex-custom-ingestion` and `codex-custom-ingestion-b` (Kubernetes v1.37.0).
It constructed the production subsystem/catalog/cache/stream owners through an
existing backend test fixture. The app's native window and governor activation
were not part of that fixture. The final probe passed all three cases (two admin
contexts and restricted access), exit 0, in `/tmp/custom-ingestion-live-final.log`.
The temporary test was copied to `/tmp/custom-ingestion-live-test.go` and removed
from the repository after execution.

The initial restricted fixture denied built-in ReplicaSet, HPA and Event watches.
Its catalog never completed startup although the dynamic Widget partition was
ready (`/tmp/custom-ingestion-live-restricted.log`). Existing
`waitForCatalogInformerCaches` uses the raw shared factory's cache wait; that path
was unchanged by this refactor. Granting the disposable identity read/watch access
to those three baseline kinds allowed catalog startup and the custom-resource
permission checks to pass (`/tmp/custom-ingestion-live-restricted-with-baseline.log`).
This is a separate unresolved startup limitation, not evidence that arbitrary
restricted identities work. No production readiness workaround was added.

Native validation was attempted with the emitted `http://127.0.0.1:9245/` URL and
the supported server build at `http://localhost:8080/`. The computer-use tool
reported the Mac locked and automatic unlock failed; a manual unlock was
requested. Server mode reported `app window "browser-1" is not live`. Neither
attempt established the rendered workflows above.

## Remaining completion steps

1. Unlock the native Mac and run the blocked view workflows using disposable
   cluster fixtures; exercise simultaneous cluster switching, reconnection and
   cooling/re-warm. Keep the built-in restricted-startup limitation explicit.
2. Resolve any failures, rerun affected checks and the final repository gate.
3. Delete this temporary record after all required outcomes have evidence.
   Durable ownership guidance has already moved into the existing documents.

## Cleanup and final gate

Both task-owned Kind clusters were deleted. All three original application-state
files were restored byte-for-byte from the pre-run backup, with no new application
configuration files left over. Both app servers were stopped; process inspection
found no task-owned app process and no listeners on ports 9245 or 8080.

Latest cleanup gate: `mise exec -- wails3 task qc:prerelease` passed, exit 0
(`/tmp/custom-ingestion-final-gate.log`), including full Go race tests, 528 frontend
files / 5,084 tests, generated bindings, lint/typecheck, Knip and Trivy (zero
reported vulnerabilities). The worktree was inspected after formatting. Only this
evidence record changed after the gate; documentation/whitespace checks passed.
`kind get clusters` reported no clusters; temporary kubeconfigs were removed.
