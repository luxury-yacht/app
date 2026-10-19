import type { RefreshContext } from './RefreshManager';
import { ALL_NAMESPACES_SELECTOR, type ScopeSelector, tryParseRefreshScope } from './scopeSelector';
import { RESOURCE_STREAM_DOMAINS, type ResourceDomain } from './streaming/resourceStreamDomains';
import type { RefreshDomain } from './types';

const resourceStreamDomains = new Set<RefreshDomain>(RESOURCE_STREAM_DOMAINS);

export const isResourceStreamDomain = (domain: RefreshDomain): domain is ResourceDomain =>
  resourceStreamDomains.has(domain);

// Focused Pod scopes are small leased windows used by object panels. Their
// owning component controls the lease lifetime, so they remain active
// independently of the broad namespace-table view gate.
const podsSelectorKind = (scope?: string): ScopeSelector['kind'] | undefined =>
  scope ? tryParseRefreshScope('pods', scope)?.selector.kind : undefined;

const isFocusedPodsScope = (scope?: string): boolean => {
  const kind = podsSelectorKind(scope);
  return kind === 'workload' || kind === 'node';
};

// Views whose tables list pods: the Workloads and Pods views under the
// selected namespace scope, and the Nodes view's pane under the cluster-wide one.
const PODS_TABLE_NAMESPACE_VIEWS: ReadonlySet<RefreshContext['activeNamespaceView']> = new Set([
  'workloads',
  'pods',
]);
export const NODES_VIEW_PODS_SELECTOR = ALL_NAMESPACES_SELECTOR;

export const isPodsTableNamespaceView = (context: RefreshContext): boolean =>
  context.currentView === 'namespace' &&
  PODS_TABLE_NAMESPACE_VIEWS.has(context.activeNamespaceView);

export const isNodesView = (context: RefreshContext): boolean =>
  context.currentView === 'cluster' && context.activeClusterView === 'nodes';

const isPodsTableScopeActive = (context: RefreshContext, scope?: string): boolean =>
  isFocusedPodsScope(scope) ||
  isPodsTableNamespaceView(context) ||
  (isNodesView(context) && podsSelectorKind(scope) === NODES_VIEW_PODS_SELECTOR.kind);

const NAMESPACE_VIEW_BY_DOMAIN: Partial<
  Record<ResourceDomain, NonNullable<RefreshContext['activeNamespaceView']>>
> = {
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

  if (domain === 'pods') {
    return isPodsTableScopeActive(context, scope);
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
