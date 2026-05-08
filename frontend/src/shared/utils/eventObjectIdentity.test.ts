import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findCatalogObjectByUIDMock } = vi.hoisted(() => ({
  findCatalogObjectByUIDMock: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
}));

import {
  buildEventObjectReference,
  canResolveEventObjectReference,
  resolveEventObjectReference,
  splitEventObjectTarget,
} from './eventObjectIdentity';

beforeEach(() => {
  findCatalogObjectByUIDMock.mockReset();
});

describe('splitEventObjectTarget', () => {
  it('parses linkable involved-object values', () => {
    expect(splitEventObjectTarget('Pod/api-123')).toEqual({
      objectType: 'Pod',
      objectName: 'api-123',
      isLinkable: true,
    });
  });

  it('marks incomplete involved-object values as non-linkable', () => {
    expect(splitEventObjectTarget('Pod')).toEqual({
      objectType: 'Pod',
      objectName: '-',
      isLinkable: false,
    });
  });
});

describe('buildEventObjectReference', () => {
  it('builds a reference from the event object and apiVersion', () => {
    expect(
      buildEventObjectReference({
        object: 'Widget/sample',
        objectUid: 'widget-uid',
        objectApiVersion: 'widgets.example.io/v1alpha1',
        objectNamespace: 'default',
        clusterId: 'cluster-a',
      })
    ).toEqual({
      kind: 'Widget',
      name: 'sample',
      namespace: 'default',
      group: 'widgets.example.io',
      version: 'v1alpha1',
      clusterId: 'cluster-a',
      clusterName: undefined,
      kindAlias: undefined,
      resource: undefined,
      uid: 'widget-uid',
    });
  });

  it('falls back to the parent object GVK when the event omits apiVersion for the same kind', () => {
    expect(
      buildEventObjectReference({
        object: 'Database/primary',
        objectUid: 'db-uid',
        eventNamespace: 'databases',
        clusterId: 'cluster-a',
        fallbackKind: 'Database',
        fallbackGroup: 'db.example.io',
        fallbackVersion: 'v1',
      })
    ).toEqual({
      kind: 'Database',
      name: 'primary',
      namespace: 'databases',
      group: 'db.example.io',
      version: 'v1',
      clusterId: 'cluster-a',
      clusterName: undefined,
      kindAlias: undefined,
      resource: undefined,
      uid: 'db-uid',
    });
  });

  it('returns undefined when it cannot resolve a version', () => {
    expect(
      buildEventObjectReference({
        object: 'Database/primary',
      })
    ).toBeUndefined();
  });

  it('returns undefined when the event object has no cluster identity', () => {
    expect(
      buildEventObjectReference({
        object: 'Pod/api',
        objectApiVersion: 'v1',
        eventNamespace: 'default',
      })
    ).toBeUndefined();
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
        object: 'Pod/stale',
        objectApiVersion: 'v1',
        objectNamespace: 'default',
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

  it('treats display-only ResourceLink values as non-openable', () => {
    const input = {
      involvedObject: {
        display: {
          clusterId: 'cluster-a',
          group: 'example.io',
          version: 'v1',
          kind: 'DeletedThing',
          name: 'gone',
        },
      },
      object: 'Pod/api',
      objectApiVersion: 'v1',
      objectNamespace: 'default',
      objectUid: 'pod-uid',
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
      object: 'Pod/api',
      objectApiVersion: 'v1',
      objectNamespace: 'default',
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
        object: 'Database/primary',
        objectUid: 'db-uid',
        clusterId: 'cluster-a',
      })
    ).toBe(true);
  });

  it('falls back to catalog lookup by UID when direct GVK resolution is unavailable', async () => {
    findCatalogObjectByUIDMock.mockResolvedValue({
      kind: 'Database',
      name: 'primary',
      namespace: 'databases',
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      group: 'db.example.io',
      version: 'v1',
      resource: 'databases',
      uid: 'db-uid',
    });

    await expect(
      resolveEventObjectReference({
        object: 'Database/primary',
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
        object: 'Database/primary',
        objectUid: 'db-uid',
        clusterId: 'cluster-a',
      })
    ).resolves.toBeUndefined();
  });
});
