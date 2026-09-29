# Logs hardening and simplification

Temporary plan. Created 2026-09-28 from a review of the container (pod/workload)
logs feature. Approved scope: refactors R1–R5 below, including keyboard
shortcuts for Node Logs. Delete this plan after its durable guidance moves into
the owning docs listed in Phase D.

Citations use `path:line` against the 2026-09-28 tree (`main` at `03340611`).
Items marked **[probe]** were reproduced with a throwaway test that was deleted
afterward. Items marked **[code-read]** are traced through source but not
reproduced. Items marked **[unverified]** depend on behavior outside this repo.

An external review of this plan on 2026-09-28 raised five design issues (resume
versus tail bounds, expired watch versions, the late-history cut-off, timeout
versus inactivity, and pod list/watch permissions). All five were verified and
are resolved in A2, A5, A6, A9, B2, B3 and open question 8. A second round the
same day raised three more (a partially observed initial timestamp group, byte
eviction versus the cut-off, and the unnamed Logs permission); all three were
verified and are resolved in A5, B2, B10 and open question 8. A third round
showed that skipping a whole partial group can lose unread lines after an
interrupted tail, and that byte eviction can invalidate a count-based cut-off;
A5 now matches the delivered run instead, and B2 drops the cut-off. A fourth
round showed that matching could withhold unmatched replay lines indefinitely
on a quiet stream; A5 now bounds replay matching by size and time.

## Goal

Make container logs tolerant of real-cluster failures and honest about what they
show, remove the duplicate data paths that cause most of the failures, and share
one viewer shell between Container Logs and Node Logs.

## Target model

### Backend

- `backend/internal/containerlogs` becomes the single log engine used by both
  transports. It owns scope-to-pod resolution for every supported kind, target
  selection (existing `SelectTargets`), log reading with a truncating line
  reader and a parse-based timestamp split, stable ordering, per-container
  resume state (timestamp plus count of lines to skip), a per-container
  response timeout, and per-target issue classification. It stays a leaf
  package: it may import client-go and Kubernetes API types but not the app's
  kind registry (`backend/internal/containerlogs/target_identity.go:13-15`
  explains the cycle).
- `backend/refresh/containerlogsstream` opens **one follow request per
  container that carries both history and live output** (`Follow` plus
  `TailLines`), replacing today's separate sequential history pass
  (`streamer.go:139-157`) and the barrier that starts followers only after it
  (`handler.go:155-159`). Follow streams already open in parallel today
  (`streamer.go:361-367`), so no parallelism setting is needed. It also owns
  session lifecycle, watch-driven target lifecycle (a per-session informer for
  pod discovery; restarts keyed by container ID), the global target limiter
  (unchanged), and delivery through one bounded pending buffer that emits
  typed protocol frames. See [Prior art: stern](#prior-art-stern).
- `backend/resources/pods` `FetchContainerLogs` serves previous-container logs
  (its only remaining frontend caller after Phase B) through the shared engine,
  with bounded parallelism (5, stern's non-follow default) and the gateway's
  direct-fetch budget (`backend/fetch_helpers.go:142-151`).

### Stream protocol

Typed frames, generated into TypeScript through the refresh contract generator
(`backend/internal/genrefreshcontracts/registry.go:219-220`):

- **Fatal error**: `error`, optional `errorDetails` (permission status), and
  `retryable`. The handler closes the stream after sending it.
- **Target issues**: a full list of per-container problems
  (`pod`, `container`, init/debug flags, `state: unavailable | failed | forbidden`,
  `reason`). Per-container failures never set `error`.
- **Warnings**: typed values — target limit (`scope: perTab | global`, `hidden`,
  `limit`) and dropped entries (`count`). The frontend renders them; it no
  longer parses backend sentences.
- **Snapshot staging**: the initial snapshot is everything received from the
  per-container follow streams within a 2 s deadline, trimmed to the client's
  `maxEntries` and `maxBytes` (sent in the request) and split into
  2 MiB frames (open question 5). The first frame carries `reset`, the last carries
  `snapshotComplete`. History that arrives later travels as ordinary batches,
  and the frontend buffer, the only owner of eviction, decides what it keeps
  (B2). Live batches are bounded by count and bytes and
  keep the 250 ms batching window (`backend/internal/config/config.go:260`).

### Frontend

- `frontend/src/core/refresh/streaming/containerLogsStreamProtocol.ts`: a pure
  transition reducer following the existing resource-stream pattern
  (`frontend/src/core/refresh/streaming/resourceStreamProtocol.ts:216-300,701`).
  Proposed phases: `connecting`, `awaiting-snapshot`, `live`,
  `reconnecting{attempt, reason}`, `failed{reason, permissionDenied, retryable}`,
  `stopping`. Socket, timer and store work stay manager-owned effects.
- `containerLogsStreamManager` is the only writer of `container-logs` scoped
  state. It keeps entries in timestamp order on insert and projects phase,
  typed warnings, target issues and truncation into the payload. Fields read by
  diagnostics stay: `status`, `error`, `data.entries`, `data.resetCount`
  (`frontend/src/core/refresh/components/DiagnosticsPanel.tsx:1100-1135`).
- `LogViewer` only reads. Its view mode becomes `live | previous`; previous logs
  live in component state and never touch the live buffer. Active-pod pruning
  becomes a display filter.
- A shared viewer shell under `ObjectPanel/Logs` provides the options reducer,
  presentation pipeline, toolbar builder, keyboard shortcuts and copy action.
  Container Logs and Node Logs both use it; each keeps its own source selection
  and transport. The object-panel skill already states this intent
  (`.agents/skills/object-panel/SKILL.md:80-84`); the code has drifted from it.

## Non-goals

- Application Logs. They have a separate app-global contract and a grid viewer
  ([application-logs.md](../workflows/logs/application-logs.md)).
- Node Logs backend, transport and source discovery
  (`backend/resources/nodes/logs.go` reads byte-bounded raw content).
- Reusing the shared pod informer/ingest store for log target discovery. It would
  inherit readiness and namespace-permission semantics that were not traced.
  Each per-stream watch is already limited to one namespace and selector.
- Visual redesign or new controls. Node Logs picks up the shared toolbar's
  tooltips and icon sizes as a side effect of sharing the builder.
- Changing the per-scope or global target limit settings.
- Merging reconnect snapshots into existing history (open question 1).

## Findings ledger

| ID | Finding | Evidence | Phase |
| --- | --- | --- | --- |
| F1 | With auto-refresh on, any error with no entries renders "Loading logs..." forever. **[probe]** | `LogViewer.tsx:1376-1395`, `LogViewer.tsx:940-979` | B |
| F2 | Any error frame flips the view to fetch polling; recovery always "succeeds", so a persistent per-container failure oscillates every ~3 s and `MAX_RECOVERY_ATTEMPTS` never applies. [code-read] | `handler.go:407-418`; `useContainerLogsStreamFallback.ts:204-210,286-356`; `orchestrator.ts:889`; `containerLogsStreamManager.ts:136-141` | B |
| F3 | A line over 1 MiB stops live logs for that container permanently; the fetch path discards the whole container. **[probe]** | `backend/internal/linescanner/scanner.go`; `streamer.go:661-672`; `logs.go:411-413` | A |
| F4 | The initial snapshot is one frame of up to per-scope limit × 1000 lines; the frontend keeps 1000. Wails rejects frames over 64 MiB. [code-read; size threshold estimated] | `handler.go:230-240`; `config.go:269`; `targets.go:10`; `containerLogsStreamManager.ts:211-217`; wails `v3.0.0-beta.26/pkg/application/stream_transport.go:50` | B |
| F5 | Init containers of pods that appear after the stream starts are never followed. [code-read] | `streamer.go:788-791`, `streamer.go:269-282` | A |
| F6 | Pod-kind streams never watch the pod: a recreated pod (same name) or a new debug container is not followed, with no indication. [code-read] | `streamer.go:203-206`, `streamer.go:639-641`, `streamer.go:807-809` | A |
| F7 | Lines sharing a timestamp are reordered by an unstable sort **[probe]**; identical lines at one timestamp are dropped [code-read]. | `streamer.go:176-188`; `logs.go:126-141`; `streamer.go:704-720`; `types.go:83-92` | A |
| F8 | A follower with no resume point replays the container's whole log file. [code-read] | `streamer.go:623-630`, `streamer.go:146-155` | A |
| F9 | Two writers of `container-logs` state: the manager's private buffer and direct `LogViewer` store writes. Pruned or stale entries come back on the next batch. [code-read] | `containerLogsStreamManager.ts:467-486`; `LogViewer.tsx:1741-1763`, `LogViewer.tsx:1861-1880`, `LogViewer.tsx:1882-1937` | B |
| F10 | Opening a tab runs a priming fetch alongside the stream, with a different tail size. [code-read] | `useContainerLogsStreamFallback.ts:399-411`; `LogViewer.tsx:426` | B |
| F11 | Tails run one target at a time with no per-target timeout; the fetch path skips the gateway budget; partial failures are only logged. [code-read] | `streamer.go:139-157`; `logs.go:106-124`; `pod_logs.go:28` vs `fetch_helpers.go:142` | A, B |
| F12 | The transport-drop warning and buffer-truncation notice are never displayed. [code-read] | `handler.go:27`; `LogViewer.tsx:1666-1673`; `containerLogsStreamManager.ts:643-645` | B |
| F13 | Pod resolution is implemented twice and already diverges; most request fields are never sent. [code-read] | `logs.go:198-366` vs `streamer.go:819-968`; `logs.go:251-259` vs `streamer.go:838-844`; `types.go:44-58`; `containerLogsStreamManager.ts:212-217`; `LogViewer.tsx:414-428` | A |
| F14 | `refreshOnce` manual mode is unreachable for container logs, and would finish on the empty handshake frame. [code-read] | `containerLogsStreamManager.ts:377-392`; `orchestrator.ts:1300-1307`; `handler.go:174-176` | B |
| F15 | Reconnect backoff resets on socket open, so terminal errors retry at the base delay. [code-read] | `containerLogsStreamManager.ts:218`; `frontend/node_modules/@wailsio/runtime/dist/stream.js:325-331` | B |
| F16 | Diagnostics noise: quiet streams record heartbeat-timeout errors; normal watch expiry is a warning plus telemetry error; watch backoff never resets; CronJob streams watch every pod in the namespace; cron ownership caches transient errors; `ContainerLogsStreamKeepAliveInterval` is unused. [code-read] | `handler.go:450-456,524-526`; `streamer.go:412-429,454-463,881-883,1070-1075`; `config.go:262-263` | A |
| F17 | `useLogFiltering` re-sorts the whole buffer on every batch. [code-read] | `useLogFiltering.ts:223-227` | B |
| F18 | Container and Node Logs duplicate the toolbar, options state and presentation pipeline, and have drifted (Node Logs has no shortcuts, different tooltips and icon sizes, deferred filtering, silent copy failures). [code-read] | `LogViewer.tsx:1006-1170` vs `NodeLogsTab.tsx:579-697`; `NodeLogsTab.tsx:707-722,750-966`; `useLogKeyboardShortcuts.ts:12-27` | C |
| F19 | Timestamps with a numeric offset are not split. Whether kubelet emits offsets on non-UTC nodes is **[unverified]**; a parse-based split removes the question. | `streamer.go:1050-1056`; `logs.go:418-424` | A |
| F20 | Stopping and restarting the same target key can run two followers on one shared `containerState` (a concurrent map write would crash the app); states are never deleted. [code-read, not reproduced] | `streamer.go:269-291`, `streamer.go:310-320` | A |
| F21 | Fallback "polling" never polls: the `container-logs` refresher is never registered, so `refreshManager.enable` returns early. Fallback mode is one fetch, then nothing until recovery restarts the stream. The fallback manager's tests mock `RefreshManager`, so they cannot see this. [code-read] | `orchestrator.ts:276-287,1244-1248`; `domainRegistrations.ts:25-38`; `RefreshManager.ts:298-302`; `containerLogsFallbackManager.ts:117-124`; `containerLogsFallbackManager.test.ts:18-27` | B |
| F22 | Workload logs already require `list`/`watch` on pods, but the Logs capability only checks `get pods/log`, so users without them see the tab fail with a generic error. Watch-based pod-kind tracking extends the same requirement to single pods. [code-read] | `useObjectPanelCapabilities.ts:170-189`; `streamer.go:432-434,846-856` vs `streamer.go:838-844`; `logs.go:251-259` | A, B |
| F23 | The Logs tab gate queries `get pods/log` without a name, while a named `view-logs` descriptor for the same check goes unread. Unnamed queries never match `resourceNames` rules, so a per-pod grant hides the tab. [code-read] | `useObjectPanelCapabilities.ts:170-191,428-436,487-495`; `core/capabilities/hooks.ts:64-72`; `backend/capabilities/rules.go:237-250` | B |

## Inventory

Line counts from `wc -l` on 2026-09-28.

| File | Lines | Fate |
| --- | ---: | --- |
| `backend/internal/containerlogs/*.go` (non-test) | 511 | Grows into the engine; `linefilters.go`, `podnamefilter.go` and the container-state filter are deleted (only used by unsent request fields) |
| `backend/internal/linescanner/scanner.go` | ~20 | Replaced by the truncating reader in `containerlogs` (only log code imports it) |
| `backend/resources/pods/logs.go` | 445 | Resolver and tail code removed; previous-logs fetch on the engine |
| `backend/pod_logs.go` | 67 | Uses the gateway fetch budget |
| `backend/refresh/containerlogsstream/streamer.go` | 1113 | Separate history pass removed (one follow request per container); resolver and reader move to the engine; watch-driven lifecycle with a per-session informer |
| `backend/refresh/containerlogsstream/handler.go` | 669 | Delivery rewritten around one pending buffer; typed frames |
| `backend/refresh/containerlogsstream/types.go` | 92 | Protocol types; unused request fields removed |
| `backend/refresh/containerlogsstream/limiter.go` | 256 | Unchanged |
| `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts` | 656 | Sole writer; protocol reducer; `refreshOnce` removed |
| `frontend/src/core/refresh/fallbacks/containerLogsFallbackManager.ts` (+test) | 146 (+113) | Deleted |
| `.../Logs/hooks/useContainerLogsStreamFallback.ts` (+test) | 421 (+478) | Deleted |
| `.../Logs/LogViewer.tsx` | 2609 | Fallback, priming, suppression, warning parsing and duplicated presentation removed |
| `.../Logs/logViewerReducer.ts` | 342 | Shared options split out; mode becomes `live \| previous` |
| `.../Logs/hooks/useLogFiltering.ts` | 280 | Sorting removed; folded into the shared presentation hook |
| `.../Logs/hooks/useLogKeyboardShortcuts.ts` | 324 | Generalized for both viewers |
| `.../NodeLogs/NodeLogsTab.tsx` | 1124 | Adopts the shared shell; keeps source discovery and byte-tail fetch |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts` | — | Logs tab gated on the named `view-logs` descriptor; unnamed permission query removed (B10) |
| `backend/refresh/domain/refresh-domain-contract.json` | — | `container-logs` refresher entry revisited (B8) |

Tests that change: `containerlogsstream/*_test.go` (2,276 lines), `pods/logs_test.go` (795), `containerLogsStreamManager.test.ts` (1,315), `LogViewer.test.tsx` (3,436), `NodeLogsTab.test.tsx` (1,008). Remove tests that pin deleted behavior (fallback, priming, manual mode, string-parsed warnings); do not recreate presentation tests to recover coverage.

## Phases

Each behavior item starts with a failing test at the seam that reproduces the
user-visible failure, then the fix, then refactoring under green. Before any
production edit in Claude Code, refresh `.claude/impact-analysis.md` per
[impact-analysis.md](../workflows/impact-analysis.md). Phases run in order:
A → B → C. Phase B touches the same stream code as A and the same `LogViewer`
as C.

### Phase A — Backend log engine (R4)

The stream protocol does not change in this phase. A1 touches the frontend
request builders and bindings only.

- [x] **A1 Delete the unsent request surface.** Done 2026-09-28. Evidence:
  surviving backend suites (`internal/containerlogs`, `containerlogsstream`,
  `resources/pods`, gateway tests) and frontend Logs + stream-manager suites
  pass; `qc:prerelease` passed on the final tree. Also removed the now-dead
  `trimQueryValues` and `boolValueOrDefault`, and split `SelectTargets` (gocognit
  14 → 4) because its signature changed. `internal/containerlogs` statement
  coverage went from 58.3% (at `HEAD`) to 67.5%; the remaining gap is functions
  exercised only by other packages' tests (`IsUnavailable`, `ValidateTargetGVK`,
  `BuildTargetLimitWarnings`, `MatchPod`). Original scope: Fetch request: `PodFilter`,
  `PodInclude`, `PodExclude`, `Container`, `IncludeInit`, `IncludeEphemeral`,
  `ContainerState`, `Include`, `Exclude`, `SinceSeconds`
  (`backend/resources/types/types.go:160-176`). Stream request: `Pod`,
  `PodInclude`, `PodExclude`, `Container`, `ContainerState`, `Include`,
  `Exclude`, `IncludeInit`, `IncludeEphemeral` (`types.go:44-58`). Delete the
  helpers that exist only for them. Drop `container` from the frontend request
  builders and `containerLogsStreamScopeParamsCache.ts`. Regenerate bindings
  (checked by `qc:bindings`). No behavior change for the only caller: validate
  with the surviving tests.
- [x] **A2 One resolver (F13, F22).** Done 2026-09-28 as
  `containerlogs.ParseTargetScope` + `containerlogs.Resolve`, returning the pods
  and a `*PodWatch` (with the CronJob ownership check that moved out of the
  streamer). Deviation: `Resolve` returns no watch for the pod kind yet; the
  `metadata.name` field-selector watch is added in A7, where the pod watch is
  first used, so A2 ships no unused spec. Behavior change: the fetch path's
  CronJob resolution now uses the stream's single batched pod list and returns
  a list failure instead of skipping that Job. Evidence: resolver tests (one per
  path, selectors asserted from recorded actions), the previous-logs guard
  test, all log suites, and `qc:prerelease`. `internal/containerlogs` coverage
  67.5% → 82.2%; `consumeWatch` split (gocognit 13 → 7) because its signature
  changed. Original scope: `containerlogs` offers two operations for
  pod, deployment, replicaset, daemonset, statefulset, job and cronjob:
  - **Resolve once**: the current pods, used by previous-logs fetches. The pod
    kind uses a `GET`, so previous logs keep needing only `get pods` and
    `get pods/log`, as today.
  - **Watch spec**: namespace, label selector, field selector and owner filter
    for the live session's informer (A9). The pod kind uses a `metadata.name`
    field selector, so live logs need `list`/`watch` on pods for every kind
    (open question 8).

  Both transports call it; delete `workloadPodObjects`, `podObjectsForCronJob`,
  both `filterPodsByName` copies and `listPods`. Tests: one case per distinct
  resolution path; assert requested selectors through fake-client reactors,
  because the fake clientset does not filter by field selector; a
  previous-logs fetch for a pod succeeds when `list`/`watch` pods are
  forbidden.
- [x] **A3 Truncating reader and parse-based timestamps (F3, F19).** Done
  2026-09-28 as `containerlogs.LineReader` (`MaxLineBytes` 256 KiB, cut on a
  rune boundary, marker ` … [truncated N bytes]`; the limit covers the raw
  kubelet line including its timestamp) and `containerlogs.SplitTimestamp`
  (splits only an RFC3339Nano prefix and returns it in UTC). The follower, the
  stream's initial tail and the fetch path use them; `internal/linescanner` and
  both length-heuristic splitters were deleted. Behavior changes: lines of
  256 KiB–1 MiB are now truncated (question 3); a first word that is not a
  timestamp now stays in the line (two fetch tests pinned the old heuristic and
  were updated). Evidence: red tests (follower stalled at a 2 MiB line; fetch
  failed with `bufio.Scanner: token too long`) now pass; reader unit tests;
  all log suites; `qc:prerelease`. Original scope: Lines over
  the limit are truncated with a marker and the stream continues. The timestamp
  split accepts any RFC3339Nano prefix before the first space. Red tests: a live
  follower delivers lines after an oversized line; a fetch keeps the other lines
  of that container; an offset timestamp is split and parsed.
- [x] **A4 Stable ordering (F7).** Done 2026-09-28: `containerlogs.SortByTimestamp`
  (pre-parsed keys, `sort.SliceStable`, untimed entries last) replaces both old
  sorts. Red evidence: the earlier probe of the old comparator (32 inversions in
  a 40-line burst); tests were written after the fix, at the unit and fetch
  levels. Original scope: One merge function uses `sort.SliceStable`
  with pre-parsed keys. Red test: a same-timestamp burst from one container
  keeps its order when merged with another container.
- [x] **A5 Resume state (F7, F20).** Done 2026-09-28: `containerlogs.ResumeCursor` +
  `LineTracker` (the tracker owns every cursor update, including lines skipped
  or released during a replay). Each follower generation clones the cursor at
  start and writes it back at exit. The follower reads on a goroutine and
  selects on lines, the replay deadline and cancellation, which also lets a
  cancelled follower stop while a quiet stream blocks the read (the new tests
  were red for exactly that). Original scope: Per container instance, store a resume
  cursor owned by one follower generation, replacing `linesAtTimestamp`.
  `SinceTime` is sent at second precision (`metav1.Time.MarshalQueryParameter`
  formats with `time.RFC3339`), so a reconnect re-reads up to one second of
  lines. **Initial opens and resumes use different rules:** an open without a resume point sends `TailLines` and no
  `SinceTime`; a resume sends `SinceTime` and never `TailLines`, as stern's
  `Resume` clears `TailLines`. A tail bound on a resume could start the replay
  inside a same-timestamp burst and make the skip count drop unseen lines (read
  `[A, B]` at one timestamp, `C` follows, a tail-2 replay returns `[B, C]`,
  skipping two loses `C`).

  **Cursor and replay rule.** The cursor is `{lastTimestamp, run}`, where `run`
  holds 64-bit hashes of the lines this follower delivered at `lastTimestamp`,
  in order. On resume, lines older than `lastTimestamp` are skipped. Within the
  replayed group at `lastTimestamp`, find the earliest position where `run`
  occurs as a contiguous sequence, skip through the end of that match, and emit
  the rest. If `run` does not occur (for example, the log rotated during the
  disconnect), emit the whole group. After a replay, `run` becomes the group's
  lines up to the current position.

  **Bounded replay matching.** Until the match is decided, replayed lines at
  `lastTimestamp` are held (text, not just hashes) in a replay buffer capped at
  the 2 MiB frame budget. The decision is made at the first of:
  - `run` is matched: skip through the match and emit the rest;
  - a line with a later timestamp arrives, or the stream ends: the group is
    complete, `run` is absent, and the held lines are emitted;
  - 250 ms pass with no further line at `lastTimestamp` (one batching window):
    a replay re-sends existing history back-to-back, so an idle gap means the
    group has fully arrived; the held lines are emitted;
  - 1 s passes since the first held line, or the buffer reaches its cap: the
    held lines are emitted.

  After an unmatched flush, matching stops for that group and lines pass
  straight through. Every unmatched flush may repeat already-shown lines, which
  the policy below accepts; none can withhold a line longer than about 1 s.

  **Policy: never lose an unread line; accept duplicates only when the replay is
  ambiguous.** A tail read is a suffix of the log, so its first group may start
  mid-group, and the API reports no offset, so the absolute position of a
  partially seen group is unknowable. Content matching finds it whenever the
  delivered run is unique in the group. When identical lines make it occur more
  than once, the earliest match re-emits some already-shown identical lines
  instead of skipping unread ones. For a group seen from its first line, `run`
  is a prefix and matches at position 0, which is exactly stern's count-based
  skip. Memory is one hash per delivered line of the current group, plus the
  bounded replay buffer only while a replay is being matched.

  Examples: `[A, B, C]` share a timestamp, a tail-2 read returns `[B, C]`, `D`
  follows, and the replay `[A, B, C, D]` emits only `D`. `[A, B, C, D]` share a
  timestamp, a tail-2 read delivers `C` and drops, and the replay emits `D`
  (skipping the whole group, the previous rule, would lose `D`).

  Red tests: two identical lines at one timestamp are both delivered; a
  reconnect skips exactly the lines already delivered; a resume request carries
  `SinceTime` and no `TailLines`; the `[A, B]`/`[B, C]` burst case delivers `C`;
  the `[A, B, C]` tail-2 case emits only `D`; the interrupted `[A, B, C, D]`
  tail-2 case emits `D`; an ambiguous group of identical lines interrupted
  mid-tail loses no unread line; a replay without the delivered run emits the
  whole group; with saved run `[B, C]`, a replay of `[X, Y]` at that timestamp
  followed by silence on an open stream delivers `X` and `Y` within the 250 ms
  idle window; a trickle at one timestamp is flushed by the 1 s cap; a group
  larger than the replay-buffer cap is flushed without loss when the cap is
  reached; a tail read whose last group follows an earlier timestamp
  resumes like a count (`[X, A, B]` then `C` at `A`'s timestamp emits `C`);
  stop→start of one key never shares state (run under `-race`).
- [x] **A6 One request per container for history and live output (F8, F11).**
  Done 2026-09-28. Followers now read history and live output from one follow
  request; `Streamer.prepare` resolves without reading; the session sends the
  snapshot once every initial follower is caught up (250 ms idle, stream end or
  open failure) or after 2 s, then live batches. Also absorbed B2's internal
  half: `pendingEntries` (bounded, counts drops) and `snapshotWait` replace the
  entries/drops channels and the delivery-event switch, so the delivery code is
  rewritten once. Red evidence: the session tests hung on the old sequential
  history pass (open stream, unresponsive container); follower tests for the
  first-open tail bound and the response timeout failed to compile against the
  old API. Race-clean. Original scope:
  Each target opens a single follow request with `TailLines` (the client's
  buffer size), replacing `tail`, `collectInitialLogEntries`,
  `fetchContainerTail` and `updateInitialContainerState` (`streamer.go:76-174`,
  `streamer.go:1010-1048`). The session builds the initial snapshot from what
  the follow streams deliver within a 2 s deadline and sends the rest as normal
  batches; the frame format is unchanged in this phase. Every open without a
  resume point carries a tail bound, so no follower replays a whole log file;
  resumes follow A5's rule instead. **Response timeout:** it starts when a log
  request is issued and stops when `Request.Stream` returns (response headers
  received). A request still waiting after 20 s is cancelled, becomes a
  per-target issue (surfaced in Phase B) and retries in the background with
  backoff. Once a stream is established, silence never times out. Because an
  established stream shares the request context, the timeout is a timer that
  cancels only while `Stream` has not returned, not a `context.WithTimeout`.
  Red tests: a live line written while history is still loading arrives
  promptly and exactly once; a request whose `Stream` never returns becomes an
  issue after 20 s without delaying the snapshot past the deadline or other
  containers' live lines; an established stream that produces no lines for
  longer than 20 s raises no issue and stays healthy; a target admitted after
  the global limit grows opens with `TailLines` set; cancelling the session
  stops every request.
- [x] **A7 Watch-driven target lifecycle (F5, F6).** Done 2026-09-28 together
  with A9, so the watch code was rewritten once. Targets carry their container
  ID as an instance fingerprint; a session keeps at most one follower per target
  (a stopped follower holds the slot until it exits and writes its cursor back),
  and a follower that ends on its own records the instance it ended at, so only
  a new instance (restart, recreated pod, container starting) restarts it. The
  follower reopens only while the watched pod shows that instance running,
  checked before and after the backoff. Removing a pod forgets its targets'
  cursors and finished instances. Red evidence: the recreate, debug-container
  and init-container tests in `lifecycle_test.go` failed before the change; the
  completed-container and resumed-stream tests guard existing behaviour.
  Race-clean. Original scope: `Resolve` returns a
  `metadata.name` field-selector `PodWatch` for the pod kind (deferred from
  A2), so every live session watches. Follower exit releases its
  slot. Restarts are driven by container ID from watch events, as in stern's
  `shouldAdd` (see [Prior art: stern](#prior-art-stern)). Retry with backoff
  only while that container is running. Delete `waitForPodSession` and the
  per-retry pod GET in `shouldContinueStreaming` (`streamer.go:788-817`). Red
  tests: an init container going from waiting to running on a new pod is
  followed; a pod-kind scope resumes after the pod is deleted and recreated with
  the same name; a debug container added to a pod-kind scope is followed; a
  completed pod is not re-opened on unrelated `Modified` events. Evidence bar:
  follow the create/update/delete expectations in
  [data-freshness.md](../architecture/data-freshness.md#required-evidence-for-resource-source-changes)
  for target discovery.
- [x] **A8 Previous-logs fetch and timeouts (F11).** Done 2026-09-28.
  `fetchSelectedContainerLogs` reads through an `errgroup` limited to
  `ContainerLogsFetchParallelism` (5), each target under
  `ContainerLogsFetchTargetTimeout` (20 s); the gateway call runs under
  `resourceFetchContext`. Failures become `containerlogs.TargetIssue` values
  (`unavailable | forbidden | failed`, the shape B1 reuses for the stream) in
  the response's new `issues`; `error` is set only when nothing was read and a
  target failed or was forbidden. Red evidence: the new tests failed to compile
  against the old response (no `issues`, no per-target timeout); the
  cancellation test guards behaviour that already held. Original scope: The
  fetch path reads
  targets with bounded parallelism (5) and the 20 s per-container timeout, under
  `resourceFetchContext`. Per-target failures are collected as structured issues.
  Red tests: one hanging target does not delay the others beyond the timeout;
  cancelling the caller stops in-flight reads.
- [x] **A9 Watch and telemetry hygiene (F16).** Done 2026-09-28 with A7.
  Deviation: the informer is client-go's generated
  `NewFilteredPodInformer` rather than `cache.NewInformerWithOptions`, because
  it already wraps the `ListWatch` with the client's watch-list capability
  (`informers/core/v1/pod.go:122-123`), which fake clients need to disable
  watch-list mode. Handlers only enqueue events; the session's run loop applies
  pod events, limiter changes and follower exits, so reconciliation stays
  single-threaded. A forbidden list/watch is reported once (B3 makes it a
  non-retryable error); other reflector errors are debug-logged. The heartbeat
  path, `ContainerLogsStreamKeepAliveInterval`, `StreamHeartbeatTimeout` and
  `ContainerLogsStreamBackoffMax` are deleted; no code can now flag a quiet
  stream, so no separate quiet-stream test was added (it would assert on
  deleted code). The 410, CronJob-future-job, forbidden-once and limiter-handoff
  tests were written after the informer code; mutation checks (dropping delete
  events, reporting every forbidden error) made the 410 and forbidden tests
  fail. Original scope: Replace the hand-rolled
  re-watch, re-list and escalating backoff (`streamer.go:410-470`) with a
  per-session informer (`cache.NewInformerWithOptions`) over a `ListWatch`
  scoped to the session's namespace and selectors. Stern's `RetryWatcher` was
  rejected: it forwards `410 Gone` and stops, and client-go directs callers to
  informers for expired resource versions (`tools/watch/retrywatcher.go:43-48`,
  `:253-255`). The informer's reflector re-lists after expiry and emits
  deletions for pods removed during the gap (`DeletedFinalStateUnknown`), which
  feed the same reconcile path as live events. Also: log normal watch expiry at
  debug without a telemetry error; use an existence selector on `job-name` for
  CronJob watches; do not cache transient ownership lookup errors; stop
  recording heartbeat-timeout errors for quiet streams; delete
  `ContainerLogsStreamKeepAliveInterval`. Tests: a `410 Gone` watch error with
  pods created and deleted during the interruption reconciles to the correct
  target set (new pods followed, deleted pods stopped); a normal watch expiry
  records no error; a quiet stream stays healthy in telemetry.

### Phase B — Typed contract, single owner, fallback removal (R3 + R2 + R1)

Phase B lands as one change. The repo forbids temporary compatibility paths, so
the protocol, manager and viewer change together; intermediate steps on the
branch may not pass the gate.

Backend:

- [x] **B1 Protocol types.** Done 2026-09-28. `EventPayload` gained `snapshotComplete`, `trimmed`, `issues` (replace semantics), typed `warnings` and `retryable`; the request carries `maxEntries`/`maxBytes`. `Warning` and `TargetIssue` live in `internal/containerlogs` so both transports share them; the previous-logs fetch response uses the same types. The empty handshake frame is gone: the first frame is the snapshot's first frame. Original scope: Add `retryable`, target issues, typed warnings and
  `snapshotComplete` to `EventPayload`; replace the stream request's
  `TailLines` with `maxEntries` and `maxBytes`. Regenerate `types.generated.ts`
  via `backend/generate.go`. Update the frontend payload validator.
- [x] **B2 Delivery rewrite (F4).** Done 2026-09-28 (the pending buffer itself landed in A6). The snapshot is trimmed to the newest `maxEntries`/`maxBytes` and packed into frames of at most `frameBudgetBytes` (8 × the line limit, measured as the JSON-encoded entry); live flushes split by 64 entries and the same budget. Drops are one `dropped` warning with a cumulative count. Tests in `protocol_test.go`. Original scope: Replace the four channels and the
  delivery-event switch (`handler.go:248-405`) with one pending buffer (count
  and byte bounds, drop counter), a wake-up channel and the 250 ms flush timer.
  Trim the deadline snapshot to `maxEntries` and `maxBytes` and stage it in
  2 MiB frames. **No late-history cut-off.** History that arrives after the
  snapshot is always sent. A backend cut-off would be valid only while the
  frontend buffer stays full by count, and later byte eviction can reduce the
  count (`maxEntries` 3, `maxBytes` 1,000: three 100-byte entries, then a newer
  950-byte entry evicts all three, so an older 25-byte entry fits again).
  Keeping it correct would require the backend to mirror the frontend's
  eviction, a second copy of buffer state. The frontend buffer is the only
  owner of eviction (B5); the saving was only transient bandwidth for slow
  containers. Tests: late history after an underfilled, a byte-evicted and a
  count-saturated snapshot is sent; a snapshot larger than the frame budget
  arrives complete and in order; the
  budget test fails when the line limit outgrows it; drops produce one `dropped`
  warning; cancellation ends cleanly with no busy loop after the runner exits.
- [x] **B3 Error classification (F2, F11, F22).** Done 2026-09-28. Resolution failures and a forbidden informer list/watch are fatal frames with `retryable` (false for NotFound, Forbidden, BadRequest, Invalid); permission details name the denied resource (`core/pods`) and the apiserver message names the verb. Follower failures are target issues (set on open failure, cleared on a successful open or when the target is no longer wanted) and never set `error`. Original scope: Resolution failures are fatal
  with `retryable` (NotFound, Forbidden and invalid scope are not retryable). A
  forbidden pod `list` or `watch` from the session informer is a non-retryable
  fatal error whose permission details name the verb and `pods`, rendered by
  B6's failed state. Per-target problems become target issues and never set
  `error`. Tests: a pod on a failing node yields a target issue while the stream
  stays live; a deleted workload yields a non-retryable fatal frame and the
  stream closes; for both a pod and a workload, forbidden `list`/`watch` pods
  yields a non-retryable permission error naming the verb, and the pod's
  previous-logs toggle still loads.

Frontend:

- [x] **B4 Protocol reducer (F14, F15).** Done 2026-09-28: `containerLogsStreamProtocol.ts` (validator + reducer) and its tests; `refreshOnce`, manual mode and the registration's `refreshOnce` are deleted. Visibility suspend/resume and `kubeconfig:changing` are covered in the manager tests. Mutation check: resetting backoff on socket open fails two tests. Original scope: `containerLogsStreamProtocol.ts` with
  tests modeled on `resourceStreamProtocol.test.ts`: the handshake completes
  nothing; a staged snapshot applies atomically; backoff grows until a snapshot
  is delivered, not on socket open; a non-retryable failure is terminal; a
  retryable failure reconnects with capped backoff; visibility suspend/resume
  and `kubeconfig:changing` reset still work. Delete `refreshOnce`, manual mode,
  and the registration's `refreshOnce` (`domainRegistrations.ts:36`).
- [x] **B5 Sole writer (F9, F17).** Done 2026-09-28. The manager keeps entries ordered by a padded timestamp key with arrival-order ties, evicts by count and UTF-8 line bytes, and projects `phase`, `warnings`, `issues` and `truncation`. `useLogFiltering` no longer sorts. The manager tests were rewritten after the code; mutation checks (always append, ignore the byte cap) fail them. Original scope: The manager inserts entries in timestamp
  order with a stable tie-break and projects phase, typed warnings, target issues
  and truncation into `ContainerLogsSnapshotPayload`
  (`frontend/src/core/refresh/types.ts:45-51`), replacing the `sequence ≥ 2`
  convention. Remove sorting from `useLogFiltering`. Tests: late history lands
  in timestamp order, including while tail-following is paused and the view is
  anchored (`useAnchoredLogEntries.ts:36-55`); with `maxEntries` 3 and
  `maxBytes` 1,000, three 100-byte entries evicted by a newer 950-byte entry
  leave room for a delayed older 25-byte entry, which is kept in order;
  stale-pod entries do
  not reappear after a live batch.
- [x] **B6 LogViewer (F1, F10, F12).** Done 2026-09-28. Red tests first for F1 (real manager + store), F10, F12 and AC13. New `useContainerLogsStream` (lifecycle only), `usePreviousContainerLogs` (component state) and `containerLogNotices.ts`; a permanent failure turns the tab's auto-refresh off and shows a retry hint; active pods are a display filter. Original scope: Remove the fallback hook usage, priming
  fetch, the `fallback` mode, the error-suppression and transient-error logic,
  `isLogDataUnavailable`, and the target-limit warning regex
  (`LogViewer.tsx:256-303`). Render: `failed` shows the error (permission denied
  through the existing error surface); `reconnecting` keeps entries and shows
  status; typed warnings (limits, dropped, truncated) and a target-issue summary
  are visible. Previous logs live in component state. Active pods become a
  display filter. Red tests first for F1, F10 and F12.
- [x] **B7 Delete the fallback machinery (F2).** Done 2026-09-28: the fallback hook, fallback manager, their tests and the empty `core/refresh/fallbacks` directory are deleted. Original scope: Remove
  `useContainerLogsStreamFallback.ts`, `containerLogsFallbackManager.ts` and
  their tests.
- [x] **B8 Refresher contract (F21).** Done 2026-09-28: `"scheduled": false` added and regenerated (`policy_generated.go`, `types.generated.ts`). The entry's stale scope metadata was corrected too (`parseRequest`, no query parameters). Original scope: Add `"scheduled": false` to the
  `container-logs` entry in `refresh-domain-contract.json` and regenerate via
  `backend/generate.go` (open question 6). The name and timings stay because the
  generator requires them (`domain_contract.go:217-222`). No runtime change is
  expected: `scheduled` is only read by `shouldAllowRefresher`
  (`orchestrator.ts:1244-1248`), which already skips this refresher; the
  diagnostics row keeps its polling label (`DiagnosticsPanel.tsx:1078-1083`).
- [x] **B9 Unchanged behaviors.** Done 2026-09-28: LogViewer tests for the tab toggle and a cluster-switch remount, an orchestrator test for the global pause, and the manager test that keeps the buffer across a restart. Original scope: Tests prove the per-tab auto-refresh toggle
  and global pause still freeze and resume the stream, and a cluster-switch
  remount keeps the buffer.
- [x] **B10 Named Logs capability for pods (F23).** Done 2026-09-28. `hasObjPanelLogs` reads the `view-logs` descriptor; the unnamed `useUserPermission` query is deleted. Red test through the real `useCapabilities` path (`useObjectPanelLogsCapability.test.tsx`); backend rule test for a name-restricted `get pods/log`. Original scope: Gate the Logs tab on the
  existing `view-logs` capability descriptor, which is already named for pod
  targets and unnamed at Pod level for workloads
  (`useObjectPanelCapabilities.ts:170-191`), and delete the separate unnamed
  `useUserPermission('Pod', 'get', …, 'log')` query
  (`useObjectPanelCapabilities.ts:428-436`, read at `:487-495`). Keep today's
  gate semantics: hide only on a settled denial. Tests through the real
  permission path, not a mocked permission hook: a backend capability test
  where a `resourceNames`-restricted `get pods/log` rule allows the named pod
  query and denies the unnamed one (`backend/capabilities/rules.go:237-250`);
  a frontend test that the tab is visible for a pod when the named descriptor
  is allowed and hidden when it is denied.

### Phase C — Shared viewer shell and Node Logs shortcuts (R5)

- [x] **C1 Shared options reducer.** Done 2026-09-28: `logOptionsReducer.ts` (owns `ParsedLogEntry` and `CopyFeedback`); the container reducer composes it and `parsedContainerLogs` became `parsedLogs`; Node Logs uses it directly and gains the container's toggle interlocks. Original scope: Search (text, highlight, inverse, case,
  regex), display (wrap, ANSI, raw/pretty/parsed), expanded rows, copy feedback
  and auto-refresh. The container reducer composes it with its own fields
  (source filters, timestamps, `live | previous`, containers, pods).
- [x] **C2 `useLogPresentation`.** Done 2026-09-28: `hooks/useLogPresentation.ts` (deferred filter, search-text accessor, JSON detection cached per entry object or line value, parsed candidates) plus `splitDisplayRows` and `logCopyText`. Source filters and line formatting stay per viewer. Red test: `useLogPresentation.test.tsx` with node and container fixtures. Original scope: Lines plus a search-text accessor
  (container search also matches pod and container names;
  `useLogFiltering.ts:132-151`) produce filtered lines, parsed candidates,
  display rows, CSV and copy text. Cache JSON detection per entry. Defer the text
  filter for both viewers. Red test: parsed CSV and copy text match for both
  viewers' fixtures.
- [x] **C3 One toolbar builder.** Done 2026-09-28: `logToolbar.tsx`; Node Logs passes no optional features and picks up the shared tooltips and icon sizes. Original scope: Optional features: timestamps, previous logs,
  settings. Node Logs passes none of them.
- [x] **C4 Shared shortcuts (approved).** Done 2026-09-28. Node Logs gains search, display, copy, Home/End and search focus; `T`/`V` exist only when a viewer passes those features. Red tests in `NodeLogsTab.test.tsx` (keyboard shortcuts block). Original scope: Generalize `useLogKeyboardShortcuts`
  to the shared options plus optional feature callbacks, with neutral help text.
  Node Logs adopts it and gains the search, display, copy, Home/End and
  search-focus shortcuts. Tests: Node Logs shortcuts toggle options and copy;
  T and V are not registered for Node Logs; shortcuts are inactive when the tab
  is inactive.
- [x] **C5 Shared copy action.** Done 2026-09-28: `hooks/useLogCopyAction.ts` (copy with feedback, selection copy); Node Logs reports clipboard failures (red test in `NodeLogsTab.test.tsx`). Original scope: One clipboard path with feedback and
  operational error reporting; Node Logs stops swallowing failures.
- [ ] **C6 Native check.** Blocked 2026-09-28: needs an interactive native session of `wails3 dev`; not available to the agent in this session. Automated shortcut tests pass, but they do not prove native focus behaviour. Original scope: Exercise Node Logs and Container Logs shortcuts and
  focus in the running app (`mise exec -- wails3 dev`).

### Phase D — Docs, contracts and completion

- [x] Update [container-logs.md](../workflows/logs/container-logs.md): fallback
  removal, protocol frames, reconnect and error semantics, snapshot staging,
  `maxEntries`, engine ownership.
- [x] Update [overview.md](../workflows/logs/overview.md) (shared viewer shell)
  and [node-logs.md](../workflows/logs/node-logs.md) (shortcuts).
- [x] Update
  [settled-findings.md](../../.agents/skills/app-review/references/settled-findings.md):
  `LogViewMode` is now `live | previous`; the viewer shell is consolidated.
- [x] Check the operations-workflows and object-panel skills' entry points and
  logs guidance.
- [x] Add user-visible changes to [pending.md](../release/pending.md).
- [ ] Move remaining durable guidance, then delete this plan. Durable guidance moved 2026-09-28; the plan stays as the completion record until the blocked native and cluster checks (C6, AC5, AC6, AC14, AC17, AC18) are run.

## Acceptance criteria

Status values follow [completion.md](../workflows/completion.md). All start
`pending`.

| ID | Criterion | Evidence required | Status |
| --- | --- | --- | --- |
| AC1 | With auto-refresh on and no entries, a fatal error is shown, not a spinner | LogViewer test with the real manager and store | passed: `LogViewer.test.tsx` "shows a failed stream instead of loading forever" (real manager and store). |
| AC2 | One failing container leaves the live view running and is listed as an issue | Backend handler test plus frontend manager test | passed: `protocol_test.go` TestUnreachableContainerIsAnIssueWhileOthersStream; manager applies `replace-issues` (`containerLogsStreamProtocol.test.ts`); LogViewer lists issues. |
| AC3 | Lines after an oversized line arrive live; fetch keeps the container's other lines | Streamer and pods tests | passed: `streamer_follow_test.go` TestFollowContainerDeliversLinesAfterAnOversizedLine; `logs_test.go` TestFetchContainerLogsKeepsOtherLinesAroundAnOversizedLine. |
| AC4 | A large workload's first snapshot is capped to `maxEntries` and staged within the frame budget | Handler test plus protocol reducer test | passed: `protocol_test.go` snapshot trim and frame-budget tests; protocol reducer staging test. |
| AC5 | Init-container logs of a newly created pod appear | Streamer lifecycle test; manual smoke with a Job | blocked: Automated: `lifecycle_test.go` TestWorkloadScopeFollowsAnInitContainerOnceItRuns passes. Manual Job smoke not run: no local cluster in this session. |
| AC6 | Pod-kind streams follow a recreated pod and a new debug container | Streamer lifecycle tests; manual smoke with a StatefulSet restart | blocked: Automated: recreate and debug-container lifecycle tests pass. Manual StatefulSet smoke not run: no local cluster in this session. |
| AC7 | Same-timestamp bursts keep their order; duplicate lines are kept | Engine tests | passed: `order_test.go`, `resume_test.go`, follower identical-lines test, fetch burst-order test. |
| AC8 | Late-admitted targets do not replay their whole log | Streamer test | passed: Follower first-open tail test and TestSnapshotKeepsTheNewestEntriesTheClientCanHold (per-container tail = maxEntries). |
| AC9 | Only the manager writes `container-logs` state; pruned entries stay pruned | Manager plus LogViewer test | passed: Manager tests; LogViewer "keeps a deleted pod hidden when new lines arrive" (store untouched). |
| AC10 | Opening a Logs tab performs one backend tail | LogViewer test asserting no fetch call in live mode | passed: `LogViewer.test.tsx` "does not fetch logs when a live tab opens". |
| AC11 | A slow container is reported after 20 s without delaying the 2 s first snapshot or other containers' live lines; cancellation stops every request | Streamer and engine tests | passed: Snapshot-deadline and response-timeout tests; fetch parallelism, per-container timeout and cancellation tests. |
| AC12 | Dropped-entry and truncation warnings are visible | LogViewer test | passed: `LogViewer.test.tsx` "shows dropped-entry and truncation notices". |
| AC13 | Non-retryable failures stop reconnecting and show the reason (with or without retained entries), turn auto-refresh off, and retry on one toggle click; retryable ones back off | Protocol reducer tests plus LogViewer tests with the real manager | passed: Protocol reducer terminal/retry tests; LogViewer "turns auto-refresh off after a permanent failure and retries on one toggle" (real manager). |
| AC14 | Node Logs shortcuts work | NodeLogsTab tests plus native check (C6) | blocked: Automated Node Logs shortcut tests pass; native check (C6) not run. |
| AC15 | No regression: previous logs, auto-refresh toggle, global pause, cluster-switch remount, panel-close eviction, visibility suspend/resume, permission gating, multi-cluster isolation | Existing suites plus B9 tests | passed: Full suites in the gate; B9 tests (tab toggle, global pause, remount); visibility and kubeconfig tests in the manager suite. |
| AC16 | Gate green on the final tree; coverage and complexity reported | `qc:prerelease`, coverage tasks, [sonar.md](../frontend/sonar.md) checks | passed: final `qc:prerelease` 2026-09-28 exit 0 (Go race suite, 538 frontend test files / 5,175 tests, lint, typecheck, knip, trivy). Coverage: containerlogs 83.6%, containerlogsstream 92.4%, pods 83.6%, capabilities 86.1%; frontend changed modules 84–100% statements (frontend total 90.14%). Changed Go functions ≤ 10 (gocognit) and changed TypeScript functions ≤ 12 (Biome at 12). |
| AC17 | Live lines stay near real time: a line written while history loads arrives once and promptly, and steady-state delivery stays within the 250 ms batching window plus transport | Streamer test; manual smoke with a chatty workload | blocked: Automated: TestHandleDeliversALiveLineOnceAndPromptly passes. Manual chatty-workload smoke not run: no local cluster. |
| AC18 | Permission combinations behave as decided in question 8: full access works; `get pods/log` + `get pods` without `list`/`watch` shows a clear live-logs permission error while previous logs load; a per-pod `resourceNames` role (including a name-restricted `get pods/log`) shows the tab and streams through the name field selector; a workload without `list` pods shows the permission error | Backend tests with forbidden reactors; B10 capability tests; manual check on a local kind cluster with matching service accounts | blocked: Automated: forbidden list/watch tests (pod and workload), previous logs without list/watch, B10 capability tests pass. Manual kind check not run: the restricted kind cluster is not set up in this session. |
| AC19 | A resume never loses an unread line, including after a tail interrupted inside a same-timestamp group; duplicates appear only when the replay is ambiguous or unmatched; replay matching never withholds a line longer than about 1 s, even on a quiet open stream | Streamer tests for the A5 examples | passed: `resume_test.go` A5 examples and follower resume tests. |

## Open questions

All eight were decided with the user on 2026-09-28.

1. **Reconnect history. Decided 2026-09-28: keep replacing.** A reconnect
   snapshot replaces the buffer, as the contract documents. Active-pod pruning
   already hides deleted pods' lines, and anchoring keeps the reading position
   while tail-following is paused (`useAnchoredLogEntries.ts:36-55`). Accepted
   loss: lines from a container's earlier run after a restart, which workloads
   cannot recover through the previous-logs toggle.
2. **Non-retryable failures. Decided 2026-09-28: stop and wait for the user,
   provided the error state is clear.** Non-retryable errors (workload not
   found, permission denied while resolving targets, invalid scope) move the
   stream to `failed` with no background retries. Retryable errors reconnect
   with backoff capped at 30 s, reset only after a snapshot arrives. Clarity
   requirements (B6, AC13):
   - The error reason is shown through the existing error surface, including
     permission-denied details when present.
   - With retained entries, the error appears in the Logs tab's existing
     warning banner area above the entries instead of being hidden.
   - The auto-refresh toggle reflects reality: a terminal failure turns it off,
     so one click (or `R`) retries. A short hint states that.
   - After Phase A a missing pod is not an error for pod-kind scopes; the watch
     follows a pod that appears later under the same name.
3. **Line limit. Decided 2026-09-28: truncate at 256 KiB, plus a total-bytes
   buffer cap.** The backend truncates any line over 256 KiB, appends a marker
   with the dropped byte count, and keeps reading (A3). Plain-text stack traces
   are one short line per frame; JSON-encoded Java traces are estimated at
   10–150 KiB. The frontend buffer trims its oldest entries when either the
   entry count or the byte cap (proposed 64 MiB per tab, measured as summed line
   length) is exceeded (B5). The stream request carries both limits so the
   backend trims the initial snapshot the same way (B1/B2).
4. **History loading and real time. Decided 2026-09-28: one request per
   container, 2 s snapshot deadline, 20 s response timeout.** Each container's
   single follow request carries history and live output (A6), so live lines
   start per container as its stream opens and no parallelism setting exists.
   The first snapshot is whatever arrived within 2 s; later history slots in by
   timestamp. A log request that has not returned response headers within 20 s
   becomes an issue and retries in the background; an established stream that
   is merely quiet never times out (A6). The 250 ms batching window stays. Previous-logs fetches use a
   parallelism limit of 5 (A8). Confirm the numbers with a large-workload smoke
   test.
5. **Frame budget. Decided 2026-09-28: 2 MiB, derived from the line limit.**
   The budget is defined in code as at least 6 × the line limit (Go's
   `json.Marshal` escapes `<`, `>`, `&` and control characters as 6-byte
   `\u00XX` sequences) plus entry metadata, rounded up. A test fails if the line
   limit grows without the budget, so one maximal entry always fits and no
   oversized-entry path exists. It stays well under Wails' 8 MiB per-window
   queue (`stream_session.go:149-151` in the pinned Wails module) and 64 MiB
   frame limit. Live batches keep their 64-entry cap and are split by the same
   budget (B2).
6. **`container-logs` refresher. Decided 2026-09-28: mark it
   `scheduled: false`.** The refresher is never registered today (F21), and
   nothing uses it after Phase B. The flag makes the contract state that it is
   never polled; changing the generator to allow stream-only domains without a
   refresher was rejected as churn for one domain (B8).
7. **Per-container history. Decided 2026-09-28: each container's follow
   request asks for `maxEntries` lines (the client's buffer size).** Only this
   guarantees the snapshot is the true newest `maxEntries` lines across all
   containers. Cost is bounded by the per-tab and global container caps and
   stays between the backend, API server and kubelets; it matches today's
   stream tail cost (`config.go:269`) without the duplicate priming fetch.
   Splitting the buffer across containers was rejected because it shows each
   container's last few lines rather than the most recent activity.
8. **Log access without pod list/watch. Decided 2026-09-28: keep the Logs tab
   gated on `get pods/log`; live logs require `list`/`watch` on pods and fail
   clearly without them.** The gate stays `get pods/log`, but pod targets use
   the existing named `view-logs` descriptor instead of today's unnamed query,
   so name-restricted grants do not hide the tab (B10, F23). Without
   `list`/`watch`, the live
   stream reports a non-retryable permission error naming the verb, using the
   failed state from question 2 (B3, B6), and previous logs still load through
   the resolver's `GET` path (A2). Workloads, which already needed
   `list`/`watch`, get the same clear error instead of a generic failure (F22).
   Accepted loss: a role granting `get pods` without `list`/`watch` no longer
   gets live single-pod logs. Rejected: hiding the whole tab (also loses
   previous logs), a reduced `GET`-only live mode, and polling, because each
   adds a second lifecycle path. Per-pod `resourceNames` roles should keep
   working, because RBAC authorizes name-restricted `list`/`watch` requests
   that carry a matching `metadata.name` field selector [unverified; AC18
   checks it].

## Prior art: stern

[stern](https://github.com/stern/stern) stays responsive with many pods by
keeping no viewer state. Read from `master` on 2026-09-28:

- **Print and forget.** Each line is formatted and written straight to stdout
  ([tail.go](https://github.com/stern/stern/blob/master/stern/tail.go)); the
  terminal owns scrollback. Not transferable: this app keeps a buffer for
  search, filters and scrollback, so its equivalent is per-batch work (ordered
  insert in B5, cached JSON detection in C2, 250 ms batching, virtualization).
- **One request per container** with `Follow`, `SinceSeconds` and `TailLines`
  together. Adopted in A6.
- **Independent containers**, printed in arrival order with no barrier.
  Adopted for liveness (A6); this app still orders lines by timestamp.
- **`RetryWatcher` for pod discovery**
  ([watch.go](https://github.com/stern/stern/blob/master/stern/watch.go)).
  Not adopted: it stops on `410 Gone` (expired resource version), so A9 uses a
  per-session informer, which re-lists.
- **Restarts keyed by container ID** (`shouldAdd` in
  [target.go](https://github.com/stern/stern/blob/master/stern/target.go)).
  Adopted in A7.
- **Resume by timestamp plus lines to skip**, retried at most twice per 20 s
  ([stern.go](https://github.com/stern/stern/blob/master/stern/stern.go)).
  Generalized in A5: matching the delivered run behaves like stern's count for
  groups seen from their first line and also recovers a partially seen first
  group after an interrupted tail.
- Not adopted: a hard exit above 50 followed containers
  (`--max-log-requests`), 48 h of history by default, no cross-pod ordering,
  and unbounded line length (safe for stern only because it keeps nothing).

## Validation

- Focused: the commands in the operations-workflows skill, plus
  `mise exec -- go test -race ./backend/refresh/containerlogsstream ./backend/internal/containerlogs ./backend/resources/pods`
  and the frontend `Logs`, `NodeLogs` and `containerLogs` suites.
- Coverage: `mise exec -- wails3 task test:backend-coverage` and
  `mise exec -- wails3 task test:frontend-coverage` (target 80% on changed code
  or report the gap).
- Complexity: changed functions at or below 12 per
  [sonar.md](../frontend/sonar.md).
- Final gate: `mise exec -- wails3 task qc:prerelease`, then inspect the
  worktree for gate formatting changes.
- Native and cluster smoke (local kind cluster): a 100-pod workload, a pod that
  logs a line over 256 KiB, a StatefulSet restart from the app, a debug
  container, a CronJob with an init container, a pod on a stopped node, a
  `410 Gone` watch interruption, and the AC18 permission combinations (full
  access; `get pods/log` + `get pods` only; a per-pod `resourceNames` role; a
  workload without `list` pods; no `pods/log`).
- Tests follow [testing.md](../workflows/testing.md): each names a user-visible
  failure or data contract.
