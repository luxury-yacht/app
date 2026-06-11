import { describe, expect, it } from 'vitest';

import {
  catalogItemToFallbackCustomRow,
  customCatalogObjectReference,
  customCatalogRowKey,
} from './customCatalogRowAdapter';
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

  it('formats fallback catalog timestamps as Age values', () => {
    const fallback = catalogItemToFallbackCustomRow({
      clusterId: 'cluster-a',
      kind: 'DBInstance',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      resource: 'dbinstances',
      name: 'primary',
      uid: 'primary-uid',
      resourceVersion: '1',
      creationTimestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      scope: 'Cluster',
    });

    expect(fallback.age).toBe('3h');
    expect(fallback.age).not.toContain('T');
    expect(fallback.ageTimestamp).toEqual(expect.any(Number));
  });
});
