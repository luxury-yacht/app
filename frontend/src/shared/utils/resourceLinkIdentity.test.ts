import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findCatalogObjectByUIDMock, findCatalogObjectMatchMock } = vi.hoisted(() => ({
  findCatalogObjectByUIDMock: vi.fn(),
  findCatalogObjectMatchMock: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
  FindCatalogObjectMatch: (...args: unknown[]) => findCatalogObjectMatchMock(...args),
}));

import {
  resolveCatalogObjectByUID,
  resolveCatalogObjectMatch,
  resourceLinkToObjectReference,
  validateResourceLink,
} from './resourceLinkIdentity';
import type { ResourceLink, ResourceRef } from '@core/refresh/types';

beforeEach(() => {
  findCatalogObjectByUIDMock.mockReset();
  findCatalogObjectMatchMock.mockReset();
});

describe('resourceLinkIdentity', () => {
  const ref: ResourceRef = {
    clusterId: 'cluster-a',
    group: 'apps',
    version: 'v1',
    kind: 'Deployment',
    resource: 'deployments',
    namespace: 'prod',
    name: 'api',
    uid: 'deploy-uid',
  };

  it('builds object references only from openable ResourceLink refs', () => {
    const link: ResourceLink = { ref };

    expect(resourceLinkToObjectReference(link, 'alpha')).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        resource: 'deployments',
        namespace: 'prod',
        name: 'api',
        uid: 'deploy-uid',
      })
    );
  });

  it('rejects ambiguous and display-only links as openable refs', () => {
    expect(validateResourceLink({ ref, display: ref })).toBe(false);
    expect(resourceLinkToObjectReference({ ref, display: ref })).toBeUndefined();
    expect(resourceLinkToObjectReference({ display: ref })).toBeUndefined();
  });

  it('resolves catalog objects by UID without guessing GVK from kind', async () => {
    findCatalogObjectByUIDMock.mockResolvedValue({
      ...ref,
      clusterName: 'alpha',
      resourceVersion: '10',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace',
    });

    await expect(resolveCatalogObjectByUID('cluster-a', 'deploy-uid')).resolves.toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'prod',
        name: 'api',
      })
    );
    expect(findCatalogObjectByUIDMock).toHaveBeenCalledWith('cluster-a', 'deploy-uid');
  });

  it('resolves catalog objects by exact identity only when full GVK is present', async () => {
    await expect(resolveCatalogObjectMatch({ ...ref, version: '' })).resolves.toBeUndefined();
    expect(findCatalogObjectMatchMock).not.toHaveBeenCalled();

    findCatalogObjectMatchMock.mockResolvedValue({
      ...ref,
      clusterName: 'alpha',
      resourceVersion: '10',
      creationTimestamp: '2024-01-01T00:00:00Z',
      scope: 'Namespace',
    });

    await expect(resolveCatalogObjectMatch(ref)).resolves.toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: 'apps',
        version: 'v1',
        kind: 'Deployment',
        namespace: 'prod',
        name: 'api',
      })
    );
    expect(findCatalogObjectMatchMock).toHaveBeenCalledWith(
      'cluster-a',
      'prod',
      'apps',
      'v1',
      'Deployment',
      'api'
    );
  });
});
