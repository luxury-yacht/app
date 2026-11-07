# Logs Contract

Three separate log surfaces; keep their scope, transport, settings, and buffers
separate.

| Surface | Shows | Scope and reads | Details |
| --- | --- | --- | --- |
| Application Logs | Luxury Yacht diagnostic log buffer | App-global, optionally cluster-annotated; app-state reads | [application-logs.md](application-logs.md) |
| Container Logs | Kubernetes pod/workload container logs | Object-panel pod/workload scope; cluster data-access reads | [container-logs.md](container-logs.md) |
| Node Logs | Node proxy log files or service query output | Object-panel Node scope; cluster data-access reads | [node-logs.md](node-logs.md) |

- Never mix Application Logs settings, buffers, or transports into Kubernetes
  log workflows.
- Document whether a new control filters frontend data or changes the backend
  target/query.
- Share viewer behavior (search, wrap, ANSI, copy, structured views, levels) only where the source
  supports it: a control both viewers can support goes in the shared piece,
  otherwise it is an optional feature.
- Validate with focused tests for the changed surface; transport changes also
  warrant a manual stream/fetch smoke test.

## Shared viewer shell

Container and Node Logs share one shell under
`frontend/src/modules/object-panel/components/ObjectPanel/Logs`; each keeps its
own source selection and transport. Timestamps and previous logs are optional
features; Node Logs passes neither.

- `logOptionsReducer.ts`: search (text, filter mode, case, regex), the level
  filter, display (wrap, ANSI, raw/pretty/parsed), row expansion, auto-refresh;
  the container reducer composes it with its source fields. Filter modes: All (default) keeps
  every line, Filtered keeps matches, Invert keeps the rest. Matches highlight
  in All and Filtered, never Invert. Case sensitivity is off in regex mode.
- `hooks/useLogPresentation.ts`: per-line cached analysis of every entry
  (structured fields from `logLineFormats.ts`: a JSON object, klog, or logfmt
  with at least two pairs; and the line's level from `logLevels.ts`: its level
  field, or a level word in the first 100 characters of plain text), levels
  resolved before any filter (an unleveled line takes the last level from its
  own source, `sourceKeyOf`; Container Logs keys by pod and container, so a
  stack trace stays with its error line; nothing to inherit is No level). An
  inherited level is remembered per entry object, so lines keep it after
  eviction drops their source line and across remounts; a line still in the
  buffer wins over the memory, and a new snapshot or source brings new objects.
  Plain string lines (Node Logs) have no identity and no memory. Then the
  level filter, then the deferred text filter (the viewer supplies an entry's
  match texts; container search also matches pod and container names), the
  parsed table (rows, columns, CSV;
  Container Logs passes pod, container, timestamp columns and its CSV value
  formatter), and copy text. Parsed rows are derived, never stored. Node Logs
  splits plain lines into rows with `splitDisplayRows`; Container Logs builds
  rows from entries, so pod, container, and timestamp come from the entry,
  never the message text. `useRawViewFallback` returns Pretty and Table to raw
  only when lines are shown and none is structured; an empty log keeps the
  view. klog and logfmt values stay strings, with Go quoting escapes decoded
  (an escape it does not know, or a `\x` byte above 0x7F, stays as written);
  Pretty shows any structured line as indented JSON.
- `logToolbar.tsx`: icon bar, search row (`LogSearchRow`), and log count
  (`renderLogCount`, "shown/total logs", only while a filter hides lines, in
  the active-filters strip left of Clear all).
  - The search button opens the row below the main controls; ⌘F / Ctrl+F opens
    it and focuses the box. Row: text box, filter-mode button (click cycles
    All → Filtered → Invert; menu picks one; `I` switches Invert/All), case and
    regex options.
  - While open, Escape with focus in the Logs tab closes the row before the
    object panel's Escape can close the tab; focus inside the row moves to the
    search button first.
  - Closing the row keeps its filter; the search button stays highlighted while
    a filter is typed. Container Logs persists row-open state with the tab's
    options; Node Logs keeps it in memory with its filter text.
  - Search, timestamps, wrap, and their shortcuts are unavailable until a line
    arrives; ANSI and format buttons are hidden until a line has color codes or
    is structured.
  - Timestamps is a split toggle: the icon shows/hides timestamps and is
    labeled with the zone (UTC or LOCAL); the caret menu picks the zone and
    shows timestamps. The zone is the app-wide Settings → Logs setting, applying
    to every Logs tab.
  - With structured lines present, the format button cycles Raw → Pretty → Table, its caret
    menu picks one, and `J` / `P` toggle Pretty / Table.
  - Other shared settings (buffer size, container limits, timestamp format)
    live only in Settings → Logs.
- `logSearchChips.ts`: search chips in the active-filters strip (text filter,
  flagged "(invalid expression)" for a bad regex; Filtered or Invert, Match
  case, Regex when on), level chips (one per chosen level, or No levels), and
  the search and level part of Clear all. Container Logs adds source and
  previous-logs chips.
- Log Levels: a multi-select dropdown after Pods/Containers (same control and
  labels as the Application Logs level filter), listing the levels present plus
  any chosen level the buffer no longer holds, then No level; hidden while no
  line has a level. A frontend filter; the backend still reads every line.
  Its action row adds a Markers toggle (on by default, saved with the tab's
  options): raw and Pretty rows of debug, warning and error entries (fatal
  shows as error, trace and info stay plain; inherited stack-trace lines
  included) get a 3px bar in the Application Logs level color at their left
  edge (`data-level-marker`), and every row leaves room for it while markers
  show. A row's level is its cached own level or the inherited level the
  resolve pass remembered, so nothing is rebuilt per batch. In the Table view
  the level column's text takes the level colors (info too, as in Application
  Logs; trace and non-level values stay plain) from the `.log-level` classes in
  `LogTable.css`, which both log tables share. Only Container Logs shows the
  filter and markers so far; Node Logs runs the same detection with the filter
  left at all levels, and its Table view colors the level column too.
- `hooks/useLogKeyboardShortcuts.ts`: shared shortcuts; `T` (timestamps) and
  `V` (previous logs) exist only when the viewer passes those features.
- Shared with Application Logs: `@shared/hooks/useLogScrollRestoration.ts`
  (tail-following and scroll restore) and `@shared/components/logs/`: `LogTable`
  (log lines in a GridTable, the Table format; `LogTable.css` rows, cells, and
  expansion), `LogResumeScrollingButton` (Resume scrolling), and
  `buildLogAutoRefreshItem` (the Stop/Start auto-refresh button, first in the
  icon bar; `R` toggles it). The Table format's log-tinted header stays
  container-only (`.parsed-logs-table` in `LogViewer.css`).
- `@shared/hooks/useLogDownloadMenu.tsx`: the Download button of every log view,
  App Logs included, on the `useDownloadMenu` tables use (busy while a choice
  runs, then success/error feedback). Both choices take the same text: CSV in
  Table view (`.csv`), otherwise the shown lines (`.log`). `Shift+C` still
  copies in Container and Node Logs. Failures are reported, never swallowed.
  `hooks/useLogSelectionCopy.ts` copies a selection.
- `LogStatus.tsx`: error block, warning bar, and buffer-full indicator (warning
  icon at the start of the controls row; tooltip says which logs are shown).
  Both viewers show loading with the shared spinner and empty messages as the
  log's only line; a failure that leaves lines keeps them and reports in the
  warning bar.

Per-batch cost: busy streams deliver up to four batches a second, so per-batch
work must scale with new lines, not the buffer. Container Logs formats each
entry once per display-option set (`useContainerLogDisplay`); each line is
parsed and its level detected once (cached per entry), so structured views
(`jsonOf`) and level resolution reuse that analysis, and like the text filter
the level filter costs one cheap pass over the buffer; copy text and table CSV
are built only when copying. Check with `mise exec -- wails3 task qc:benchmark-logs` (1,000 and
10,000 lines; raw, Pretty, and Table views). Besides a batch's own time it
reports the first full render and the follow-up a batch triggers: GridTable
re-measures auto-width columns from a debounced timer, so an auto-width Table
column without `measurementSampleKey` shows up there as measured cells per batch,
not in the batch time.

## Shared raw-log layout

Both viewers render through `Logs/RawLogViewer.tsx` (generic over row type;
`renderRow` receives the data the viewer attached) and
`Logs/hooks/useVirtualizedLogRows.ts`; DOM row refs and ResizeObserver callbacks
supply measured heights.

- Update the height cache immediately but publish its React state notification
  at most once per animation frame: a measured row can expose more unmeasured
  rows, and synchronous state updates from their refs recurse through commits.
- On cleanup, cancel pending notifications, disconnect observers, and clear
  measurements so StrictMode replay can remeasure after a canceled
  notification.
- Keep the row-key extractor stable across measurement renders. Cache updates
  still rebuild row positions; frame batching does not make layout cheap.
- Test tall wrapped rows, scrolling into unmeasured content, resizing,
  filtering to zero rows, wrap changes, and tail-following. Measure settling
  separately from crash prevention, include padding in height assertions, and
  begin StrictMode tests before viewport sizing can hide a lost notification.
- Known gap: the update-depth crash
  ([LUXURY-YACHT-FRONTEND-2Q](https://luxury-yacht.sentry.io/issues/7722326368/))
  is fixed, but 1,000 long lines in a 200×600px viewport took about 1.6 s to
  settle after the fix, and the original Deployment's native retry is
  unverified. Crash prevention does not resolve that layout cost.
