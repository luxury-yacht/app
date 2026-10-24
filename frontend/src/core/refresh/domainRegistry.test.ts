import { describe, expect, it } from 'vitest';
import {
  DOMAIN_STREAM_MAP,
  frontendRefreshDomainPolicies,
  getRefreshDomainDescriptor,
  METRIC_DEMAND_DOMAINS,
  PRIORITY_DOMAINS,
  REFRESH_DOMAIN_DESCRIPTORS,
  refreshDomainDescriptors,
} from './domainRegistry';

describe('refresh domain registry', () => {
  it('preserves frontend registration order from generated policy', () => {
    expect(frontendRefreshDomainPolicies.map((policy) => policy.domain)).toEqual([
      'namespaces',
      'namespace-metrics',
      'object-events',
      'cluster-overview',
      'cluster-attention',
      'object-maintenance',
      'object-details',
      'object-map',
      'object-yaml',
      'object-helm-manifest',
      'object-helm-values',
      'container-logs',
      'pods',
      'catalog',
      'catalog-diff',
      'cluster-events',
      'nodes',
      'cluster-rbac',
      'cluster-storage',
      'cluster-config',
      'cluster-crds',
      'namespace-events',
      'namespace-workloads',
      'namespace-config',
      'namespace-network',
      'namespace-rbac',
      'namespace-storage',
      'namespace-autoscaling',
      'namespace-quotas',
      'namespace-helm',
      'cluster-identities',
    ]);
  });

  it('derives metrics demand from the generated source clocks', () => {
    expect(METRIC_DEMAND_DOMAINS).toEqual([
      'namespace-metrics',
      'cluster-overview',
      'nodes',
      'namespace-workloads',
      'pods',
    ]);
  });

  it('derives the diagnostics stream map from the descriptor table', () => {
    expect(refreshDomainDescriptors).toHaveLength(Object.keys(REFRESH_DOMAIN_DESCRIPTORS).length);

    for (const descriptor of refreshDomainDescriptors) {
      expect(getRefreshDomainDescriptor(descriptor.domain)).toBe(descriptor);

      if (descriptor.diagnosticsStream) {
        expect(DOMAIN_STREAM_MAP[descriptor.domain]).toBe(descriptor.diagnosticsStream);
      } else {
        expect(DOMAIN_STREAM_MAP[descriptor.domain]).toBeUndefined();
      }
    }
  });

  it('keeps priority diagnostics domains in the registry instead of panel config', () => {
    expect(PRIORITY_DOMAINS).toEqual([
      'namespaces',
      'namespace-metrics',
      'cluster-attention',
      'nodes',
      'object-maintenance',
      'cluster-overview',
      'catalog',
      'namespace-workloads',
    ]);
  });
});
