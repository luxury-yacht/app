# Goroutine Dump (Wedge Diagnosis)

The backend can arm a SIGUSR1 handler that writes every goroutine's stack to a
file **without stopping the app**. It exists because the data layer wedges have
historically been lock-ordering bugs that logs cannot explain: the app logger
is an in-memory ring (not stderr), and a `wails dev` child's stderr is not
reliably capturable, so SIGQUIT dumps are effectively lost.

- **Opt-in per run**: the handler arms only when `ENABLE_GOROUTINE_DUMP` is
  truthy — `ENABLE_GOROUTINE_DUMP=true wails dev` (or `… mage dev`, or set on
  a built binary's environment). Default off. Because a wedge may not
  reproduce on demand, relaunch with the flag *before* trying to reproduce.
- Handler: `backend/app_diagnostic_dump.go` (unix-only; Windows no-op in
  `backend/app_diagnostic_dump_windows.go`), armed in `App.Startup`
  (`backend/app_lifecycle.go`).
- Output: `os.UserCacheDir()/luxury-yacht/diagnostics/goroutines-<timestamp>.txt`
  (macOS: `~/Library/Caches/luxury-yacht/diagnostics/`).
- It takes no application locks (`runtime.Stack` is runtime-level), so it works
  precisely when the app's own mutexes are wedged.

## When to capture a dump

Reach for this on data-layer wedge symptoms instead of guessing from logs:

- A cluster never leaves "loading"; the namespace list never paints or stays
  dimmed; table views hang; the catalog stays degraded and never recovers.
- The 2026-07-01 wedge log signature: `initial catalog sync failed … is not
  synced` with **no** `catalog reactive updates enabled` line after it, no
  resync activity ever, and a kind that never logs `Caches populated`.

Capture first, then hypothesize: the 2026-06-27 incident looked like ingest
readiness but the dump showed synced stores and pointed downstream (catalog).

## How to use it

1. Launch with the opt-in: `ENABLE_GOROUTINE_DUMP=true mage dev` (or `wails
   dev`), then reproduce the problem.
2. Find the arming line in the app log (log viewer or startup output):
   `goroutine dump armed: pid <N> — kill -USR1 <N> writes all goroutine stacks to <dir>`
   If that line is absent, the opt-in did not take effect — the handler is not
   armed and SIGUSR1 would kill the app (default signal action).
3. While the app is wedged, run that exact `kill -USR1 <N>` command.
   **Never signal by pattern** (`pkill -f luxury`): SIGUSR1 kills any process
   without a handler, and that pattern matches wails/vite/compilers whose
   command lines contain the repo path.
4. The app log then shows `goroutine dump written to <path>` (or
   `goroutine dump failed: …`). The app keeps running; dump as often as needed.

## How to read the dump

Search for goroutines in `sync.Mutex.Lock` / `sync.RWMutex` states and pair
holders with waiters — a deadlock reads as two goroutines each blocked on the
lock the other holds, with every other blocked goroutine queued behind them.

Lock invariants that make dumps legible (violations are bugs):

- `IngestManager.mu` is a **leaf lock**: taken only to resolve the entries
  map, never held across a store call (`backend/refresh/ingest/manager.go`,
  regression `manager_sink_locking_test.go`).
- `Sink`/`BundleSink` deliveries run **under the store write lock** and must
  not call back into the same store; calling the manager or another store is
  legal (`backend/refresh/ingest/projecting_store.go` contract) — which is
  exactly why the manager mutex must stay a leaf.

Incidents this instrument has resolved: the 2026-06-27 catalog O(N²)
query-store rebuild under one lock, and the 2026-07-01 manager/store ABBA
deadlock fixed by the leaf-lock rule above.
