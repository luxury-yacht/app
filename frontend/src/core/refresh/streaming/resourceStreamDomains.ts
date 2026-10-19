/**
 * frontend/src/core/refresh/streaming/resourceStreamDomains.ts
 *
 * Domain descriptors for resource named streams.
 */

import {
  type RefreshSourceClock,
  type ResourceStreamDomain,
  refreshDomainContract,
} from '../domainRegistry';
import { domainScopeSelectors } from '../scopeSelector';
import type { RefreshDomain } from '../types';

export type ResourceDomain = ResourceStreamDomain;
export type DoorbellDomain = (typeof doorbellDomainDescriptors)[number]['domain'];

export type ResourceStreamDomainDescriptor = {
  domain: RefreshDomain;
  // The doorbell AUGMENTS polling instead of replacing it: a healthy stream
  // must not suppress this domain's polls, because the doorbell's signal
  // source is not guaranteed to ever fire (e.g. metric doorbells ring only
  // on SUCCESSFUL collections — absent metrics-server, never).
  pollingContinuesWhileStreaming?: boolean;
};

export type ResourceStreamSourceClock = RefreshSourceClock;

export const RESOURCE_STREAM_DOMAINS = Object.keys(
  refreshDomainContract.resourceStream.domains
) as ResourceDomain[];

export const resourceStreamDomainDescriptors = RESOURCE_STREAM_DOMAINS.map((domain) => ({
  domain,
}));

const doorbellDomainDescriptors = [
  ...resourceStreamDomainDescriptors,
  {
    domain: 'catalog',
  },
  {
    domain: 'cluster-events',
  },
  {
    domain: 'namespace-events',
  },
  // Signal-only doorbell for the namespaces snapshot domain: namespace object
  // changes and workload-presence flips replace the sidebar's poll.
  {
    domain: 'namespaces',
  },
  // Signal-only metric doorbell for the separate namespace utilization
  // payload. It never advances the namespaces object clock.
  {
    domain: 'namespace-metrics',
  },
  // Signal-only per-object doorbell for the object-events snapshot domain: an
  // event for a panel's object replaces the Events tab's poll. The scope is
  // the snapshot domain's object-scope tail, passed through verbatim.
  {
    domain: 'object-events',
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
    pollingContinuesWhileStreaming: true,
  },
  {
    domain: 'cluster-attention',
  },
  {
    domain: 'cluster-identities',
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

// A domain whose only scope is the whole cluster; its stream scope is empty.
export const isClusterScopedDomain = (domain: DoorbellDomain): boolean => {
  const selectors = domainScopeSelectors(domain);
  return selectors.length === 1 && selectors[0] === 'cluster';
};

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
