import type { RefreshContext } from './RefreshManager';
import type { RefreshDomain } from './types';
import { stripClusterScope } from './clusterScope';

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

// A pods scope shaped `workload:...` or `node:...` is an object-panel Pods-tab
// window: those scopes exist only while a panel's Pods tab actively leases them
// (the lease drops when the tab deactivates), and the panel is visible over ANY
// main view. The per-view gate below exists to keep the BIG namespace-shaped
// table scopes from streaming while nobody is looking at them; applying it to
// panel windows froze the embedded Pods tab — no doorbells, so its query-backed
// table never refetched and its metrics meta aged into the staleness banner.
const isPanelPodsScope = (scope?: string): boolean => {
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
    if (isPanelPodsScope(scope)) {
      return true;
    }
    return context.currentView === 'namespace' && context.activeNamespaceView === 'pods';
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
