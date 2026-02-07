#!/usr/bin/env bash
# Installs/uninstalls sample workloads for testing Luxury Yacht.
# Usage: ./workloads.sh install|uninstall dev|stg|prod|all

set -euo pipefail

for cmd in helm kubectl; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "Error: '${cmd}' is not installed." >&2
    exit 1
  fi
done

KUBECONFIG_DIR="${HOME}/.kube"

# Cluster -> kubeconfig file mapping
declare -A KUBECONFIG_FILES=(
  [dev]="${KUBECONFIG_DIR}/dev-stg-clusters"
  [stg]="${KUBECONFIG_DIR}/dev-stg-clusters"
  [prod]="${KUBECONFIG_DIR}/prod-clusters"
)

# Cluster -> context name mapping
declare -A CONTEXTS=(
  [dev]="dev-cluster"
  [stg]="stg-cluster"
  [prod]="prod-cluster"
)

# Helpers to run kubectl/helm with the right kubeconfig and context
kctl() {
  local env="$1"; shift
  kubectl --kubeconfig "${KUBECONFIG_FILES[$env]}" --context "${CONTEXTS[$env]}" "$@"
}

hhelm() {
  local env="$1"; shift
  helm --kubeconfig "${KUBECONFIG_FILES[$env]}" --kube-context "${CONTEXTS[$env]}" "$@"
}

# Add helm repos (idempotent)
add_helm_repos() {
  helm repo add podinfo https://stefanprodan.github.io/podinfo 2>/dev/null || true
  helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
  helm repo update
}

# --- Namespace helpers ---

create_namespaces() {
  local env="$1"
  for ns in podinfo redis postgres batch monitoring; do
    kctl "$env" create namespace "$ns" --dry-run=client -o yaml | kctl "$env" apply -f -
  done
}

delete_namespaces() {
  local env="$1"
  for ns in podinfo redis postgres batch monitoring; do
    kctl "$env" delete namespace "$ns" --ignore-not-found
  done
}

# --- Helm workloads ---

install_podinfo() {
  local env="$1"
  echo "  Installing podinfo..."
  hhelm "$env" upgrade --install podinfo podinfo/podinfo \
    --namespace podinfo --set replicaCount=2
}

uninstall_podinfo() {
  local env="$1"
  hhelm "$env" uninstall podinfo --namespace podinfo 2>/dev/null || true
}

install_redis() {
  local env="$1"
  echo "  Installing redis..."
  hhelm "$env" upgrade --install redis bitnami/redis \
    --namespace redis --set architecture=standalone --set auth.enabled=true
}

uninstall_redis() {
  local env="$1"
  hhelm "$env" uninstall redis --namespace redis 2>/dev/null || true
}

install_postgresql() {
  local env="$1"
  echo "  Installing postgresql..."
  hhelm "$env" upgrade --install postgresql bitnami/postgresql \
    --namespace postgres --set auth.postgresPassword=testpassword
}

uninstall_postgresql() {
  local env="$1"
  hhelm "$env" uninstall postgresql --namespace postgres 2>/dev/null || true
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

# --- Per-environment install/uninstall ---

# dev: podinfo, cronjob, daemonset
install_dev() {
  echo "Installing dev workloads..."
  add_helm_repos
  create_namespaces dev
  install_podinfo dev
  install_cronjob dev
  install_daemonset dev
  echo "Dev workloads installed."
}

uninstall_dev() {
  echo "Uninstalling dev workloads..."
  uninstall_podinfo dev
  uninstall_cronjob dev
  uninstall_daemonset dev
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
  echo "Stg workloads installed."
}

uninstall_stg() {
  echo "Uninstalling stg workloads..."
  uninstall_podinfo stg
  uninstall_redis stg
  uninstall_job stg
  uninstall_rbac stg
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
  echo "Prod workloads installed."
}

uninstall_prod() {
  echo "Uninstalling prod workloads..."
  uninstall_hpa prod
  uninstall_networkpolicy prod
  uninstall_podinfo prod
  uninstall_redis prod
  uninstall_postgresql prod
  delete_namespaces prod
  echo "Prod workloads uninstalled."
}

# --- Main ---

ACTION="${1:-}"
ENV="${2:-}"

case "${ACTION}" in
  install)
    case "${ENV}" in
      dev)  install_dev ;;
      stg)  install_stg ;;
      prod) install_prod ;;
      all)  install_dev; install_stg; install_prod ;;
      *)    echo "Usage: $0 install {dev|stg|prod|all}" >&2; exit 1 ;;
    esac
    ;;
  uninstall)
    case "${ENV}" in
      dev)  uninstall_dev ;;
      stg)  uninstall_stg ;;
      prod) uninstall_prod ;;
      all)  uninstall_dev; uninstall_stg; uninstall_prod ;;
      *)    echo "Usage: $0 uninstall {dev|stg|prod|all}" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Usage: $0 {install|uninstall} {dev|stg|prod|all}" >&2
    exit 1
    ;;
esac
