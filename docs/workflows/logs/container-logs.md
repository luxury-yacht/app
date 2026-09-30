# Container Logs Contract

Container Logs show Kubernetes pod/workload container log output in the Object
Panel. They are not Application Logs and they are not Node Logs.

## Agent Contract

- Preserve full object identity from object panel target to backend log scope.
- The live stream and the previous-logs fetch consume the same canonical log
  scope and the same resolver (`containerlogs.Resolve`), so they agree on which
  pods and containers a scope means.
- Workload targets resolve to bounded pod/container targets before backend log
  retrieval.
- Frontend filters such as search, regex, display mode, timestamps, wrapping,
  and ANSI rendering must not change backend target identity.
- Pod/container source selection uses explicit `all`, `some`, and `none`
  states. `none` must produce an empty frontend result and carry
  `matchNone=true` through both the live stream and the previous-logs fetch
  without dropping the cluster-prefixed object/log scope.
- Previous logs, history size, follow, timestamps, and target caps are backend
  log query concerns.
- Live logs come only from the stream; there is no fetch fallback and no
  priming fetch. Previous logs are fetched into the Logs tab's component state
  and never touch the live buffer.
- `containerLogsStreamManager` is the only writer of `container-logs` scoped
  state. The Logs tab reads it; hiding deleted pods' lines is a view filter.
- Do not start both duplicate scoped-domain enablement and explicit stream
  startup paths for the same consumer.
- Tail-following is explicit user intent shared by raw, Pretty, and parsed
  table views. Only a user scroll interaction may pause or resume it; stream
  reconnects, tab visibility, row measurement, and programmatic scroll events
  preserve the current intent. Reactivating the Logs tab positions the active
  scroll container during layout so unchanged content cannot visibly jump or
  expose the Resume scrolling control.

## Stream Protocol

The client's first frame carries the scope, the source selection, and the
buffer limits `maxEntries` (the Buffer size setting in Settings → Logs) and
`maxBytes` (64 MiB of line bytes). The backend bounds each container's history
by `maxEntries`. Container Logs records each scope's source selection in
`core/refresh/streaming/containerLogsStreamScopeParams.ts`; the stream manager
reads it when it opens the stream, and closing the panel clears it.

When the buffer already holds lines read for the same selection and for a
buffer size at least as large, the first frame also carries `resume`: for each
container, the newest timestamp the buffer holds and its lines at that
timestamp, oldest first (at most 64 lines and 64 KiB; a suffix is enough to
find the place).

Server frames, generated into `types.generated.ts`:

- **Snapshot.** One or more frames: the first carries `reset`, the last
  `snapshotComplete` and `trimmed` (history left out because the buffer could
  not hold it). The snapshot is the newest entries that fit both limits, sorted
  by time, sent once every initial container has caught up or after 2 s. While
  history arrives the backend keeps only those newest entries, whatever order
  the containers answer in, holding at most twice the limits
  (`containerlogs.NewestWindow`); older history counts as `trimmed`, never
  `dropped`. Frames
  stay within a budget of 8 × the 256 KiB line limit, measured as encoded JSON.
  The client applies a snapshot only when its last frame arrives. When the
  request's resume points were used, the first frame carries `resumed`: the
  snapshot holds only lines after them, plus history for containers without
  one.
- **Live batches.** At most 64 entries and one frame budget, flushed every
  250 ms. History that arrives after the snapshot is always sent; the client
  inserts it in time order.
- **Warnings and issues.** Typed `warnings` (`targetLimit` per tab or global,
  `dropped` with a count of live lines lost because delivery fell behind after
  the snapshot) and per-container `issues` (`unavailable`,
  `forbidden`, `failed`, with a reason). When present they replace the previous
  lists. A per-container problem never sets `error`.
- **Fatal error.** `error`, optional permission `errorDetails`, and
  `retryable`; the stream then closes. Missing objects, permission denials and
  rejected requests are not retryable.

A restarted stream (a reconnect, the window shown again, auto-refresh turned
back on) resumes, and its `resumed` snapshot is merged into the buffer, as live
lines are. Lines of pods that ended meanwhile stay, as they do while live. A
selection change, a larger buffer size, an empty buffer, or resume points the
backend cannot use (one unusable point voids them all) read full history, and
that snapshot replaces the buffer; an identical one keeps entry render identity
so row measurements and the viewport stay. The buffer keeps entries in
timestamp order and evicts the oldest by count and by UTF-8 line bytes.

Client phases (`containerLogsStreamProtocol.ts`): `connecting`,
`awaiting-snapshot`, `live`, `reconnecting`, `failed`, `stopping`. Reconnect
backoff grows until a snapshot arrives (not when a socket opens) and caps at
30 s. A non-retryable failure is terminal: the Logs tab shows the reason,
turns its auto-refresh off, and one toggle (or `R`) retries.

## Backend Behavior

- A session's first containers read their history in two steps when there
  are three or more of them, so a tab downloads about one buffer of history
  rather than one per container (`history.go`). Each first reads its last
  2 × `maxEntries` ÷ containers lines without following. When every read has
  arrived, or after 1 s, the backend finds the cut-off: the oldest line the
  buffer can hold among everything read. A container whose read came back full
  and whose oldest line is after the cut-off reads again, from the cut-off,
  at most `maxEntries` lines. Each container then follows from its newest line
  read, as a resume. A read that fails falls back to one follow request that
  carries both history and live output, which is how one or two containers,
  containers added later, and resumed containers always read.
- A follow request with no response headers after 20 s becomes a `failed`
  issue and retries; an established stream that is quiet never times out. A
  plain history read must finish within 20 s.
- Lines over 256 KiB are truncated with a marker and reading continues.
- Resuming uses a cursor (last timestamp plus the hashes of the lines delivered
  at it): a follower's own after its stream ends, or one built from the
  client's resume point for a pod present when the session starts (a pod that
  appears later reads its history). Every read, resumed or not, is bounded by
  `maxEntries` lines; the client cannot hold more of one container. No unread
  line the client could hold is lost; duplicates appear only when the replay is
  ambiguous, unmatched, or cut by that bound. Lines are tracked in their JSON
  wire form (each invalid UTF-8 byte as U+FFFD) so the client's text matches.
- A per-session pod informer keeps targets current: new pods, init and debug
  containers, recreated pods with the same name, and restarts (a new container
  ID) are followed. A follower reopens only while its container is running.
  An expired watch re-lists without surfacing an error. The informer's first
  list is authoritative: a resolved pod it never reports was deleted before it
  listed and is removed, releasing its target capacity.
- Live logs need `list` and `watch` on pods (a single pod is watched by name);
  without them the stream fails with a non-retryable permission error that
  names the verb. Previous logs use `get` only and still load, so loading,
  paused and failure-before-lines states show in the log region below the
  controls; Previous Logs and the auto-refresh retry stay usable.
- The previous-logs fetch reads containers five at a time, each within 20 s, and
  returns per-container `issues`; `error` is set only when nothing could be
  read.

## Ownership

- Log engine (resolution, target selection, line reading, ordering, resume,
  issue classification): `backend/internal/containerlogs`
- Container log stream: `backend/refresh/containerlogsstream`
- Previous-logs fetch: `backend/resources/pods/logs.go`
- Per-scope selection policy: `backend.ContainerLogsSelectionPolicy`. Direct
  reads and live streams receive its current value explicitly; no package-global
  target limit is consulted.
- Global target limiter: one process-wide instance owned by
  `backend.RefreshCoordinator` and reached only through its write-only settings
  sink.
- Stream protocol and buffer: `frontend/src/core/refresh/streaming`
  (`containerLogsStreamProtocol.ts`, `containerLogsStreamManager.ts`)
- Object-panel log viewer and controls:
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs`
- Refresh/log scopes: `frontend/src/core/refresh`
- Data access: [../../architecture/data-access.md](../../architecture/data-access.md)

The per-scope and global limits both start at backend defaults. Every successful
settings load, startup-default fallback, applicable preference update, and
settings import pushes the selected values after the Preferences lock is
released. The global limiter mutex is a leaf lock: code under it must not read
Preferences or acquire refresh/subsystem locks. Settings load/update therefore
captures values first and pushes only after unlocking. This preserves the
default-then-push startup rule without allowing a settings/limiter ABBA cycle.
The per-scope `ContainerLogsSelectionPolicy` remains an independent leaf shared
by `ResourceGateway` direct reads and Refresh live streams; it is not owned by
the global limiter or by either consumer.

## Change Checklist

When changing container logs:

1. Trace object/workload identity into the log scope.
2. Keep the stream and the previous-logs fetch on the shared engine.
3. Keep the manager the only writer of `container-logs` state.
4. Verify reconnect/remount behavior does not show an initial-load state when
   cached entries still exist.
5. Keep frontend filters separate from backend target reduction.
6. Test pod, workload, missing container, previous logs, failure and permission
   states, and stream cleanup as relevant.

## Validation

Run focused backend log/stream tests and object-panel log viewer tests. Manual
stream smoke testing is appropriate for transport changes.
