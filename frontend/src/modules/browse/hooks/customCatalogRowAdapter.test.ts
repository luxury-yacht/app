import { describe, expect, it } from 'vitest';
import type { CatalogBackedCustomResourceRow } from './customCatalogRowAdapter';
import {
  catalogItemToFallbackCustomRow,
  customCatalogObjectReference,
  customCatalogRowKey,
  normalizeHydratedCustomRow,
} from './customCatalogRowAdapter';

const row = (group: string): CatalogBackedCustomResourceRow => ({
  clusterId: 'cluster-a',
  clusterName: 'Cluster A',
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
      clusterName: 'Cluster A',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      kind: 'DBInstance',
      namespace: 'data',
      name: 'primary',
      resource: 'dbinstances',
    });
  });

  it('preserves fallback catalog creation time for live Age rendering', () => {
    const creationTimestamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const fallback = catalogItemToFallbackCustomRow({
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
      kind: 'DBInstance',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      resource: 'dbinstances',
      name: 'primary',
      uid: 'primary-uid',
      resourceVersion: '1',
      creationTimestamp,
      scope: 'Cluster',
    });

    expect(fallback.age).toBeUndefined();
    expect(fallback.ageTimestamp).toEqual(expect.any(Number));
    expect(fallback.creationTimestamp).toBe(creationTimestamp);
    expect(customCatalogObjectReference(fallback)).toMatchObject({
      ageTimestamp: fallback.ageTimestamp,
      creationTimestamp,
    });
  });

  it('uses group/version row fields without api-prefixed aliases', () => {
    const fallback = catalogItemToFallbackCustomRow({
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
      kind: 'DBInstance',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      resource: 'dbinstances',
      name: 'primary',
      uid: 'primary-uid',
      resourceVersion: '1',
      creationTimestamp: '2026-06-28T00:00:00Z',
      scope: 'Cluster',
    });

    expect(fallback.group).toBe('rds.services.k8s.aws');
    expect(fallback.version).toBe('v1alpha1');
    expect(fallback).not.toHaveProperty('apiGroup');
    expect(fallback).not.toHaveProperty('apiVersion');
  });

  it('normalizes hydrated rows from group/version fields without api-prefixed aliases', () => {
    const normalized = normalizeHydratedCustomRow({
      kind: 'DBInstance',
      name: 'primary',
      namespace: 'data',
      clusterId: 'cluster-a',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      resource: 'dbinstances',
    });

    expect(normalized.group).toBe('rds.services.k8s.aws');
    expect(normalized.version).toBe('v1alpha1');
    expect(normalized).not.toHaveProperty('apiGroup');
    expect(normalized).not.toHaveProperty('apiVersion');
  });

  it.each(['clusterId', 'group', 'version', 'kind', 'name'])(
    'rejects hydrated rows missing required identity field %s',
    (field) => {
      const hydrated: Record<string, unknown> = {
        clusterId: 'cluster-a',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
        kind: 'DBInstance',
        name: 'primary',
      };
      delete hydrated[field];

      expect(() => normalizeHydratedCustomRow(hydrated)).toThrow(
        `Hydrated catalog row is missing string field "${field}".`
      );
    }
  );
});
