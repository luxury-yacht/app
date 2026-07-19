/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.ts
 *
 * Domain descriptors for resource WebSocket streams.
 */

import type { AppEvents } from '@/core/events';
import { type RefreshSourceClock, refreshDomainContract } from '../domainRegistry';

export type ResourceDomain = AppEvents['refresh:resource-stream-drift']['domain'];
export type DoorbellDomain = AppEvents['refresh:resource-stream-health']['domain'];

export type ResourceStreamScopeKind = 'pod' | 'namespace' | 'cluster' | 'object';

export type ResourceStreamDomainDescriptor = {
  domain: DoorbellDomain;
  scopeKind: ResourceStreamScopeKind;
  isClusterScoped: boolean;
  // The doorbell AUGMENTS polling instead of replacing it: a healthy stream
  // must not suppress this domain's polls, because the doorbell's signal
  // source is not guaranteed to ever fire (e.g. metric doorbells ring only
  // on SUCCESSFUL collections — absent metrics-server, never).
  pollingContinuesWhileStreaming?: boolean;
};

export type ResourceStreamSourceClock = RefreshSourceClock;

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
    if (!namespace || !group || !version || !kind || !name) {
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
  },
  {
    domain: 'namespace-workloads',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-config',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-network',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-rbac',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-custom',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-helm',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-autoscaling',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-quotas',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'namespace-storage',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  {
    domain: 'cluster-rbac',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'cluster-storage',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'cluster-config',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'cluster-crds',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'cluster-custom',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'nodes',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
] satisfies ResourceStreamDomainDescriptor[];

export const RESOURCE_STREAM_DOMAINS = resourceStreamDomainDescriptors.map(
  (descriptor) => descriptor.domain
) as ResourceDomain[];

const doorbellDomainDescriptors = [
  ...resourceStreamDomainDescriptors,
  {
    domain: 'catalog',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'cluster-events',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  {
    domain: 'namespace-events',
    scopeKind: 'namespace',
    isClusterScoped: false,
  },
  // Signal-only doorbell for the namespaces snapshot domain: namespace object
  // changes and workload-presence flips replace the sidebar's poll.
  {
    domain: 'namespaces',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  // Signal-only metric doorbell for the separate namespace utilization
  // payload. It never advances the namespaces object clock.
  {
    domain: 'namespace-metrics',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
  // Signal-only per-object doorbell for the object-events snapshot domain: an
  // event for a panel's object replaces the Events tab's poll. The scope is
  // the snapshot domain's object-scope tail, passed through verbatim.
  {
    domain: 'object-events',
    scopeKind: 'object',
    isClusterScoped: false,
  },
  // Signal-only metric doorbell for the cluster-overview snapshot domain: a
  // successful metrics collection refetches the overview so live usage
  // appears within one collection instead of a full poll cycle. POLLS STAY
  // ON for this domain (pollingContinuesWhileStreaming): the metric doorbell
  // only rings on successful collections, so a metrics-less cluster would
  // otherwise freeze the overview's object-derived counts behind the
  // skip-while-stream-healthy gate.
  {
    domain: 'cluster-overview',
    scopeKind: 'cluster',
    isClusterScoped: true,
    pollingContinuesWhileStreaming: true,
  },
  {
    domain: 'cluster-attention',
    scopeKind: 'cluster',
    isClusterScoped: true,
  },
] satisfies ResourceStreamDomainDescriptor[];

export const DOORBELL_STREAM_DOMAINS = doorbellDomainDescriptors.map(
  (descriptor) => descriptor.domain
);

const doorbellDescriptorByDomain = new Map<DoorbellDomain, ResourceStreamDomainDescriptor>(
  doorbellDomainDescriptors.map((descriptor) => [descriptor.domain, descriptor])
);

const sourceClocksByDomain = new Map<DoorbellDomain, readonly ResourceStreamSourceClock[]>(
  refreshDomainContract.domains
    .filter((entry) => doorbellDescriptorByDomain.has(entry.domain as DoorbellDomain))
    .map((entry) => [entry.domain as DoorbellDomain, entry.sourceClocks ?? []])
);

// Domains whose doorbell AUGMENTS polling instead of replacing it (see the
// descriptor flag). Consulted by the orchestrator's stream-health gate.
export const doorbellPollingContinues = (domain: string): boolean =>
  doorbellDescriptorByDomain.get(domain as DoorbellDomain)?.pollingContinuesWhileStreaming === true;

export const isSupportedDomain = (value: string | undefined): value is DoorbellDomain =>
  Boolean(value && doorbellDescriptorByDomain.has(value as DoorbellDomain));

export const isResourceStreamSourceClock = (value: unknown): value is ResourceStreamSourceClock =>
  value === 'object' ||
  value === 'metric' ||
  value === 'event' ||
  value === 'catalog' ||
  value === 'attention';

// The doorbell clocks a domain declares in the contract. Signal-driven refetch
// hooks key on THESE clock values (never the folded sourceVersion): payload
// applies rewrite sourceVersion/other clocks on every build, and keying on
// those turns each fetch response into another "signal" — a fetch loop.
export const doorbellSourceClocks = (domain: string): readonly ResourceStreamSourceClock[] =>
  sourceClocksByDomain.get(domain as DoorbellDomain) ?? [];

export const domainSupportsSourceClock = (
  domain: DoorbellDomain,
  source: ResourceStreamSourceClock
): boolean => sourceClocksByDomain.get(domain)?.includes(source) ?? false;

const getResourceStreamDomainDescriptor = (
  domain: DoorbellDomain
): ResourceStreamDomainDescriptor => {
  const descriptor = doorbellDescriptorByDomain.get(domain);
  if (!descriptor) {
    throw new Error(`Missing resource stream descriptor for domain "${domain}".`);
  }
  return descriptor;
};

export const isClusterScopedDomain = (domain: DoorbellDomain): boolean =>
  getResourceStreamDomainDescriptor(domain).isClusterScoped;

export const COMPLETE_RESYNC_STREAM_DOMAINS = new Set<ResourceDomain>(
  Object.entries(refreshDomainContract.domainInventory)
    .filter(
      ([domain, inventory]) =>
        inventory.behaviorClass === 'complete-resync-stream' && isSupportedDomain(domain)
    )
    .map(([domain]) => domain as ResourceDomain)
);

export const isCompleteResyncStreamDomain = (domain: DoorbellDomain): boolean =>
  COMPLETE_RESYNC_STREAM_DOMAINS.has(domain as ResourceDomain);

export const normalizeResourceScope = (domain: DoorbellDomain, scope: string): string => {
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
    case 'object': {
      // The object-scope tail (namespace:group/version:kind:name) is the wire
      // format; the backend selector validates it via its single decoder.
      const trimmed = scope.trim();
      if (!trimmed) {
        throw new Error(`${domain} scope is required`);
      }
      return trimmed;
    }
    default:
      throw new Error(`unsupported resource stream domain ${domain}`);
  }
};
