# kube-prometheus-stack fixtures

These are verbatim Prometheus HTTP API responses for the Metrics tab's
Prometheus provider ([plan](../../../../../docs/plans/metrics-history.md)).
They were captured 2026-10-01 through the Kubernetes API-server Service proxy,
the same route the in-cluster transport uses:

```text
/api/v1/namespaces/kube-prometheus-stack/services/http:kube-prometheus-stack-prometheus:http-web/proxy/api/v1/...
```

[manifest.json](manifest.json) lists every file with its endpoint, PromQL query,
and `start`/`end`/`step`. Range queries cover 10 minutes at a 30 s step. Each
series returned 20 points.

## Environment

| Component | Version |
| --- | --- |
| Kind | v0.33.0, `dev-cluster` (control plane + 2 workers), arm64 Docker VM |
| Kubernetes | v1.37.0 |
| Chart | `prometheus-community/kube-prometheus-stack` 91.8.2 (operator v0.94.1), default values |
| Prometheus | 3.15.0 |

Reproduce the environment with
[the Kind workflow](../../../../../docs/workflows/kind-clusters.md):
`clusters.sh start`, then `workloads.sh install dev --prometheus`. Wait about
10 minutes for scrape data, then run each manifest query with
`kubectl get --raw "<proxy path>/api/v1/query_range?<params>"` against
`~/.kube/dev-stg-clusters`, context `dev-cluster`.

## Subjects

- **Pod** `podinfo/podinfo-66888d8d86-5lpbr` on `dev-cluster-worker2`. One
  container, `podinfo`: requests 100m CPU / 256Mi memory, limits 500m / 512Mi.
- **Deployment** `podinfo/podinfo`: 2 replicas, ReplicaSet `podinfo-66888d8d86`.
- **Node** `dev-cluster-worker2`.

## What the capture established

- **cAdvisor (kubelet) series** carry `namespace`, `pod`, `container`, and
  `node`.
  - The pod-level aggregate and the pause container have no `container`
    label, so `container!=""` selects the real containers.
  - Network series exist only at pod level, with an `interface` label.
- **`container_fs_usage_bytes` has no series** on this containerd-based
  cluster ([pod_filesystem_absent.json](pod_filesystem_absent.json) is an empty
  `success` matrix).
- **kube-state-metrics:**
  - `kube_pod_owner` maps a pod to its ReplicaSet (`owner_kind`, `owner_name`).
  - `kube_replicaset_owner` maps a ReplicaSet to its Deployment through its
    `replicaset` label.
  - On object metrics that are not about pods (ReplicaSet, Deployment, Node),
    the `pod`, `container`, and `namespace` labels describe the
    kube-state-metrics pod itself. Never join or filter on them there.
- **The owner join and the recording rule agree.** The join without recording
  rules ([workload_cpu_owner_join.json](workload_cpu_owner_join.json)) matched
  the stack's `namespace_workload_pod:kube_pod_owner:relabel` recording rule
  ([workload_cpu_recording_rule.json](workload_cpu_recording_rule.json)) at
  every point (maximum difference 0). The join therefore works on Prometheus
  installs without that rule.
- **node-exporter series have no `node` label**, only `instance` (`IP:9100`).
  `* on(instance) group_left(nodename) node_uname_info{nodename="<node>"}`
  joins them to the node. The kubelet has no root-cgroup (`id="/"`) series
  here, so node CPU and memory come from node-exporter.
- **Kind caveats:**
  - Node-exporter has no `/` mount in a Kind node; filesystems appear at `/var`
    and bind-mounted files.
  - All Kind nodes share one Docker VM kernel, so node-exporter CPU and memory,
    and `kube_node_status_allocatable`, describe the whole VM rather than one
    node.
  - The etcd, scheduler, controller-manager, and kube-proxy targets report `up
    == 0`.
- **Errors.** A malformed query returns HTTP 400 with Prometheus' JSON body
  ([error_bad_data.json](error_bad_data.json)), relayed unchanged by the API-server
  proxy. `kubectl` replaces it with a generic "rejected our request" message,
  so the transport must decode the body itself.
