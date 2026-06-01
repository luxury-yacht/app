import { describe, expect, it } from 'vitest';
import {
  backendSelectionFromCatalogSelection,
  catalogSelectionFromBrowseQuery,
} from './querySelection';

describe('catalog query selection', () => {
  it('maps Browse catalog queries to the shared query-wide descriptor', () => {
    const selection = catalogSelectionFromBrowseQuery({
      clusterId: 'cluster-a',
      namespaces: ['default'],
      hasUserNamespaceScope: true,
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
      hasUserNamespaceScope: true,
      kinds: ['apps/v1/Deployment'],
      search: 'api',
      sortField: 'name',
      sortDirection: 'desc',
      customOnly: true,
    });
    expect(backendSelectionFromCatalogSelection(selection)).toMatchObject({
      clusterId: 'cluster-a',
      table: 'browse',
      namespaces: ['default'],
      kinds: ['apps/v1/Deployment'],
      search: 'api',
      sortField: 'name',
      sortDirection: 'desc',
      customOnly: true,
    });
  });
});
