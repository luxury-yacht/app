import { stripClusterScope } from './clusterScope';
import type { RefreshContext } from './RefreshManager';
import { RESOURCE_STREAM_DOMAINS, type ResourceDomain } from './streaming/resourceStreamDomains';
import type { RefreshDomain } from './types';

const resourceStreamDomains = new Set<RefreshDomain>(RESOURCE_STREAM_DOMAINS);

export const isResourceStreamDomain = (domain: RefreshDomain): domain is ResourceDomain =>
  resourceStreamDomains.has(domain);

// Focused Pod scopes are small leased windows used by object panels. Their
// owning component controls the lease lifetime, so they remain active
// independently of the broad namespace-table view gate.
const isFocusedPodsScope = (scope?: string): boolean => {
  const base = stripClusterScope(scope);
  return base.startsWith('workload:') || base.startsWith('node:');
};

// The Nodes view's pods pane lists every pod in the cluster under the
// cluster-wide namespace scope.
const isNodesViewPodsScope = (context: RefreshContext, scope?: string): boolean =>
  context.currentView === 'cluster' &&
  context.activeClusterView === 'nodes' &&
  stripClusterScope(scope) === 'namespace:all';

const NAMESPACE_VIEW_BY_DOMAIN: Partial<
  Record<ResourceDomain, NonNullable<RefreshContext['activeNamespaceView']>>
> = {
  pods: 'workloads',
  'namespace-workloads': 'workloads',
  'namespace-config': 'config',
  'namespace-network': 'network',
  'namespace-rbac': 'rbac',
  'namespace-helm': 'helm',
  'namespace-autoscaling': 'autoscaling',
  'namespace-quotas': 'quotas',
  'namespace-storage': 'storage',
};

const CLUSTER_VIEW_BY_DOMAIN: Partial<
  Record<ResourceDomain, NonNullable<RefreshContext['activeClusterView']>>
> = {
  nodes: 'nodes',
  'cluster-rbac': 'rbac',
  'cluster-storage': 'storage',
  'cluster-config': 'config',
  'cluster-crds': 'crds',
};

export const isResourceStreamViewActive = (
  domain: RefreshDomain,
  context: RefreshContext,
  scope?: string
): boolean => {
  if (!isResourceStreamDomain(domain)) {
    return true;
  }

  if (domain === 'pods' && (isFocusedPodsScope(scope) || isNodesViewPodsScope(context, scope))) {
    return true;
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
