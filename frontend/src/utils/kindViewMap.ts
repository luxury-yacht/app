/**
 * frontend/src/utils/kindViewMap.ts
 *
 * Maps Kubernetes resource kinds to their corresponding view destination
 * (ViewType + tab). Used by useNavigateToView to determine where to
 * navigate when alt+clicking an object link.
 *
 * Returns null for unknown kinds — callers should fall back to browse.
 */

import type { ViewType, NamespaceViewType, ClusterViewType } from '@/types/navigation/views';

export interface ViewDestination {
  viewType: ViewType;
  tab: NamespaceViewType | ClusterViewType;
}

// Namespace-scoped resource kind → view destination
const NAMESPACE_SCOPED_MAP: Record<string, ViewDestination> = {
  pod: { viewType: 'namespace', tab: 'pods' },
  deployment: { viewType: 'namespace', tab: 'workloads' },
  statefulset: { viewType: 'namespace', tab: 'workloads' },
  daemonset: { viewType: 'namespace', tab: 'workloads' },
  job: { viewType: 'namespace', tab: 'workloads' },
  cronjob: { viewType: 'namespace', tab: 'workloads' },
  replicaset: { viewType: 'namespace', tab: 'workloads' },
  configmap: { viewType: 'namespace', tab: 'config' },
  secret: { viewType: 'namespace', tab: 'config' },
  service: { viewType: 'namespace', tab: 'network' },
  ingress: { viewType: 'namespace', tab: 'network' },
  endpointslice: { viewType: 'namespace', tab: 'network' },
  networkpolicy: { viewType: 'namespace', tab: 'network' },
  gateway: { viewType: 'namespace', tab: 'network' },
  httproute: { viewType: 'namespace', tab: 'network' },
  grpcroute: { viewType: 'namespace', tab: 'network' },
  tlsroute: { viewType: 'namespace', tab: 'network' },
  listenerset: { viewType: 'namespace', tab: 'network' },
  referencegrant: { viewType: 'namespace', tab: 'network' },
  backendtlspolicy: { viewType: 'namespace', tab: 'network' },
  role: { viewType: 'namespace', tab: 'rbac' },
  rolebinding: { viewType: 'namespace', tab: 'rbac' },
  serviceaccount: { viewType: 'namespace', tab: 'rbac' },
  persistentvolumeclaim: { viewType: 'namespace', tab: 'storage' },
  pvc: { viewType: 'namespace', tab: 'storage' },
  horizontalpodautoscaler: { viewType: 'namespace', tab: 'autoscaling' },
  hpa: { viewType: 'namespace', tab: 'autoscaling' },
  verticalpodautoscaler: { viewType: 'namespace', tab: 'autoscaling' },
  vpa: { viewType: 'namespace', tab: 'autoscaling' },
  poddisruptionbudget: { viewType: 'namespace', tab: 'autoscaling' },
  pdb: { viewType: 'namespace', tab: 'autoscaling' },
  resourcequota: { viewType: 'namespace', tab: 'quotas' },
  limitrange: { viewType: 'namespace', tab: 'quotas' },
  helmrelease: { viewType: 'namespace', tab: 'helm' },
  event: { viewType: 'namespace', tab: 'events' },
};

// Cluster-scoped resource kind → view destination
const CLUSTER_SCOPED_MAP: Record<string, ViewDestination> = {
  node: { viewType: 'cluster', tab: 'nodes' },
  clusterrole: { viewType: 'cluster', tab: 'rbac' },
  clusterrolebinding: { viewType: 'cluster', tab: 'rbac' },
  persistentvolume: { viewType: 'cluster', tab: 'storage' },
  pv: { viewType: 'cluster', tab: 'storage' },
  storageclass: { viewType: 'cluster', tab: 'storage' },
  namespace: { viewType: 'cluster', tab: 'config' },
  gatewayclass: { viewType: 'cluster', tab: 'config' },
  customresourcedefinition: { viewType: 'cluster', tab: 'crds' },
  crd: { viewType: 'cluster', tab: 'crds' },
};

/**
 * Look up the view destination for a Kubernetes resource kind.
 * Case-insensitive. Returns null for unknown kinds.
 */
export function getViewForKind(kind: string): ViewDestination | null {
  const normalized = kind.toLowerCase();
  return NAMESPACE_SCOPED_MAP[normalized] ?? CLUSTER_SCOPED_MAP[normalized] ?? null;
}

/**
 * Returns true if the kind maps to a namespace-scoped view.
 * Useful for determining whether namespace selection is needed.
 */
export function isNamespaceScopedKind(kind: string): boolean {
  const normalized = kind.toLowerCase();
  return normalized in NAMESPACE_SCOPED_MAP;
}
