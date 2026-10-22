/**
 * frontend/src/utils/kindViewMap.ts
 *
 * Maps an object's API group, kind, and scope to the view that lists it, for
 * alt+click navigation (useNavigateToView). In order:
 * - its resource family's view (Karpenter, Argo CD, and so on);
 * - the built-in view whose refresh domain lists the kind;
 * - Browse, for a built-in kind that no view lists;
 * - the Custom view, for any other custom resource.
 */

import { resourceFamilyForObject } from '@core/navigation/resourceFamilies';
import { isBuiltinResource } from '@shared/constants/builtinGroupVersions';
import type { ClusterViewType, NamespaceViewType, ViewType } from '@/types/navigation/views';

export interface ViewDestination {
  viewType: ViewType;
  tab: NamespaceViewType | ClusterViewType;
  destinationViewId?: string;
}

// The built-in views and the kinds each one's refresh domain lists, keyed by
// "group/kind" with the kind lowercased. Each list mirrors its domain's kinds in
// backend/refresh/snapshot (for example cluster_config.go, namespace_quotas.go).
const BUILTIN_KIND_VIEWS: Record<string, ViewDestination> = {
  '/pod': { viewType: 'namespace', tab: 'pods' },
  'apps/deployment': { viewType: 'namespace', tab: 'workloads' },
  'apps/statefulset': { viewType: 'namespace', tab: 'workloads' },
  'apps/daemonset': { viewType: 'namespace', tab: 'workloads' },
  'apps/replicaset': { viewType: 'namespace', tab: 'workloads' },
  'batch/job': { viewType: 'namespace', tab: 'workloads' },
  'batch/cronjob': { viewType: 'namespace', tab: 'workloads' },
  '/configmap': { viewType: 'namespace', tab: 'config' },
  '/secret': { viewType: 'namespace', tab: 'config' },
  '/service': { viewType: 'namespace', tab: 'network' },
  'networking.k8s.io/ingress': { viewType: 'namespace', tab: 'network' },
  'discovery.k8s.io/endpointslice': { viewType: 'namespace', tab: 'network' },
  'networking.k8s.io/networkpolicy': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/gateway': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/httproute': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/grpcroute': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/tlsroute': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/listenerset': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/referencegrant': { viewType: 'namespace', tab: 'network' },
  'gateway.networking.k8s.io/backendtlspolicy': { viewType: 'namespace', tab: 'network' },
  'rbac.authorization.k8s.io/role': { viewType: 'namespace', tab: 'rbac' },
  'rbac.authorization.k8s.io/rolebinding': { viewType: 'namespace', tab: 'rbac' },
  '/serviceaccount': { viewType: 'namespace', tab: 'rbac' },
  '/persistentvolumeclaim': { viewType: 'namespace', tab: 'storage' },
  'autoscaling/horizontalpodautoscaler': { viewType: 'namespace', tab: 'autoscaling' },
  '/resourcequota': { viewType: 'namespace', tab: 'quotas' },
  '/limitrange': { viewType: 'namespace', tab: 'quotas' },
  'policy/poddisruptionbudget': { viewType: 'namespace', tab: 'quotas' },
  'helm.sh/helmrelease': { viewType: 'namespace', tab: 'helm' },
  '/event': { viewType: 'namespace', tab: 'events' },
  '/node': { viewType: 'cluster', tab: 'nodes' },
  'rbac.authorization.k8s.io/clusterrole': { viewType: 'cluster', tab: 'rbac' },
  'rbac.authorization.k8s.io/clusterrolebinding': { viewType: 'cluster', tab: 'rbac' },
  '/persistentvolume': { viewType: 'cluster', tab: 'storage' },
  'storage.k8s.io/storageclass': { viewType: 'cluster', tab: 'config' },
  'networking.k8s.io/ingressclass': { viewType: 'cluster', tab: 'config' },
  'gateway.networking.k8s.io/gatewayclass': { viewType: 'cluster', tab: 'config' },
  'admissionregistration.k8s.io/mutatingwebhookconfiguration': {
    viewType: 'cluster',
    tab: 'config',
  },
  'admissionregistration.k8s.io/validatingwebhookconfiguration': {
    viewType: 'cluster',
    tab: 'config',
  },
  '/namespace': { viewType: 'cluster', tab: 'namespaces' },
  'apiextensions.k8s.io/customresourcedefinition': { viewType: 'cluster', tab: 'crds' },
};

/** The view that lists an object of `kind` in `group`; the kind matches in any case. */
export function getViewForKind(
  kind: string,
  group: string,
  namespace?: string | null
): ViewDestination {
  const namespaced = Boolean(namespace);
  const viewType = namespaced ? 'namespace' : 'cluster';
  const family = resourceFamilyForObject(group, kind, namespaced);
  if (family) {
    return { viewType, tab: family };
  }
  const builtinView = BUILTIN_KIND_VIEWS[`${group}/${kind.toLowerCase()}`];
  if (builtinView) {
    return builtinView;
  }
  if (!isBuiltinResource(group, kind)) {
    return { viewType, tab: 'custom' };
  }
  // The cluster Browse table's view id is "browse" (BrowseView.tsx).
  return namespaced
    ? { viewType, tab: 'browse' }
    : { viewType, tab: 'browse', destinationViewId: 'browse' };
}
