#!/usr/bin/env bash
# Manages local Kind clusters for Luxury Yacht development/testing.
# Usage: ./clusters.sh start | stop

set -euo pipefail

if ! command -v kind &>/dev/null; then
  echo "Error: 'kind' is not installed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECONFIG_DIR="${HOME}/.kube"

# Cluster definitions: name -> config file
declare -A CLUSTERS=(
  [dev-cluster]="dev.yaml"
  [stg-cluster]="stg.yaml"
  [prod-cluster]="prod.yaml"
)

# Map clusters to their kubeconfig files
declare -A KUBECONFIG_FILES=(
  [dev-cluster]="dev-stg-clusters"
  [stg-cluster]="dev-stg-clusters"
  [prod-cluster]="prod-clusters"
)

# Friendly context names in the kubeconfig
declare -A CONTEXT_NAMES=(
  [dev-cluster]="dev-cluster"
  [stg-cluster]="stg-cluster"
  [prod-cluster]="prod-cluster"
)

start_clusters() {
  backup_kube
  mkdir -p "${KUBECONFIG_DIR}"

  for cluster in "${!CLUSTERS[@]}"; do
    config="${CLUSTERS[$cluster]}"
    kubeconfig="${KUBECONFIG_DIR}/${KUBECONFIG_FILES[$cluster]}"

    if kind get clusters 2>/dev/null | grep -qx "${cluster}"; then
      echo "Cluster '${cluster}' already exists, skipping."
      continue
    fi

    echo "Creating cluster '${cluster}' from ${config}..."
    kind create cluster \
      --name "${cluster}" \
      --config "${SCRIPT_DIR}/${config}" \
      --kubeconfig "${kubeconfig}"

    # Rename the context from kind-<name> to a friendly name
    kubectl config rename-context \
      --kubeconfig "${kubeconfig}" \
      "kind-${cluster}" "${CONTEXT_NAMES[$cluster]}"

    echo "Kubeconfig written to ${kubeconfig} (context: ${CONTEXT_NAMES[$cluster]})"

    # Install metrics-server (patched for Kind's self-signed certs)
    echo "Installing metrics-server in '${cluster}'..."
    kubectl apply \
      --kubeconfig "${kubeconfig}" \
      --context "${CONTEXT_NAMES[$cluster]}" \
      -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    kubectl patch deployment metrics-server \
      --kubeconfig "${kubeconfig}" \
      --context "${CONTEXT_NAMES[$cluster]}" \
      -n kube-system \
      --type=json \
      -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
  done

  echo ""
  echo "All clusters ready."
  echo "  dev + stg: ${KUBECONFIG_DIR}/dev-stg-clusters"
  echo "  prod:      ${KUBECONFIG_DIR}/prod-clusters"
}

stop_clusters() {
  for cluster in "${!CLUSTERS[@]}"; do
    if kind get clusters 2>/dev/null | grep -qx "${cluster}"; then
      echo "Deleting cluster '${cluster}'..."
      kind delete cluster --name "${cluster}"
    else
      echo "Cluster '${cluster}' does not exist, skipping."
    fi
  done

  echo "All clusters stopped."

  rm -rf "${KUBECONFIG_DIR}"
  restore_kube
}

BACKUP_DIR="${HOME}/.kube.luxury-yacht-test"

backup_kube() {
  if [[ ! -d "${KUBECONFIG_DIR}" ]]; then
    echo "Nothing to back up: ${KUBECONFIG_DIR} does not exist."
    return
  fi

  if [[ -d "${BACKUP_DIR}" ]]; then
    echo "Backup already exists at ${BACKUP_DIR}. Restore it first before creating a new backup."
    return 1
  fi

  mv "${KUBECONFIG_DIR}" "${BACKUP_DIR}"
  echo "Backed up ${KUBECONFIG_DIR} to ${BACKUP_DIR}"
}

restore_kube() {
  if [[ ! -d "${BACKUP_DIR}" ]]; then
    echo "No backup found at ${BACKUP_DIR}."
    return 1
  fi

  mv "${BACKUP_DIR}" "${KUBECONFIG_DIR}"
  echo "Restored ${KUBECONFIG_DIR} from ${BACKUP_DIR}"
}

case "${1:-}" in
  start)
    start_clusters
    ;;
  stop)
    stop_clusters
    ;;
  *)
    echo "Usage: $0 {start|stop}" >&2
    exit 1
    ;;
esac
