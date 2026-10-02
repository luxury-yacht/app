#!/usr/bin/env bash
# Installs/uninstalls sample workloads for testing Luxury Yacht.
# Usage: ./workloads.sh install dev|stg|prod|all [options]
#        ./workloads.sh uninstall dev|stg|prod|all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
require_commands helm kubectl

# Helpers to run kubectl/helm with the right kubeconfig and context
kctl() {
  local env="$1"; shift
  local kubeconfig
  kubeconfig="$(kubeconfig_for "$env")"
  kubectl_for "${kubeconfig}" "${env}-cluster" "$@"
}

hhelm() {
  local env="$1"; shift
  local kubeconfig
  kubeconfig="$(kubeconfig_for "$env")"
  helm --kubeconfig "${kubeconfig}" --kube-context "${env}-cluster" "$@"
}

# Add helm repos (idempotent)
add_helm_repos() {
  helm repo add podinfo https://stefanprodan.github.io/podinfo 2>/dev/null || true
  helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
  if [[ "${INSTALL_ARGOCD}" == true ]]; then
    helm repo add argo https://argoproj.github.io/argo-helm --force-update
  fi
  if [[ "${INSTALL_EXTERNAL_SECRETS_OPERATOR}" == true ]]; then
    helm repo add external-secrets https://charts.external-secrets.io --force-update
  fi
  if [[ "${INSTALL_CERT_MANAGER}" == true ]]; then
    helm repo add jetstack https://charts.jetstack.io --force-update
  fi
  helm repo update
}

# --- Namespace helpers ---

create_namespaces() {
  local env="$1"
  local kubeconfig
  kubeconfig="$(kubeconfig_for "${env}")"
  for ns in podinfo redis postgres batch monitoring; do
    ensure_namespace "${kubeconfig}" "${env}-cluster" "$ns"
  done
}

delete_namespaces() {
  local env="$1"
  for ns in podinfo redis postgres batch monitoring stress-test; do
    kctl "$env" delete namespace "$ns" --ignore-not-found
  done
}

# --- Helm workloads ---

install_podinfo() {
  local env="$1"
  echo "  Installing podinfo..."
  hhelm "$env" upgrade --install podinfo podinfo/podinfo \
    --namespace podinfo \
    --set replicaCount=2 \
    --set resources.requests.cpu=100m \
    --set resources.requests.memory=256Mi \
    --set resources.limits.cpu=500m \
    --set resources.limits.memory=512Mi
}

uninstall_podinfo() {
  local env="$1"
  hhelm "$env" uninstall podinfo --namespace podinfo 2>/dev/null || true
}

install_redis() {
  local env="$1"
  echo "  Installing redis..."
  hhelm "$env" upgrade --install redis bitnami/redis \
    --namespace redis \
    --set architecture=standalone \
    --set auth.enabled=true \
    --set master.resources.requests.cpu=250m \
    --set master.resources.requests.memory=1Gi \
    --set master.resources.limits.cpu=1000m \
    --set master.resources.limits.memory=2Gi
}

uninstall_redis() {
  local env="$1"
  hhelm "$env" uninstall redis --namespace redis 2>/dev/null || true
}

install_postgresql() {
  local env="$1"
  echo "  Installing postgresql..."
  hhelm "$env" upgrade --install postgresql bitnami/postgresql \
    --namespace postgres \
    --set auth.postgresPassword=testpassword \
    --set primary.resources.requests.cpu=2000m \
    --set primary.resources.requests.memory=2Gi \
    --set primary.resources.limits.cpu=4000m \
    --set primary.resources.limits.memory=4Gi
}

uninstall_postgresql() {
  local env="$1"
  hhelm "$env" uninstall postgresql --namespace postgres 2>/dev/null || true
}

install_addons() {
  local env="$1"
  if [[ "${INSTALL_ARGOCD}" == true ]]; then
    echo "  Installing Argo CD..."
    hhelm "$env" upgrade --install argocd argo/argo-cd \
      --namespace argocd --create-namespace
  fi
  if [[ "${INSTALL_EXTERNAL_SECRETS_OPERATOR}" == true ]]; then
    echo "  Installing External Secrets Operator..."
    hhelm "$env" upgrade --install external-secrets external-secrets/external-secrets \
      --namespace external-secrets --create-namespace
  fi
  if [[ "${INSTALL_CERT_MANAGER}" == true ]]; then
    echo "  Installing cert-manager..."
    hhelm "$env" upgrade --install cert-manager jetstack/cert-manager \
      --namespace cert-manager --create-namespace \
      --set crds.enabled=true
  fi
}

uninstall_addons() {
  local env="$1"
  local release
  for release in argocd external-secrets cert-manager; do
    hhelm "$env" uninstall "${release}" --namespace "${release}" --ignore-not-found
    kctl "$env" delete namespace "${release}" --ignore-not-found
  done
}

# --- Plain manifest workloads ---

install_cronjob() {
  local env="$1"
  echo "  Installing cronjob..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: batch/v1
kind: CronJob
metadata:
  name: hello-cron
  namespace: batch
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: hello
            image: busybox:1.36
            command: ["sh", "-c", "echo Hello from cron at $(date)"]
          restartPolicy: OnFailure
EOF
}

uninstall_cronjob() {
  local env="$1"
  kctl "$env" delete cronjob hello-cron -n batch --ignore-not-found
}

install_daemonset() {
  local env="$1"
  echo "  Installing daemonset..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: node-logger
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: node-logger
  template:
    metadata:
      labels:
        app: node-logger
    spec:
      containers:
      - name: logger
        image: busybox:1.36
        command: ["sh", "-c", "while true; do echo Node logger running on $(hostname); sleep 60; done"]
        resources:
          limits:
            memory: "64Mi"
            cpu: "50m"
          requests:
            memory: "32Mi"
            cpu: "10m"
EOF
}

uninstall_daemonset() {
  local env="$1"
  kctl "$env" delete daemonset node-logger -n monitoring --ignore-not-found
}

install_job() {
  local env="$1"
  echo "  Installing job..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: batch/v1
kind: Job
metadata:
  name: pi-calculator
  namespace: batch
spec:
  template:
    spec:
      containers:
      - name: pi
        image: perl:5.38
        command: ["perl", "-Mbignum=bpi", "-wle", "print bpi(2000)"]
      restartPolicy: Never
  backoffLimit: 4
EOF
}

uninstall_job() {
  local env="$1"
  kctl "$env" delete job pi-calculator -n batch --ignore-not-found
}

install_rbac() {
  local env="$1"
  echo "  Installing RBAC resources..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-reader
  namespace: podinfo
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: podinfo
rules:
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods
  namespace: podinfo
subjects:
- kind: ServiceAccount
  name: app-reader
  namespace: podinfo
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
EOF
}

uninstall_rbac() {
  local env="$1"
  kctl "$env" delete rolebinding read-pods -n podinfo --ignore-not-found
  kctl "$env" delete role pod-reader -n podinfo --ignore-not-found
  kctl "$env" delete serviceaccount app-reader -n podinfo --ignore-not-found
}

install_hpa() {
  local env="$1"
  echo "  Installing HPA..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: podinfo
  namespace: podinfo
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: podinfo
  minReplicas: 2
  maxReplicas: 5
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 80
EOF
}

uninstall_hpa() {
  local env="$1"
  kctl "$env" delete hpa podinfo -n podinfo --ignore-not-found
}

install_networkpolicy() {
  local env="$1"
  echo "  Installing network policies..."
  kctl "$env" apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: deny-all-ingress
  namespace: podinfo
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-podinfo
  namespace: podinfo
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: podinfo
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: podinfo
    ports:
    - protocol: TCP
      port: 9898
EOF
}

uninstall_networkpolicy() {
  local env="$1"
  kctl "$env" delete networkpolicy deny-all-ingress allow-podinfo -n podinfo --ignore-not-found
}

install_stress() {
  local env="$1"
  if [[ "${INSTALL_STRESS_NG}" != true ]]; then
    return
  fi
  echo "  Installing stress-ng..."
  local kubeconfig
  kubeconfig="$(kubeconfig_for "${env}")"
  ensure_namespace "${kubeconfig}" "${env}-cluster" stress-test
  kctl "$env" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stress-ng
  namespace: stress-test
spec:
  replicas: 2
  selector:
    matchLabels:
      app: stress-ng
  template:
    metadata:
      labels:
        app: stress-ng
    spec:
      containers:
      - name: stress-ng
        image: alexeiled/stress-ng:latest
        args: ["--cpu", "1", "--cpu-load", "50", "--vm", "1", "--vm-bytes", "1G", "--timeout", "0"]
        resources:
          requests:
            cpu: "2"
            memory: 2Gi
          limits:
            cpu: "4"
            memory: 4Gi
EOF
}

uninstall_stress() {
  local env="$1"
  kctl "$env" delete deployment stress-ng -n stress-test --ignore-not-found
}

# --- Per-environment install/uninstall ---

# dev: podinfo, cronjob, daemonset
install_dev() {
  echo "Installing dev workloads..."
  add_helm_repos
  create_namespaces dev
  install_podinfo dev
  install_cronjob dev
  install_daemonset dev
  install_stress dev
  install_addons dev
  echo "Dev workloads installed."
}

uninstall_dev() {
  echo "Uninstalling dev workloads..."
  uninstall_podinfo dev
  uninstall_cronjob dev
  uninstall_daemonset dev
  uninstall_stress dev
  uninstall_addons dev
  delete_namespaces dev
  echo "Dev workloads uninstalled."
}

# stg: podinfo, redis, job, RBAC
install_stg() {
  echo "Installing stg workloads..."
  add_helm_repos
  create_namespaces stg
  install_podinfo stg
  install_redis stg
  install_job stg
  install_rbac stg
  install_stress stg
  install_addons stg
  echo "Stg workloads installed."
}

uninstall_stg() {
  echo "Uninstalling stg workloads..."
  uninstall_podinfo stg
  uninstall_redis stg
  uninstall_job stg
  uninstall_rbac stg
  uninstall_stress stg
  uninstall_addons stg
  delete_namespaces stg
  echo "Stg workloads uninstalled."
}

# prod: podinfo, redis, postgresql, HPA, network policies
install_prod() {
  echo "Installing prod workloads..."
  add_helm_repos
  create_namespaces prod
  install_podinfo prod
  install_redis prod
  install_postgresql prod
  install_hpa prod
  install_networkpolicy prod
  install_stress prod
  install_addons prod
  echo "Prod workloads installed."
}

uninstall_prod() {
  echo "Uninstalling prod workloads..."
  uninstall_hpa prod
  uninstall_networkpolicy prod
  uninstall_podinfo prod
  uninstall_redis prod
  uninstall_postgresql prod
  uninstall_stress prod
  uninstall_addons prod
  delete_namespaces prod
  echo "Prod workloads uninstalled."
}

# --- Main ---

usage() {
  echo "Usage: $0 install {dev|stg|prod|all} [options] | uninstall {dev|stg|prod|all}" >&2
  echo "Install options: --stress-ng --argocd --external-secrets-operator --cert-manager" >&2
}

ACTION="${1:-}"
ENV="${2:-}"
INSTALL_STRESS_NG=false
INSTALL_ARGOCD=false
INSTALL_EXTERNAL_SECRETS_OPERATOR=false
INSTALL_CERT_MANAGER=false

for install_option in "${@:3}"; do
  if [[ "${ACTION}" != install ]]; then
    usage
    exit 1
  fi
  case "${install_option}" in
    --stress-ng) INSTALL_STRESS_NG=true ;;
    --argocd) INSTALL_ARGOCD=true ;;
    --external-secrets-operator) INSTALL_EXTERNAL_SECRETS_OPERATOR=true ;;
    --cert-manager) INSTALL_CERT_MANAGER=true ;;
    *) usage; exit 1 ;;
  esac
done

case "${ACTION}" in
  install)
    case "${ENV}" in
      dev)  install_dev ;;
      stg)  install_stg ;;
      prod) install_prod ;;
      all)  install_dev; install_stg; install_prod ;;
      *)    usage; exit 1 ;;
    esac
    ;;
  uninstall)
    case "${ENV}" in
      dev)  uninstall_dev ;;
      stg)  uninstall_stg ;;
      prod) uninstall_prod ;;
      all)  uninstall_dev; uninstall_stg; uninstall_prod ;;
      *)    usage; exit 1 ;;
    esac
    ;;
  *)
    usage
    exit 1
    ;;
esac
