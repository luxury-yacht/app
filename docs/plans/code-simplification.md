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
selects one cohesive responsibility and records the remaining domain scope.
After domain 14, restart with unreviewed responsibilities. Record any
correctness-driven interruption and resume the rotation afterwards.

| Order | Domain | Initial scope and required adjacent paths | Status |
| --- | --- | --- | --- |
| 1 | Shared tables | Shared table hooks/rendering; resource-grid adapters; snapshot/querypage consumers | Selected: sizing/measurement |
| 2 | Catalog and resource projections | Object catalog; per-kind resources; kind/model contracts; Browse adapters | Inventoried |
| 3 | Cluster/workspace/auth | Backend cluster/workspace owners and auth helpers; Kubernetes/cluster workspace contexts | Inventoried |
| 4 | Refresh and data access | Refresh APIs, stores, snapshots, ingestion, streams, metrics and governor; frontend refresh/data brokers | Inventoried |
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

## Next pass: S001 — table sizing and measurement

**Status: selected for investigation; no implementation finding confirmed.**

Selection evidence: the table bucket has 79 authored files and 25 Biome signals;
the [GridTable contract](../frontend/gridtable.md) makes it the shared table
owner. [Sizing](../frontend/gridtable-sizing.md) documents page replacement,
virtualization, zoom conversion, inert measurement, and persisted width ownership.
These obligations make an owner/consumer trace more useful than isolated edits
in whichever function has the largest score.

- [ ] Split the table bucket into sizing/measurement, columns/persistence,
  filtering/pagination, keyboard/selection, and rendering/virtualization.
- [ ] Trace `useGridTableColumnWidths`, its helpers, `useDirtyQueue`,
  `useGridTableColumnMeasurer`, resize control, the controller, and persistence.
  Inventory the actual callers and tests before judging duplication.
- [ ] Record which state each layer owns and why. Check the
  [settled findings](../../.agents/skills/app-review/references/settled-findings.md):
  table configuration and persistence are already consolidated; do not propose
  another general schema or wrapper on the basis of this scan.
- [ ] Identify a concrete simplification with before/after responsibilities, or
  record why the current decomposition should remain. Compare total complexity
  of the solution, including helper indirection, rather than a single score.
- [ ] For an accepted candidate, confirm characterization of page replacement,
  user-width persistence, virtualization invalidation, pending measurement,
  zoom conversion, and cancellation/cleanup as applicable.
- [ ] Refactor incrementally and run the affected validation from the
  [completion contract](../workflows/completion.md), including rendered/native
  interaction evidence when required by the changed contract.
- [ ] Record remaining table scope and advance to domain 2. Do not mark all 79
  files reviewed because one sizing function changed.

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
| `backend/(root: cluster)` | 23 | 3451 | 1 / — | Inventoried |
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
| `backend/(root: workspace)` | 16 | 2130 | — / — | Inventoried |
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
| `backend/objectcatalog` | 25 | 5995 | 8 / — | Inventoried |
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
| `backend/refresh/snapshot` | 77 | 20864 | 11 / — | Inventoried |
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
| `frontend/src/core/cluster-workspace` | 2 | 755 | — / — | Inventoried |
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
| `frontend/src/modules/kubernetes` | 1 | 856 | — / — | Inventoried |
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
| `frontend/src/shared/components/tables` | 79 | 14583 | — / 25 | Inventoried |
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
