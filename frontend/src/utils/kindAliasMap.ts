// Map of Kubernetes resource types to their short names (Kind -> alias)
const kindAliasMap: Record<string, string> = {
  // Workloads (singular forms as sent by backend)
  Pod: 'pod',
  Deployment: 'deploy',
  DaemonSet: 'ds',
  StatefulSet: 'sts',
  ReplicaSet: 'rs',
  Job: 'job',
  CronJob: 'cron',

  // Services & Networking
  Service: 'svc',
  EndpointSlice: 'eps',
  Ingress: 'ing',
  IngressClass: 'ingclass',
  NetworkPolicy: 'netpol',

  // Config & Storage
  ConfigMap: 'cm',
  Secret: 'sec',
  PersistentVolumeClaim: 'pvc',
  PersistentVolume: 'pv',
  StorageClass: 'sc',

  // RBAC
  ServiceAccount: 'sa',
  ClusterRole: 'cr',
  ClusterRoleBinding: 'crb',
  Role: 'role',
  RoleBinding: 'rb',

  // Cluster
  Node: 'node',
  Namespace: 'ns',
  Event: 'ev',
  CustomResourceDefinition: 'crd',

  // Policies
  ResourceQuota: 'quota',
  LimitRange: 'limit',
  PodDisruptionBudget: 'pdb',
  HorizontalPodAutoscaler: 'hpa',

  // Webhooks
  ValidatingWebhookConfiguration: 'vwc',
  MutatingWebhookConfiguration: 'mwc',

  // Helm
  HelmRelease: 'helm',
};

// Map for display name overrides (when showing full names)
// These are shorter alternatives to very long resource names
const displayNameOverrides: Record<string, string> = {
  MutatingWebhookConfiguration: 'MutatingWebhook',
  ValidatingWebhookConfiguration: 'ValidatingWebhook',
};

// Get type alias based on user preference
export function getTypeAlias(kind: string): string | undefined {
  const useShortNames = localStorage.getItem('useShortResourceNames') === 'true';
  return useShortNames ? kindAliasMap[kind] : undefined;
}

// Get display type (short or full) based on user preference
export function getDisplayKind(kind: string, useShortNames?: boolean): string {
  // If not provided, read from localStorage
  const shouldUseShort =
    useShortNames !== undefined
      ? useShortNames
      : localStorage.getItem('useShortResourceNames') === 'true';

  if (shouldUseShort) {
    return kindAliasMap[kind] || kind;
  }

  // When showing full names, check for display overrides first
  return displayNameOverrides[kind] || kind;
}

// Reverse lookup: user input alias -> canonical Kind (for search/query parsing)
// Includes short aliases, kubectl abbreviations, lowercase kinds, and common plurals
const buildAliasToKindMap = (): Map<string, string> => {
  const map = new Map<string, string>();

  // Add entries from kindAliasMap (both the alias and lowercase kind)
  for (const [kind, alias] of Object.entries(kindAliasMap)) {
    const lowerKind = kind.toLowerCase();
    map.set(alias, kind);
    map.set(lowerKind, kind);
    // Add common plural forms
    map.set(`${lowerKind}s`, kind);
    map.set(`${alias}s`, kind);
  }

  // Add kubectl-style abbreviations not covered by kindAliasMap
  const kubectlAliases: Record<string, string> = {
    po: 'Pod',
    pods: 'Pod',
    deploys: 'Deployment',
    deployments: 'Deployment',
    daemonsets: 'DaemonSet',
    statefulsets: 'StatefulSet',
    sts: 'StatefulSet',
    replicasets: 'ReplicaSet',
    jobs: 'Job',
    cronjobs: 'CronJob',
    cj: 'CronJob',
    services: 'Service',
    svcs: 'Service',
    ingresses: 'Ingress',
    ing: 'Ingress',
    networkpolicies: 'NetworkPolicy',
    np: 'NetworkPolicy',
    configmaps: 'ConfigMap',
    secrets: 'Secret',
    persistentvolumeclaims: 'PersistentVolumeClaim',
    pvcs: 'PersistentVolumeClaim',
    persistentvolumes: 'PersistentVolume',
    pvs: 'PersistentVolume',
    storageclasses: 'StorageClass',
    serviceaccounts: 'ServiceAccount',
    sas: 'ServiceAccount',
    clusterroles: 'ClusterRole',
    clusterrolebindings: 'ClusterRoleBinding',
    roles: 'Role',
    rolebindings: 'RoleBinding',
    nodes: 'Node',
    namespaces: 'Namespace',
    events: 'Event',
    crds: 'CustomResourceDefinition',
    resourcequotas: 'ResourceQuota',
    limitranges: 'LimitRange',
    poddisruptionbudgets: 'PodDisruptionBudget',
    pdbs: 'PodDisruptionBudget',
    horizontalpodautoscalers: 'HorizontalPodAutoscaler',
    hpas: 'HorizontalPodAutoscaler',
  };

  for (const [alias, kind] of Object.entries(kubectlAliases)) {
    if (!map.has(alias)) {
      map.set(alias, kind);
    }
  }

  return map;
};

export const aliasToKindMap = buildAliasToKindMap();

// Get canonical kinds for partial matching in search
export const canonicalKinds = Array.from(new Set(aliasToKindMap.values())).map((k) =>
  k.toLowerCase()
);
