/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.ts
 *
 * Domain descriptors for resource WebSocket streams.
 */

import type { AppEvents } from '@/core/events';
import { refreshDomainContract } from '../domainRegistry';

export type ResourceDomain = AppEvents['refresh:resource-stream-drift']['domain'];

export type ResourceStreamScopeKind = 'pod' | 'namespace' | 'cluster';

export type ResourceStreamDomainDescriptor = {
  domain: ResourceDomain;
  scopeKind: ResourceStreamScopeKind;
  isClusterScoped: boolean;
  preserveMetrics: boolean;
};

const normalizeNamespaceToken = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === '*' || lowered === 'all') {
    return 'all';
  }
  return trimmed;
};

const normalizeNamespaceScope = (scope: string, label: string): string => {
  const value = scope.trim();
  if (!value) {
    throw new Error(`${label} scope is required`);
  }
  if (value.startsWith('namespace:')) {
    const trimmed = value
      .replace(/^namespace:/, '')
      .replace(/^:/, '')
      .trim();
    const token = normalizeNamespaceToken(trimmed);
    if (!token) {
      throw new Error(`${label} scope is required`);
    }
    return `namespace:${token}`;
  }
  const token = normalizeNamespaceToken(value);
  if (!token) {
    throw new Error(`${label} scope is required`);
  }
  return `namespace:${token}`;
};

const normalizePodScope = (scope: string): string => {
  const trimmed = scope.trim();
  if (!trimmed) {
    throw new Error('pods scope is required');
  }
  if (trimmed.startsWith('namespace:')) {
    return normalizeNamespaceScope(trimmed, 'pods');
  }
  if (trimmed.startsWith('node:')) {
    const value = trimmed
      .replace(/^node:/, '')
      .replace(/^:/, '')
      .trim();
    if (!value) {
      throw new Error('pods node scope is required');
    }
    return `node:${value}`;
  }
  if (trimmed.startsWith('workload:')) {
    const value = trimmed
      .replace(/^workload:/, '')
      .replace(/^:/, '')
      .trim();
    const parts = value.split(':').map((part) => part.trim());
    if (parts.length !== 5) {
      throw new Error('pods workload scope requires namespace:group:version:kind:name');
    }
    const [namespace, group, version, kind, name] = parts;
    if (!namespace || !version || !kind || !name) {
      throw new Error('pods workload scope requires namespace:group:version:kind:name');
    }
    return `workload:${namespace}:${group}:${version}:${kind}:${name}`;
  }
  throw new Error(`unsupported pods scope ${scope}`);
};

export const resourceStreamDomainDescriptors = [
  {
    domain: 'pods',
    scopeKind: 'pod',
    isClusterScoped: false,
    preserveMetrics: true,
  },
  {
    domain: 'namespace-workloads',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: true,
  },
  {
    domain: 'namespace-config',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-network',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-rbac',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-custom',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-helm',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-autoscaling',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-quotas',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'namespace-storage',
    scopeKind: 'namespace',
    isClusterScoped: false,
    preserveMetrics: false,
  },
  {
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
  },
  {
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
  },
  {
    domain: 'cluster-config',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
  },
  {
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
  },
  {
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: false,
  },
  {
    domain: 'nodes',
    scopeKind: 'cluster',
    isClusterScoped: true,
    preserveMetrics: true,
  },
] satisfies ResourceStreamDomainDescriptor[];

export const RESOURCE_STREAM_DOMAINS = resourceStreamDomainDescriptors.map(
  (descriptor) => descriptor.domain
);

const resourceStreamDescriptorByDomain = new Map<ResourceDomain, ResourceStreamDomainDescriptor>(
  resourceStreamDomainDescriptors.map((descriptor) => [descriptor.domain, descriptor])
);

export const isSupportedDomain = (value: string | undefined): value is ResourceDomain =>
  Boolean(value && resourceStreamDescriptorByDomain.has(value as ResourceDomain));

export const getResourceStreamDomainDescriptor = (
  domain: ResourceDomain
): ResourceStreamDomainDescriptor => resourceStreamDescriptorByDomain.get(domain)!;

export const isClusterScopedDomain = (domain: ResourceDomain): boolean =>
  getResourceStreamDomainDescriptor(domain).isClusterScoped;

export const COMPLETE_RESYNC_STREAM_DOMAINS = new Set<ResourceDomain>(
  Object.entries(refreshDomainContract.domainInventory)
    .filter(
      ([domain, inventory]) =>
        inventory.behaviorClass === 'complete-resync-stream' && isSupportedDomain(domain)
    )
    .map(([domain]) => domain as ResourceDomain)
);

export const isCompleteResyncStreamDomain = (domain: ResourceDomain): boolean =>
  COMPLETE_RESYNC_STREAM_DOMAINS.has(domain);

export const normalizeResourceScope = (domain: ResourceDomain, scope: string): string => {
  const descriptor = getResourceStreamDomainDescriptor(domain);
  switch (descriptor.scopeKind) {
    case 'pod':
      return normalizePodScope(scope);
    case 'namespace':
      return normalizeNamespaceScope(scope, domain);
    case 'cluster':
      if (!scope || scope.trim() === '' || scope.trim().toLowerCase() === 'cluster') {
        return '';
      }
      throw new Error(`${domain} stream does not accept scope ${scope}`);
    default:
      throw new Error(`unsupported resource stream domain ${domain}`);
  }
};
