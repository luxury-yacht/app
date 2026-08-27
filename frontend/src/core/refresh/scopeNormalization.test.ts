import { describe, expect, it } from 'vitest';

import { normalizeRefreshDomainScope } from './scopeNormalization';

describe('normalizeRefreshDomainScope', () => {
  it('covers normalizeRefreshDomainScope scenarios', async () => {
    // Scenario: canonicalizes cluster resource-stream aliases
    expect(
      normalizeRefreshDomainScope({
        domain: 'nodes',
        value: 'cluster-a|cluster',
        selectedClusterId: 'cluster-b',
      })
    ).toBe('cluster-a|');
    // Scenario: preserves resource-stream query scopes for snapshot-backed table queries
    expect(
      normalizeRefreshDomainScope({
        domain: 'nodes',
        value: 'cluster-a|?limit=50&sort=name',
        selectedClusterId: 'cluster-b',
      })
    ).toBe('cluster-a|?limit=50&sort=name');
  });
});
