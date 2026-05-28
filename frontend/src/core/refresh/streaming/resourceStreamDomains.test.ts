/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.test.ts
 *
 * Tests for resource stream domain descriptors.
 */

import { describe, expect, it } from 'vitest';

import { refreshDomainContract } from '../domainRegistry';
import {
  COMPLETE_RESYNC_STREAM_DOMAINS,
  RESOURCE_STREAM_DOMAINS,
  getResourceStreamDomainDescriptor,
  isCompleteResyncStreamDomain,
  isClusterScopedDomain,
  isSupportedDomain,
  normalizeResourceScope,
  resourceStreamDomainDescriptors,
  type ResourceDomain,
} from './resourceStreamDomains';
import type { ResourceRef } from './resourceStreamRows';

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

const samplePayloads: Record<ResourceDomain, unknown> = {
  pods: {
    pods: [{ clusterId: 'cluster-a', namespace: 'default', name: 'pod-a' }],
  },
  'namespace-workloads': {
    workloads: [{ clusterId: 'cluster-a', namespace: 'default', kind: 'Deployment', name: 'web' }],
  },
  'namespace-config': {
    resources: [
      { clusterId: 'cluster-a', namespace: 'default', kind: 'ConfigMap', name: 'config-a' },
    ],
  },
  'namespace-network': {
    resources: [{ clusterId: 'cluster-a', namespace: 'default', kind: 'Service', name: 'svc-a' }],
  },
  'namespace-rbac': {
    resources: [{ clusterId: 'cluster-a', namespace: 'default', kind: 'Role', name: 'role-a' }],
  },
  'namespace-custom': {
    resources: [
      {
        clusterId: 'cluster-a',
        namespace: 'default',
        apiGroup: 'example.com',
        apiVersion: 'v1',
        kind: 'Widget',
        name: 'widget-a',
      },
    ],
  },
  'namespace-helm': {
    releases: [{ clusterId: 'cluster-a', namespace: 'default', name: 'release-a' }],
  },
  'namespace-autoscaling': {
    resources: [
      {
        clusterId: 'cluster-a',
        namespace: 'default',
        kind: 'HorizontalPodAutoscaler',
        name: 'hpa-a',
      },
    ],
  },
  'namespace-quotas': {
    resources: [
      { clusterId: 'cluster-a', namespace: 'default', kind: 'ResourceQuota', name: 'quota-a' },
    ],
  },
  'namespace-storage': {
    resources: [
      {
        clusterId: 'cluster-a',
        namespace: 'default',
        kind: 'PersistentVolumeClaim',
        name: 'claim-a',
      },
    ],
  },
  'cluster-rbac': {
    resources: [{ clusterId: 'cluster-a', kind: 'ClusterRole', name: 'role-a' }],
  },
  'cluster-storage': {
    volumes: [{ clusterId: 'cluster-a', name: 'pv-a' }],
  },
  'cluster-config': {
    resources: [{ clusterId: 'cluster-a', kind: 'StorageClass', name: 'standard' }],
  },
  'cluster-crds': {
    definitions: [{ clusterId: 'cluster-a', name: 'widgets.example.com' }],
  },
  'cluster-custom': {
    resources: [
      {
        clusterId: 'cluster-a',
        apiGroup: 'example.com',
        apiVersion: 'v1',
        kind: 'ClusterWidget',
        name: 'widget-a',
      },
    ],
  },
  nodes: {
    nodes: [{ clusterId: 'cluster-a', name: 'node-a' }],
  },
};

const expectedSnapshotKeys: Record<ResourceDomain, string[]> = {
  pods: ['cluster-a::default::pod-a'],
  'namespace-workloads': ['cluster-a::default::Deployment::web'],
  'namespace-config': ['cluster-a::default::ConfigMap::config-a'],
  'namespace-network': ['cluster-a::default::Service::svc-a'],
  'namespace-rbac': ['cluster-a::default::Role::role-a'],
  'namespace-custom': ['cluster-a::default::example.com::v1::Widget::widget-a'],
  'namespace-helm': ['cluster-a::default::release-a'],
  'namespace-autoscaling': ['cluster-a::default::HorizontalPodAutoscaler::hpa-a'],
  'namespace-quotas': ['cluster-a::default::ResourceQuota::quota-a'],
  'namespace-storage': ['cluster-a::default::PersistentVolumeClaim::claim-a'],
  'cluster-rbac': ['cluster-a::ClusterRole::role-a'],
  'cluster-storage': ['cluster-a::pv-a'],
  'cluster-config': ['cluster-a::StorageClass::standard'],
  'cluster-crds': ['cluster-a::widgets.example.com'],
  'cluster-custom': ['cluster-a::example.com::v1::ClusterWidget::widget-a'],
  nodes: ['cluster-a::node-a'],
};

const updateRefs: Record<ResourceDomain, ResourceRef> = {
  pods: {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'Pod',
    namespace: 'default',
    name: 'pod-a',
  },
  'namespace-workloads': {
    clusterId: 'cluster-a',
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    namespace: 'default',
    name: 'web',
  },
  'namespace-config': {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'ConfigMap',
    namespace: 'default',
    name: 'config-a',
  },
  'namespace-network': {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'Service',
    namespace: 'default',
    name: 'svc-a',
  },
  'namespace-rbac': {
    clusterId: 'cluster-a',
    group: 'rbac.authorization.k8s.io',
    version: 'v1',
    kind: 'Role',
    namespace: 'default',
    name: 'role-a',
  },
  'namespace-custom': {
    clusterId: 'cluster-a',
    group: 'example.com',
    version: 'v1',
    kind: 'Widget',
    namespace: 'default',
    name: 'widget-a',
  },
  'namespace-helm': {
    clusterId: 'cluster-a',
    group: 'helm.sh',
    version: 'v3',
    kind: 'HelmRelease',
    namespace: 'default',
    name: 'release-a',
  },
  'namespace-autoscaling': {
    clusterId: 'cluster-a',
    group: 'autoscaling',
    version: 'v2',
    kind: 'HorizontalPodAutoscaler',
    namespace: 'default',
    name: 'hpa-a',
  },
  'namespace-quotas': {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'ResourceQuota',
    namespace: 'default',
    name: 'quota-a',
  },
  'namespace-storage': {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'PersistentVolumeClaim',
    namespace: 'default',
    name: 'claim-a',
  },
  'cluster-rbac': {
    clusterId: 'cluster-a',
    group: 'rbac.authorization.k8s.io',
    version: 'v1',
    kind: 'ClusterRole',
    name: 'role-a',
  },
  'cluster-storage': {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'PersistentVolume',
    name: 'pv-a',
  },
  'cluster-config': {
    clusterId: 'cluster-a',
    group: 'storage.k8s.io',
    version: 'v1',
    kind: 'StorageClass',
    name: 'standard',
  },
  'cluster-crds': {
    clusterId: 'cluster-a',
    group: 'apiextensions.k8s.io',
    version: 'v1',
    kind: 'CustomResourceDefinition',
    name: 'widgets.example.com',
  },
  'cluster-custom': {
    clusterId: 'cluster-a',
    group: 'example.com',
    version: 'v1',
    kind: 'ClusterWidget',
    name: 'widget-a',
  },
  nodes: {
    clusterId: 'cluster-a',
    group: '',
    version: 'v1',
    kind: 'Node',
    name: 'node-a',
  },
};

describe('resource stream domain descriptors', () => {
  it('covers every streamed resource domain exactly once', () => {
    expect(RESOURCE_STREAM_DOMAINS).toEqual(EXPECTED_DOMAINS);
    expect(new Set(RESOURCE_STREAM_DOMAINS).size).toBe(EXPECTED_DOMAINS.length);
    expect(resourceStreamDomainDescriptors).toHaveLength(EXPECTED_DOMAINS.length);
  });

  it('declares scope, sorting, drift, and metrics behavior for every domain', () => {
    resourceStreamDomainDescriptors.forEach((descriptor) => {
      expect(['pod', 'namespace', 'cluster']).toContain(descriptor.scopeKind);
      expect(typeof descriptor.sortRows).toBe('function');
      expect(typeof descriptor.buildSnapshotKeys).toBe('function');
      expect(typeof descriptor.collection.getRows).toBe('function');
      expect(typeof descriptor.collection.withRows).toBe('function');
      expect(typeof descriptor.collection.buildRowKey).toBe('function');
      expect(typeof descriptor.collection.buildUpdateKey).toBe('function');
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

  it('uses descriptor row identity to build snapshot drift keys', () => {
    EXPECTED_DOMAINS.forEach((domain) => {
      const descriptor = getResourceStreamDomainDescriptor(domain);
      const keys = descriptor.buildSnapshotKeys(samplePayloads[domain], 'fallback-cluster');
      expect(Array.from(keys).sort()).toEqual(expectedSnapshotKeys[domain]);

      const rows = descriptor.collection.getRows(samplePayloads[domain]);
      const collectionKeys = new Set(
        rows.map((row: any) => descriptor.collection.buildRowKey(row, 'fallback-cluster'))
      );
      expect(collectionKeys).toEqual(keys);

      expect(
        descriptor.collection.buildUpdateKey({ ref: updateRefs[domain] }, 'fallback-cluster')
      ).toBe(expectedSnapshotKeys[domain][0]);

      const sortedRows = [...rows];
      descriptor.sortRows(sortedRows);
      descriptor.collection.sortRows(sortedRows);

      const emptyPayload = descriptor.collection.emptyPayload('empty-cluster');
      expect(descriptor.buildSnapshotKeys(emptyPayload, 'empty-cluster')).toEqual(new Set());
    });
  });

  it('requires update ref identity instead of legacy row or envelope fields', () => {
    EXPECTED_DOMAINS.forEach((domain) => {
      const descriptor = getResourceStreamDomainDescriptor(domain);
      const [row] = descriptor.collection.getRows(samplePayloads[domain]);
      expect(
        descriptor.collection.buildUpdateKey({ clusterId: 'cluster-a', row }, 'fallback-cluster')
      ).toBe('');
    });

    resourceStreamDomainDescriptors
      .filter((descriptor) => descriptor.scopeKind !== 'cluster')
      .forEach((descriptor) => {
        const ref = { ...updateRefs[descriptor.domain] };
        delete ref.namespace;
        expect(descriptor.collection.buildUpdateKey({ ref }, 'fallback-cluster')).toBe('');
      });
  });

  it('keys custom resources by full GVK so same-kind resources do not collide', () => {
    const namespaceDescriptor = getResourceStreamDomainDescriptor('namespace-custom');
    const namespacePayload = {
      clusterId: 'cluster-a',
      resources: [
        {
          clusterId: 'cluster-a',
          namespace: 'default',
          apiGroup: 'alpha.example.com',
          apiVersion: 'v1',
          kind: 'Widget',
          name: 'shared',
        },
        {
          clusterId: 'cluster-a',
          namespace: 'default',
          apiGroup: 'beta.example.com',
          apiVersion: 'v1',
          kind: 'Widget',
          name: 'shared',
        },
      ],
    };
    expect(
      Array.from(namespaceDescriptor.buildSnapshotKeys(namespacePayload, 'cluster-a')).sort()
    ).toEqual([
      'cluster-a::default::alpha.example.com::v1::Widget::shared',
      'cluster-a::default::beta.example.com::v1::Widget::shared',
    ]);
    expect(
      namespaceDescriptor.collection.buildUpdateKey(
        {
          // Envelope clusterId disagrees with ref to prove that ref wins:
          // ref is the authoritative identity now that the legacy
          // top-level identity fields are no longer on the wire.
          clusterId: 'wrong-cluster',
          ref: {
            clusterId: 'cluster-a',
            group: 'beta.example.com',
            version: 'v1',
            kind: 'Widget',
            namespace: 'default',
            name: 'shared',
          },
        },
        'fallback-cluster'
      )
    ).toBe('cluster-a::default::beta.example.com::v1::Widget::shared');

    const clusterDescriptor = getResourceStreamDomainDescriptor('cluster-custom');
    const clusterPayload = {
      clusterId: 'cluster-a',
      resources: [
        {
          clusterId: 'cluster-a',
          apiGroup: 'alpha.example.com',
          apiVersion: 'v1',
          kind: 'ClusterWidget',
          name: 'shared',
        },
        {
          clusterId: 'cluster-a',
          apiGroup: 'beta.example.com',
          apiVersion: 'v1',
          kind: 'ClusterWidget',
          name: 'shared',
        },
      ],
    };
    expect(
      Array.from(clusterDescriptor.buildSnapshotKeys(clusterPayload, 'cluster-a')).sort()
    ).toEqual([
      'cluster-a::alpha.example.com::v1::ClusterWidget::shared',
      'cluster-a::beta.example.com::v1::ClusterWidget::shared',
    ]);
    expect(
      clusterDescriptor.collection.buildUpdateKey(
        {
          clusterId: 'wrong-cluster',
          ref: {
            clusterId: 'cluster-a',
            group: 'beta.example.com',
            version: 'v1',
            kind: 'ClusterWidget',
            name: 'shared',
          },
        },
        'fallback-cluster'
      )
    ).toBe('cluster-a::beta.example.com::v1::ClusterWidget::shared');
  });

  it('exposes domain guards from the descriptor table', () => {
    EXPECTED_DOMAINS.forEach((domain) => {
      expect(isSupportedDomain(domain)).toBe(true);
      expect(isClusterScopedDomain(domain)).toBe(CLUSTER_SCOPED_DOMAINS.has(domain));
    });
    expect(isSupportedDomain('not-a-domain')).toBe(false);
  });

  // Locks the frontend descriptor table to the backend-authored projection
  // contract. The same JSON file (refresh-domain-contract.json) is the
  // source of truth for both: this test ensures scopeKind and
  // preserveMetrics on the frontend match the backend descriptor's
  // ScopeKind and MetricsDependency. Drift here means the frontend would
  // build snapshot keys / preserve-metrics-state for a stream domain in a
  // way the backend wouldn't expect.
  it('matches the backend-authored projection contract', async () => {
    const { refreshDomainContract } = await import('@/core/refresh/domainRegistry');
    const contractDomains = refreshDomainContract.resourceStream.domains;
    expect(Object.keys(contractDomains).sort()).toEqual([...EXPECTED_DOMAINS].sort());

    for (const descriptor of resourceStreamDomainDescriptors) {
      const entry = contractDomains[descriptor.domain];
      expect(entry, `contract missing entry for ${descriptor.domain}`).toBeDefined();
      expect(entry.scopeKind, `${descriptor.domain} scopeKind`).toBe(descriptor.scopeKind);
      expect(entry.metricsDependency, `${descriptor.domain} metricsDependency`).toBe(
        descriptor.preserveMetrics
      );
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
