#!/usr/bin/env bash

KUBECONFIG_DIR="${HOME}/.kube"

require_commands() {
  local command_name
  for command_name in "$@"; do
    if ! command -v "${command_name}" &>/dev/null; then
      echo "Error: '${command_name}' is not installed." >&2
      return 1
    fi
  done
}

kubeconfig_for() {
  local environment="$1"
  case "${environment}" in
    dev|stg) printf '%s/dev-stg-clusters\n' "${KUBECONFIG_DIR}" ;;
    prod) printf '%s/prod-clusters\n' "${KUBECONFIG_DIR}" ;;
    *) echo "Unknown environment: ${environment}" >&2; return 1 ;;
  esac
}

kubectl_for() {
  local kubeconfig="$1"
  local context="$2"
  shift 2
  kubectl --kubeconfig "${kubeconfig}" --context "${context}" "$@"
  return $?
}

ensure_namespace() {
  local kubeconfig="$1"
  local context="$2"
  local namespace="$3"
  kubectl_for "${kubeconfig}" "${context}" create namespace "${namespace}" --dry-run=client -o yaml \
    | kubectl_for "${kubeconfig}" "${context}" apply -f -
  return $?
}

ensure_kind_cluster() {
  local cluster="$1"
  local config="$2"
  local kubeconfig="$3"
  local existing_clusters="$4"
  local kubeconfig_description="${5:-kubeconfig}"

  if grep -Fxq -- "${cluster}" <<< "${existing_clusters}"; then
    echo "Cluster '${cluster}' already exists, refreshing ${kubeconfig_description}."
    kind export kubeconfig --name "${cluster}" --kubeconfig "${kubeconfig}"
  else
    echo "Creating cluster '${cluster}' from ${config##*/}..."
    kind create cluster --name "${cluster}" --config "${config}" --kubeconfig "${kubeconfig}"
  fi
  return $?
}

delete_kind_cluster() {
  local cluster="$1"
  local kubeconfig="$2"
  local existing_clusters="$3"

  if grep -Fxq -- "${cluster}" <<< "${existing_clusters}"; then
    echo "Deleting cluster '${cluster}'..."
    kind delete cluster --name "${cluster}" --kubeconfig "${kubeconfig}"
  else
    echo "Cluster '${cluster}' does not exist, skipping."
  fi
  return $?
}
