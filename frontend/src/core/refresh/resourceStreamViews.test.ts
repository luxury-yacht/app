import { describe, expect, it } from 'vitest';
import type { RefreshContext } from './RefreshManager';
import { isResourceStreamViewActive } from './resourceStreamViews';
import type { RefreshDomain } from './types';

const context = (overrides: Partial<RefreshContext>): RefreshContext => ({
  currentView: 'cluster',
  objectPanel: { isOpen: false },
  ...overrides,
});

describe('isResourceStreamViewActive', () => {
  it('keeps non-resource-stream domains active', () => {
    expect(isResourceStreamViewActive('namespaces', context({ currentView: 'settings' }))).toBe(
      true
    );
  });

  it('keeps focused pod scopes active independently of the broad view', () => {
    const inactiveView = context({ currentView: 'settings' });
    expect(
      isResourceStreamViewActive('pods', inactiveView, 'cluster-a|workload:team:Pod:api')
    ).toBe(true);
    expect(isResourceStreamViewActive('pods', inactiveView, 'cluster-a|node:worker-a')).toBe(true);
  });

  it.each<[RefreshDomain, NonNullable<RefreshContext['activeNamespaceView']>]>([
    ['pods', 'workloads'],
    ['namespace-workloads', 'workloads'],
    ['namespace-config', 'config'],
    ['namespace-network', 'network'],
    ['namespace-rbac', 'rbac'],
    ['namespace-custom', 'custom'],
    ['namespace-helm', 'helm'],
    ['namespace-autoscaling', 'autoscaling'],
    ['namespace-quotas', 'quotas'],
    ['namespace-storage', 'storage'],
  ])('activates %s only for namespace view %s', (domain, activeNamespaceView) => {
    expect(
      isResourceStreamViewActive(domain, context({ currentView: 'namespace', activeNamespaceView }))
    ).toBe(true);
    expect(isResourceStreamViewActive(domain, context({ currentView: 'namespace' }))).toBe(false);
    expect(
      isResourceStreamViewActive(domain, context({ currentView: 'cluster', activeNamespaceView }))
    ).toBe(false);
  });

  it.each<[RefreshDomain, NonNullable<RefreshContext['activeClusterView']>]>([
    ['nodes', 'nodes'],
    ['cluster-rbac', 'rbac'],
    ['cluster-storage', 'storage'],
    ['cluster-config', 'config'],
    ['cluster-crds', 'crds'],
    ['cluster-custom', 'custom'],
  ])('activates %s only for cluster view %s', (domain, activeClusterView) => {
    expect(
      isResourceStreamViewActive(domain, context({ currentView: 'cluster', activeClusterView }))
    ).toBe(true);
    expect(isResourceStreamViewActive(domain, context({ currentView: 'cluster' }))).toBe(false);
    expect(
      isResourceStreamViewActive(domain, context({ currentView: 'namespace', activeClusterView }))
    ).toBe(false);
  });
});
