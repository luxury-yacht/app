# Real-State Test Harness

Temporary plan from the second app-wide design review (2026-10-22), finding #2.
It covers the frontend Vitest suite: a shared harness that mounts the app's real
state owners, the migration of suites off stubs of those owners, and a lint
guard against regression.

- **Status:** John approved the plan on 2026-10-22, with every recommended
  answer, including Q11 and Q12. That followed
  [review round 1](#review-round-1-2026-10-22) and
  [review round 2](#review-round-2-2026-10-22). Phase 0 is implemented
  (uncommitted) and its gates pass; see
  [Phase 0 progress](#phase-0-progress-2026-10-22-uncommitted). The Phase 1
  pilot (John's decision A) is implemented (uncommitted); see
  [Phase 1 pilot](#phase-1-pilot-2026-10-22-uncommitted). After the pilot,
  John raised the end-state runtime budget to +60% (2026-10-22). The rest of
  Phase 1 is implemented (uncommitted), with decisions open for John; see
  [Phase 1 completion](#phase-1-completion-2026-10-22-uncommitted).
- **Base:** `main` at `2ba0fb8a` (Feed cutover #402). Line numbers are from that
  commit.
- **Paths:** relative to `frontend/src/` unless they start with `frontend/`,
  `docs/`, or `backend/`.
- **Measurements** were taken on 2026-10-22 on John's Mac with Vitest 5.0.5,
  Biome 2.6.2, and Node v25.9.0. Scratch probes were deleted afterwards, and the
  tree was clean before and after (`git status --short` was empty).

## Phase 0 progress (2026-10-22, uncommitted)

Implemented on top of `88c97765`. Gates still open are listed under
"Pending".

### What exists

- **Production changes.** These are the Phase 0 rows of
  [Production changes](#production-changes-complete-list).
  - `App.tsx` exports `AppShell({ children })`, and `App` is
    `<AppShell><AppLayout /></AppShell>`.
  - New `windowBootstrap.ts` holds the extracted steps:
    `createWindowPreparation`, `disposeWindowPreparation`,
    `prepareWindow(config, preparation)`, `loadWindowRoot(descriptor)`, and
    `renderWindowRoot(container, element, rootOptions)`. Step 5 is split into
    `loadWindowRoot` and `renderWindowRoot`, so provider mode can render the
    shell without the root-module import.
  - `main.ts` uses one catch path: it disposes the preparation and then fails
    the opening transfer.
  - No new reset hook was needed in Phase 0.
- **Harness** (`frontend/src/test-utils/appState/`):
  - `transport.ts`: RPC on `Call.ByName`, runtime events (adding the missing
    `Events.Emit`), `Window.Name`, the `_wails` marker, JSON streams, a
    programmable `/api/v2` server (`serve`, `fail`, `respond`, `clearReads`,
    and manual-refresh jobs), and `matchMedia`.
  - `errorCapture.ts`: every reporting path from
    [Error capture](#error-capture-every-reporting-path).
  - `moduleState.ts`: the ledger reset.
  - `harness.tsx`:
    - `installAppStateHarness({ windowName, streams })`;
    - fixtures `cluster`, `showCluster`, `object`, `namespaces`,
      `preferences`, and `denyPermissions`;
    - `render` (provider mode) and `mountApp` (full app);
    - `view.show` and `view.owners`, and `settle`;
    - owner-level inputs `markClusterReady`, `setAutoRefresh`, and
      `flushRefreshWork`.
  - Strict RPCs: an unanswered call fails teardown even when the caller
    swallows the rejection. 25 RPCs are answered by default.
- **Migrated.** All four former `refreshHarness` users moved; the module is
  deleted.
  - `inactiveClusterDemand.test.tsx` lost its five owner stubs and now runs
    two real open clusters.
  - `orchestrator.demand.test.ts` now asserts that each of five failure flows
    tells the user exactly once (the log-once rule). The harness surfaced
    these toasts.
- **Pruned.** 22 dead `@/hooks/useShortNames` mocks were deleted, along with
  their helpers. In `NsViewCustom.test.tsx`, a test titled "adjusts column
  sizing when short names are enabled" asserted only row keys; it is retitled
  "keys rows by cluster and full object identity".
- **Guard.**
  - `frontend/biome-plugins/no-owned-state-mocks.grit`, generated from the
    owner set (155 alias forms, 74 relative tails).
  - Registered with a baseline of 175 files.
  - Against all 1,322 existing `vi.mock` specifiers: 0 false positives, and 8
    misses, which are exactly the documented generic relative tails.
- **Harness contract tests:**
  - `harness.isolation.test.tsx`: 10 cases;
  - `harness.bootstrap.test.tsx`: 6;
  - `harness.errors.test.tsx`: 7;
  - `main.test.ts`: +4 partial-failure cases.

### Findings while building

- **Leases acquired before the workspace connects a cluster are pruned.**
  Child effects run before ancestor effects, so a surface that leases in the
  first commit is wiped by `KubeconfigProvider`'s `setConnectedClusters([])`
  (`KubeconfigContext.tsx:274-279`, `orchestrator.ts:984-1004`). Production
  avoids this, because routes render only for open clusters
  (`AppLayout.tsx:148-150`) and panels come from state. The harness mirrors
  that with `view.show`, which shows a surface after startup.
- **Unacknowledged streams fall back to polling.** With no ACK, both clusters
  polled `namespaces` about every 2 s. The backend acknowledges subscriptions,
  so the harness auto-acknowledges by default. `streams: 'manual'` keeps
  explicit ACKs for suites that test stream health: the orchestrator demand
  and doorbell suites.
- **The ledger red check.** Each reset was disabled in turn, and the
  isolation rows were rerun:
  - Only the preference cache leaked: without
    `resetAppPreferencesCacheForTesting`, "starts paused" fails.
  - The workspace store and permission store re-initialize on every mount;
    the permission store also resets on `kubeconfig:changing`
    (`permissionStore.ts:1160-1162`). Their rows stayed green with every reset
    disabled, so they guard against a future cross-mount cache rather than a
    current one.
- **Biome 2.6.2.** The unanchored include `src/**/*.test.{ts,tsx}` also fires
  in-project: the guard probes passed with it. The anchored form stays for
  consistency.
- **Vitest caches mocked modules across `vi.resetModules()`.** A per-test
  failing factory therefore needs `vi.doMock`, with the default re-registered
  in `beforeEach`. See the `main.test.ts` root-import failure case.

### Mutation evidence

Each mutation was made in a scratchpad copy and restored, never with git
stash. Pre-migration means the stubbed suite.

| ID | Mutation | Result |
| --- | --- | --- |
| M5 | `FavoritesProvider` outside `KubernetesProvider` | Harness isolation suite red, 10 of 10. The stubbed `App.menu.test.tsx` stays green. |
| M9 | Hydration deferred until after the first render | 3 paused-start cases red: stream `REQUEST`s were sent. A first attempt that kept hydration concurrent stayed green; it did not actually reorder with instant fakes. |
| M10 | `onEvent` without the sender filter | "ignores an event addressed to another window" red |
| M11 | Capture reduced to toast listeners only | 4 error-capture cases red, including both boundary cases |
| M12 | Opening transfer recorded after step 4 | `main.test.ts` step-4 failure case red |
| — | Polls with `stream-signal` intent (bypasses the healthy-stream gate) | `inactiveClusterDemand` red: 30 inactive reads |

Guard proofs:

- **Removing one baseline line** (`ClusterViewNodes.test.tsx`): `biome lint`
  exits 1, with 7 diagnostics, all in that file.
- **Restored tree:** exit 0.

### Runtime after Phase 0, and the budget decision

**Measured.** Full `vitest run`, 4 workers, same machine and command as the
baseline:

| | Wall | Tests | Failures |
| --- | ---: | ---: | ---: |
| Baseline | 75.4 s | 5,372 | 0 |
| Phase 0 | 79.5 s | 5,405 | 0 |

Phase 0 adds +4.1 s (+5.4%).

- **Per-test cost of a bootstrapped `StrictMode` mount** (JSON reporter):

  | Mode | Median | Max |
  | --- | ---: | ---: |
  | Provider (isolation suite) | 23 ms | 68 ms |
  | Provider (errors suite) | 19 ms | 64 ms |
  | Full app (bootstrap suite; includes 5 min of fake time and a manual refresh) | 74 ms | 305 ms |

- **Migrated suites before and after** (per-file test time):

  | Suite | Before | After |
  | --- | ---: | ---: |
  | `inactiveClusterDemand` | 0.015 s | 0.073 s |
  | `objectDetailsDoorbell` | 0.034 s | 0.187 s |
  | `objectYamlScopeSharing` | 0.024 s | 0.084 s |
  | `orchestrator.demand` | 0.104 s | 0.123 s |

**Re-projection (exceeds the budget).** The 175 baseline suites hold 2,392
tests:

- 85 suites (1,062 tests) need full-app mode by the eligibility rule (the
  pilot found that rule too broad; see its finding 2);
- 90 suites (1,330 tests) can use provider mode.

The projection assumes one mount per test and no consolidation. It charges
0.074–0.12 s per full-app test, 0.025 s per provider test, and the probe's
import cost per file. That comes to +38 to +51 s wall, or **+51% to +67%**,
against the approved +20%.

**Decision (John, 2026-10-22): option A.** Phase 1 starts as a measured
pilot: migrate about 10 object-panel suites with consolidation, and profile
the harness's own cost (the `settle` loop, `StrictMode` double effects, the
full-app route import). The budget is then set from real data. The rejected
options were B (raise the budget to at most +60% now) and C (tier-1 suites
only).

### Gates on the final Phase 0 tree

- **`mise exec -- wails3 task qc:prerelease`: exit 0.** It ran docs, fmt,
  bindings, vet and staticcheck, `test:race`, Biome lint and lint-fix,
  typecheck, frontend tests (5,404 passed, 1 skipped), knip, and trivy. The
  formatter only reordered imports and rewrapped lines in the new files; the
  tests ran after formatting.
- **Complexity** at 12 or lower for every changed or new function
  (`npm run complexity`). The fetch router in `transport.ts` scored 14 and was
  split.
- **Coverage** (diagnostic):

  | | Before | After |
  | --- | ---: | ---: |
  | Statements | 91.18% | 90.87% |
  | Branches | 81.78% | 81.43% |
  | `App.tsx` statements | 55% | 62.3% |
  | `main.ts` statements | 91.2% | 95.2% |

  New modules: `windowBootstrap.ts` 92.6%, `transport.ts` 89.1%,
  `harness.tsx` 95.2%, `errorCapture.ts` 92.9%, `moduleState.ts` 100%.
  - No file lost covered statements, apart from the deleted
    `refreshHarness.ts` and the code moved out of `main.ts`.
  - The percentage dips because full-app mounts now load modules that every
    suite used to mock: `AppDebugOverlays.tsx` (19%), `AppLayout.tsx` (56%),
    and `KubeconfigsSection.tsx` (0%). v8 counts only files a test loads, so
    those were never in the denominator before. The dip is reported, not
    chased.
- **Native checks.** John approved temporarily swapping the persisted
  selection, because it named a production cluster.
  - **Setup.** `settings.json` was backed up and set to
    `~/.kube/dev-stg-clusters:dev-cluster` with auto-refresh off, then
    restored byte-for-byte (SHA-256 verified).
  - **Run.** `EXTRA_TAGS=mcp wails3 dev`, driven through the Wails MCP server.
  - **Workspace window.** `workspace-1` booted on `dev-cluster` with the
    persisted pause applied: connectivity `data-status="inactive"`,
    "Auto-refresh paused", and the Overview rendered. Re-enabling auto-refresh
    from the connectivity popover made it Ready.
  - **Panel window.** From Nodes, the `dev-cluster-worker` link opened a
    docked panel. "Undock panel to floating window" opened the native window
    `panel-1`, which booted through the panel bootstrap: it is visible (its
    ready acknowledgement committed), it has no bootstrap error, and its
    Details show the node (Kind Node, Ready). The workspace had 0 docked
    panels left.
  - **Not run.** Cluster switching (only the approved `dev-cluster` was
    opened) and the failed-bootstrap disposal, which cannot be triggered
    natively without fault injection; `main.test.ts` covers it.
  - **Side effect.** The run rewrote `persistence.json` `clusterTabs.order` to
    the single dev-cluster entry. That file was not backed up, so its prior
    value is unknown.
  - **Leftover tag.** `bin/luxury-yacht` and `bin/Luxury Yacht.dev.app` keep
    the `mcp` tag until the next build; do not launch them directly.

### Pending

- **Phase 1 pilot** (decision A): done; see
  [Phase 1 pilot](#phase-1-pilot-2026-10-22-uncommitted).

## Phase 1 pilot (2026-10-22, uncommitted)

Decision A's measured pilot, built on the Phase 0 tree. It fed the budget
decision ([Budget decision](#budget-decision-john-2026-10-22)).

### What changed

- **Production.** These are the Phase 1 rows of
  [Production changes](#production-changes-complete-list).
  - `PanelWindowApp.tsx` exports `PanelWindowShell({ descriptor, children })`,
    which holds the window's hooks and provider chain. `PanelWindowSurface`
    renders `children` after its content div, inside its
    `DockablePanelProvider`. `PanelWindowApp` is
    `<PanelWindowShell descriptor={descriptor} />`.
  - `PanelWindowApp.tsx` exports `resetAcknowledgedPanelTransfersForTesting()`
    next to `acknowledgedTransfers`. The ledger calls it.
- **Harness.**
  - Panel-window mount mode: `app.panelWindow(cluster, { name, transferId })`,
    then `render` mounts `PanelWindowShell` through the panel bootstrap.
  - A panel directory fake. It answers `OpenPanelWorkspaceObject`,
    `ClosePanelWorkspaceObject`, and `GetPanelWorkspace`
    (`internal/appwindow/workspace.go:114-147`), plus `BeginPanelWindowOpen`
    and the ready acknowledgement (`internal/appwindow/registry.go:229-261`,
    `:513-536`):
    - the group stays in place while its window opens;
    - the window's acknowledgement moves the group into it;
    - it then sends `panel-window:opened` addressed to the source window
      (Wails `WebviewWindow.EmitEvent` sets `Sender` to the window name);
    - it rings `panel-workspace:changed`.
  - `view.openPanels()` returns the open panels with complete identity.
  - `app.startScreen(cluster)` serves what the full app's start screen reads.
  - Two builders in `refreshContractTestBuilders.ts`.
- **Migrated.** Nine suites, with 18 owner `vi.mock` calls deleted. Their
  baseline lines are gone, leaving 166. `biome lint src` exits 0, and a probe
  owner mock added to `DockableTabBar.test.tsx` is rejected.

  | Suite | Mode | Tests before → after | Notes |
  | --- | --- | --- | --- |
  | `ConfigMapOverview` | provider | 2 → 2 | |
  | `SecretOverview` | provider | 3 → 1 | Two duplicate `renderUsedByLinks` consumer tests removed |
  | `PodOverview` | provider | 3 → 3 | Asserts the real lowercase-kind targets |
  | `JobOverview` | provider | 3 → 3 | |
  | `WorkloadOverview` | provider | 9 → 9 | |
  | `ClusterResourceOverview` | provider | 10 → 10 | |
  | `EventsTab` | provider | 12 → 12 | Two clusters, plus a panel-window case |
  | `DockableTabBar` | provider | 4 → 4 | |
  | `DockablePanel` | provider | 17 → 17 | |

  New suites and rows:
  - `Details/Overview/overviewLinks.test.tsx`: full app, 1 test. A link in an
    opened ConfigMap panel opens the pod's panel with complete identity.
  - `core/panel-windows/panelWindowFloat.test.tsx`: full app, 2 tests.
    Undocking freezes the window, and the real guard registry releases it
    both when the new window is ready and when the backend refuses.
  - The transfer-id row in `harness.isolation.test.tsx`: 2 tests.

  Child-component stubs (`ResourceHeader`, `ResourceMetadata`, `Tooltip`)
  stay, as [Not in scope of the guard](#not-in-scope-of-the-guard) allows.

### Mutation evidence

Each mutation was made in a scratchpad copy and restored, never with git
stash. Pre-migration means the stubbed suite.

| ID | Mutation | Result |
| --- | --- | --- |
| M1 | As written: `openWithObject` skips `hydrateClusterMeta` and the identity assertion | Green before and after. A second hydration on the same path masks it (`ObjectPanelStateContext.tsx:359`). M1′ replaces it. |
| M1′ | `panelTargetSnapshot` drops the namespace | `overviewLinks` red: the link never renders (`expected undefined to be defined`). The stubbed `ConfigMapOverview` stays green, 2 of 2. |
| M2a | `handlePanelWindowOpened` calls `releaseTransfer` unbound | `panelWindowFloat` ready case red: `TypeError: Cannot read properties of undefined (reading '#transfers')`. The stubbed `WorkspacePanelCoordinator.test.tsx` stays green, 43 of 43. |
| M2b | The refusal `.catch` calls `releaseTransfer` unbound | Refusal case red: the window stays frozen (`expected true to be false`), plus an unhandled rejection. The stub stays green, 43 of 43. |
| — | No `acknowledgedTransfers` reset | Transfer-id row red (`expected [] to deeply equal [['panel-1','t-1']]`). Green with the reset, in file order, shuffled, and each test alone. |

### Findings

1. **M1 as written is not a valid mutation.** `openWithObject` hydrates and
   asserts (`useObjectPanel.ts:226-227`), and `onRowClick` hydrates again
   (`ObjectPanelStateContext.tsx:359`). This is not a defect; the catalog row
   now points to M1′.
2. **The full-app eligibility list was too broad.**
   - Overview descriptor suites render `OverviewRenderer`, and `EventsTab`
     takes `objectData` as a prop (`EventsTab.tsx:119`). Neither reads
     `CurrentObjectPanelContext`.
   - The direct readers are:
     - `Overview/index.tsx:76` and the Helm descriptor
       (`descriptors/helm.tsx:53`);
     - `PodsTab.tsx:77`, `JobsTab.tsx:63`, and `YamlTab.tsx:596`;
     - `ResourceHeader.tsx:28`;
     - `useObjectActionController.tsx:447`, for `panelId`.
   - The pilot's Overview suites keep `ResourceHeader` stubbed, so their
     assertions do not depend on the context, and they are provider-eligible.
     All 7 pilot suites that the old rule sent to full-app mode were
     provider-eligible.
   - `NamespaceResourcesProvider` provides no context value. It issues the
     namespace permission query and renders its children
     (`NsResourcesContext.tsx:39-60`). Routes depend on that side effect.
   - [Mount modes](#mount-modes-and-eligibility) is updated to match.
3. **Child stubs hide fixtures with incomplete identity.** With isolation off,
   stubs leaked between files, so the real header and metadata rendered
   fixtures that have no `clusterId`. The app threw `Object identity for
   Namespace/default is missing required field "clusterId"`. A suite that
   drops those stubs must supply complete identity.
4. **EventsTab related-object references take the panel's cluster.**
   `eventGridRelatedObjectInput` receives `objectData`'s cluster id and name
   (`EventsTab.tsx:173-180`). A catalog-resolved reference has no
   `clusterName`. The suite asserts today's behavior. For John: whether an
   object's events can involve an object in another cluster [assumed: no].
5. **Stream stops linger 500 ms** (`resourceStreamManager.ts:58`). Suites that
   assert an unsubscribe advance fake timers past it.

### Runtime

Full suite, with the same command as the baseline (`/usr/bin/time`, JSON
reporter, 4 workers). Per-file time is the reporter's start-to-end for `src/`
files, which excludes import (the baseline's method).

| Run | Wall | Tests | Per-file sum | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 75.4 s | 5,372 | 46.5 s | 0.33 s | 2.93 s |
| Phase 0 | 79.5 s | 5,405 | 47.0 s | 0.35 s | 2.90 s |
| Pilot | 79.0 s | 5,408 | 51.4 s | 0.44 s | 2.96 s |

- **Overall.** Wall time is +3.6 s (+4.7%) over the baseline, and within noise
  of Phase 0.
- **Pilot suites.** They add 3.6 s of per-file time (0.75 s → 4.34 s). The
  slowest migrated file is `DockablePanel.test.tsx` at 0.98 s for 17 tests,
  within the 1.0 s p95 limit.
- **Per-test cost.**
  - Provider mode: a 27–73 ms mean per file, which is +36 ms per test over the
    stubbed suites (0.75 s for 63 tests became 2.96 s for 61).
  - Full app: the first test in a file takes about 0.6 s (`overviewLinks`
    621 ms, `panelWindowFloat` 605 ms); later tests take about 0.16 s
    (162 ms).

**Profile.** Scratch instrumentation of the harness, 3 runs per setting,
restored afterwards:

| Step | `StrictMode` on | `StrictMode` off |
| --- | ---: | ---: |
| Full-app mount, cold | 311 ms | 249 ms |
| Full-app mount, warm (second, third) | 106 ms, 62 ms | 91 ms, 57 ms |
| Provider mount | 10 ms | 8 ms |
| Idle `settle()` | 3–4 ms | 3–4 ms |

- **Route import** is the largest fixed cost. A cold full-app mount costs
  about 0.22 s more than a warm one, once per file. Vitest reports import at
  26% and environment setup at 27% of the pilot set's duration.
- **`StrictMode`** costs about 20% of a mount.
- **The settle loop.** The pilot and harness suites make 177 settle calls:
  - 3 turns: 1.05 s;
  - 1 turn: 0.66 s, with all 89 tests still passing;
  - 0 turns: 2 tests fail (the overview link, and "reads only the visible
    overview").

  One turn saves about 2 ms per call.
- **A shared module cache** (`--no-isolate`) halves the pilot set's wall time
  (4.4 s → 2.2 s). But 5 of 6 runs failed 1–9 tests, because child stubs
  leaked between files (finding 3). It is viable only for suites with no
  `vi.mock` at all. It also lets module state cross files, so the ledger would
  have to be complete.

**Re-projection.** 166 baseline suites remain. The model uses the pilot's
constants:
- +36 ms per provider-mode test;
- +0.15 s per full-app test;
- +0.22 s per full-app file.

It divides CPU by 4 workers, which assumes balanced workers [assumed]; wall
noise between runs is about ±3 s.

- **The plan's split** (after the pilot: 78 full-app suites with about 1,020
  tests, and 88 provider suites with about 1,310 tests): about 217 s of CPU,
  or about +54 s wall. That reaches about 133 s, **+77%** over the baseline.
- **A corrected split.** If about half the full-app suites turn out
  provider-eligible, as the pilot's did [assumed; Phase 1 recounts suite by
  suite]: about 151 s of CPU, or about +38 s wall. That reaches about 117 s,
  **+55%**.
- **Consolidation** removed 2 of 63 tests (3%) in the pilot. It will not close
  the gap.

**Harness-only reductions:**
- the settle loop at 1 turn: about −3 s wall, projected;
- `StrictMode` off: about −20% of mount cost. Not recommended, because it
  drops the double-effect checks;
- a shared module cache: about −50% on the pilot set. It needs suites with no
  stubs at all.

### Budget decision (John, 2026-10-22)

- **John raised the end-state budget** to at most +60% wall (at most 120 s),
  replacing the approved +20%. This was the recommendation. The measured
  projection is +55% to +77%, so +20% is not reachable at full fidelity.
- **Keep** the per-file p95 limit of 1.0 s, `StrictMode`, isolation, one mount
  per test, and the settle loop at 3 turns. The loop's cost is about 1–2% of
  the projected total, and its extra turns guard negative assertions.
- **Checkpoint after Phase 1.** Phase 1 holds most of the suites that
  genuinely need full-app mode: `ObjectPanel`, `DetailsTab`, `YamlTab`,
  `PodsTab`, `JobsTab`, `IdentityPanel`, and `PanelWindowApp`. If its measured
  delta extrapolates above +60%, try a separate Vitest project with a shared
  module cache for stub-free harness suites, before raising the budget again.

### Gates on the pilot tree

- **`mise exec -- wails3 task qc:prerelease`: exit 0.**
  - The first run failed at typecheck: the harness read the nullable
    `group.tabs` (a Go nil slice). That was fixed, and the second run passed
    every stage.
  - Frontend: 545 files and 5,407 tests passed, 1 skipped. knip and trivy are
    clean.
  - The gate changed no file (hashes compared before and after).
  - `qc:docs` passes on the final plan.
- **Complexity** is at 12 or lower in every changed file (`npm run
  complexity`): `PanelWindowApp.tsx`, the harness modules, the migrated and
  new suites, `windowBootstrap.ts`, `main.ts`, and `App.tsx`.
- **Coverage** (diagnostic), Phase 0 → pilot:

  | | Phase 0 | Pilot |
  | --- | ---: | ---: |
  | Statements | 90.87% | 90.93% |
  | Branches | 81.43% | 81.52% |
  | `PanelWindowApp.tsx` statements | 81.0% | 82.9% |
  | `harness.tsx` statements | 95.2% | 93.9% |

  `App.tsx` stays at 62.3% (baseline 55%), below the 80% target. Its 23
  uncovered statements are `AppContent` callbacks that fire only on
  application-menu, debug-toggle, and sidebar-resize input (lines 98–205 in
  the coverage report). The Phase 3 shell and menu suites drive them.
- **Biome guard:** `biome lint src` exits 0 with the 9 baseline lines
  removed. `check-biome-boundaries.test.mjs` passes, 57 of 57.

### Pending

- **John:** finding 4.
- **Native check** of `PanelWindowShell`: a panel window opens through a
  transfer. It needs John's approval to swap the persisted selection again,
  which names a production cluster. The float test covers the source window's
  side.
- **Phase 1 remainder:** done; see
  [Phase 1 completion](#phase-1-completion-2026-10-22-uncommitted).

## Phase 1 completion (2026-10-22, uncommitted)

The rest of Phase 1, built on the pilot tree. 61 of the 62 Phase 1 suites run
on the harness. `Logs/LogViewer.benchmark.test.tsx` keeps its stubs and its
baseline line until John decides ([Pending](#pending-2)).

### What changed

- **Production.** Four reset hooks, each next to its state and called only by
  the ledger (`test-utils/appState/moduleState.ts`). Each has a
  repeated-identity row in `harness.isolation.test.tsx` that was red before
  the hook and green after it: in file order, shuffled, and alone.

  | Module | State | Red before the hook: test 2 saw test 1's |
  | --- | --- | --- |
  | `core/panel-windows/publicationQueue.ts` | The two `PanelPublicationQueue` singletons | Refused close, retried by its own window-close flush |
  | `…/Helm/helmValuesViewCache.ts` | Values view by panel id | `'merged'` view |
  | `…/NodeLogs/nodeLogsApi.ts` | Discovery cache and in-flight map (`:41-42`) | Cached discovery |
  | `modules/object-panel/objectPanelTabRequests.ts` | `pendingTabByPanel` (`:11`) | Pending `'shell'` request |

- **Harness.**
  - Teardown awaits work still in flight from `show`, `settle`, and
    `selectCluster`. Before, one test's un-awaited `onClose` draw ran into the
    next (`DockablePanel.lifetime` tests 3–7 were red).
  - `view.selectCluster(cluster)` switches the workspace through the
    kubeconfig owner.
  - `backend.hold(method)` parks calls until released. An answer given during
    the hold stays in place after the release (`harness.transport.test.tsx`,
    red before).
  - The directory fake mirrors three more Go paths:
    - re-opening a listed panel sends the focus request to the window that
      holds it, and rings `panel-workspace:changed`
      (`internal/appwindow/workspace.go:137-141`, `:168-180`);
    - `CloseClusterView` (`backend/workspace_cluster_close.go`). It throws for
      a cluster with open panel windows, which no suite needs yet;
    - the ready acknowledgement moves the panels into the new window and
      sends `panel-window:opened` (`internal/appwindow/registry.go:513-536`).
  - `Window.Get(name).Focus()` is faked, and `app.focusedWindows()` lists the
    calls. Before, `focusWindow` threw inside `focusBlocker`.
  - `app.panelWindow(cluster, { name, transferId, tabs })` seeds the window's
    group.
  - `app.permissions(decide)` answers `QueryPermissions` in Go's shape. A
    namespaced query resolves from the namespace's rules: allowed is `ssrr`,
    denied is `denied` with "no matching rule"
    (`backend/resource_gateway_permissions.go:262-273`). A cluster-wide query
    goes to an access review: `ssar`, with the API server's reason
    (`backend/capabilities/service.go:221`). Before, a denial came back as `ssar` with
    no reason. `denyPermissions` also matches subresource and name.
  - `WorkspacePanelHost` hosts open panels in provider mode, the way
    `AppLayout` does: the dock's panel layer, and one `DockablePanel` per open
    panel at its mount target, inside its cluster's lifecycle surface
    (`ui/layout/AppLayout.tsx:316-370`, `ObjectPanel.tsx:332`). Five suites
    use it. It is a copy of production composition, which
    [Real owners](#real-owners-production-composition-not-a-copy) rules out;
    see [Pending](#pending-2).
- **Migrated:** 52 suites, plus the benchmark, which has not moved. 173 owner
  `vi.mock` calls were deleted, which with the pilot's 18 makes 191 of
  Phase 1's 195. Every remaining `vi.mock` in these suites stubs a child
  component or a library: header, metadata, tooltip, and dropdown components,
  `GridTable`, `ObjectMap`, chart pieces, tab contents, CodeMirror, and
  xterm.

  | Area | Suites | Full app | Tests before → after | Owner mocks deleted |
  | --- | ---: | ---: | --- | ---: |
  | `core/panel-windows` | 7 | 0 | 108 → 98 | 36 |
  | `PanelWindowApp` (panel-window mode) | 1 | 0 | 9 → 10 | 14 |
  | `ui/dockable` | 7 | 0 | 98 → 98 | 8 |
  | Details and Overview descriptors | 12 | 2 | 87 → 87 | 19 |
  | `ObjectPanel`, panel state, open, identity | 5 | 3 | 77 → 75 | 36 |
  | Panel hooks | 5 | 1 | 65 → 61 | 11 |
  | Metrics | 4 | 0 | 30 → 24 | 5 |
  | Pods, Jobs, Map, and YAML tabs | 5 | 2 | 82 → 77 | 27 |
  | Logs, node logs, shell, and Helm tabs | 7 | 0 | 194 → 190 | 17 |
  | **Total** | **53** | **8** | **750 → 720** | **173** |

  - **Full-app suites** (8): `Overview/index`, `HelmOverview`, `ObjectPanel`,
    `ObjectPanel.groupContext`, `IdentityPanel`, `useObjectPanelLogsCapability`,
    `PodsTab`, and `JobsTab`. Each reads `CurrentObjectPanelContext`, or
    depends on the panel's own namespace permission query
    (`ObjectPanel.tsx:152`; see
    [Mount modes](#mount-modes-and-eligibility)).
  - **Other modes:** 5 suites mount a panel window: `PanelWindowApp`,
    `WorkspacePanelSync`, `MapTab`, and, besides the full app, `PodsTab` and
    `JobsTab`. `panelTabActions` and `nodeLogsApi` use the harness without a
    mount. The rest use provider mode.
  - **Consolidation** removed 30 tests (4%). Each removed test duplicated
    another or asserted a state the app cannot reach (finding 7).
    `WorkspacePanelCoordinator`'s header names the suites that now hold its
    duplicates.
  - **Guard:** 49 baseline lines removed, leaving 117. `biome lint src` exits
    0, and `tsc --noEmit` reports 0 errors.

### Mutation evidence

Mutations were made in place and restored from a scratchpad copy in the same
command; checksums matched afterwards. None used git stash.

| ID | Mutation | Result on the final tree |
| --- | --- | --- |
| M1′ | `panelTargetSnapshot` drops the namespace | Red in 26 files (122 tests), including `ConfigMapOverview`, whose stubbed version stayed green in the pilot, `ObjectPanel` (19), `PodsTab` (21), `WorkspacePanelCoordinator` (15), and `useObjectPanel` (4). |
| M2a | `handlePanelWindowOpened` calls `releaseTransfer` unbound | Red in the migrated `WorkspacePanelCoordinator` (2 tests) and `panelWindowFloat` (1): `TypeError: Cannot read properties of undefined (reading '#transfers')`. The stubbed suite stayed green, 43 of 43. |
| M2b | The refusal `.catch` calls `releaseTransfer` unbound | Red in `WorkspacePanelCoordinator` ("docks the panel on the right when the native window cannot open") and `panelWindowFloat` (the window stays frozen), plus unhandled rejections. |
| — | Each reset hook removed | Its isolation row is red (table above). |

### Findings

1. **The YAML tab sees no live changes while editing, unless another
   consumer leases its scope.**
   - Editing releases the tab's `object-yaml` lease (`yamlTransaction.ts:554`,
     `enabled: isActive && !isEditing`). The last release disables the scope
     (`orchestrator.ts:537-556`), and a fetch of a disabled scope resets it
     (`:1283-1285`).
   - So the drift check (`yamlTransaction.ts:687`) and "Reload & merge" work
     only while the object diff (`ui/modals/useObjectDiffYaml.ts`) leases the
     same scope. Without that consumer, all 5 drift and merge tests fail.
   - The stubbed suite pushed snapshots into the editing tab directly.
   - **Resolved (2026-10-22, uncommitted).** John chose the Headlamp model
     after a survey of other tools' source: the tab keeps watching while
     editing, never touches the draft, and shows drift with a diff and
     Reload & merge. Drift ignores status and server-managed churn (the field
     policy's semantic compare). A replaced object (new uid, or an
     `ObjectUIDMismatch` save conflict) shows the diff without a merge,
     because the backend refuses one. The contract is in
     `docs/architecture/yaml-editing.md` (invariant 6).
2. **Alt+click on a pod owner in a custom API group.** `getViewForKind` keys on
   the kind alone (`kindViewMap.ts:87`). A `Deployment` in
   `operators.example.io` goes to the built-in Workloads table, which cannot
   contain it. A kind with no view does nothing (`useNavigateToView.ts:38`),
   although `kindViewMap.ts:8` says callers fall back to Browse.
3. **A resource link can carry another cluster's name.**
   `resourceLinkToObjectReference(link, clusterName)` attaches the caller's
   cluster name to whatever `clusterId` the link carries
   (`resourceLinkIdentity.ts:101-108`), and hydration keeps a given name
   (`ObjectPanelStateContext.tsx:334-350`). Latent today: the PDB producer
   always links within its own cluster
   (`backend/resources/poddisruptionbudget/model.go:36`). The same pattern is
   at `storage.tsx:188` and `useResourceLinkReference.ts:42`.
4. **Opening an object in a cluster the window does not display does nothing,
   silently.** `openPanel` returns before any RPC
   (`WorkspacePanelSync.tsx:214-218`), so `useObjectPanel`'s report
   (`useObjectPanel.ts:126-133`) is unreachable from `openWithObject`. The
   stubbed suite asserted that report.
5. **The Overview's replica-string fallback is unreachable.** The Details tab
   always passes a numeric `desiredReplicas` (`objectDetailModel.ts:138`,
   `:215`, `:235`), so the `replicas` and `ready` fallbacks
   (`Overview/index.tsx:189-193`) never run. Candidate dead code.
6. **Wording:** a transfer refused while the window is frozen for a cluster
   close warns "Wait for the panel move to finish."
   (`panelLifecycleGuards.tsx:93`).
7. **Fixtures that passed only because of stubs.** Each now uses a state the
   app can reach:
   - Map tab: `GatewayClass` is map-supported (`objectMap: true` in
     `backend/resourcecontract/builtin-resource-identities.json`). The
     webhook case hid the Map tab for the wrong reason.
   - Capabilities: restart allowed while YAML edit is denied cannot happen;
     both check `patch` on the object (`backend/objectaction/catalog.go:113`,
     `useObjectPanelCapabilities.ts:138`).
   - Pods: rows from another cluster, and a panel cluster that differs from
     the selection. The pods query is per cluster, and `openWithObject`
     switches to the panel's cluster.
   - `ObjectPanel`: one panel re-rendered with another identity. A panel id
     derives from identity, so a new identity is always a new panel. The
     deleted-marker check now ignores the group's hidden hosts
     (`DockablePanelGroup.tsx:562-566`).
   - `IdentityPanel`: a `partialReason` field that the snapshot type lacks
     (`types.generated.ts:648-672`). Go reports partial data as `issues`
     (`backend/refresh/snapshot/table_query_issues.go:76-83`).
   - Cluster ids such as `'Cluster-A'` and `'test-cluster'`, which never
     open panels in the real app.
8. **`StrictMode` double reads** (dev only): `FindCatalogObjectByUID` runs
   twice per mount, and a panel's metrics series is read twice on show.
   Effect cleanup is correct.
9. **Observed, not traced:** `requestRefreshDomain` with reason `'user'` for
   an unleased `pods` scope issued no read.

**Harness gaps** that later phases may need:
- A stream's connection cannot be held, so a domain's `initialising` window
  (`orchestrator.ts:355-359`) is not observable. `IdentityPanel`'s warm-up test
  was dropped.
- `snapshots.respond` holds one responder; `PodsTab` builds its own
  dispatcher.
- No helper serves a panel's reads by kind. A Deployment panel also needs
  `IsWorkloadHPAManaged` and its namespace's pods and workloads; a Node panel
  needs `nodes`, `object-maintenance`, and `DiscoverNodeLogs`. Four suites
  write this out.
- No helper selects a panel's sub-tab or reads the active one.
- No panel-metrics buffer fake; three suites fake it in-file.
- Clusters must be declared before the mount, because `GetKubeconfigs` is
  read once.
- jsdom lacks `scrollIntoView` (`Sidebar.tsx:934`) and `elementsFromPoint`.
  Suites shim them locally; a shared shim belongs next to `matchMedia` in
  `transport.ts`.
- Named container-log streams. Only the benchmark needs them.

### Runtime

Same command and method as the pilot. The script reproduces the baseline's
and the pilot's rows from their reports.

| Run | Wall | Tests | Per-file sum | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 75.4 s | 5,372 | 46.5 s | 0.33 s | 2.93 s |
| Pilot | 79.0 s | 5,408 | 51.4 s | 0.44 s | 2.96 s |
| Phase 1 | 82.0 s | 5,387 | 80.1 s | 0.70 s | 4.98 s |

- **Overall:** +6.6 s wall (+8.7%) over the baseline, within the +60% budget.
- **Phase 1 suites:** 8.7 s → 43.4 s of per-file time, for 813 → 781 tests.
  Full-app tests cost +157 ms each (8 suites); the rest +30 ms each.
- **Checkpoint.** Phases 2–4 hold 121 suites and 1,648 baseline tests. At
  Phase 1's mix (about 10% of tests in full-app mode), they add about 70 s of
  CPU, or about +18 s wall on 4 workers [assumed balanced, as in the pilot].
  That reaches about 100 s, **+32%**. The budget breaks even when about half
  of those tests need full-app mode. The trigger is not met, so the shared
  module cache waits. Phase 2 re-checks once its suites are classified.
- **Per-file limit: missed.** Over the 64 Phase 1 files the p95 is 2.39 s
  (limit 1.0 s): 11 files take over 1 s, and 4 over 2 s. Every one of them is
  long because of its test count, not slow tests:

  | File | Time | Tests | Mean per test | Mode |
  | --- | ---: | ---: | ---: | --- |
  | `Logs/LogViewer.test.tsx` | 4.98 s | 91 | 55 ms | provider (1.14 s before) |
  | `ObjectPanel.test.tsx` | 3.88 s | 30 | 129 ms | full app |
  | `Pods/PodsTab.test.tsx` | 3.40 s | 22 | 155 ms | full app |
  | `NodeLogs/NodeLogsTab.test.tsx` | 2.39 s | 42 | 57 ms | provider (1.23 s before) |

  The slowest single test is 0.5 s. Splitting a file adds import cost without
  reducing the total. Remedies 1–3 are spent (consolidation, and the pilot's
  harness profile), so by step 4 this goes to John
  ([Pending](#pending-2)).

### Gates on the final tree

- **`mise exec -- wails3 task qc:prerelease`: exit 0.** Every stage ran: docs,
  fmt, bindings, vet, race, lint, typecheck, frontend tests (546 files and
  5,386 tests passed, 1 skipped), knip, and trivy. Hashes of every changed
  file were compared before and after; the gate changed none. Only this plan
  differs, edited during the run.
- **Complexity** is 12 or lower in all 73 files checked (`npm run
  complexity`): the four reset-hook modules, `PanelWindowApp.tsx`, the
  harness modules, and every Phase 1 suite.
- **Biome guard:** `biome lint src` exits 0 with 117 baseline lines.
  `check-biome-boundaries.test.mjs` passes, 57 of 57. With the benchmark's
  line removed, the guard reports its 3 owner mocks. `tsc --noEmit`
  reports 0 errors.
- **Isolation:** `harness.isolation.test.tsx` passes, 20 of 20, in file
  order and shuffled. All 64 Phase 1 files and the harness suites pass
  shuffled together: 67 files, 817 tests (seed `1792704605997`).
- **Coverage** (diagnostic), pilot → Phase 1:

  | | Pilot | Phase 1 |
  | --- | ---: | ---: |
  | Statements | 90.93% | 91.26% |
  | Branches | 81.52% | 81.86% |
  | `PanelWindowApp.tsx` statements | 82.9% | 82.9% |
  | `nodeLogsApi.ts` statements | 84.6% | 95.2% |
  | `objectPanelTabRequests.ts` statements | 92.3% | 92.9% |
  | `harness.tsx` statements | 93.9% | 94.8% |

  `publicationQueue.ts` and `helmValuesViewCache.ts` are at 100%. `App.tsx`
  stays at 62.3%, for the reason the pilot recorded.

### Pending

- **John:**
  - **The benchmark.** Under the harness, `StrictMode` raises its medians
    (10,000 parsed JSON lines: 13.1 ms → 23 ms), and the follow-up and
    measured-cells columns were lost. The options are a harness option without
    `StrictMode` plus named streams, or an exemption for `*.benchmark.test.*`.
    Until then its baseline line stays.
  - **The per-file limit.** Replace it with a per-test mean (for example
    60 ms in provider mode and 200 ms in full-app mode), or keep it and split
    the four files. Recommended: replace it, since only wall time costs
    anything.
  - **`WorkspacePanelHost`.** Recommended: extract `AppLayout`'s object-panel
    host into an exported component, as with `AppShell`, so the harness
    renders the real one. That is a production change and needs a native
    check.
  - Finding 2, and pilot finding 4.
- **Native check** of `PanelWindowShell` (unchanged from the pilot).
- **Follow-ups:** findings 3–6, and the harness gaps as later phases need
  them.

## Problem

The testing standard asks for real wiring. "Prefer the smallest real boundary
… Mock external dependencies" (`docs/workflows/testing.md:18-19`). "Treat
production wiring as a data contract; isolated producer and consumer tests do
not prove that the application connects them" (`testing.md:26-27`). The
checklist adds "the real state owner" (`docs/workflows/common-mistakes.md:21-22`).

The suite has drifted from that standard. There is no shared way to mount real
state, so each suite stubs the owners its component reads. The composite
provider even documents this as a goal: "Easier testing: Smaller contexts are
easier to mock" (`core/contexts/KubernetesProvider.tsx:29`).

### Size

A scratch script inventoried every `vi.mock` call. It resolved the path aliases
and the relative specifiers to module paths, then classified each module.

- **Test files:** 534 under `src/`.
- **`vi.mock` calls:** 1,355 in total. Of those, 1,326 target app modules in
  256 files; the other 29 mock npm packages.
- **Owned state modules** (definition in [Inventory](#inventory)): 685 calls in
  **183 suites**. The 13 suites that stub only the error sinks are not counted.
  - 131 suites mock at least one of the seven most-mocked owners:
    `KubeconfigContext`, `useObjectPanel`, `useNavigateToView`,
    `@/core/refresh`, `@/core/data-access`, `@/core/capabilities`, and
    `NamespaceContext`.
  - The brief counted 122 and 252 / 1,286. The differences come from resolving
    relative specifiers such as `'./WorkspacePanelSync'` (37 owner mocks) and
    from a broader owner set.
- **External boundary mocks:** 180 calls. These are allowed and stay
  (`@core/backend-api`, `@core/desktop-runtime`, `@/core/refresh/client`,
  sentry, app-log client, platform).
- **Dead mocks:** 22 suites mock `@/hooks/useShortNames`. That module was
  deleted by the preference-store work; `src/hooks/` has no such file. One
  example is `modules/cluster/components/ClusterViewCRDs.test.tsx:98`. All 22
  suites passed in the baseline run, so Vitest accepts a mock of a missing
  module without any error.

### What the stubs hide (verified examples)

- **The only `<App/>` test proves nothing about the provider tree.**
  `App.menu.test.tsx` has 18 `vi.mock` calls (`:15-48`). Every provider is a
  pass-through, and `AppLayout` renders `null`.
- **Owner suites stub their neighbours.** `KubeconfigContext.test.tsx` stubs
  `ViewStateContext`, `@/core/refresh`, `ObjectPanelStateContext`,
  `WorkspacePanelSync`, and the panel-window client (`:71-123`). The coordinator
  suite stubs `@/ui/dockable` (`WorkspacePanelCoordinator.test.tsx:226`), which
  contains the `DockablePanelProvider` the coordinator renders
  (`core/panel-windows/WorkspacePanelCoordinator.tsx:286`).
- **The guard-registry stub hid a crash (per notes).** The coordinator suite's guard
  registry defaults to an object of `vi.fn`s
  (`WorkspacePanelCoordinator.test.tsx:209-220`). The real
  `PanelLifecycleGuardRegistry` appears in only one case (`:1076`). Per the
  brief and the sibling note `finding-4-panel-placement-single-writer.md`, this
  `vi.fn` registry hid an unbound-method crash in the single-panel-writer
  prototype (#401 work) [from notes, not re-run].
- **Stubs fabricate identities that production cannot produce.**
  `ClusterViewNodes.test.tsx:155-162` stubs `selectedClusterId: 'path:context'`.
  That is a selection-shaped string. Production derives the id as
  `${name}:${context}` (`modules/kubernetes/config/kubeconfigSelection.ts:46-48`).
  In the same test, the node row's ref carries `clusterId: 'alpha:ctx'`
  (`:386`): the view's cluster and the row's cluster differ. The open assertion
  checks only `kind` and `name` (`:396-398`). A panel opened with the wrong
  cluster passes.
- **The stubbed panel opener skips identity validation.** The real
  `openWithObject` hydrates cluster metadata and asserts complete identity
  (`modules/object-panel/hooks/useObjectPanel.ts:224-229`). The stub,
  `useObjectPanel: () => ({ openWithObject: openWithObjectMock })`
  (`ClusterViewNodes.test.tsx:147-149`), accepts any ref. 90 assertion lines
  check calls on `openWithObject…` mocks (grep
  `openWithObject[A-Za-z]*\)\.(not\.)?toHaveBeenCalled`).
- **The refresh stub returns fixed state.** `useRefreshScopedDomain` returns
  canned data, and the lease calls are `vi.fn`
  (`ClusterViewNodes.test.tsx:203-215`). Lease acquire and release, scope
  encoding, the pause gate (`core/data-access/dataAccess.ts:26-31`), and stream
  subscription never run.
- **The "integration" test stubs eight owners.**
  `modules/browse/hooks/catalogFreshness.integration.test.tsx:41-76` stubs
  Kubeconfig, Namespace, ViewState, Sidebar, `useObjectPanel`,
  `useNavigateToView`, `useObjectActionController`, and Favorites.
- **Even a harness user stubs owners.** `core/contexts/inactiveClusterDemand.test.tsx`
  runs the real orchestrator through `refreshHarness`. It still stubs
  `KubeconfigContext`, `ViewStateContext`, `NamespaceContext`,
  `ClusterLifecycleContext`, and `AppearanceModeContext` (`:33-64`).
- **Earlier incidents** from notes, not re-run here [unverified]:
  - A mocked `useCapabilities` hid a Node Shell tab that never appeared
    (2026-10-12). Unnamed descriptors never queried permissions.
  - Orchestrator tests reach private methods through cast types:
    `orchestrator.test.ts` has 82 matches of `orchestratorInternals|as unknown as {`
    and `resourceStreamManager.test.ts` has 26 (grep counts). A signature change
    in one of them compiled but misrouted tests at runtime (2026-10-19).

### The right pattern exists but is barely used

`test-utils/refreshHarness.ts` runs the real orchestrator, cluster runtimes,
store, default domain registrations, and stream managers. Only the transport
is faked (`:1-10`). Four suites use it: `orchestrator.demand.test.ts`,
`inactiveClusterDemand.test.tsx`, `objectDetailsDoorbell.test.tsx`, and
`objectYamlScopeSharing.test.tsx`. Other helpers have narrow scopes:

| Helper | Suites that use it |
| --- | ---: |
| `DockablePanelTestHost` | 6 |
| `PanelLayoutTestProvider` | 11 |
| `createWailsRuntimeHarness` | 4 |

Real providers are rarely rendered:

| Provider | Suites that render it |
| --- | ---: |
| `KeyboardProvider` | 49 |
| `DockablePanelProvider` | 15 |
| `KubeconfigProvider` | 1 |
| `NamespaceProvider` | 1 |
| `KubernetesProvider` | 2 |

## Target model

One app-state harness, built from `refreshHarness`. It mounts the production
provider composition over fakes of the external boundary only. Fixtures seed
state through that boundary. Tests drive the real owners through their public
hooks, and assert through the UI, the boundary records, or the owners' public
reads.

### Feasibility (scratch probe, 2026-10-22)

A temporary test rendered the real `<App/>` in jsdom over the existing global
`@wailsio/runtime` mock. It served one ready cluster and recorded all boundary
traffic. The probe file was then deleted.

- **Without help, the app crashes.** `AppearanceModeProvider` threw
  `window.matchMedia is not a function`. `GetKubeconfigs` returned `null`, which
  produced "Failed to load kubeconfigs".
- **With `matchMedia`, kubeconfig, and workspace answers, it boots.**
  - The Overview rendered for the cluster.
  - 14 distinct RPCs were called: `GetAppInfo`,
    `GetClusterWorkspaceStateForWindow`, `ListRuntimeOperations`,
    `GetKubeconfigs`, `GetZoomLevel`, `PublishDockedPanels`,
    `ApplyClusterWorkspace`, `ListShellSessions`, `MatchThemeForCluster`,
    `AcknowledgePanelWorkspaceReady`, `GetPanelWorkspace`, `ListPortForwards`,
    `GetClusterAllowedNamespaces`, and `SetAppLogsPanelVisible`.
  - Snapshot reads were sent to `/api/v2/snapshots/{namespaces,
    namespace-metrics,cluster-overview,catalog,cluster-attention}` and to
    `/api/v2/metrics/active`.
  - Stream `REQUEST` frames carried `clusterId: "dev:alpha"`.
  - "Failed to activate the initial cluster" appeared because
    `ApplyClusterWorkspace` returned `null`.
- **Without the desktop-runtime marker, gated calls are skipped silently.**
  `GetFavorites` and `GetClusterTabOrder` never ran, because
  `desktopRuntimeAvailable()` reads `window._wails.environment`
  (`core/desktop-runtime/index.ts:70-72`).
- **Mount cost (two runs):**
  - Production provider stack: 181 and 184 ms import per file. Mounts took
    29 ms the first time, then 3–6 ms.
  - Full `<App/>` on top: 110 and 120 ms more import. Mounts took 32–100 ms.
  - These numbers exclude the bootstrap and `StrictMode`; the probe rendered
    without them. Phase 0 measures both.

### Boundary: the only things faked

| Boundary | Production path | Harness fake |
| --- | --- | --- |
| RPC | Bindings call `$Call.ByName("…DesktopService.<Method>", …)` (`frontend/bindings/github.com/luxury-yacht/app/backend/desktopservice.ts:41`) through the `core/backend-api` facade | A typed handler table keyed by method name, installed on the `Call.ByName` `vi.fn` from `frontend/vitest.setup.ts:101`. Defaults answer the boot set above. An unfaked method rejects and is recorded (Q2). |
| Runtime events | `Events.On` (`core/desktop-runtime/index.ts:28`, `:38`) | One emitter on `Events.On` (`vitest.setup.ts:104`). It generalizes `createWailsRuntimeHarness`. |
| Window identity and availability | `WailsWindow.Name()` (`desktop-runtime/index.ts:14`) and `window._wails.environment` (`:70-72`) | `Window.Name` resolves the fixture's window name (default `'main'`), which `prepareWindow` applies. `_wails.environment` is set. |
| Refresh HTTP | `fetch('/api/v2/snapshots/<domain>?scope=…')` (`core/refresh/client.ts:189`), plus `/refresh/<domain>` (`:132`), jobs (`:94`), telemetry (`:277`), and metrics/active (`:293`) | A fetch fake that serves payloads per `(domain, scope)`, with ETag/304 and permission-denied responses. Unknown paths return 404 and are recorded (Q1). |
| Streams | `JSONStream` through `__wailsJSONStreamFactory` (`vitest.setup.ts:105-115`) | The existing `FakeStreamSocket` plus ack and ring helpers (`refreshHarness.ts:25-125`) |
| Clock | Timers | Opt-in `vi.useFakeTimers`, and the existing `flushRefreshWork` |
| jsdom gaps | — | `matchMedia` (seen in the probe). Further shims are added only when a probe shows they are needed. |

`@core/backend-api` and `@core/desktop-runtime` stay mockable in unit suites.
The harness fakes the layer beneath them (`@wailsio/runtime`, which is already
mocked globally), so harness suites need no `vi.mock` at all. That avoids
hoisting rules for helper modules.

### Real owners: production composition, not a copy

The harness must not re-declare provider order. It imports what production
renders.

- **Workspace window.** `App` renders this chain (`App.tsx:228-252`):
  `AppErrorBoundary` → `ErrorProvider` → `ZoomProvider` → `KeyboardProvider` →
  `AuthErrorProvider` → `KubernetesProvider` → `FavoritesProvider` →
  `PanelLifecycleGuardProvider` → `WorkspacePanelCoordinator` → `AppContent`.
  - `KubernetesProvider` adds `AppearanceMode` → `Kubeconfig` → `ViewState` →
    `ClusterLifecycle` → `Namespace` (`core/contexts/KubernetesProvider.tsx:31-43`).
  - `ViewStateProvider` adds `SidebarState` → `ObjectPanelState` → `ModalState`
    → `NavigationState` → `ActiveViewSync` → `CombinedViewState`
    (`core/contexts/ViewStateContext.tsx:477-489`).
  - `WorkspacePanelCoordinator` adds `DockablePanelProvider` →
    `WorkspacePanelSync` (`core/panel-windows/WorkspacePanelCoordinator.tsx:286-338`).
- **`AppContent` holds state wiring, not only layout.** Its effect calls
  `setActivePermissionCluster` (`App.tsx:71-74`). It is the only production
  caller (grep). Rendering the providers without `AppContent` would therefore
  diverge from production on permissions.
- **Phase 0 change.** Export `AppShell({ children })`: the provider chain plus
  `AppContent`, with `AppContent` rendering `children` where it now renders
  `<AppLayout />` (`App.tsx:220`). `App` becomes
  `<AppShell><AppLayout /></AppShell>`. Provider order and effect order stay
  the same; the only addition is the `AppShell` component layer. Production
  uses the same seam the harness does. Q3 covers the
  alternative.
- **Panel window.** `PanelWindowApp` composes a different chain
  (`PanelWindowApp.tsx:292-338`). Phase 1 extracts `PanelWindowShell` the same
  way.
- **Route-level providers come from real routes.** Namespace views get
  `NamespaceResourcesProvider` from `AppLayout`'s route (`ui/layout/AppLayout.tsx:119-132`).
  Object panels are mounted by `AppLayout` per open panel (`:350-371`). Suites
  for these surfaces mount the full `<App/>` and navigate. They do not re-wrap
  route providers by hand.

### Fixture API (sketch)

The final names are settled by the first migrated suites in Phase 0.

```ts
const app = installAppStateHarness();      // installs fakes; teardown in afterEach
const dev = app.cluster({ name: 'dev', context: 'alpha', lifecycle: 'ready' });
// dev.clusterId comes from production resolveClusterMeta; it is never typed by hand
app.namespaces(dev, ['default', 'team-a']);   // namespaces snapshot + allowed namespaces
app.permissions(dev, { deny: [{ verb: 'delete', resource: 'pods', namespace: 'team-a' }] });
const api = dev.object({ group: 'apps', version: 'v1', kind: 'Deployment',
                         namespace: 'team-a', name: 'api' });   // full identity is required
app.snapshots.serve('object-details', api.detailScope, details);

const view = await app.render(<SomeView />, { visible: dev });  // AppShell around the UI
// or: await app.mountApp({ visible: dev }) for route-level surfaces
await view.objectPanel.open(api);          // real useObjectPanel().openWithObject
expect(view.objectPanel.openRefs()).toEqual([api.ref]);   // real ObjectPanelState
expect(app.streams.active()).toContain(streamKey('object-details', api.detailScope));
expect(app.backend.calls('ApplyClusterWorkspace')).toHaveLength(1);
```

Rules:

1. **Seed only through the boundary.** RPC answers, runtime events, snapshots,
   and stream frames. Never write owner internals.
2. **Drive through public APIs.** A bridge component inside the providers
   exposes only the public hooks: `useObjectPanel`, `useViewState`,
   `useKubeconfig`, and `useNamespace`. Prefer real UI events when a control
   exists.
3. **Object fixtures come from cluster handles.** They require group, version,
   kind, namespace, and name. A test cannot fabricate a cluster id that
   disagrees with its view, as `ClusterViewNodes.test.tsx` does today.
   (`test-utils/makeResourceRef.ts` defaults `clusterId: 'alpha:ctx'`.)
4. **Errors fail the test.** See [Error capture](#error-capture-every-reporting-path).
5. **Each test mounts and tears down its own app.** See
   [Isolation](#isolation-module-state-and-repeated-identities). No mount is
   shared between tests.

`refreshHarness.ts` is folded into the new harness, not wrapped. Its four users
move in Phase 0, and no compatibility re-export remains (AGENTS.md: no
temporary compatibility paths).

### Bootstrap: the same sequence as `main.ts`

Production prepares the window before it renders anything
(`main.ts:29-83`):

1. It configures error reporting from the hydrated preferences
   (`:39-43`). This hydrates preferences before the first render so that
   paused and loading UI start from the persisted settings (`:37-38`). It also
   installs the event-bus handler reporter (`core/telemetry/sentry.ts:731-738`).
2. It initializes the window identity (`:44`). Until then the identity is
   `'browser-workspace'` (`core/window-identity/index.ts:1`). `onEvent` drops
   any event whose `sender` is another window
   (`core/desktop-runtime/index.ts:28-33`).
3. It resolves the native window descriptor (`:45`), which picks the
   workspace or panel root (`:71-77`). For an opening panel, it records the
   transfer right away (`:46-53`), before any later step can throw.
4. It starts scrollbar tracking and subscribes to peer preference changes
   (`:54-64`).
5. It imports the selected root module, creates the root with the React root
   error options, and renders under `React.StrictMode` (`:66-83`).

If any step fails, the catch path fails the recorded transfer and shows an
error in place of the app (`:84-96`, `:102-119`).

The harness must not skip or re-implement these steps.

- **Phase 0 production change.** Extract steps 1–4 from `main.ts` into an
  exported `prepareWindow(config, preparation)`. Split step 5 into
  `loadWindowRoot(descriptor)` (the dynamic root import) and
  `renderWindowRoot(container, element, rootOptions)`. `main.ts` calls all
  three and keeps its order. These live in `windowBootstrap.ts`.
- **Partial state lives in a caller-owned `preparation` record.** It holds:
  - `openingPanel`, which `prepareWindow` sets as soon as the descriptor
    resolves, as `main.ts:46-53` does today;
  - the disposers of the subscriptions acquired so far (the peer-preference
    subscription, step 4);
  - `dispose()`.

  A failure anywhere (in `prepareWindow` or in `renderWindowRoot`) reaches
  `main.ts`'s single catch path. That path calls `preparation.dispose()`, then
  `abortOpeningPanel(preparation.openingPanel)`, then shows the error. Because
  the record exists before the first step, a partial preparation keeps
  today's transfer cleanup.
- **One behavior change.** Today the peer-preference subscription stays
  registered in a window that shows only the bootstrap error. After this
  change it is disposed. Its handler only re-hydrates preferences
  (`main.ts:56-64`), and a failed window has no consumer for them. The change
  goes through impact analysis.
- **Scrollbar tracking stays.** It is window-lifetime and has no production
  dispose: `shared/scrollbars/scrollbarActivity.ts:1040`; the only reset is
  the test hook at `:1181`. Production keeps it after a failure. The harness
  resets it through the ledger.
- **The harness uses the same record** and calls `dispose()` at teardown.
- **Both mount modes run `prepareWindow` first.** The harness then renders
  the root that the descriptor selects, under `StrictMode` (Q11). A
  `role: 'panel'` descriptor selects `PanelWindowShell` (Phase 1).
- **Root error options.** Where `main.ts` passes
  `createReactRootErrorHandlers(available)`, the harness passes its capture
  handlers. Reporting is unavailable in tests, so production passes `{}`
  there (`sentry.ts:782-785`); the harness replaces no production behavior.
- **More boot RPCs.** The bootstrap adds `GetAppSettingsSchema` and
  `GetAppSettings` (preference hydration, through
  `core/app-state-access/readers.ts:21-22`) and `GetNativeWindowDescriptor`
  (`core/panel-windows/index.ts:66`) to the probe's 14. The scratch probe did
  not run the bootstrap.
- **Fixtures seed these through the boundary.** For example,
  `app.preferences({ autoRefreshEnabled: false })` answers `GetAppSettings`.
  It does not call `setAppPreferencesForTesting`.
- **Phase 0 tests for this contract:**
  - **Addressed events.** An event whose `sender` is this window is
    delivered. An event addressed to another window is dropped. An event with
    no sender is delivered.
  - **Persisted paused state on first render.** The fixture persists
    `autoRefreshEnabled: false`; the default is `true`
    (`core/settings/appPreferences.ts:200`). Paused blocks only passive work:
    `startup`, `background`, and `stream-signal` reads, stream subscriptions,
    and polls. `foreground` and `user` reads still run
    (`core/refresh/refreshIntent.ts:11-15`,
    `docs/architecture/data-freshness.md:45-51`). The test asserts:
    - **The first committed render shows the paused state.**
    - **No stream `REQUEST` frame is ever sent.** The orchestrator refuses
      streams while paused (`core/refresh/orchestrator.ts:655-657`). A render
      before hydration would subscribe under the default `true` and then
      cancel (mutation M9).
    - **Advancing fake timers past every polled domain's interval adds no
      read.** Polls are disarmed while paused (`orchestrator.ts:1066-1072`).
    - **The only snapshot reads are foreground activations of visible
      surfaces.** Intent is not visible at the boundary, so the test names
      them. Only a lease's `fetchOnEnable` can read while paused, because
      stream starts are refused. Today those sites are:
      - `'foreground'`: `ClusterOverview.tsx:241` and
        `GlobalViewNamespaces.tsx:46`;
      - `'user'`: `ObjectDiffModal.tsx:463` and `useObjectDiffYaml.ts:62`.

      On the Overview start screen, that means exactly one `cluster-overview`
      read for the visible cluster (`ClusterOverview.tsx:236-242`).
    - **A user action still reads.** The manual refresh command reads every
      leased scope of the cluster (`user` intent; `data-freshness.md:62-63`).
  - **Partial preparation failure.** These cases go in `main.test.ts`, which
    owns `main.ts`'s catch path. The disposal assertions test new behavior,
    so each must be seen red before the change. The transfer-failure
    assertions pin today's behavior through the extraction.
    - The descriptor resolves to an opening panel, then the peer-preference
      subscription throws (step 4). Assert `FailPanelWindowTransfer('panel-1',
      'panel-1', 'transfer-1')` and the panel error text. Nothing else was
      acquired.
    - The descriptor resolves to an opening panel, then the root-module import
      rejects (step 5). Assert the transfer failure and the error text, and
      that the peer-preference subscription was disposed.
    - The existing render-failure case (`main.test.ts:178-207`) also asserts
      that disposal.
    - Descriptor resolution itself rejects. Assert that no transfer failure is
      sent (none was recorded) and that the window error text is shown.

### Error capture: every reporting path

Subscribing through `subscribeToErrors` is not enough. Listeners hear only
toast notifications from `handle` and `warn` (`utils/errorHandler.ts:226-258`,
`:341-368`). `handleInline` and `handleOperational` report without notifying
listeners (`:265-286`), and `errorHandler.test.ts:202-238` asserts that on
purpose. Two production boundaries report render failures only through
`handleOperational`: `shared/components/errors/ResourceBarErrorBoundary.tsx:30-35`
and `modules/object-panel/components/ObjectPanel/Details/DetailsTabDataErrorBoundary.tsx:27-32`.

The harness records every path:

| Path | Where it reports | How the harness records it |
| --- | --- | --- |
| Toast, inline, and operational reports | `errorHandler.handle`, `handleInline`, `handleOperational`, `warn` | Call-through spies on those four methods of the `errorHandler` singleton (`:420`). No import-time binding bypasses them: only `subscribe` is bound (`:429`), and `reportOperationalError` calls through (`:422-426`). Biome enforces this chokepoint by banning `console.error` outside it (`frontend/biome-plugins/no-direct-console-error.grit`, `frontend/biome.jsonc:231-239`). |
| Event-bus handler exceptions | Caught in `emit` and passed to the handler reporter, or dropped when none is set (`core/events/eventBus.ts:152-159`). Bootstrap installs a reporter that forwards to telemetry (`sentry.ts:731-738`), which does nothing while reporting is uninitialized (`:1077-1080`). | A call-through spy on `eventBus.setHandlerErrorReporter` wraps the reporter that bootstrap installs. |
| Render errors caught by any boundary, including `isolate` boundaries and the operational-only ones above | React root `onCaughtError` | The harness root's capture handlers |
| Uncaught render errors and recoverable errors | React root `onUncaughtError` and `onRecoverableError` | The harness root's capture handlers |
| Unhandled rejections and exceptions | Vitest fails the run on unhandled errors; the config does not override that (`frontend/vite.config.ts:126-141`) [assumed Vitest default] | Nothing extra |

Rules:

- **Each record has a kind:** toast, inline, operational, expected denial,
  event bus, render caught, render uncaught, or recoverable. An error object
  seen by both a boundary and the root is one record.
- **Expected denials** (the suppressed branch of `handle`, `:236-243`) are
  recorded but never fail a test. A permission test can still assert them.
  The harness recognizes one as a `handle` call with no listener
  notification. It does not re-implement the suppression predicate.
- **Every other record fails the test at teardown,** unless the test consumed
  it with `app.errors.take(match)`. The check is a plain function that the
  harness's `afterEach` calls.
- **Phase 0 regression cases** call that check directly and expect it to
  throw for:
  - an unexpected inline report;
  - an unexpected operational report;
  - a render error caught by an operational-only boundary
    (`DetailsTabDataErrorBoundary`);
  - a render error caught by an `isolate` boundary;
  - a throwing event-bus handler.

  They expect it to pass for an expected denial and for a consumed error.

### Isolation: module state and repeated identities

Vitest isolates modules per file; `vite.config.ts:126-141` does not override
`isolate` [assumed default: true]. Within one file, module-scope state
survives from test to test. An A-then-B check misses state that is keyed by
identity. For example, `acknowledgedTransfers` is a module-scope `Set`
(`PanelWindowApp.tsx:54`). An effect skips acknowledgement for a transfer id
it has already seen (`:101-104`), and nothing resets it.

**Module-state ledger (Phase 0).**

- **Scan scope.** A scratch scan at `2ba0fb8a` found 188 top-level `let`,
  `Set`, `Map`, `WeakMap`, and `WeakSet` declarations in 75 production files.
  That is an upper bound, because it includes immutable constants. It also
  found 8 class-instance singletons: `refreshOrchestrator`,
  `resourceStreamManager`, `containerLogsStreamManager`,
  `clusterWorkspaceStore`, the two panel publication queues, `eventBus`, and
  `errorHandler`.
- **Classification.** Phase 0 classifies every item reachable from a harness
  mount, in this order of preference:
  1. immutable;
  2. reset through the owner's public API (for example
     `refreshOrchestrator.setConnectedClusters([])`);
  3. reset by an existing hook. 13 production modules export
     `…ForTesting`/`…ForTests` hooks (grep).
  4. reset by a new, narrowly named hook next to the state. This follows the
     existing convention; `acknowledgedTransfers` needs one in Phase 1.
  5. process-lifetime by design, with the reason. An example is warn-once
     sets such as `warnedUnknownStatuses`
     (`ui/status/runtimeOperationStatusAdapter.ts:33`), which affect only logs.
- **Window identity** is restored to its default at teardown, through its
  setter (`core/window-identity/index.ts:3-7`).
- **Rejected: `vi.resetModules()` per test.** It re-imports about 180 ms per
  test (the probe's import cost). It also splits singletons between the
  harness's copy and the app's.
- **Moving state into component lifetime** is a production redesign. It is not
  part of this plan (Q12).

**Repeated-identity tests.** These are separate tests in one file that reuse
the same identities with different boundary answers. Each must pass alone, in
file order, and with `--sequence.shuffle`.

| Identity reused | Test 1 answers | Test 2 answers | Test 2 must show |
| --- | --- | --- | --- |
| Cluster `dev:alpha` | namespaces `[a]` | namespaces `[b]` | only `b`, and only test 2's streams |
| Object `dev:alpha` / `apps/v1` `Deployment` `team-a/api` | details with 1 replica | details with 3 replicas | 3 replicas, with no retained panel or details cache |
| Transfer id `t-1` (panel window) | ready acknowledged | ready acknowledged again | a second `AcknowledgePanelWindowReady` call. This is red until `acknowledgedTransfers` is reset, which is the proof the reset works. |
| Window name | paused preference | running preference | the first render follows test 2's preference |
| Window identity | panel window `panel-1` | workspace `main` | events addressed to `main` are delivered |
| Panel publication queue | a close the backend refuses | the window closes | no retry of test 1's close |
| Helm release panel id | the user picks the merged values view | nothing | the default values view |
| Node `worker-1` | log sources found | no log sources | test 2's discovery |
| Pod panel id | a session asks for the shell tab | nothing | no pending tab request |

Phase 0 adds the cluster, object, window-name, and window-identity rows. Phase 1
adds the transfer row together with the `acknowledgedTransfers` reset, and
the last four rows with their resets. Each
later phase adds a row for every owner it migrates whose state is keyed by
identity.

### Mount modes and eligibility

- **Full-app mode** renders the root from `loadWindowRoot` through
  `renderWindowRoot`, and navigates through the UI. The bridge is
  provider-mode only. It is required for any surface whose assertions depend
  on a route-owned or panel-owned provider. Today those are:
  - `NamespaceResourcesProvider` (`ui/layout/AppLayout.tsx:119-132`). It
    provides no context value; it issues the namespace permission query
    (`NsResourcesContext.tsx:39-60`), which permission-gated UI depends on.
  - `CurrentObjectPanelContext`, which `ObjectPanel` provides
    (`modules/object-panel/components/ObjectPanel/ObjectPanel.tsx:316-370`).
    It is read directly only by the Overview root, the Helm descriptor,
    `PodsTab`, `JobsTab`, `YamlTab`, `ResourceHeader`, and
    `useObjectActionController` (pilot finding 2). Descriptor suites that
    render `OverviewRenderer` with `ResourceHeader` stubbed, and tabs that
    take `objectData` as a prop, are provider-eligible.
  - The panel's own namespace permission query (`ObjectPanel.tsx:152`). A
    workload's Pod-level checks resolve from it, so suites whose assertions
    depend on those checks need the real panel (Phase 1 completion).
- **Provider mode** renders `<AppShell>{ui}</AppShell>` for eligible
  surfaces: hooks, owner suites, and components whose production ancestors,
  between the shell's layout slot and the surface, add no provider that the
  assertions depend on.
- **Eligibility is decided by composition, never by speed.** A slow
  full-app suite stays full-app. See [Runtime budget](#runtime-budget).

## Inventory

### Owner set and risk tiers

A module is an **owned state module** when it holds or brokers app state:
contexts and their hooks, stores, coordinators, refresh and data access,
permissions, persisted preferences, the keyboard registry, and the
panel-window client.

Each suite is ranked by the worst tier it stubs, then by how many owner groups
it stubs.

| Tier | Meaning | What a stub hides |
| --- | --- | --- |
| 1 | Identity, lifecycle, and cross-layer contracts | Cluster identity and readiness; panel identity, placement, and transfer protocol; refresh demand (leases, scope, stream, pause gate); permission queries; action execution |
| 2 | Navigation and persisted UI state | Navigation targets, per-cluster namespace selection, persistence keys and rollback, shortcut registration and priority |
| 3 | Thin clients and cosmetic owners | One-RPC client wrappers, zoom, appearance |
| Sink | `utils/errorHandler`, `ErrorContext`, `core/events` | Not a wiring risk. They are not flagged; migrated suites use the harness's error capture instead. |

### By owner

| Group | Owner modules (suites stubbing each) | Suites | Tier |
| --- | --- | ---: | :-: |
| Object panel and docking | `useObjectPanel` (59), `ObjectPanelStateContext` (14), `@/ui/dockable` (13), `@/core/panel-windows` (12), `panelLifecycleGuards` (6), `WorkspacePanelSync` (4), `PanelWindowRoleContext` (2), `dockablePanelLayout` (2), and 7 others with 1 each | 78 | 1 |
| Cluster | `KubeconfigContext` (80), `ClusterLifecycleContext` (12), `AuthErrorContext` (5), `useClusterWorkspace` (5), `KubernetesProvider` (1), `clusterTabOrder` (1, tier 2) | 84 | 1 |
| Refresh and data | `@/core/refresh` (38), `@/core/data-access` (34), `refresh/store` (12), `useAutoRefreshLoadingState` (12, tier 2), `app-state-access` (6), `useResourceGridTable` (5), `refresh/orchestrator` (4), stream managers (2+2), browse catalog hooks (3+3), and 12 more | 83 | 1 |
| Permissions | `@/core/capabilities` (29), `permissionStore` (2), `permissionRead` (2) | 33 | 1 |
| Actions | `useObjectActionController` (6), `useNodeMaintenanceActions` (2), `objectActionClient` (3, tier 3) | 9 | 1 |
| Namespace | `NamespaceContext` (27), `useNamespaceColumnLink` (13), `namespaceScope` (3, tier 3), `clusterAllowedNamespaces` (1) | 39 | 2 |
| Navigation | `useNavigateToView` (48), `FavoritesContext` (26), `ViewStateContext` (23), `SidebarStateContext` (8), `persistence/favorites` (3, tier 3), and 3 more | 69 | 2 |
| Preferences and persistence | `ZoomContext` (26, tier 3), `useGridTablePersistence` (21), `useNamespaceGridTablePersistence` (12), `appPreferences` (10), `AppearanceModeContext` (4, tier 3), and 5 more | 70 | 2 |
| Keyboard | `@ui/shortcuts` (28), `useGridTableExternalFocus` (2), shortcut context, registry, and hooks (5) | 34 | 2 |
| Sinks (not counted) | `errorHandler` (55), `core/events` (5), `ErrorContext` (2) | 61 | — |

Suites by worst tier: tier 1: 148, tier 2: 28, tier 3: 7 (183 in total). A
suite usually stubs several groups, so the group column sums to more than 183.

### By area and phase

| Phase | Areas | Suites | Owner `vi.mock` calls | Tier-1 suites | Test time now |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | `modules/object-panel` (45), `ui/dockable` (9), `core/panel-windows` (7), `PanelWindowApp.test.tsx` | 62 | 195 | 55 | 8.7 s |
| 2 | `modules/{cluster (14), namespace (17), browse (5), resource-grid (6), global (2), object-map, port-forward, kubernetes}` | 46 | 288 | 42 | 7.6 s |
| 3 | `ui/{layout, command-palette, favorites, status, modals, settings, shortcuts, overlays, panels}`, `core/contexts`, `core/navigation`, `App.menu.test.tsx`, `main.test.ts` | 42 | 134 | 32 | 6.7 s |
| 4 | `shared/*`, `hooks`, `utils`, `core/{refresh, data-access, capabilities, settings}` | 33 | 68 | 19 | 7.2 s |

Every suite is listed in [Appendix A](#appendix-a-suites-by-phase).

### Not in scope of the guard

- **Child-component stubs:** 370 calls in 116 files. Examples: `GridTable`
  (26 suites), `Tooltip` (26), `FavToggle` (23), `ResourceLoadingBoundary` (22),
  `ResourceHeader` (22), `useTableSort` (20). Tests that capture `GridTable`
  props are the "mock setter that rewrites captured props" pattern
  (`testing.md:31-33`). A migrated suite drops such a stub only when its
  rewritten assertions need the real child. Removing the rest is a separate
  finding, not part of this plan.

## Migration phases

Each phase is one reviewable change (recommendation, Q9). A suite counts as
migrated only when it has **no** owned-state `vi.mock`; it then leaves the lint
baseline in the same change. Migration is not a 1:1 port. Apply
`testing.md:29-31`, `:66-67`, and `:75-76` while migrating:

- Keep one representative consumer test for a shared pass-through path.
- Vary resource kinds only where behavior branches on kind.
- Check a test's assertions before deleting it.

Each phase records its mutation checks, timing, and coverage under
[Validation](#validation).

### Phase 0: harness, guard, and first proof

1. **Production:** the Phase 0 rows of
   [Production changes](#production-changes-complete-list). The
   impact-analysis prerequisite applies to every row
   (`docs/workflows/impact-analysis.md`). `main.test.ts` must stay green and
   gains the partial-failure cases.
   - Export `AppShell` from `App.tsx`, as described in
     [Real owners](#real-owners-production-composition-not-a-copy).
   - Export `prepareWindow` and `renderWindowRoot` from `main.ts`, with the
     `preparation` record and the failure-path disposal, as described in
     [Bootstrap](#bootstrap-the-same-sequence-as-maints).
   - Add the reset hooks that the ledger marks "new reset hook".
2. **Harness** under `test-utils/` (module layout decided in review):
   - the boundary fakes, with `refreshHarness.ts` folded in;
   - the fixtures for clusters, namespaces, permissions, and objects;
   - the bridge;
   - error capture over every reporting path;
   - the module-state ledger and teardown.
   The default RPC answers cover the 17 boot calls (the probe's 14, plus the
   3 bootstrap calls). Stateful fakes
   (workspace selection, `ApplyClusterWorkspace` echo) name their Go producer
   in a comment.
3. **Move the four `refreshHarness` users.**
   `inactiveClusterDemand.test.tsx` also loses its five owner stubs
   (`:33-64`). It becomes the first proof that the inactive-tab contract holds
   with real Kubeconfig, ViewState, Namespace, and ClusterLifecycle.
4. **Delete the 22 dead `@/hooks/useShortNames` mocks.** This is test-only
   pruning; validate by running those suites.
5. **Harness contract tests.** `test-utils/wailsRuntimeHarness.test.ts` is the
   precedent for testing a harness. A leak or a missed report would let later
   tests pass or fail on the wrong state. The tests are:
   - the bootstrap cases (addressed events, persisted paused state on first
     render), plus the partial-preparation failure cases in `main.test.ts`;
   - the error-capture regression cases;
   - the Phase 0 rows of the repeated-identity table, run in file order and
     with `--sequence.shuffle`.
6. **Lint guard** with the baseline set to every remaining offender
   ([Regression guard](#regression-guard)).

Phase 0 deletes `refreshHarness.ts`, five stubs in
`inactiveClusterDemand.test.tsx`, and 22 dead mocks.

### Phase 1: object panel and docking (62 suites, 195 owner mocks)

This phase comes first: it has the most suites and the most tier-1 suites
(62 and 55), plus the #401 incident.

- **Extract `PanelWindowShell`** and add a panel-window mount mode, so
  `PanelWindowApp.test.tsx` (14 owner mocks) runs the real chain. The mount
  goes through `prepareWindow` with a `role: 'panel'` descriptor.
- **Add a reset for `acknowledgedTransfers`** (`PanelWindowApp.tsx:54`), and
  add the transfer-id row of the repeated-identity table. That row must be
  red before the reset and green after it.
- **Coordinator and panel-window suites** (`core/panel-windows/*`,
  `ui/dockable/*`) run the real `DockablePanelProvider`,
  `PanelLifecycleGuardRegistry`, `ObjectPanelStateProvider`, and
  `WorkspacePanelSync`. They assert backend calls such as
  `AcknowledgePanelTransfer` and `PublishDockedPanels` through the RPC record.
- **Object-panel suites open panels through the real `openWithObject`** and
  assert the opened panel's full identity. Suites whose subject reads
  `CurrentObjectPanelContext` use full-app mode; the rest use provider mode
  ([eligibility](#mount-modes-and-eligibility); the pilot corrected the
  reader list).
  - The 13 Overview descriptor suites mostly stub `useObjectPanel` only, to
    capture link clicks. Consolidate them to one representative link test, plus
    per-kind cases where the kind actually branches (from notes: Overview is
    descriptor-driven).

Phase 1 deletes the stubs of `useObjectPanel`, `ObjectPanelStateContext`,
`@/ui/dockable`, the panel-window modules, and `panelLifecycleGuards`, together
with their co-stubbed cluster and refresh owners in these files.

### Phase 2: cluster and namespace views (46 suites, 288 owner mocks)

- **Views mount the full app and navigate** to their route, so
  `NamespaceResourcesProvider` and lazy route loading are real. Hook suites
  (`useBrowseCatalog`, `useTypedResourceQuery`, `useResourceGridTable`) and the
  owners' own suites use provider mode.
- **Fixtures serve the domain snapshots** and acknowledge streams.
- **Assertions:**
  - the stream `REQUEST` frames carry the visible cluster's id and scope;
  - rows render;
  - a row's Enter opens a panel with full identity;
  - leaving the view cancels its subscriptions.
- **Includes `KubeconfigContext.test.tsx` and `NamespaceContext.test.tsx`.**
  The owners' own suites keep their focus but run their neighbours for real.

Phase 2 deletes the stubs of `KubeconfigContext`, `NamespaceContext`,
`@/core/refresh`, `@/core/data-access`, `@/core/capabilities`,
`useNavigateToView`, `useNamespaceColumnLink`, and the grid persistence hooks
in these files.

### Phase 3: shell, navigation, and settings (42 suites, 134 owner mocks)

- **`App.menu.test.tsx`** runs the real `<App/>` (its 18 mocks go). Menu
  commands are asserted through their real effects: the settings modal opens,
  and `ExecuteApplicationMenuCommand` is recorded.
- **Favorites, command palette, sidebar, cluster tabs, and status** use the
  cluster and namespace fixtures. Navigation assertions read the real
  `ViewState`.
- **`main.test.ts`** keeps its root-component stubs (`./WorkspaceApp.tsx`,
  `./PanelWindowApp.tsx`), which are not owned-state modules. Its bootstrap
  ordering checks then run against the real `appPreferences` and the
  panel-window client.

### Phase 4: shared components and core infrastructure (33 suites, 68 owner mocks)

- **Refresh and data-access suites** (`dataAccess.test.ts`,
  `orchestrator.test.ts`, `orchestrator.streamingFlap.test.ts`,
  `domainContract.test.ts`) run the real stream managers over the fake
  sockets, instead of stubbing `./streaming/*`.
  - The cast-based private calls in `orchestrator.test.ts` and
    `resourceStreamManager.test.ts` are converted where the behavior is
    observable at the transport. The number of casts left over is recorded
    as a follow-up, not chased.
- **Shared components** (`ActionsMenu`, `ObjectPanelLink`, `ResourceHeader`,
  `DrainNodeModal`, `useObjectLink`) run against real panel, permission, and
  action owners.
- **Low-tier suites** (`Tooltip` and `StatusIndicator` stubbing
  `ZoomContext`; `utils/appearanceMode.test.ts` stubbing `appPreferences`)
  render inside the real provider, or test the pure helper directly. They
  never keep the stub under an exemption.

### Phase 5: close-out

- Move durable guidance into `docs/workflows/testing.md`: harness use, the
  boundary list, and the seeding and driving rules. Add a pointer from
  `frontend/AGENTS.md` Testing Guidelines.
- The lint baseline is empty; remove its negation block.
- Delete this plan.

### Production changes (complete list)

This list is the single source for non-goals, coverage, complexity, impact
analysis, and native checks. Anything outside it is a non-goal.

| Phase | File | Change | Runtime effect |
| --- | --- | --- | --- |
| 0 | `App.tsx` | Export `AppShell({ children })`; `App` renders `<AppShell><AppLayout /></AppShell>` | None: provider and effect order unchanged |
| 0 | `main.ts` | Extract `prepareWindow(config, preparation)` and `renderWindowRoot(…)`; add the caller-owned `preparation` record | None on success: same steps in the same order |
| 0 | `main.ts` | After a failed bootstrap, dispose the peer-preference subscription | **Behavior change** on the failure path only |
| 0 and later | Modules the ledger marks "new reset hook" | A narrowly named `reset…ForTesting` export next to the state | None: test-only entry point |
| 1 | `PanelWindowApp.tsx` | Extract `PanelWindowShell({ descriptor, children })` (done in the pilot) | None: provider and effect order unchanged |
| 1 | `PanelWindowApp.tsx` | A reset hook for `acknowledgedTransfers` (done in the pilot: `resetAcknowledgedPanelTransfersForTesting`) | None: test-only entry point |
| 1 | `publicationQueue.ts`, `helmValuesViewCache.ts`, `nodeLogsApi.ts`, `objectPanelTabRequests.ts` | A reset hook each (done; see [Phase 1 completion](#phase-1-completion-2026-10-22-uncommitted)) | None: test-only entry points |

### What stays a pure unit test (non-goals)

- **The 351 suites** (534 − 183) with no owned-state stub. This includes leaf
  utilities, parsers, codecs, column factories, reducers, and presentational
  components fed by props.
- **Mocks of the external boundary:** `@wailsio/runtime`, `@core/backend-api`,
  `@core/desktop-runtime`, `@/core/refresh/client`, `@core/telemetry/sentry`,
  `@/core/logging/appLogsClient`, `@/utils/platform`, npm packages, assets, and
  CSS.
- **Owners' own logic tests** that stub only the boundary, such as
  `store.test.ts` and `clusterWorkspaceStore.test.ts`.
- **Error-sink mocks** (`errorHandler`, `core/events`). They are not flagged;
  migrated files switch to the harness capture.
- **Child-component stubs.** These are a separate finding.
- **Native behavior.** The harness is jsdom. Native dragging, placement,
  focus, and window destruction still need the native app
  (`docs/workflows/completion.md:19-21`). Backend-backed rendering claims still
  follow AGENTS.md (the native window via Wails MCP).
- **Storybook, backend Go tests, and any production change** not in
  [Production changes](#production-changes-complete-list). Moving module state
  into component lifetime is one such change (Q12).

## Regression guard

### The rule

Add a Grit plugin, `frontend/biome-plugins/no-owned-state-mocks.grit`, that
matches `vi.mock($spec, $...)` and `vi.doMock($spec, $...)` when `$spec` names
an owned module.

- **Alias forms** are matched exactly, for example
  `@modules/kubernetes/config/KubeconfigContext` and `@/core/capabilities`.
- **Relative forms** are matched by a distinctive tail, for example
  `…/KubeconfigContext` and `…/WorkspacePanelSync`.
- **Generic relative tails cannot be matched by name:** `./index` (5 uses in
  `core/panel-windows`), `../store`, `../hooks`, and `../context`. All of these
  sit in baseline files. Migration rewrites them to aliases, and the residual
  gap is listed in [Self-review](#self-review).
- **The message names the harness.**

The plugin's `includes` select tests only:

```jsonc
{
  "path": "./biome-plugins/no-owned-state-mocks.grit",
  "includes": [
    "**/src/**/*.test.{ts,tsx}",
    // Baseline: suites not yet migrated. Each phase deletes its lines.
    "!**/src/modules/cluster/components/ClusterViewNodes.test.tsx"
    // …
  ]
}
```

Single-file negations are already an established form
(`frontend/biome.jsonc:203`). Every glob is `**/`-anchored, like the existing
plugins (`frontend/biome.jsonc:193-251`).

### Prototype (scratch, 2026-10-22)

A scratch copy of the rule ran under a scratch `biome.json` with Biome 2.6.2.
On a probe file it flagged both the alias form and a multi-line relative form
(`vi.mock(\n '../config/KubeconfigContext', …)`). It did not flag
`@/core/backend-api` or the look-alike `…/KubeconfigContextHelpers`: two
diagnostics, exit 1.

**A scratch config cannot prove the anchoring gotcha.** Under a `"root": true`
scratch config, both `src/**/*.test.tsx` and `**/src/**/*.test.tsx` fired. The gotcha was
observed in the real project layout (`"root": false`, extending the root
config) on Biome 2.5.3, per a memory note. That suggests it depends on layout
or version [assumed], so only an in-project probe is evidence.

### Proving the guard in-project (Phase 0)

Extend `frontend/scripts/check-biome-boundaries.test.mjs`. Its
`lintWithProjectConfig` (`:38-53`) already writes a probe file under `src/` and
lints it through the real project config. Pass
`fileName: 'adversarial.test.tsx'` for these cases:

1. An alias owner mock exits non-zero, and the output names the harness.
2. A multi-line relative owner mock exits non-zero.
3. `vi.mock('@/core/backend-api', …)` exits 0.
4. The real look-alike `@modules/kubernetes/config/KubeconfigContextLabel`
   (`modules/kubernetes/config/KubeconfigContextLabel.tsx` exists) exits 0.
5. An automock with no factory, `vi.mock('@/core/capabilities')`, exits
   non-zero.

Add isolated-plugin cases for the same patterns to the `lintWithPlugin` table
(`:15-36`).

**Red proof.** Temporarily change the include to the unanchored
`src/**/*.test.{ts,tsx}` and rerun case 1.

- If case 1 then exits 0, the test detects an inert plugin, as it should.
  Restore the include.
- If case 1 still fails, Biome 2.6.2 has fixed the gotcha upstream. Record
  that, and keep the anchored form for consistency.

Edit and restore through a scratchpad copy; never use `git stash`.

**Baseline proof.** `biome lint` exits 0 on the tree with the full baseline.
Deleting one baseline line makes it fail on exactly that file.

## Validation

### Mutation checks

Each phase picks at least two mutations that its migrated suites now cover,
and runs each one twice:

- **Before migration:** the original stubbed suites, where the expected result
  is green (the stub hid the defect).
- **After migration:** the migrated suites, which must be red.

Edit and restore through the scratchpad, never with git stash. Record the
command and the failing assertion. A mutation that stays green after migration
is a finding, either a harness gap or uncovered wiring, and is resolved before
the phase closes.

Candidate catalog. The code paths are verified; the red results are expected,
not yet observed:

| ID | Mutation | Hidden today by | Phase |
| --- | --- | --- | :-: |
| M1 | `openWithObject` skips `hydrateClusterMeta` and `assertObjectRefHasRequiredIdentity` (`useObjectPanel.ts:226-227`). The pilot found it masked by a second hydration; M1′ (`panelTargetSnapshot` drops the namespace) replaces it. | The `useObjectPanel` stub (59 suites) | 1 |
| M2 | The coordinator calls a guard-registry method unbound (the #401 class) | The `vi.fn` registry (`WorkspacePanelCoordinator.test.tsx:209-220`) | 1 |
| M3 | A view builds its refresh scope from `selectedKubeconfig` (selection) instead of `selectedClusterId` | The stub sets both to `'path:context'` (`ClusterViewNodes.test.tsx:155-162`) | 2 |
| M4 | Unnamed capability descriptors skip the namespace permission query (the Node Shell class) | The `@/core/capabilities` stub (29 suites) | 2 |
| M5 | `FavoritesProvider` moves outside `KubernetesProvider` | The pass-through Favorites (`App.menu.test.tsx:20`). In reality `useKubeconfig` throws outside its provider (`KubeconfigContext.tsx:122`; used at `FavoritesContext.tsx:168`). | 0 |
| M6 | `isDataAccessBlocked` ignores `autoRefreshEnabled` (`dataAccess.ts:26-31`) | `@/core/data-access` stubs (34 suites) | 2 or 4 |
| M7 | A view's unmount skips its lease release, so the stream stays subscribed | The `refreshOrchestrator` lease stubs (`ClusterViewNodes.test.tsx:209-210`) | 2 |
| M8 | `AppContent` stops calling `setActivePermissionCluster` (`App.tsx:72-74`) | Every suite: no suite runs `AppContent` with real permissions | 2 |
| M9 | `main.ts` renders before preferences hydrate (step 1 moved after step 5) | Suites that seed preferences with `setAppPreferencesForTesting` or stub `appPreferences` (10 suites) | 0 |
| M10 | `onEvent` stops filtering by `sender` (`core/desktop-runtime/index.ts:29-31`) | Suites that mock `@core/desktop-runtime` (58) | 0 |
| M11 | A Details sub-component throws during render, inside `DetailsTabDataErrorBoundary` | A `subscribeToErrors`-only capture: the boundary reports through `handleOperational`, which notifies no listener | 0 or 1 |
| M12 | `prepareWindow` records the opening transfer only after step 4, instead of right after the descriptor resolves | The render-only crash case (`main.test.ts:178-207`): a failure at step 4 would leave the transfer unfailed | 0 |

### Runtime budget

**Baseline.** Full `vitest run` from `frontend/`, 4 workers
(`vite.config.ts:135`):

- 75.4 s wall (`/usr/bin/time`), 5,372 tests, 0 failures, exit 0.
- Per-file test time: median 0.026 s, p95 0.33 s, maximum 2.93 s
  (`catalogFreshness.integration.test.tsx`).
- The 183 inventory suites take 30.2 s of the 46.5 s summed test time
  (median 0.06 s, p95 0.68 s). These numbers come from the JSON reporter's
  per-file start and end times, which exclude import.

**Projection** [not measured; superseded by the Phase 1 pilot's
re-projection]:

- **Mount mode split.** About 100 of the 183 suites need full-app mode: most
  of Phase 1's object-panel suites, Phase 2's views, and part of Phase 3. See
  [eligibility](#mount-modes-and-eligibility).
- **Import cost.** Full-app mode costs about 0.30 s of import per file
  (0.18 s for the provider stack plus 0.12 s for the app, from the probe).
  Provider mode costs about 0.18 s.
- **Total.** That is about 45 s of CPU, or about +11 s wall (+15%) on 4
  workers, before the costs the probe did not measure: `prepareWindow` per
  mount, `StrictMode`'s double effects, and fixture rendering.
- **Phase 0 re-projects.** It measures a bootstrapped `StrictMode` mount in
  both modes and recomputes the projection. If the new projection exceeds the
  budget, the numbers go to John (Q8) before Phase 1 starts.

**Budget** (Q8). John raised the end state from +20% to +60% after the
Phase 1 pilot measured that +20% is not reachable at full fidelity (2026-10-22;
see [Budget decision](#budget-decision-john-2026-10-22)):

- **End state:** wall time at most 60% above the baseline (at most 120 s) on
  the same machine, configuration, and command.
- **Checkpoint after Phase 1:** if its measured delta extrapolates above
  +60%, try a shared module cache for stub-free harness suites before
  raising the budget again.
- **Per migrated file:** p95 test time at most 1.0 s. Any migrated file over
  2 s states why.
- **Each phase** reports its wall-time delta and per-file distribution, from
  the same `--reporter=json` run.

**If a phase is over budget,** remedies keep the mount mode and per-test
teardown unchanged:

1. Remove duplicate consumer tests (`testing.md:29-31`, `:75-76`). Fewer tests
   means fewer mounts.
2. Merge sequential steps of one user workflow into one test, where they are
   genuinely one flow.
3. Profile the harness's own overhead: fixture payload size, flush loops, and
   timer advancement.
4. If the phase is still over, take the measurements to John to change the
   budget.

Never move a suite to provider mode for speed, never share a mount between
tests, and never bring back a stub.

### Coverage

**Baseline** (`wails3 task test:frontend-coverage`, 2026-10-22, exit 0):

- Statements 91.18%, branches 81.78%, functions 90.59%, lines 91.15%.
- `App.tsx` statements: 55%.

Each phase reports the overall change, and the change for each production
file it touched in [Production changes](#production-changes-complete-list).
Those are `App.tsx`, `main.ts`, and `PanelWindowApp.tsx`, plus each module
that gains a reset hook. Coverage is a diagnostic:
no test is added to recover a percentage, and drops from consolidating
duplicate consumer tests are acceptable (`testing.md:79-80`). Real owners now
execute, so an increase is expected [assumed].

### Gates per phase

- **Focused Vitest runs** of the migrated suites.
- **`mise exec -- wails3 task qc:prerelease`.** Then inspect the worktree,
  because the gate may format files.
- **Complexity** at 12 or lower for every production function the phase
  changed in [Production changes](#production-changes-complete-list), through
  `mise exec -- npm run complexity --prefix frontend -- <files>`. This covers
  `AppShell`, `prepareWindow`, `renderWindowRoot`, `main.ts`'s bootstrap and
  catch path, `PanelWindowShell`, and each new reset hook.
- **Native checks** apply to Phases 0 and 1, which change production
  composition and bootstrap. They need John's cluster choice first
  (AGENTS.md). Launch `wails3 dev` and confirm:
  - the workspace window boots with persisted preferences applied on its
    first render (paused stays paused);
  - a native panel window opens through a transfer and switches clusters.

  The reset hooks have no runtime path and need no native check. The
  failed-bootstrap disposal cannot be triggered natively without fault
  injection; `main.test.ts` covers it, and that limit is recorded in the
  phase's completion record.

## Open questions (recommended answers)

1. **Fake level for snapshot reads.**
   - **Recommended:** `fetch` (`/api/v2/*`). It keeps
     `refresh/client.ts` envelope validation and the ETag and permission
     handling real.
   - **Alternative:** keep mocking `@/core/refresh/client`, as `refreshHarness`
     users do today.
2. **Unfaked RPC policy.**
   - **Recommended:** strict. An unfaked method rejects with a named error and
     fails teardown.
   - **Alternative:** lenient `null`. In the probe, `null` answers produced
     confusing downstream failures, such as "Cannot read properties of null
     (reading 'kubeconfigs')".
3. **How to reach production composition and bootstrap.**
   - **Recommended:** the `AppShell({ children })` seam in `App.tsx`, plus
     `prepareWindow` and `renderWindowRoot` extracted from `main.ts`. Both
     keep provider, effect, and bootstrap order identical. The harness calls
     the same functions production calls.
   - **Rejected:** the harness re-implementing the bootstrap steps. That
     would be a second copy that can drift.
   - **Alternative:** move the `setActivePermissionCluster` effect into the
     provider chain. That changes when the effect runs relative to `AppLayout`
     effects, so it would need its own analysis.
4. **Permission fixture default.**
   - **Recommended:** allow everything, but answer through the real
     `QueryPermissions` path and record each query. A gate that never queries
     (the Node Shell class) still fails. Gate suites declare deny rules.
   - **Alternative:** require every test to declare permissions.
5. **Guard mechanism.**
   - **Recommended:** the Grit plugin with per-file negations as a shrinking
     baseline.
   - **Alternatives:**
     - per-call `biome-ignore` comments: about 685 suppressions that
       `check-biome-suppressions.mjs` would police;
     - a Node script with a JSON baseline, like `check-typescript-s3776.mjs`.
6. **Guard scope.**
   - **Recommended:** tier 1 and tier 2 owners plus tier-3 client wrappers.
   - **Not flagged:** sinks (`errorHandler`, `core/events`) and child-component
     stubs.
7. **Exemptions.**
   - **Recommended:** none by default. A suite that truly cannot use the
     harness stays in the baseline only with John's approval and a recorded
     reason.
8. **Runtime budget.**
   - **Recommended and approved:** at most +20% wall time (at most 90 s) at
     the end, and p95 at most 1.0 s per migrated file.
   - **Revised (John, 2026-10-22, after the Phase 1 pilot):** at most +60%
     wall time (at most 120 s); the p95 limit is unchanged.
9. **Delivery.**
   - **Recommended:** one change per phase. Phase 0 alone first, so the
     harness API is reviewed against real migrated suites before the bulk
     phases.
10. **Stateful fake drift**, for example the `ApplyClusterWorkspace` echo
    disagreeing with the backend.
    - **Recommended:** each stateful fake names its Go producer, and Phase 0
      reuses an existing backend test that pins the same semantics, or names
      the missing one as a follow-up.
    - **Alternative:** generated contract fixtures, which are heavier.
11. **`StrictMode` in the harness.**
    - **Recommended:** on, as in `main.ts:83`. It also matches `wails3 dev`,
      and it surfaces effects that are not idempotent, such as lease
      acquire and release.
    - **Cost:** unmeasured; Phase 0 measures it.
    - **Alternative:** off, which deviates from the production source.
12. **Module state that has no reset,** such as `acknowledgedTransfers`.
    - **Recommended:** a narrowly named reset hook next to the state, following
      the existing `…ForTesting` convention.
    - **Alternative:** moving the state into component lifetime. That is a
      production redesign with its own analysis, outside this plan.

## Self-review

An adversarial pass ran before presenting. It produced these changes and
known limits:

- **Counts were re-derived, not copied.** The brief's 122 and 252 / 1,286
  differ from this plan's 131 / 183 and 256 / 1,326. The method is stated
  above: aliases and relative specifiers are resolved, and the owner set is
  explicit.
- **Provider-only mode would have broken permission parity.** The first draft
  rendered the providers without `AppContent`. That would have silently
  dropped `setActivePermissionCluster` (`App.tsx:72-74`). The fix is the
  `AppShell` seam (Q3).
- **Route providers are not re-wrapped.** Re-wrapping
  `NamespaceResourcesProvider` in the harness would have been a second copy of
  `AppLayout`'s composition. Namespace views use the full-app mode instead.
- **The anchoring gotcha cannot be proved in scratch.** The guard's validation
  therefore relies on the in-project probe, not on the scratch result.
- **Known guard gaps:**
  - generic relative tails (`./index`, `../store`, `../hooks`, `../context`);
  - `vi.spyOn` on owner objects. One instance exists:
    `vi.spyOn(refreshOrchestrator, 'fetchScopedDomain')` at
    `core/refresh/orchestrator.test.ts:217`. It is inside an owner's own
    suite, spies on rather than replaces the real object, and is left alone.
- **The runtime projection** extrapolates from one probe with immediate
  answers. Real fixtures add payload render time, so the budget is checked per
  phase, not assumed.
- **Not checked:**
  - whether `PanelWindowApp` should also call `setActivePermissionCluster`.
    Only `App.tsx` calls it today; this is out of scope and not asserted
    either way;
  - Vitest's default `isolate` value: assumed true, see Teardown;
  - whether every mutation in the catalog goes red. Each phase must show this.

## Review round 1 (2026-10-22)

All four findings were checked against the code before the plan changed.

1. **[P1] Error capture missed handled failures.** Confirmed:
   - `handleInline` and `handleOperational` do not notify listeners
     (`utils/errorHandler.ts:265-286`; `errorHandler.test.ts:202-238`);
   - two production boundaries report only through `handleOperational`;
   - event-bus handler exceptions reach no observable sink in tests.

   The fix is [Error capture](#error-capture-every-reporting-path): spies on
   the four entry points, the event-bus reporter wrapper, and the React root
   options, with regression cases for each kind (mutation M11).
2. **[P2] Bootstrap before rendering.** Confirmed: `main.ts:37-45` hydrates
   preferences and sets the window identity before rendering, and `onEvent`
   filters by sender. The fix is [Bootstrap](#bootstrap-the-same-sequence-as-maints):
   `prepareWindow` and `renderWindowRoot` are extracted and used by both mount
   modes, with tests for addressed events and for the persisted paused state
   on first render (mutations M9 and M10).
3. **[P2] Isolation needs repeated identities.** Confirmed:
   `acknowledgedTransfers` (`PanelWindowApp.tsx:54`, `:101-104`). The fix is
   [Isolation](#isolation-module-state-and-repeated-identities): a
   module-state ledger with a reset strategy for each item, and
   repeated-identity tests that run in order and shuffled. The transfer row is
   red until the reset exists.
4. **[P2] The performance fallback contradicted route parity.** Confirmed: the
   old fallback switched mount modes for speed and shared mounts across tests.
   The fix:
   - eligibility is decided by composition only
     ([Mount modes](#mount-modes-and-eligibility));
   - the remedies keep the mount mode and per-test teardown;
   - shared mounts are removed;
   - the projection was redone at about +15% before the unmeasured costs,
     and Phase 0 re-projects.

## Review round 2 (2026-10-22)

Both findings were checked against the code before the plan changed.

1. **[P2] The paused-startup criterion forbade legitimate reads.** Confirmed:
   `foreground` and `user` reads run while paused
   (`core/refresh/refreshIntent.ts:11-15`), and the Overview reads on
   activation with `fetchOnEnable: 'foreground'` (`ClusterOverview.tsx:236-242`).
   The criterion now blocks only passive work: no stream `REQUEST` (refused
   while paused, `orchestrator.ts:655-657`), no polls (`:1066-1072`), and
   reads limited to the named foreground and user activation sites, plus a
   positive case for manual refresh.
2. **[P2] Cleanup when `prepareWindow` fails partway.** Confirmed: `main.ts`
   records the opening transfer at `:46-53`, before steps that can throw
   (`:54-64`), and its catch path fails it (`:84-96`). The only crash test
   fails during render (`main.test.ts:178-207`). The fix:
   - A caller-owned `preparation` record holds `openingPanel` and the
     subscription disposers from before the first step. `main.ts`'s single
     catch path disposes and then aborts.
   - Failure cases cover step 4, the root-module import, render, and
     descriptor resolution (mutation M12).
   - The one behavior change is disposing the peer-preference subscription
     after a failed bootstrap. Scrollbar tracking stays, because it is
     window-lifetime.

## Appendix A: suites by phase

Tier is the suite's worst stubbed tier. Calls counts its owned-state
`vi.mock` calls, excluding sinks. Generated on 2026-10-22 from `2ba0fb8a` by
the scratch inventory script.

### Phase 1

| Suite | Tier | Owner groups stubbed (calls) |
| --- | :-: | --- |
| `core/panel-windows/ClusterPanelsMenu.test.tsx` | 1 | panel, cluster, preferences, keyboard (4) |
| `core/panel-windows/ClusterTabTransferCoordinator.test.tsx` | 1 | panel, cluster, namespace, navigation, preferences (11) |
| `core/panel-windows/PanelLayoutLifecycle.test.tsx` | 1 | cluster, refresh (2) |
| `core/panel-windows/WorkspacePanelCoordinator.test.tsx` | 1 | panel, cluster, preferences (8) |
| `core/panel-windows/WorkspacePanelLifecycle.test.tsx` | 1 | panel, cluster (5) |
| `core/panel-windows/WorkspacePanelSync.test.tsx` | 1 | panel, cluster, refresh (5) |
| `core/panel-windows/panelTabActions.test.ts` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Details/DetailsTab.test.tsx` | 1 | actions, preferences, keyboard (3) |
| `modules/object-panel/components/ObjectPanel/Details/FinalizersSection.test.tsx` | 1 | actions, preferences (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.test.tsx` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/ConfigMapOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/EndpointsOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/HelmOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/IngressOverview.test.tsx` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/JobOverview.test.tsx` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/PodOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/PolicyOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/RBACOverview.test.tsx` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/SecretOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/StorageOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/WorkloadOverview.test.tsx` | 1 | panel, navigation (2) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx` | 1 | panel (1) |
| `modules/object-panel/components/ObjectPanel/Events/EventsTab.test.tsx` | 1 | panel, cluster, refresh, navigation (6) |
| `modules/object-panel/components/ObjectPanel/Helm/ManifestTab.test.tsx` | 1 | refresh, keyboard (4) |
| `modules/object-panel/components/ObjectPanel/Helm/ValuesTab.test.tsx` | 1 | refresh, keyboard (4) |
| `modules/object-panel/components/ObjectPanel/Jobs/JobsTab.test.tsx` | 1 | panel, cluster, namespace, navigation, preferences (6) |
| `modules/object-panel/components/ObjectPanel/Logs/LogViewer.benchmark.test.tsx` | 1 | refresh, preferences, keyboard (4) |
| `modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx` | 1 | refresh, preferences, keyboard (4) |
| `modules/object-panel/components/ObjectPanel/Map/MapTab.test.tsx` | 1 | panel, refresh, navigation (4) |
| `modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.test.ts` | 1 | refresh (1) |
| `modules/object-panel/components/ObjectPanel/Metrics/useUtilizationData.test.tsx` | 1 | refresh (1) |
| `modules/object-panel/components/ObjectPanel/NodeLogs/nodeLogsApi.test.ts` | 1 | refresh (1) |
| `modules/object-panel/components/ObjectPanel/ObjectPanel.groupContext.test.tsx` | 1 | panel, cluster, refresh, permissions, keyboard (9) |
| `modules/object-panel/components/ObjectPanel/ObjectPanel.test.tsx` | 1 | panel, refresh, permissions, keyboard (10) |
| `modules/object-panel/components/ObjectPanel/Pods/PodsTab.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (10) |
| `modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx` | 1 | cluster, preferences (2) |
| `modules/object-panel/components/ObjectPanel/Yaml/YamlTab.shortcuts.test.tsx` | 1 | refresh, keyboard (3) |
| `modules/object-panel/components/ObjectPanel/Yaml/YamlTab.test.tsx` | 1 | refresh, preferences, keyboard (4) |
| `modules/object-panel/components/ObjectPanel/hooks/nodeShellCapability.test.tsx` | 1 | refresh (2) |
| `modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx` | 1 | refresh, permissions (2) |
| `modules/object-panel/components/ObjectPanel/hooks/useObjectPanelLogsCapability.test.tsx` | 1 | cluster, refresh, permissions (3) |
| `modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh.test.tsx` | 1 | refresh (3) |
| `modules/object-panel/contexts/ObjectPanelStateContext.test.tsx` | 1 | cluster, refresh, preferences (3) |
| `modules/object-panel/hooks/useObjectPanel.test.tsx` | 1 | panel, cluster (4) |
| `modules/object-panel/identity/IdentityPanel.test.tsx` | 1 | panel, cluster, refresh, navigation, preferences, keyboard (10) |
| `modules/object-panel/components/ObjectPanel/Details/DetailsTabData.test.tsx` | 2 | keyboard (1) |
| `modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.test.tsx` | 2 | refresh (2) |
| `modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.test.tsx` | 2 | refresh (1) |
| `modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs.test.tsx` | 2 | keyboard (1) |
| `modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.test.tsx` | 3 | preferences (1) |
| `modules/object-panel/components/ObjectPanel/Details/Overview/ArgoCDOverview.test.tsx` | 3 | preferences (1) |
| `modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab.test.tsx` | 3 | refresh, preferences (2) |
| `PanelWindowApp.test.tsx` | 1 | panel, cluster, namespace, preferences, keyboard (14) |
| `ui/dockable/DockablePanel.behavior.test.tsx` | 1 | cluster (1) |
| `ui/dockable/DockablePanel.lifetime.test.tsx` | 1 | cluster, refresh (2) |
| `ui/dockable/DockablePanel.test.tsx` | 1 | cluster (1) |
| `ui/dockable/DockablePanelDropTargets.test.tsx` | 1 | cluster (1) |
| `ui/dockable/DockablePanelProvider.test.tsx` | 1 | cluster (1) |
| `ui/dockable/DockableTabBar.drag.test.tsx` | 1 | cluster (1) |
| `ui/dockable/DockableTabBar.test.tsx` | 1 | cluster (1) |
| `ui/dockable/appWidePanelClusterSwitch.test.tsx` | 1 | cluster (1) |
| `ui/dockable/useDockablePanelState.test.tsx` | 1 | cluster (1) |

### Phase 2

| Suite | Tier | Owner groups stubbed (calls) |
| --- | :-: | --- |
| `modules/browse/components/BrowseView.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (10) |
| `modules/browse/hooks/catalogFreshness.integration.test.tsx` | 1 | panel, cluster, refresh, actions, namespace, navigation (9) |
| `modules/browse/hooks/useBrowseCatalog.test.tsx` | 1 | refresh (5) |
| `modules/browse/hooks/useHydratedCustomCatalogRows.test.tsx` | 1 | refresh (1) |
| `modules/browse/hooks/useBrowseColumns.test.tsx` | 2 | navigation (1) |
| `modules/cluster/components/ClusterOverview.test.tsx` | 1 | panel, cluster, refresh, namespace, navigation (8) |
| `modules/cluster/components/ClusterResourcesManager.test.tsx` | 1 | cluster, refresh, permissions (3) |
| `modules/cluster/components/ClusterViewAttention.test.tsx` | 1 | panel, cluster, refresh, namespace, navigation, preferences (8) |
| `modules/cluster/components/ClusterViewCRDs.test.tsx` | 1 | panel, cluster, permissions, navigation, preferences (6) |
| `modules/cluster/components/ClusterViewConfig.test.tsx` | 1 | panel, cluster, refresh, permissions, navigation, preferences (7) |
| `modules/cluster/components/ClusterViewCustom.test.tsx` | 1 | panel, cluster, refresh, permissions, navigation, preferences (8) |
| `modules/cluster/components/ClusterViewEvents.test.tsx` | 1 | panel, cluster, navigation, preferences (5) |
| `modules/cluster/components/ClusterViewIdentities.test.tsx` | 1 | panel, cluster, refresh, navigation, preferences, keyboard (6) |
| `modules/cluster/components/ClusterViewNamespaces.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (9) |
| `modules/cluster/components/ClusterViewNodes.test.tsx` | 1 | panel, cluster, refresh, navigation, preferences (7) |
| `modules/cluster/components/ClusterViewNodesRevisit.test.tsx` | 1 | panel, cluster, refresh, actions, navigation, preferences (11) |
| `modules/cluster/components/ClusterViewRBAC.test.tsx` | 1 | panel, cluster, permissions, navigation, preferences (6) |
| `modules/cluster/components/ClusterViewStorage.test.tsx` | 1 | panel, cluster, navigation, preferences (5) |
| `modules/cluster/components/clusterCustomFilterPropagation.test.tsx` | 1 | panel, cluster, refresh, navigation (6) |
| `modules/global/components/GlobalViewClusters.test.tsx` | 1 | cluster, refresh, navigation, preferences (10) |
| `modules/global/components/GlobalViewNamespaces.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (12) |
| `modules/kubernetes/config/KubeconfigContext.test.tsx` | 1 | panel, refresh, navigation, preferences (6) |
| `modules/namespace/components/NsViewAutoscaling.test.tsx` | 1 | panel, cluster, permissions, namespace, navigation, preferences (7) |
| `modules/namespace/components/NsViewConfig.test.tsx` | 1 | panel, cluster, permissions, namespace, navigation, preferences (7) |
| `modules/namespace/components/NsViewCustom.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (9) |
| `modules/namespace/components/NsViewEvents.test.tsx` | 1 | panel, cluster, refresh, namespace, navigation, preferences (9) |
| `modules/namespace/components/NsViewHelm.test.tsx` | 1 | panel, cluster, refresh, actions, namespace, navigation (6) |
| `modules/namespace/components/NsViewMap.test.tsx` | 1 | panel, cluster, refresh, namespace, navigation (6) |
| `modules/namespace/components/NsViewNetwork.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (10) |
| `modules/namespace/components/NsViewPods.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (12) |
| `modules/namespace/components/NsViewQuotas.test.tsx` | 1 | panel, cluster, permissions, namespace, navigation, preferences (7) |
| `modules/namespace/components/NsViewRBAC.test.tsx` | 1 | panel, cluster, permissions, namespace, navigation, preferences (7) |
| `modules/namespace/components/NsViewStorage.test.tsx` | 1 | panel, cluster, permissions, namespace, navigation, preferences (7) |
| `modules/namespace/components/NsViewWorkloads.test.tsx` | 1 | panel, cluster, refresh, permissions, namespace, navigation, preferences (11) |
| `modules/namespace/contexts/NamespaceContext.test.tsx` | 1 | cluster, refresh, permissions (4) |
| `modules/namespace/contexts/NsResourcesContext.test.tsx` | 1 | cluster, refresh, permissions, namespace (4) |
| `modules/namespace/hooks/useNamespaceGridTablePersistence.test.tsx` | 1 | cluster, preferences (2) |
| `modules/namespace/components/useNamespaceColumnLink.test.tsx` | 2 | namespace, navigation (3) |
| `modules/namespace/components/useWorkloadTableColumns.test.tsx` | 2 | namespace (1) |
| `modules/object-map/ObjectMap.test.tsx` | 1 | panel, permissions, navigation, preferences (4) |
| `modules/resource-grid/queryBackedLeafFirstLoad.test.tsx` | 1 | panel, cluster, refresh, permissions, actions, namespace, navigation, preferences (14) |
| `modules/resource-grid/useQueryBackedResourceGridTable.test.tsx` | 1 | refresh, preferences (5) |
| `modules/resource-grid/useResourceGridTable.test.tsx` | 1 | cluster (1) |
| `modules/resource-grid/useTypedResourceQuery.anchor.test.tsx` | 1 | refresh (1) |
| `modules/resource-grid/useTypedResourceQuery.test.tsx` | 1 | refresh (1) |
| `modules/resource-grid/useAnchorOnUnmatchedFocusRequest.test.tsx` | 2 | keyboard (1) |

### Phase 3

| Suite | Tier | Owner groups stubbed (calls) |
| --- | :-: | --- |
| `core/contexts/ClusterLifecycleContext.test.tsx` | 1 | cluster, permissions (2) |
| `core/contexts/FavoritesContext.test.tsx` | 1 | cluster, namespace, navigation (5) |
| `core/contexts/SidebarStateContext.test.tsx` | 1 | cluster (1) |
| `core/contexts/ViewStateContext.telemetry.test.tsx` | 1 | panel, cluster, navigation (4) |
| `core/contexts/ZoomContext.test.tsx` | 1 | refresh (1) |
| `core/contexts/inactiveClusterDemand.test.tsx` | 1 | cluster, namespace, navigation, preferences (5) |
| `core/navigation/useAvailableResourceViews.test.tsx` | 1 | refresh (1) |
| `App.menu.test.tsx` | 1 | panel, cluster, permissions, navigation, preferences, keyboard (12) |
| `main.test.ts` | 1 | panel, preferences (2) |
| `ui/command-palette/CommandPalette.keyboard.test.tsx` | 1 | panel, cluster (2) |
| `ui/command-palette/CommandPalette.test.tsx` | 1 | panel, cluster, keyboard (3) |
| `ui/command-palette/CommandPaletteCommands.test.tsx` | 1 | cluster, refresh, namespace, navigation, preferences (10) |
| `ui/favorites/FavMenuDropdown.test.tsx` | 1 | cluster, refresh, namespace, navigation (5) |
| `ui/favorites/FavSaveModal.test.tsx` | 1 | cluster, namespace, keyboard (3) |
| `ui/favorites/FavToggle.test.tsx` | 1 | cluster, namespace, navigation (4) |
| `ui/layout/ClusterTabs.test.tsx` | 1 | panel, cluster, navigation, preferences, keyboard (5) |
| `ui/layout/Sidebar.navigation.test.tsx` | 1 | panel, cluster, refresh, namespace (8) |
| `ui/layout/Sidebar.test.tsx` | 1 | cluster, refresh, namespace, navigation (6) |
| `ui/layout/appFocusRegions.test.tsx` | 1 | panel (1) |
| `ui/layout/namespaceScope.test.ts` | 1 | refresh, namespace (2) |
| `ui/layout/NamespaceScopeEditor.test.tsx` | 3 | namespace (1) |
| `ui/modals/ObjectDiffModal.test.tsx` | 1 | cluster, refresh (2) |
| `ui/modals/SettingsModal.test.tsx` | 1 | refresh (1) |
| `ui/modals/useObjectDiffYaml.test.tsx` | 1 | refresh (2) |
| `ui/overlays/AuthFailureOverlay.integration.test.tsx` | 1 | cluster (1) |
| `ui/panels/app-logs/AppLogsPanel.test.tsx` | 1 | panel, cluster, preferences, keyboard (4) |
| `ui/settings/sections/ObjectPanelSection.test.tsx` | 1 | panel, preferences (3) |
| `ui/settings/sections/preferenceConcurrency.test.tsx` | 1 | panel, navigation (3) |
| `ui/settings/sections/AdvancedSection.test.tsx` | 2 | preferences (2) |
| `ui/settings/sections/AppearanceSection.test.tsx` | 2 | preferences (2) |
| `ui/settings/sections/DataManagementSection.test.tsx` | 2 | navigation, preferences (2) |
| `ui/settings/sections/DisplaySection.test.tsx` | 2 | preferences (1) |
| `ui/settings/sections/LogsSection.test.tsx` | 2 | preferences (1) |
| `ui/shortcuts/components/GlobalShortcuts.test.tsx` | 1 | cluster, preferences, keyboard (3) |
| `ui/shortcuts/components/PanelWindowShortcuts.test.tsx` | 1 | panel, navigation, preferences (6) |
| `ui/shortcuts/components/SearchShortcutHandler.test.tsx` | 2 | keyboard (1) |
| `ui/shortcuts/components/TextContextMenu.test.tsx` | 2 | preferences, keyboard (2) |
| `ui/shortcuts/useSearchShortcutTarget.test.tsx` | 2 | keyboard (1) |
| `ui/status/ConnectivityStatus.test.tsx` | 1 | cluster, refresh, namespace, preferences (6) |
| `ui/status/SessionsStatus.test.tsx` | 1 | panel, cluster (4) |
| `ui/status/UpdateStatus.test.tsx` | 1 | refresh, navigation (2) |
| `ui/status/MetricsStatus.test.tsx` | 2 | refresh (2) |

### Phase 4

| Suite | Tier | Owner groups stubbed (calls) |
| --- | :-: | --- |
| `core/capabilities/hooks.test.tsx` | 1 | cluster, permissions (2) |
| `core/capabilities/permissionStore.test.ts` | 1 | refresh (1) |
| `core/data-access/dataAccess.test.ts` | 1 | refresh (2) |
| `core/data-access/useScopedRefreshDomainLifecycle.test.tsx` | 1 | refresh (1) |
| `core/refresh/components/DiagnosticsPanel.test.ts` | 1 | panel, cluster, refresh, permissions, namespace, navigation (7) |
| `core/refresh/domainContract.test.ts` | 1 | refresh (2) |
| `core/refresh/hooks/useMetricsAvailability.test.tsx` | 1 | cluster, refresh, navigation (5) |
| `core/refresh/orchestrator.streamingFlap.test.ts` | 1 | refresh (1) |
| `core/refresh/orchestrator.test.ts` | 1 | refresh (2) |
| `hooks/multiClusterIsolation.test.ts` | 1 | refresh (1) |
| `shared/components/ObjectPanelLink.test.tsx` | 1 | panel, navigation (2) |
| `shared/components/kubernetes/ActionsMenu.integration.test.tsx` | 1 | panel, permissions, navigation, keyboard (4) |
| `shared/components/kubernetes/ActionsMenu.test.tsx` | 1 | panel, permissions, actions, navigation, preferences, keyboard (6) |
| `shared/components/kubernetes/ResourceHeader.test.tsx` | 1 | panel, navigation (2) |
| `shared/components/modals/DrainNodeModal.test.tsx` | 1 | refresh, actions (4) |
| `shared/components/tables/GridTable.rowDetail.test.tsx` | 1 | refresh (1) |
| `shared/components/tables/hooks/useGridTableDownloadAction.test.tsx` | 1 | refresh (1) |
| `shared/components/ResourceLoadingBoundary.test.tsx` | 2 | refresh (1) |
| `shared/components/tables/GridTable.test.tsx` | 2 | keyboard (1) |
| `shared/components/tables/GridTableFiltersBar.test.tsx` | 2 | keyboard (1) |
| `shared/components/tables/GridTableKeys.test.tsx` | 2 | keyboard (1) |
| `shared/components/tables/hooks/useGridTableHeaderContextMenu.test.tsx` | 2 | keyboard (1) |
| `shared/components/tables/hooks/useGridTableShortcuts.test.tsx` | 2 | keyboard (1) |
| `shared/components/tables/persistence/useGridTablePersistence.multicluster.test.tsx` | 2 | preferences (1) |
| `shared/components/tables/persistence/useGridTablePersistence.test.tsx` | 2 | preferences (1) |
| `shared/components/yaml/YamlEditor.test.tsx` | 2 | preferences, keyboard (3) |
| `shared/components/ResourceBar.test.tsx` | 3 | preferences (1) |
| `shared/components/Tooltip.test.tsx` | 3 | preferences (1) |
| `shared/components/status/StatusIndicator.test.tsx` | 3 | preferences (1) |
| `shared/hooks/useNodeMaintenanceActions.lifecycle.test.tsx` | 1 | refresh, permissions, actions (3) |
| `shared/hooks/useObjectLink.test.tsx` | 1 | panel, navigation (2) |
| `shared/hooks/useNavigateToView.test.tsx` | 2 | namespace, navigation, keyboard (4) |
| `utils/appearanceMode.test.ts` | 2 | preferences (1) |
