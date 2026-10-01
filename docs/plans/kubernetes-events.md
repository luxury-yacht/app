# Kubernetes Events fixes

Temporary plan from the 2026-09-30 Events review. Delete it after the durable
contracts below move into their owning docs.

## Target model

- `cluster-events` and `namespace-events` are doorbell-backed snapshot tables on
  the `resources` stream, like `cluster-identities`. Each maintained store's own
  informer handler rings its doorbell **after** the store applies the change.
  Adds, real updates, and deletes ring; resync echoes do not. Namespace events
  ring `namespace:<ns>` and `namespace:all`. Rings are debounced like the
  object-events doorbell.
- `backend/refresh/eventstream` is removed. It has no production subscriber;
  its only live role was the doorbell above.
- One event timestamp rule (`resources/events`) serves every surface.
- One event row projection supplies the display fields every table shares.
- The object-panel Events tab serves the most recent events when it truncates
  and does not drop events for a version mismatch inside the same API group.

## Non-goals

- Merging the cluster and namespace query adapters (settled: dismissed).
- Changing the 15s informer resync interval.
- Changing the object-events doorbell's matching or debounce.

## Phase 1 — event table doorbells

- [x] Red: composed test (fake informer → maintained store → doorbell →
      resource-stream subscribers → snapshot build) covering add, delete,
      resync echo, `namespace:all`, and cluster scope.
- [x] Ring from the maintained-store handlers. (The namespaces notifier's
      events handler keeps re-scanning on resync echoes: CPU only, no visible
      failure, left out of scope.)
- [x] Remove `eventstream`, its subsystem wiring, dead config, the
      `events` telemetry stream and scope leaf, and `timeutil.LatestEventTimestamp`.
- [x] Contract: orchestrator `doorbell-snapshot`, diagnostics stream
      `resources`, inventory like `cluster-identities`; drop the
      `event-stream` vocabulary; regenerate.
- [x] Diagnostics Events card reads the resources stream's event-domain leaves.
- [x] Update `docs/architecture/refresh-system.md` stream-leaf text.

## Phase 2 — one timestamp rule

- [x] Red: Overview Recent Events keeps a series Warning that began >24h ago
      and recurred recently, and orders by last observation.
- [x] Use `eventres.EventTimestamp` for the cutoff and sort; delete
      `snapshot.eventTimestamp`.

## Phase 3 — one event row projection

- [x] Decide placeholder semantics: `-` everywhere, raw values from the
      backend, no Message→Reason fallback (user, 2026-09-30). The Event detail
      status keeps the shared status vocabulary (`Unknown`).
- [x] Red: placeholder and structured-object tests
      (`event_row_projection_test.go`, `eventColumns.test.tsx`).
- [x] Shared projector (`projectEventRow`); `ClusterEventEntry` is a defined
      type over `EventSummary`; Object Type/Name from `objectKind`/`objectName`.
      The object-panel `ObjectEventSummary` keeps its own shape (raw source).

## Phase 4 — object-panel Events tab

- [x] Red + fix: sort by last observation before truncating.
- [x] Red + fix: match the involved object's group, not exact `apiVersion`.
- [x] Row click opens the Event; Object Name opens the involved object (user,
      2026-09-30).
- [x] Display-only links resolve only through the catalog by UID. The
      built-in kind table is not applied to them: the shared resource model
      forbids guessing group/version from `kind`.

## Remaining (not in this change)

- The namespaces notifier's Events handler still recomputes its warning
  rollup on resync echoes (CPU only).
- `buildEventObjectReference`'s no-link path still guesses a built-in
  group/version from `kind` for the Overview's Recent Events (pre-existing).
- `clusterDataRowModel.ts` functions at lines 126, 297, 352 score 14, 29, 46
  (untouched, pre-existing).

## Completion record

| Criterion | Status | Evidence |
| --- | --- | --- |
| All Namespaces Events refetches on a namespaced event change | passed | `TestEventTableDoorbellsReachEveryViewedScopeAfterTheStoreApplies` red→green |
| Event deletes ring the owning scopes | passed | same test; temporary red variant failed before the fix |
| Resync echoes do not ring | passed | `TestEventTableDoorbellsIgnoreInformerResyncEchoes` red→green |
| Read after a ring sees the change | passed | composed test reads the snapshot after each ring |
| Cluster events ring only the cluster scope | passed | composed test quiet checks |
| Diagnostics Events card shows event-domain deliveries | passed | `diagnosticsRowModel.test.ts` red→green |
| Overview Recent Events uses last observation | passed | `TestBuildRecentEventsUsesTheLatestObservationOfASeries` red→green |
| Empty type/source/message raw; untyped not shown as Normal | passed | `TestEventSurfacesSendEmptyDisplayFieldsRaw`, `eventColumns.test.tsx` red→green |
| Events tab row opens the Event | passed | `EventsTab.test.tsx` red→green |
| Display-only links open via catalog UID | passed | `eventObjectIdentity.test.ts` red→green |
| Object events truncation and group matching | passed | two `object_events_test.go` tests red→green |
| Runtime check against a live cluster | blocked | no local cluster running; production kubeconfigs not used |
| Focused suites, coverage, complexity | passed | see session report |
| `qc:prerelease` | passed | exit 0, 2026-09-30: docs, fmt, bindings, vet, race, lint-fix, lint, typecheck, frontend, knip, trivy |
