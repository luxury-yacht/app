import { stripClusterScope } from './clusterScope';
import type { RefreshContext } from './RefreshManager';
import type { RefreshDomain } from './types';

export type ResourceStreamRefreshDomain =
  | 'pods'
  | 'namespace-workloads'
  | 'namespace-config'
  | 'namespace-network'
  | 'namespace-rbac'
  | 'namespace-custom'
  | 'namespace-helm'
  | 'namespace-autoscaling'
  | 'namespace-quotas'
  | 'namespace-storage'
  | 'cluster-rbac'
  | 'cluster-storage'
  | 'cluster-config'
  | 'cluster-crds'
  | 'cluster-custom'
  | 'nodes';

const RESOURCE_STREAM_DOMAINS = new Set<RefreshDomain>([
  'pods',
  'namespace-workloads',
  'namespace-config',
  'namespace-network',
  'namespace-rbac',
  'namespace-custom',
  'namespace-helm',
  'namespace-autoscaling',
  'namespace-quotas',
  'namespace-storage',
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-custom',
  'nodes',
]);

export const isResourceStreamDomain = (
  domain: RefreshDomain
): domain is ResourceStreamRefreshDomain => RESOURCE_STREAM_DOMAINS.has(domain);

// Focused Pod scopes are small leased windows used by the combined Workloads
// view and object panels. Their owning component controls the lease lifetime,
// so they remain active independently of the broad namespace-table view gate.
const isFocusedPodsScope = (scope?: string): boolean => {
  const base = stripClusterScope(scope);
  return base.startsWith('workload:') || base.startsWith('node:');
};

const NAMESPACE_VIEW_BY_DOMAIN: Partial<
  Record<ResourceStreamRefreshDomain, NonNullable<RefreshContext['activeNamespaceView']>>
> = {
  pods: 'workloads',
  'namespace-workloads': 'workloads',
  'namespace-config': 'config',
  'namespace-network': 'network',
  'namespace-rbac': 'rbac',
  'namespace-custom': 'custom',
  'namespace-helm': 'helm',
  'namespace-autoscaling': 'autoscaling',
  'namespace-quotas': 'quotas',
  'namespace-storage': 'storage',
};

const CLUSTER_VIEW_BY_DOMAIN: Partial<
  Record<ResourceStreamRefreshDomain, NonNullable<RefreshContext['activeClusterView']>>
> = {
  nodes: 'nodes',
  'cluster-rbac': 'rbac',
  'cluster-storage': 'storage',
  'cluster-config': 'config',
  'cluster-crds': 'crds',
  'cluster-custom': 'custom',
};

export const isResourceStreamViewActive = (
  domain: RefreshDomain,
  context: RefreshContext,
  scope?: string
): boolean => {
  if (!isResourceStreamDomain(domain)) {
    return true;
  }

  if (domain === 'pods') {
    if (isFocusedPodsScope(scope)) {
      return true;
    }
  }
  const namespaceView = NAMESPACE_VIEW_BY_DOMAIN[domain];
  if (namespaceView) {
    return context.currentView === 'namespace' && context.activeNamespaceView === namespaceView;
  }
  const clusterView = CLUSTER_VIEW_BY_DOMAIN[domain];
  if (clusterView) {
    return context.currentView === 'cluster' && context.activeClusterView === clusterView;
  }
  return true;
};
