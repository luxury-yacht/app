# Logs Overview

Luxury Yacht has three separate log surfaces. Keep their contracts separate.

| Surface          | What it shows                                | Scope                                                  | Primary docs                               |
| ---------------- | -------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| Application Logs | Luxury Yacht's own diagnostic log buffer     | App-global, optionally annotated with cluster metadata | [application-logs.md](application-logs.md) |
| Container Logs   | Kubernetes pod/workload container log output | Object-panel pod or workload scope                     | [container-logs.md](container-logs.md)     |
| Node Logs        | Node proxy log files or service query output | Object-panel Node scope                                | [node-logs.md](node-logs.md)               |

Application Logs are for app diagnostics: startup, settings, kubeconfig
discovery, auth, refresh setup, object catalog, streams, shell sessions, port
forwarding, update checks, and selected frontend diagnostics.

Container Logs use Kubernetes pod log APIs through the refresh/log streaming
path. They support live follow, fallback/manual fetch, previous logs for pods,
frontend search/filtering, JSON display modes, timestamps, ANSI rendering, and
target caps.

Node Logs use the Kubernetes node proxy logs endpoint. They are discovered on
demand for a specific Node object panel, are snapshot/fetch based rather than
follow streaming, and intentionally hide pod/container log paths because those
belong to Container Logs.

When changing log-related code:

- Keep canonical object identity and `clusterId` on Kubernetes log paths.
- Route Kubernetes log reads through `dataAccess`; Application Logs remain
  app-state/runtime data.
- Do not share Application Logs settings with Container Logs or Node Logs.
- Prefer shared viewer behavior for search, wrapping, ANSI rendering, copy, and
  parsed JSON where the underlying log source supports it.
- Shared Container Logs / Node Logs viewer behavior belongs under
  `frontend/src/modules/object-panel/components/ObjectPanel/Logs`; keep
  transport and source-selection wiring in the specific log surface.
- Document whether a new control is frontend-only filtering or backend-side
  target reduction.
