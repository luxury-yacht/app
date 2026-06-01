import { describe, expect, it } from 'vitest';
import { catalogSelectionFromBrowseQuery } from './querySelection';

describe('catalog query selection', () => {
  it('maps Browse catalog queries to the shared query-wide descriptor', () => {
    const selection = catalogSelectionFromBrowseQuery({
      clusterId: 'cluster-a',
      namespaces: ['default'],
      kinds: ['apps/v1/Deployment'],
      search: 'api',
      sortField: 'name',
      sortDirection: 'desc',
      scope: 'cluster-a|kind=apps%2Fv1%2FDeployment&namespace=default',
      customOnly: true,
    });

    expect(selection).toMatchObject({
      clusterId: 'cluster-a',
      table: 'browse',
      namespaces: ['default'],
      kinds: ['apps/v1/Deployment'],
      search: 'api',
      sortField: 'name',
      sortDirection: 'desc',
      customOnly: true,
      querySignature: 'cluster-a|kind=apps%2Fv1%2FDeployment&namespace=default',
    });
  });
});
