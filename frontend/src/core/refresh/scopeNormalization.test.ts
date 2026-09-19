import { describe, expect, it } from 'vitest';

import { normalizeRefreshDomainScope } from './scopeNormalization';

describe('normalizeRefreshDomainScope', () => {
  it.each(['nodes', 'object-yaml'] as const)(
    'keeps explicit cluster identity and query scope for %s',
    (domain) => {
      expect(
        normalizeRefreshDomainScope({
          domain,
          value: ' clusters=Cluster-A|namespace:team-a?limit=25 ',
          selectedClusterId: 'cluster-a',
        })
      ).toBe('Cluster-A|namespace:team-a?limit=25');
      expect(() =>
        normalizeRefreshDomainScope({
          domain,
          value: 'clusters=Cluster-A,cluster-a|namespace:team-a',
        })
      ).toThrow('single cluster');
    }
  );

  it.each(['nodes', 'object-yaml'] as const)(
    'only derives an empty scope from selection when explicitly allowed for %s',
    (domain) => {
      expect(
        normalizeRefreshDomainScope({ domain, value: ' ', selectedClusterId: 'Cluster-A' })
      ).toBeUndefined();
      expect(
        normalizeRefreshDomainScope({
          domain,
          value: null,
          selectedClusterId: 'Cluster-A',
          allowEmpty: true,
        })
      ).toBe('Cluster-A|');
      expect(normalizeRefreshDomainScope({ domain, allowEmpty: true })).toBeUndefined();
    }
  );

  it('retains a literal cluster tail for domains without the resource-stream alias', () => {
    expect(normalizeRefreshDomainScope({ domain: 'object-yaml', value: 'Cluster-A|cluster' })).toBe(
      'Cluster-A|cluster'
    );
  });

  it('canonicalizes cluster resource-stream aliases', () => {
    expect(
      normalizeRefreshDomainScope({
        domain: 'nodes',
        value: 'cluster-a|cluster',
        selectedClusterId: 'cluster-b',
      })
    ).toBe('cluster-a|');
  });

  it('preserves resource-stream query scopes for snapshot-backed table queries', () => {
    expect(
      normalizeRefreshDomainScope({
        domain: 'nodes',
        value: 'cluster-a|?limit=50&sort=name',
        selectedClusterId: 'cluster-b',
      })
    ).toBe('cluster-a|?limit=50&sort=name');
  });
});
