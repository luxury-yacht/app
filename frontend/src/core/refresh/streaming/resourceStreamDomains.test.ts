/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.test.ts
 *
 * Tests for resource stream domain descriptors.
 */

import { describe, expect, it } from 'vitest';

import {
  RESOURCE_STREAM_DOMAINS,
  getResourceStreamDomainDescriptor,
  isClusterScopedDomain,
  isSupportedDomain,
  normalizeResourceScope,
  resourceStreamDomainDescriptors,
  type ResourceDomain,
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
    resources: [{ clusterId: 'cluster-a', namespace: 'default', kind: 'Widget', name: 'widget-a' }],
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
    resources: [{ clusterId: 'cluster-a', kind: 'ClusterWidget', name: 'widget-a' }],
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
  'namespace-custom': ['cluster-a::default::Widget::widget-a'],
  'namespace-helm': ['cluster-a::default::release-a'],
  'namespace-autoscaling': ['cluster-a::default::HorizontalPodAutoscaler::hpa-a'],
  'namespace-quotas': ['cluster-a::default::ResourceQuota::quota-a'],
  'namespace-storage': ['cluster-a::default::PersistentVolumeClaim::claim-a'],
  'cluster-rbac': ['cluster-a::ClusterRole::role-a'],
  'cluster-storage': ['cluster-a::pv-a'],
  'cluster-config': ['cluster-a::StorageClass::standard'],
  'cluster-crds': ['cluster-a::widgets.example.com'],
  'cluster-custom': ['cluster-a::ClusterWidget::widget-a'],
  nodes: ['cluster-a::node-a'],
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

  it('normalizes scopes through descriptor scope kinds', () => {
    expect(normalizeResourceScope('pods', 'namespace:*')).toBe('namespace:all');
    expect(normalizeResourceScope('pods', 'node:node-a')).toBe('node:node-a');
    expect(normalizeResourceScope('pods', 'workload:default:Deployment:web')).toBe(
      'workload:default:Deployment:web'
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

      const [row] = rows;
      const clusterId = (row as { clusterId?: string }).clusterId;
      expect(descriptor.collection.buildUpdateKey({ clusterId, row }, 'fallback-cluster')).toBe(
        expectedSnapshotKeys[domain][0]
      );

      const sortedRows = [...rows];
      descriptor.sortRows(sortedRows);
      descriptor.collection.sortRows(sortedRows);

      const emptyPayload = descriptor.collection.emptyPayload('empty-cluster');
      expect(descriptor.buildSnapshotKeys(emptyPayload, 'empty-cluster')).toEqual(new Set());
    });
  });

  it('exposes domain guards from the descriptor table', () => {
    EXPECTED_DOMAINS.forEach((domain) => {
      expect(isSupportedDomain(domain)).toBe(true);
      expect(isClusterScopedDomain(domain)).toBe(CLUSTER_SCOPED_DOMAINS.has(domain));
    });
    expect(isSupportedDomain('not-a-domain')).toBe(false);
  });
});
