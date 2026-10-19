import { describe, expect, it } from 'vitest';

import { normalizeRefreshDomainScope } from './scopeNormalization';

describe('normalizeRefreshDomainScope', () => {
  it('returns a canonical scope for the domain unchanged apart from whitespace', () => {
    expect(
      normalizeRefreshDomainScope('namespace-config', ' cluster-a|namespace:team-a?limit=25 ')
    ).toBe('cluster-a|namespace:team-a?limit=25');
    expect(normalizeRefreshDomainScope('nodes', 'cluster-a|')).toBe('cluster-a|');
  });

  it('treats a missing scope as absent', () => {
    expect(normalizeRefreshDomainScope('nodes', ' ')).toBeUndefined();
    expect(normalizeRefreshDomainScope('nodes', null)).toBeUndefined();
  });

  it.each([
    ['unprefixed scope', 'namespace-config', 'namespace:team-a'],
    ['retired cluster alias', 'nodes', 'cluster-a|cluster'],
    ['retired namespace wildcard', 'pods', 'cluster-a|namespace:*'],
    ['selector outside the domain grammar', 'namespace-config', 'cluster-a|node:worker-1'],
  ] as const)('rejects a %s', (_label, domain, value) => {
    expect(() => normalizeRefreshDomainScope(domain, value)).toThrow();
  });
});
