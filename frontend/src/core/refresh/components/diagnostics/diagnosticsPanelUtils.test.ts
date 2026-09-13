import { describe, expect, it } from 'vitest';
import type { RefreshDomain } from '../../types';
import { resolveDomainNamespace } from './diagnosticsPanelUtils';

describe('diagnosticsPanelUtils', () => {
  it.each<[RefreshDomain, string | undefined, string]>([
    ['pods', undefined, '-'],
    ['pods', 'cluster-a|', '-'],
    ['namespace-workloads', 'cluster-a|namespace:alpha', 'alpha'],
    ['namespace-workloads', 'cluster-a|alpha', 'alpha'],
    ['pods', 'cluster-a|workload:alpha:Deployment:api', 'alpha'],
    ['pods', 'cluster-a|workload:', '-'],
    ['pods', 'cluster-a|namespace:alpha', 'alpha'],
    ['pods', 'cluster-a|namespace:all', 'All'],
    ['pods', 'cluster-a|namespace:', '-'],
    ['pods', 'cluster-a|node:worker-a', '-'],
    ['object-maintenance', 'cluster-a|node:worker-a', 'worker-a'],
    ['object-maintenance', 'cluster-a|node:', '-'],
    ['object-maintenance', 'cluster-a|custom-scope', 'custom-scope'],
    ['cluster-events', 'cluster-a|namespace:alpha', '-'],
  ])('resolves %s scope %s as %s', (domain, scope, expected) => {
    expect(resolveDomainNamespace(domain, scope)).toBe(expected);
  });
});
