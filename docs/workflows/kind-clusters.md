# Local Kind clusters

The [Kind scripts](../../test/kind/clusters.sh) require Bash 3.2 or newer, Kind,
kubectl, and a running container runtime; workload installation also requires
Helm and network access to chart repositories and container registries. Run
from the repository root:

```sh
mise exec -- ./test/kind/clusters.sh start
mise exec -- ./test/kind/workloads.sh install all
mise exec -- ./test/kind/workloads.sh install dev --stress-ng
mise exec -- ./test/kind/workloads.sh uninstall all
mise exec -- ./test/kind/clusters.sh stop
```

- `workloads.sh` takes `dev`, `stg`, `prod`, or `all`.
- Stress-ng is opt-in: append `--stress-ng` to `install`. Its CPU stressor uses
  one worker at 50% load; its memory stressor uses 1 GiB. Installing without
  the flag leaves existing stress workloads alone; `uninstall` always removes
  the stress deployment and namespace, including earlier runs' workloads.
- Controller flags add controllers alongside the environment's sample
  workloads. They combine with each other and `--stress-ng`, in any order after
  the environment argument:

```sh
mise exec -- ./test/kind/workloads.sh install dev --argocd --external-secrets-operator --cert-manager
```

| Flag | Helm chart | Release and namespace |
| --- | --- | --- |
| `--argocd` | `argo/argo-cd` | `argocd` |
| `--external-secrets-operator` | `external-secrets/external-secrets` | `external-secrets` |
| `--cert-manager` | `jetstack/cert-manager` | `cert-manager` |

- Charts use Helm's latest stable version and default values.
  [Argo CD](https://github.com/argoproj/argo-helm/tree/main/charts/argo-cd) and
  [External Secrets](https://external-secrets.io/latest/introduction/getting-started/)
  include CRDs by default; for
  [cert-manager](https://cert-manager.io/docs/installation/helm/) the script
  sets `crds.enabled=true` as its installation instructions require. Configure
  Git repositories, SecretStores, and Issuers separately after installation.
- Repeated installs upgrade the selected releases; installing without a
  controller's flag leaves its existing release alone.
- `uninstall` removes all three optional releases before deleting their
  namespaces; a release-removal error aborts cleanup. Helm's default CRD
  retention applies, so some CRDs can remain. Remove user-created controller
  resources before uninstalling controllers; use `clusters.sh stop` to discard
  the entire test cluster.

## Kubeconfig ownership and recovery

- `clusters.sh` owns `~/.kube/dev-stg-clusters` and `~/.kube/prod-clusters`,
  with contexts `dev-cluster`, `stg-cluster`, and `prod-cluster`. Do not store
  unrelated contexts in those files. Personal kubeconfigs and other files in
  `~/.kube` stay in place through startup and shutdown.
- Every cluster operation uses an explicit kubeconfig; workload operations also
  select an explicit context.
- Startup reconciles existing clusters, refreshes their kubeconfigs, and
  reapplies metrics-server setup; rerun `start` after a partial failure. A
  failed cluster listing must abort before cleanup or creation.
- Shutdown removes only the named test kubeconfigs, after cluster deletion
  succeeds; repeating it is supported.
- Older script versions moved personal kubeconfigs to
  `~/.kube.luxury-yacht-test`; the scripts now leave that backup untouched and
  never merge or discard it. If it exists, inspect and restore needed files
  manually, preserving any newer files in `~/.kube`.

## Restricted access

```sh
mise exec -- ./test/kind/restricted.sh start
mise exec -- ./test/kind/restricted.sh stop
```

[restricted.sh](../../test/kind/restricted.sh) owns the
`restricted-cluster-admin` and `restricted-cluster` kubeconfigs in `~/.kube`.
The restricted identity receives namespace-scoped edit access in `kube-system`
and current `test-*` namespaces; rerun `start` after adding a namespace.
Namespace discovery must succeed before role bindings are applied or restricted
credentials are rewritten; discovery errors must not report successful setup.

## Validation

The entry scripts source `test/kind/common.sh` for dependency checks, scoped
kubectl calls, namespace creation, and Kind create/export/delete. Cluster
discovery stays in each entry script as a checked step before the shared
lifecycle helpers; context naming and kubeconfig cleanup stay local.

```sh
GOCACHE=/tmp/luxury-yacht-go-build mise exec -- go test ./test/kind -count=1
mise exec -- shellcheck -x -P test/kind test/kind/*.sh
```

The regression suite (part of the repository's Go test and race suites) runs
script copies with home-directory paths redirected into temporary fixtures and
Kind/kubectl/Helm replaced by subprocess fixtures. It checks shell control
flow, filesystem ownership, and command/manifest contracts; it does not prove
live cluster readiness or image availability, and Go coverage does not measure
shell statements.
