# Logs Contract

Luxury Yacht has three separate log surfaces. Keep their scope, transport, and
settings separate.

| Surface | Shows | Scope | Details |
| --- | --- | --- | --- |
| Application Logs | Luxury Yacht diagnostic log buffer | App-global, optionally cluster-annotated | [application-logs.md](application-logs.md) |
| Container Logs | Kubernetes pod/workload container logs | Object-panel pod/workload scope | [container-logs.md](container-logs.md) |
| Node Logs | Node proxy log files or service query output | Object-panel Node scope | [node-logs.md](node-logs.md) |

## Agent Contract

- Do not mix Application Logs settings, buffers, or transports with Kubernetes
  log workflows.
- Kubernetes log paths must preserve `clusterId` and full object identity.
- Kubernetes log reads go through cluster/resource data-access paths.
- Application Logs are app-state/runtime data.
- Share viewer behavior such as search, wrapping, ANSI rendering, copy, and JSON
  display only when the source supports it.
- Document whether a new control filters existing frontend data or changes the
  backend target/query.

## Shared viewer shell

Container and Node Logs share one viewer shell under
`frontend/src/modules/object-panel/components/ObjectPanel/Logs`. Each viewer
keeps its own source selection and transport.

- `logOptionsReducer.ts`: search (text, highlight, invert, case, regex),
  display (wrap, ANSI, raw/pretty/parsed), row expansion, copy feedback and
  auto-refresh. The container reducer composes it with its source
  fields. Highlighting is off while the filter is inverted; case sensitivity is
  off in regex mode.
- `hooks/useLogPresentation.ts`: the deferred text filter (a viewer supplies the
  texts an entry matches; container search also matches pod and container
  names), JSON detection cached per line, the parsed JSON table (rows, columns
  and CSV; Container Logs passes pod, container and timestamp columns and its
  CSV value formatter), and the copy text. Parsed rows are derived, not stored.
  Node Logs splits its plain lines into display rows with `splitDisplayRows`;
  Container Logs builds its rows from the entries, so the pod, container and
  timestamp a row shows come from the entry and never from its message text. `useRawViewFallback` returns the JSON views to raw only when lines are
  shown and none is JSON; an empty log keeps the view.
- `logToolbar.tsx`: the text filter box (`LogTextFilter`), the icon bar, and
  the match count (`LogMatchCount`), shown only while a filter narrows the logs.
  Timestamps and previous logs are optional icon bar features; Node Logs
  passes neither. The log settings both viewers share (buffer size, container
  limits, API timestamps) live in Settings → Logs, not in the Logs tab.
- `hooks/useLogKeyboardShortcuts.ts`: shared shortcuts. `T` (timestamps) and
  `V` (previous logs) exist only when the viewer passes those features.
- `hooks/useLogCopyAction.ts`: the copy action and selection copy; clipboard
  failures are reported, never swallowed.
- `LogStatus.tsx`: the error block, the warning bar and the buffer-full
  indicator (a warning icon beside the icon bar whose tooltip says which logs
  are shown). Both viewers show loading with the shared spinner and their empty
  messages as the log's only line; a failure that leaves lines keeps them and
  reports in the warning bar.

Add a new control to the shared piece when both viewers can support it, and as
an optional feature otherwise.

A busy stream delivers a batch up to four times a second, so work per batch
must follow the new lines, not the buffer: Container Logs formats each entry
once per display option set (`useContainerLogDisplay`), the JSON views reuse
the presentation's cached parse (`jsonOf`), and copy text and table CSV are
built only when copying. Check changes to this path with
`mise exec -- wails3 task qc:benchmark-logs` (1,000 and 10,000 lines).

## Shared raw-log layout

Container and Node Logs use
[`RawLogViewer`](../../../frontend/src/modules/object-panel/components/ObjectPanel/Logs/RawLogViewer.tsx)
and its
[`useVirtualizedLogRows`](../../../frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useVirtualizedLogRows.ts)
hook. DOM row refs and ResizeObserver callbacks supply measured heights.
`RawLogViewer` is generic over its row type, so a viewer's `renderRow` receives
the data it attached to each row.

- Update the height cache immediately, but publish its React state notification
  at most once per animation frame. A measured row can expose more unmeasured
  rows; synchronous state updates from their refs can recurse through commits.
- Cancel pending notifications and disconnect observers on cleanup. Clear the
  measurements so StrictMode replay can remeasure after a canceled notification.
- Keep the row-key extractor stable across measurement renders. Cache updates
  still rebuild row positions; frame batching is not a guarantee of cheap layout.
- Exercise tall wrapped rows, scrolling into unmeasured content, resizing,
  filtering to zero rows, wrap changes, and tail-following. Measure settling
  separately from crash prevention. Include padding in height assertions, and
  begin StrictMode tests before viewport sizing can hide a lost notification.

## Validation

Run focused tests for the changed log surface. Manual stream/fetch smoke tests
are useful for transport changes.

The 2026-09-09 investigation of
[LUXURY-YACHT-FRONTEND-2Q](https://luxury-yacht.sentry.io/issues/7722326368/)
reproduced the update-depth failure with synthetic data and the real viewer.
The original Deployment's native retry remained unverified. Its extreme browser
case (1,000 long lines in a 200×600px viewport) took about 1.6 seconds to settle
after the fix; do not treat crash prevention as resolution of that layout cost.
