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

## Shared raw-log layout

Container and Node Logs use
[`RawLogViewer`](../../../frontend/src/modules/object-panel/components/ObjectPanel/Logs/RawLogViewer.tsx)
and its
[`useVirtualizedLogRows`](../../../frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useVirtualizedLogRows.ts)
hook. DOM row refs and ResizeObserver callbacks supply measured heights.

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
