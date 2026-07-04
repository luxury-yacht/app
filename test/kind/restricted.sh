#!/usr/bin/env bash
# Manages a local Kind cluster with namespace-scoped management access.
# Usage: ./restricted.sh start | stop

set -euo pipefail

for cmd in kind kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '${cmd}' is not installed." >&2
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KUBECONFIG_DIR="${HOME}/.kube"

CLUSTER_NAME="restricted-cluster"
CONFIG_FILE="${SCRIPT_DIR}/clusters/restricted.yaml"
ADMIN_KUBECONFIG="${KUBECONFIG_DIR}/restricted-cluster-admin"
RESTRICTED_KUBECONFIG="${KUBECONFIG_DIR}/restricted-cluster"

KIND_CONTEXT="kind-${CLUSTER_NAME}"
ADMIN_CONTEXT="restricted-cluster-admin"
RESTRICTED_CONTEXT="restricted-cluster"

IDENTITY_NAMESPACE="luxury-yacht-restricted"
RESTRICTED_SERVICE_ACCOUNT="restricted-manager"
RESTRICTED_USER="restricted-manager"
RESTRICTED_ROLE_BINDING="restricted-manager-edit"
MANAGED_NAMESPACE_PREFIX="test-"
VERIFY_TEST_NAMESPACE="test-managed"
STATIC_MANAGED_NAMESPACES=("kube-system")

LEGACY_RESTRICTED_NAMESPACE="luxury-yacht-restricted"
LEGACY_SERVICE_ACCOUNT="restricted-viewer"
LEGACY_ROLE_BINDING="restricted-viewer-view"
LEGACY_CLUSTER_ROLE_BINDING="restricted-viewer-view"

cluster_exists() {
  kind get clusters 2>/dev/null | grep -qx "${CLUSTER_NAME}"
}

context_exists() {
  local kubeconfig="$1"
  local context="$2"

  kubectl config get-contexts --kubeconfig "${kubeconfig}" -o name 2>/dev/null | grep -qx "${context}"
}

admin_kctl() {
  kubectl --kubeconfig "${ADMIN_KUBECONFIG}" --context "${ADMIN_CONTEXT}" "$@"
}

restricted_kctl() {
  kubectl --kubeconfig "${RESTRICTED_KUBECONFIG}" --context "${RESTRICTED_CONTEXT}" "$@"
}

ensure_admin_context() {
  if context_exists "${ADMIN_KUBECONFIG}" "${ADMIN_CONTEXT}"; then
    kubectl config use-context --kubeconfig "${ADMIN_KUBECONFIG}" "${ADMIN_CONTEXT}" >/dev/null
    return
  fi

  if ! context_exists "${ADMIN_KUBECONFIG}" "${KIND_CONTEXT}"; then
    echo "Error: admin kubeconfig does not contain ${KIND_CONTEXT}." >&2
    exit 1
  fi

  kubectl config rename-context \
    --kubeconfig "${ADMIN_KUBECONFIG}" \
    "${KIND_CONTEXT}" "${ADMIN_CONTEXT}" >/dev/null
  kubectl config use-context --kubeconfig "${ADMIN_KUBECONFIG}" "${ADMIN_CONTEXT}" >/dev/null
}

install_restricted_rbac() {
  echo "Installing restricted RBAC..."

  admin_kctl create namespace "${IDENTITY_NAMESPACE}" --dry-run=client -o yaml | admin_kctl apply -f -
  admin_kctl create namespace "${VERIFY_TEST_NAMESPACE}" --dry-run=client -o yaml | admin_kctl apply -f -
  admin_kctl -n "${IDENTITY_NAMESPACE}" create serviceaccount "${RESTRICTED_SERVICE_ACCOUNT}" --dry-run=client -o yaml | admin_kctl apply -f -
  admin_kctl delete clusterrolebinding "${LEGACY_CLUSTER_ROLE_BINDING}" --ignore-not-found
  admin_kctl -n "${LEGACY_RESTRICTED_NAMESPACE}" delete rolebinding "${LEGACY_ROLE_BINDING}" --ignore-not-found
  admin_kctl -n "${LEGACY_RESTRICTED_NAMESPACE}" delete serviceaccount "${LEGACY_SERVICE_ACCOUNT}" --ignore-not-found

  while IFS= read -r namespace; do
    [[ -n "${namespace}" ]] || continue
    bind_restricted_namespace "${namespace}"
  done < <(managed_namespaces)
}

managed_namespaces() {
  printf '%s\n' "${STATIC_MANAGED_NAMESPACES[@]}"
  admin_kctl get namespaces -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' \
    | while IFS= read -r namespace; do
        if [[ "${namespace}" == "${MANAGED_NAMESPACE_PREFIX}"* ]]; then
          printf '%s\n' "${namespace}"
        fi
      done \
    | sort -u
}

bind_restricted_namespace() {
  local namespace="$1"

  admin_kctl -n "${namespace}" create rolebinding "${RESTRICTED_ROLE_BINDING}" \
    --clusterrole=edit \
    --serviceaccount="${IDENTITY_NAMESPACE}:${RESTRICTED_SERVICE_ACCOUNT}" \
    --dry-run=client \
    -o yaml | admin_kctl apply -f -
}

write_restricted_kubeconfig() {
  local token

  echo "Writing restricted kubeconfig..."
  token="$(admin_kctl -n "${IDENTITY_NAMESPACE}" create token "${RESTRICTED_SERVICE_ACCOUNT}" --duration=8760h)"

  cp "${ADMIN_KUBECONFIG}" "${RESTRICTED_KUBECONFIG}"
  kubectl config set-credentials "${RESTRICTED_USER}" \
    --kubeconfig "${RESTRICTED_KUBECONFIG}" \
    --token="${token}" >/dev/null
  kubectl config set-context "${RESTRICTED_CONTEXT}" \
    --kubeconfig "${RESTRICTED_KUBECONFIG}" \
    --cluster="${KIND_CONTEXT}" \
    --user="${RESTRICTED_USER}" >/dev/null
  kubectl config use-context --kubeconfig "${RESTRICTED_KUBECONFIG}" "${RESTRICTED_CONTEXT}" >/dev/null

  if context_exists "${RESTRICTED_KUBECONFIG}" "${ADMIN_CONTEXT}"; then
    kubectl config delete-context --kubeconfig "${RESTRICTED_KUBECONFIG}" "${ADMIN_CONTEXT}" >/dev/null
  fi
  if context_exists "${RESTRICTED_KUBECONFIG}" "${KIND_CONTEXT}"; then
    kubectl config delete-context --kubeconfig "${RESTRICTED_KUBECONFIG}" "${KIND_CONTEXT}" >/dev/null
  fi
  kubectl config unset "users.${KIND_CONTEXT}" --kubeconfig "${RESTRICTED_KUBECONFIG}" >/dev/null 2>&1 || true
}

verify_restricted_access() {
  echo "Verifying restricted permissions..."

  if restricted_kctl auth can-i list namespaces --quiet; then
    echo "Error: restricted user can list namespaces; expected denial." >&2
    exit 1
  fi

  if ! restricted_kctl auth can-i create deployments.apps -n kube-system --quiet; then
    echo "Error: restricted user cannot create deployments in kube-system; expected edit access." >&2
    exit 1
  fi

  if ! restricted_kctl auth can-i create deployments.apps -n "${VERIFY_TEST_NAMESPACE}" --quiet; then
    echo "Error: restricted user cannot create deployments in ${VERIFY_TEST_NAMESPACE}; expected edit access." >&2
    exit 1
  fi

  if restricted_kctl auth can-i create deployments.apps -n default --quiet; then
    echo "Error: restricted user can create deployments in default; expected denial." >&2
    exit 1
  fi
}

start_cluster() {
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Error: cluster config not found: ${CONFIG_FILE}" >&2
    exit 1
  fi

  mkdir -p "${KUBECONFIG_DIR}"

  if cluster_exists; then
    echo "Cluster '${CLUSTER_NAME}' already exists, refreshing admin kubeconfig."
    kind export kubeconfig --name "${CLUSTER_NAME}" --kubeconfig "${ADMIN_KUBECONFIG}"
  else
    echo "Creating cluster '${CLUSTER_NAME}' from restricted.yaml..."
    kind create cluster \
      --name "${CLUSTER_NAME}" \
      --config "${CONFIG_FILE}" \
      --kubeconfig "${ADMIN_KUBECONFIG}"
  fi

  ensure_admin_context
  install_restricted_rbac
  write_restricted_kubeconfig
  verify_restricted_access

  echo ""
  echo "Restricted cluster ready."
  echo "  admin:      ${ADMIN_KUBECONFIG} (context: ${ADMIN_CONTEXT})"
  echo "  restricted: ${RESTRICTED_KUBECONFIG} (context: ${RESTRICTED_CONTEXT}, namespace RoleBinding: edit)"
  echo "  managed:    kube-system and current ${MANAGED_NAMESPACE_PREFIX}* namespaces"
}

stop_cluster() {
  if cluster_exists; then
    echo "Deleting cluster '${CLUSTER_NAME}'..."
    kind delete cluster --name "${CLUSTER_NAME}"
  else
    echo "Cluster '${CLUSTER_NAME}' does not exist, skipping."
  fi

  rm -f "${ADMIN_KUBECONFIG}" "${RESTRICTED_KUBECONFIG}"
  echo "Removed kubeconfigs:"
  echo "  ${ADMIN_KUBECONFIG}"
  echo "  ${RESTRICTED_KUBECONFIG}"
}

case "${1:-}" in
  start)
    start_cluster
    ;;
  stop)
    stop_cluster
    ;;
  *)
    echo "Usage: $0 {start|stop}" >&2
    exit 1
    ;;
esac
