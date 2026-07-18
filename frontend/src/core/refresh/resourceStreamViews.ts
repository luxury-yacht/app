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
    return context.currentView === 'namespace' && context.activeNamespaceView === 'workloads';
  }

  if (domain === 'namespace-workloads') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'workloads';
  }

  if (domain === 'namespace-config') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'config';
  }

  if (domain === 'namespace-network') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'network';
  }

  if (domain === 'namespace-rbac') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'rbac';
  }

  if (domain === 'namespace-custom') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'custom';
  }

  if (domain === 'namespace-helm') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'helm';
  }

  if (domain === 'namespace-autoscaling') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'autoscaling';
  }

  if (domain === 'namespace-quotas') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'quotas';
  }

  if (domain === 'namespace-storage') {
    return context.currentView === 'namespace' && context.activeNamespaceView === 'storage';
  }

  if (domain === 'nodes') {
    return context.currentView === 'cluster' && context.activeClusterView === 'nodes';
  }

  if (domain === 'cluster-rbac') {
    return context.currentView === 'cluster' && context.activeClusterView === 'rbac';
  }

  if (domain === 'cluster-storage') {
    return context.currentView === 'cluster' && context.activeClusterView === 'storage';
  }

  if (domain === 'cluster-config') {
    return context.currentView === 'cluster' && context.activeClusterView === 'config';
  }

  if (domain === 'cluster-crds') {
    return context.currentView === 'cluster' && context.activeClusterView === 'crds';
  }

  if (domain === 'cluster-custom') {
    return context.currentView === 'cluster' && context.activeClusterView === 'custom';
  }

  return true;
};
