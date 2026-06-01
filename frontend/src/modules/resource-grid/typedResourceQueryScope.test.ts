import { describe, expect, it } from 'vitest';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import {
  buildTypedResourceQueryScope,
  typedResourceQueryIdentity,
} from './typedResourceQueryScope';

describe('typedResourceQueryScope', () => {
  it('builds a stable all-namespaces resource query scope', () => {
    const scope = buildTypedResourceQueryScope('cluster-a', {
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        search: 'api',
        kinds: ['Pod', 'Deployment'],
        namespaces: ['zeta', 'apps'],
      },
      sortConfig: { key: 'cpu', direction: 'desc' },
      pageLimit: 250,
      predicates: { health: 'unhealthy' },
      continueToken: 'cursor-1',
    });

    expect(scope).toBe(
      'cluster-a|namespace:all?limit=250&search=api&namespaces=apps%2Czeta&kinds=Deployment%2CPod&sort=cpu&sortDirection=desc&predicate.health=unhealthy&continue=cursor-1'
    );
  });

  it('builds the same query identity for equivalent unordered filters', () => {
    const left = typedResourceQueryIdentity({
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: ['Pod', 'Deployment'],
        namespaces: ['zeta', 'apps'],
      },
      sortConfig: { key: 'name', direction: 'asc' },
      predicates: { health: 'unhealthy', phase: 'pending' },
    });
    const right = typedResourceQueryIdentity({
      filters: {
        ...DEFAULT_GRID_TABLE_FILTER_STATE,
        kinds: ['Deployment', 'Pod'],
        namespaces: ['apps', 'zeta'],
      },
      sortConfig: { key: 'name', direction: 'asc' },
      predicates: { phase: 'pending', health: 'unhealthy' },
    });

    expect(left).toBe(right);
  });
});
