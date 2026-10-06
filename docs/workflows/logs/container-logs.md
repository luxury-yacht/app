# Container Logs Contract

Container Logs show Kubernetes pod/workload container output in the Object
Panel; they are neither Application nor Node Logs. Viewer controls come from the
[shared viewer shell](overview.md#shared-viewer-shell).

## Agent Contract

- The live stream and the previous-logs fetch share one canonical log scope and
  resolver (`containerlogs.Resolve`), so they agree on a scope's pods and
  containers. Workload targets resolve to bounded pod/container targets before
  retrieval.
- Frontend filters (search, regex, display mode, timestamps, wrap, ANSI) never
  change backend target identity. Previous logs, history size, follow,
  timestamps, and target caps are backend query concerns.
- Source selection is explicit `all` / `some` / `none`
  (`logFilterSelection.ts`). `none` yields an empty result and carries
  `matchNone=true` through stream and fetch without dropping the
  cluster-prefixed object/log scope. The Pods (workloads only) and Containers
  dropdowns each choose one group of that single selection; changing one keeps
  the other's choice; no pods or no containers reads nothing. A dropdown with
  no options has not listed its sources yet (no pod list and no lines, or no
  container inventory) and keeps its choice.
- Raw rows name their source: workload views name the pod; the container only
  when more than one is in view (not for one selected container, or no
  selection and one inventory container; `shouldDisplayPodContainerMetadata`).
  The table always keeps its Container column.
- The container inventory (`useLogScopeContainers`) is read when the scope
  opens and again when shown logs hold a container it lacks (debug container,
  rollout-added sidecar). The stream buffer tracks the containers it holds, like
  its pods, so the view compares only when that set changes. Each missing
  container is re-read once per scope, so one never in the inventory cannot
  loop.
- Live logs come only from the stream (no fetch fallback, no priming fetch).
  Previous logs live in the Logs tab's component state and never touch the
  live buffer.
- `containerLogsStreamManager` is the only writer of `container-logs` scoped
  state; the Logs tab reads it. Never start both scoped-domain enablement and
  explicit stream startup for one consumer. Reconnect or remount with cached
  entries must not show the initial-load state.
- Deleted pods' lines are hidden by a view filter (`hooks/useActivePodSet.ts`).
  Each workload pod list (every 5 s) hides pods with lines that are not in it;
  an empty list hides all; an unreadable list (`pods: null`) hides none. A pod
  whose first line arrives after the latest list stays visible until the next
  list (lists lag new pods). The Pods dropdown offers the list's pods plus pods
  with buffered lines (manager `pods`), less hidden pods.
- Tail-following is explicit user intent shared by raw, Pretty, and table
  views; only a user scroll pauses or resumes it. Reconnects, tab visibility,
  row measurement, and programmatic scrolls preserve it. Reactivating the tab
  positions the scroll container during layout, so unchanged content cannot
  jump or expose Resume scrolling.
- While paused (`hooks/useAnchoredLogEntries.ts`), shown rows stay, including
  lines the buffer evicted; new entries follow them, even earlier-timestamped
  ones. A row leaves only when its pod is hidden, never on buffer eviction; a
  pod the backend removes while the pod list is unknown leaves on resume.
  Resuming shows the buffer in time order.

## Stream Protocol

Client first frame: scope, source selection, `maxEntries` (Settings → Logs
Buffer size; the backend bounds each container's history by it), and
`maxBytes` (64 MiB of line bytes). The per-scope selection is recorded in
`core/refresh/streaming/containerLogsStreamScopeParams.ts` and read when the
manager opens the stream. Closing the panel clears it and resets the scope,
dropping the buffer, so a reopened panel reads full history.

If the buffer holds lines read for the same selection with a buffer size at
least as large, the first frame adds `resume`: per container, the newest
buffered timestamp and its lines at that timestamp, oldest first (≤ 64 lines
and 64 KiB; a suffix suffices).

Server frames (generated into `types.generated.ts`):

- **Snapshot**: one or more frames; first has `reset`, last has
  `snapshotComplete` and `trimmed` (history the buffer could not hold). Holds
  the newest entries fitting both limits, time-sorted, sent when every initial
  container has caught up or after 2 s. While history arrives the backend keeps
  only those newest entries regardless of answer order, holding ≤ 2× the limits
  (`containerlogs.NewestWindow`); older history is `trimmed`, never `dropped`.
  Frames stay within 8 × the 256 KiB line limit as encoded JSON. The client
  applies a snapshot only on its last frame.
- **Resumed snapshot**: when resume points were used, the first frame has
  `resumed`; it holds only lines after them plus history for containers
  without one, and `removedPods` names resumed pods that no longer exist. The
  client merges it like live lines and drops removed pods' lines; a pod
  recreated with the same name exists and keeps its lines.
- **Live batches**: ≤ 64 entries and one frame budget, flushed every 250 ms.
  History arriving after the snapshot is always sent and inserted in time
  order. A live `removedPods` names a pod deleted this session whose name has
  not returned within 10 s (a StatefulSet pod recreated under its name keeps
  its lines); its pending lines are sent first, then the client drops its
  lines.
- **Warnings and issues**: typed `warnings` (`targetLimit` per tab or global;
  `dropped` = count of live lines lost because delivery fell behind after the
  snapshot) and per-container `issues` (`unavailable`, `forbidden`, `failed`,
  with reason). When present they replace the previous lists. A per-container
  problem never sets `error`.
- **Fatal error**: `error`, optional permission `errorDetails`, `retryable`;
  then the stream closes. Missing objects, permission denials, and rejected
  requests are not retryable. A stream arriving while the refresh subsystem or
  its cluster's handler is being republished is told to retry.

Restarts (reconnect, window shown, auto-refresh back on) resume. A selection
change, larger buffer size, empty buffer, or unusable resume points (one voids
all) read full history, which replaces the buffer; an identical snapshot keeps
entry render identity, so row measurements and the viewport stay. The buffer
keeps timestamp order and evicts oldest by count and UTF-8 line bytes.

Client phases (`containerLogsStreamProtocol.ts`): `connecting`,
`awaiting-snapshot`, `live`, `reconnecting`, `failed`, `stopping`. Reconnect
backoff grows until a snapshot arrives (not a socket open), capped at 30 s. A
non-retryable failure is terminal: the tab shows the reason and turns
auto-refresh off; one toggle (or `R`) retries.

## Backend Behavior

- History reads in rounds (`backend/refresh/containerlogsstream/history.go`), so
  a tab downloads about one buffer, not one per container. A session's first
  containers form round one; later ones (new pods, capacity freed under a
  target cap) gather for 250 ms into further rounds.
- Floor: the backend records lines sent; once the client buffer is full, no
  read goes back past the oldest line it keeps (older lines would be evicted on
  arrival).
- Rounds of ≥ 3 containers: each reads its last 2 × `maxEntries` ÷ containers
  lines from the floor without following, keeping the newest within
  2 × `maxBytes` ÷ containers bytes; the round keeps only line times and sizes
  (about two buffers). When all reads arrive, or after 1 s, the cut-off is the
  oldest line the buffer can hold among held and read lines. A container whose
  read came back full (all lines asked for, or cut short by bytes) and whose
  oldest line is after the cut-off re-reads from the cut-off (≤ `maxEntries`
  lines, ≤ `maxBytes`); if that fails, its follow request reads from the
  cut-off. Each container then follows from its newest line read, as a resume.
- One or two containers, or a failed read, use one follow request carrying
  history and live output from the floor. Resumed containers follow from their
  resume points.
- A follow request without response headers after 20 s becomes a `failed`
  issue and retries; an established quiet stream never times out; a plain
  history read must finish within 20 s.
- Lines over 256 KiB are truncated with a marker and reading continues. A line
  cut by a broken connection is not delivered; the resumed stream reads it
  whole.
- Resume cursor = last timestamp plus hashes of lines delivered at it: a
  follower's own after its stream ends, or built from the client's resume point
  for a pod present at session start (later pods read history). Every read is
  bounded by `maxEntries` (the client cannot hold more per container). No
  unread line the client could hold is lost; duplicates appear only when replay
  is ambiguous, unmatched, or cut by that bound. Lines are tracked in JSON wire
  form (invalid UTF-8 bytes as U+FFFD) so the client's text matches.
- A per-session pod informer follows new pods, init and debug containers,
  same-name recreated pods, and restarts (new container ID). A follower reopens
  only while its container runs. An expired watch re-lists silently. The
  informer's first list is authoritative: a resolved pod it never reports was
  deleted before it listed and is removed, releasing target capacity.
- Live logs need `list` and `watch` on pods (a single pod is watched by name);
  otherwise the stream fails non-retryably, naming the verb. Previous logs need
  no `watch`: Pod → `get` pod; Deployment, ReplicaSet, DaemonSet, StatefulSet →
  `get` workload + `list` pods; Job → `list` pods; CronJob → `list` jobs and
  pods (`containerlogs.Resolve`). So previous logs can load when live logs
  cannot: loading, paused, and failure-before-lines states render in the log
  region below the controls, leaving Previous Logs and the auto-refresh retry
  usable.
- The previous-logs fetch reads five containers at a time, each within 20 s (no
  whole-fetch limit, so a slow first batch cannot fail the rest), returns
  per-container `issues`, and sets `error` only when nothing could be read.

## Ownership

| Concern | Owner |
| --- | --- |
| Log engine: resolution, target selection, line reading, ordering, resume, issue classification | `backend/internal/containerlogs` |
| Live stream | `backend/refresh/containerlogsstream` |
| Previous-logs fetch | `backend/resources/pods/logs.go` |
| Stream protocol and buffer | `frontend/src/core/refresh/streaming` (`containerLogsStreamProtocol.ts`, `containerLogsStreamManager.ts`) |
| Viewer and controls | `frontend/src/modules/object-panel/components/ObjectPanel/Logs` |
| Refresh/log scopes | `frontend/src/core/refresh`; reads per [data-access.md](../../architecture/data-access.md) |

Target limits start at backend defaults and receive settings pushes after the
Preferences lock is released
([app-preferences.md](../../architecture/app-preferences.md)):

- Per-scope `backend.ContainerLogsSelectionPolicy`: an independent leaf shared
  by `ResourceGateway` direct reads and Refresh live streams, owned by neither
  nor by the global limiter. Both receive its value explicitly; no
  package-global target limit is consulted.
- Global limiter: one process-wide instance owned by `backend.RefreshCoordinator`,
  reached only through its write-only settings sink. Its mutex is a leaf lock:
  code under it never reads Preferences or takes refresh/subsystem locks
  (no settings/limiter ABBA cycle).

## Validation

Run focused backend log/stream and object-panel viewer tests covering pod,
workload, missing container, previous logs, failure and permission states, and
stream cleanup as relevant; smoke-test the live stream manually for transport
changes.
