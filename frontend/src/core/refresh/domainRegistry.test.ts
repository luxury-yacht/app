import { describe, expect, it } from 'vitest';

import {
  CLUSTER_REFRESHERS,
  NAMESPACE_REFRESHERS,
  SYSTEM_REFRESHERS,
  type StaticRefresherName,
} from './refresherTypes';
import {
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  PRIORITY_DOMAINS,
  REFRESHER_TIMING_BY_NAME,
  REFRESH_DOMAIN_DESCRIPTORS,
  getRefreshDomainDescriptor,
  refreshDomainDescriptors,
} from './domainRegistry';

describe('refresh domain registry', () => {
  it('covers every static refresher name with registry timing', () => {
    const staticRefresherNames: StaticRefresherName[] = [
      ...Object.values(SYSTEM_REFRESHERS),
      ...Object.values(CLUSTER_REFRESHERS),
      ...Object.values(NAMESPACE_REFRESHERS),
    ];

    for (const name of staticRefresherNames) {
      expect(REFRESHER_TIMING_BY_NAME[name]).toBeDefined();
    }
  });

  it('derives diagnostics and timing maps from the descriptor table', () => {
    expect(refreshDomainDescriptors).toHaveLength(Object.keys(REFRESH_DOMAIN_DESCRIPTORS).length);

    for (const descriptor of refreshDomainDescriptors) {
      expect(DOMAIN_REFRESHER_MAP[descriptor.domain]).toBe(descriptor.refresherName);
      expect(REFRESHER_TIMING_BY_NAME[descriptor.refresherName]).toBe(descriptor.timing);
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
      'nodes',
      'nodes-metrics',
      'object-maintenance',
      'cluster-overview',
      'catalog',
      'namespace-workloads',
      'namespace-workloads-metrics',
    ]);
  });

  it('exposes object-panel domains through the shared refresher map', () => {
    expect(DOMAIN_REFRESHER_MAP['object-details']).toBe('object-details');
    expect(DOMAIN_REFRESHER_MAP['object-events']).toBe('object-events');
    expect(DOMAIN_REFRESHER_MAP['object-yaml']).toBe('object-yaml');
    expect(DOMAIN_REFRESHER_MAP['object-helm-manifest']).toBe('object-helm-manifest');
    expect(DOMAIN_REFRESHER_MAP['object-helm-values']).toBe('object-helm-values');
  });
});
