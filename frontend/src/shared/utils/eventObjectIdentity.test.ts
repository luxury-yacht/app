import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findCatalogObjectByUIDMock } = vi.hoisted(() => ({
  findCatalogObjectByUIDMock: vi.fn(),
}));

vi.mock('@core/backend-api', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
}));

import {
  buildEventObjectReference,
  canResolveEventObjectReference,
  resolveEventObjectReference,
} from './eventObjectIdentity';

beforeEach(() => {
  findCatalogObjectByUIDMock.mockReset();
});

describe('buildEventObjectReference', () => {
  // Only the backend's link identifies the involved object. A group or version
  // is never guessed from the kind, and a wire apiVersion without a link is not
  // enough either (shared resource model: no identity guessing).
  it('never builds a reference from the kind, name, and apiVersion fields alone', () => {
    // A grid row carries these display fields; the resolver must ignore them.
    const row = {
      objectKind: 'Pod',
      objectName: 'api',
      objectNamespace: 'default',
      clusterId: 'cluster-a',
    };

    expect(buildEventObjectReference(row)).toBeUndefined();
    expect(canResolveEventObjectReference(row)).toBe(false);
  });

  it('prefers openable ResourceLink refs over legacy flat event fields', () => {
    expect(
      buildEventObjectReference({
        involvedObject: {
          ref: {
            clusterId: 'cluster-a',
            group: 'apps',
            version: 'v1',
            kind: 'Deployment',
            resource: 'deployments',
            namespace: 'prod',
            name: 'api',
            uid: 'deploy-uid',
          },
        },
        clusterId: 'cluster-a',
      })
    ).toEqual(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'api',
        namespace: 'prod',
        group: 'apps',
        version: 'v1',
        clusterId: 'cluster-a',
        uid: 'deploy-uid',
      })
    );
  });

  // A display-only link is the backend saying it could not identify the object
  // (for example an Event recorded without an apiVersion). It is never opened
  // from a guessed group or version; only the catalog can resolve it, by UID.
  it('opens display-only ResourceLink values only through the catalog by UID', async () => {
    const input = {
      involvedObject: {
        display: {
          clusterId: 'cluster-a',
          group: '',
          version: '',
          kind: 'Database',
          namespace: 'default',
          name: 'primary',
          uid: 'db-uid',
        },
      },
      objectUid: 'db-uid',
      clusterId: 'cluster-a',
    };
    findCatalogObjectByUIDMock.mockResolvedValue({
      ref: {
        kind: 'Database',
        name: 'primary',
        namespace: 'default',
        clusterId: 'cluster-a',
        group: 'db.example.io',
        version: 'v1',
        resource: 'databases',
        uid: 'db-uid',
      },
    });

    expect(buildEventObjectReference(input)).toBeUndefined();
    expect(canResolveEventObjectReference(input)).toBe(true);
    await expect(resolveEventObjectReference(input)).resolves.toEqual(
      expect.objectContaining({ kind: 'Database', group: 'db.example.io', version: 'v1' })
    );
    expect(findCatalogObjectByUIDMock).toHaveBeenCalledWith('cluster-a', 'db-uid');
  });

  it('keeps display-only ResourceLink values unopenable without a UID', () => {
    const input = {
      involvedObject: {
        display: { clusterId: 'cluster-a', group: '', version: '', kind: 'Pod', name: 'gone' },
      },
      clusterId: 'cluster-a',
    };

    expect(buildEventObjectReference(input)).toBeUndefined();
    expect(canResolveEventObjectReference(input)).toBe(false);
  });

  it('fails closed for invalid ResourceLink values instead of falling back to legacy fields', async () => {
    const input = {
      involvedObject: {
        ref: {
          clusterId: 'cluster-a',
          group: 'apps',
          version: '',
          kind: 'Deployment',
          name: 'api',
        },
      },
      objectUid: 'pod-uid',
      clusterId: 'cluster-a',
    };

    await expect(resolveEventObjectReference(input)).resolves.toBeUndefined();
    expect(findCatalogObjectByUIDMock).not.toHaveBeenCalled();
  });
});

describe('resolveEventObjectReference', () => {
  it('reports UID-backed targets as resolvable even when apiVersion is missing', () => {
    expect(
      canResolveEventObjectReference({
        objectUid: 'db-uid',
        clusterId: 'cluster-a',
      })
    ).toBe(true);
  });

  it('falls back to catalog lookup by UID when direct GVK resolution is unavailable', async () => {
    findCatalogObjectByUIDMock.mockResolvedValue({
      ref: {
        kind: 'Database',
        name: 'primary',
        namespace: 'databases',
        clusterId: 'cluster-a',
        group: 'db.example.io',
        version: 'v1',
        resource: 'databases',
        uid: 'db-uid',
      },
    });

    await expect(
      resolveEventObjectReference({
        objectUid: 'db-uid',
        clusterId: 'cluster-a',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'Database',
        name: 'primary',
        namespace: 'databases',
        clusterId: 'cluster-a',
        group: 'db.example.io',
        version: 'v1',
        uid: 'db-uid',
      })
    );

    expect(findCatalogObjectByUIDMock).toHaveBeenCalledWith('cluster-a', 'db-uid');
  });

  it('fails closed when catalog lookup by UID rejects', async () => {
    findCatalogObjectByUIDMock.mockRejectedValue(new Error('catalog unavailable'));

    await expect(
      resolveEventObjectReference({
        objectUid: 'db-uid',
        clusterId: 'cluster-a',
      })
    ).resolves.toBeUndefined();
  });
});
