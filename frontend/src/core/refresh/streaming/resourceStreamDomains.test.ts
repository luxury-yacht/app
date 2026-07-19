/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.test.ts
 *
 * Tests for resource stream domain descriptors.
 */

import { describe, expect, it } from 'vitest';

import { refreshDomainContract } from '../domainRegistry';
import {
  COMPLETE_RESYNC_STREAM_DOMAINS,
  DOORBELL_STREAM_DOMAINS,
  type DoorbellDomain,
  domainSupportsSourceClock,
  isClusterScopedDomain,
  isCompleteResyncStreamDomain,
  isSupportedDomain,
  normalizeResourceScope,
  RESOURCE_STREAM_DOMAINS,
  type ResourceDomain,
  resourceStreamDomainDescriptors,
} from './resourceStreamDomains';

const EXPECTED_DOMAINS: ResourceDomain[] = [
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
];

const CLUSTER_SCOPED_DOMAINS = new Set<ResourceDomain>([
  'cluster-rbac',
  'cluster-storage',
  'cluster-config',
  'cluster-crds',
  'cluster-custom',
  'nodes',
]);

const REPRESENTATIVE_DOMAIN_BY_SCOPE_KIND = {
  pod: 'pods',
  namespace: 'namespace-workloads',
  cluster: 'nodes',
} satisfies Record<'pod' | 'namespace' | 'cluster', ResourceDomain>;

const EXPECTED_DOORBELL_DOMAINS: DoorbellDomain[] = [
  ...EXPECTED_DOMAINS,
  'catalog',
  'cluster-events',
  'namespace-events',
  'namespaces',
  'namespace-metrics',
  'object-events',
  'cluster-overview',
  'cluster-attention',
];

describe('resource stream domain descriptors', () => {
  it('covers every streamed resource domain exactly once', () => {
    expect(RESOURCE_STREAM_DOMAINS).toEqual(EXPECTED_DOMAINS);
    expect(new Set(RESOURCE_STREAM_DOMAINS).size).toBe(EXPECTED_DOMAINS.length);
    expect(resourceStreamDomainDescriptors).toHaveLength(EXPECTED_DOMAINS.length);
  });

  it('declares scope and metrics behavior for every domain', () => {
    resourceStreamDomainDescriptors.forEach((descriptor) => {
      expect(['pod', 'namespace', 'cluster']).toContain(descriptor.scopeKind);
      expect(descriptor.isClusterScoped).toBe(CLUSTER_SCOPED_DOMAINS.has(descriptor.domain));
      expect('supportsMultiCluster' in descriptor).toBe(false);
    });
  });

  it('derives COMPLETE-only resource stream domains from the shared inventory', () => {
    expect(Array.from(COMPLETE_RESYNC_STREAM_DOMAINS)).toEqual(['namespace-helm']);
    EXPECTED_DOMAINS.forEach((domain) => {
      expect(isCompleteResyncStreamDomain(domain)).toBe(domain === 'namespace-helm');
    });
  });

  it('normalizes scopes through descriptor scope kinds', () => {
    expect(normalizeResourceScope('pods', 'namespace:*')).toBe('namespace:all');
    expect(normalizeResourceScope('pods', 'node:node-a')).toBe('node:node-a');
    expect(normalizeResourceScope('pods', 'workload:default:apps:v1:Deployment:web')).toBe(
      'workload:default:apps:v1:Deployment:web'
    );
    expect(() => normalizeResourceScope('pods', 'workload:default::v1:Deployment:web')).toThrow(
      'pods workload scope requires namespace:group:version:kind:name'
    );

    resourceStreamDomainDescriptors
      .filter((descriptor) => descriptor.scopeKind === 'namespace')
      .forEach((descriptor) => {
        expect(normalizeResourceScope(descriptor.domain, 'default')).toBe('namespace:default');
        expect(normalizeResourceScope(descriptor.domain, 'namespace:all')).toBe('namespace:all');
      });

    resourceStreamDomainDescriptors
      .filter((descriptor) => descriptor.scopeKind === 'cluster')
      .forEach((descriptor) => {
        expect(normalizeResourceScope(descriptor.domain, '')).toBe('');
        expect(normalizeResourceScope(descriptor.domain, 'cluster')).toBe('');
        expect(() => normalizeResourceScope(descriptor.domain, 'namespace:default')).toThrow();
      });
  });

  it('exposes domain guards from the descriptor table', () => {
    EXPECTED_DOMAINS.forEach((domain) => {
      expect(isSupportedDomain(domain)).toBe(true);
      expect(isClusterScopedDomain(domain)).toBe(CLUSTER_SCOPED_DOMAINS.has(domain));
    });
    expect(isSupportedDomain('not-a-domain')).toBe(false);
  });

  it('keeps doorbell domains distinct from resource table domains', () => {
    expect(DOORBELL_STREAM_DOMAINS).toEqual(EXPECTED_DOORBELL_DOMAINS);
    expect(RESOURCE_STREAM_DOMAINS).toEqual(EXPECTED_DOMAINS);
    expect(isSupportedDomain('catalog')).toBe(true);
    expect(isSupportedDomain('cluster-events')).toBe(true);
    expect(isSupportedDomain('namespace-events')).toBe(true);
    expect(isSupportedDomain('namespace-metrics')).toBe(true);

    expect(normalizeResourceScope('catalog', '')).toBe('');
    expect(normalizeResourceScope('cluster-events', 'cluster')).toBe('');
    expect(normalizeResourceScope('namespace-events', 'prod')).toBe('namespace:prod');
    expect(() => normalizeResourceScope('catalog', 'limit=50')).toThrow('does not accept scope');

    expect(domainSupportsSourceClock('catalog', 'catalog')).toBe(true);
    expect(domainSupportsSourceClock('cluster-events', 'event')).toBe(true);
    expect(domainSupportsSourceClock('namespace-events', 'event')).toBe(true);
    expect(domainSupportsSourceClock('namespace-metrics', 'metric')).toBe(true);
    expect(domainSupportsSourceClock('catalog', 'object')).toBe(false);
    expect(domainSupportsSourceClock('cluster-attention', 'attention')).toBe(true);
  });

  // Locks the frontend descriptor table to the backend-authored projection
  // contract. The same JSON file (refresh-domain-contract.json) is the
  // source of truth for both: this test ensures scopeKind on the frontend
  // matches the backend descriptor's ScopeKind, and pins which stream
  // domains declare the metric source clock (live usage is joined onto the
  // base rows at serve by the backend).
  it('matches the backend-authored projection contract', async () => {
    const { refreshDomainContract: loadedRefreshDomainContract } = await import(
      '@/core/refresh/domainRegistry'
    );
    const contractDomains = loadedRefreshDomainContract.resourceStream.domains;
    const sourceClocksByDomain = new Map(
      loadedRefreshDomainContract.domains.map((entry) => [entry.domain, entry.sourceClocks ?? []])
    );
    expect(Object.keys(contractDomains).sort()).toEqual([...EXPECTED_DOMAINS].sort());

    const metricClockDomains = resourceStreamDomainDescriptors
      .filter((descriptor) => sourceClocksByDomain.get(descriptor.domain)?.includes('metric'))
      .map((descriptor) => descriptor.domain)
      .sort();
    expect(metricClockDomains).toEqual(['namespace-workloads', 'nodes', 'pods']);

    for (const descriptor of resourceStreamDomainDescriptors) {
      const entry = contractDomains[descriptor.domain];
      expect(entry, `contract missing entry for ${descriptor.domain}`).toBeDefined();
      expect(entry.scopeKind, `${descriptor.domain} scopeKind`).toBe(descriptor.scopeKind);
      expect(entry.completeIsScopeLevel, `${descriptor.domain} completeIsScopeLevel`).toBe(true);
      const clusterScoped = entry.scopeKind === 'cluster';
      expect(descriptor.isClusterScoped, `${descriptor.domain} isClusterScoped`).toBe(
        clusterScoped
      );
    }
  });

  it('normalizes scopes from the backend-authored executable examples', () => {
    const examples = refreshDomainContract.resourceStream.scopeExamples;

    for (const [scopeKind, cases] of Object.entries(examples) as Array<
      [keyof typeof REPRESENTATIVE_DOMAIN_BY_SCOPE_KIND, (typeof examples)[keyof typeof examples]]
    >) {
      const domain = REPRESENTATIVE_DOMAIN_BY_SCOPE_KIND[scopeKind];

      for (const example of cases.valid) {
        expect(normalizeResourceScope(domain, example.scope)).toBe(example.canonical);
      }

      for (const example of cases.invalid) {
        expect(() => normalizeResourceScope(domain, example.scope)).toThrow(example.errorContains);
      }
    }
  });
});
