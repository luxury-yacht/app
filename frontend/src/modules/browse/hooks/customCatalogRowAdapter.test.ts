import { describe, expect, it } from 'vitest';

import { customCatalogObjectReference, customCatalogRowKey } from './customCatalogRowAdapter';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';

const row = (group: string): CatalogBackedCustomResourceRow => ({
  clusterId: 'cluster-a',
  kind: 'DBInstance',
  name: 'primary',
  namespace: 'data',
  group,
  version: 'v1alpha1',
  resource: 'dbinstances',
});

describe('customCatalogRowAdapter', () => {
  it('keeps colliding custom-resource kinds distinct by canonical GVK', () => {
    expect(customCatalogRowKey(row('rds.services.k8s.aws'))).not.toBe(
      customCatalogRowKey(row('documentdb.services.k8s.aws'))
    );
  });

  it('builds object references from canonical custom-resource identity', () => {
    expect(customCatalogObjectReference(row('rds.services.k8s.aws'))).toMatchObject({
      clusterId: 'cluster-a',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      kind: 'DBInstance',
      namespace: 'data',
      name: 'primary',
      resource: 'dbinstances',
    });
  });
});
