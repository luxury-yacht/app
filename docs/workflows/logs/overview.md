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

## Validation

Run focused tests for the changed log surface. Manual stream/fetch smoke tests
are useful for transport changes.
