import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findCatalogObjectByUIDMock, findCatalogObjectMatchMock } = vi.hoisted(() => ({
  findCatalogObjectByUIDMock: vi.fn(),
  findCatalogObjectMatchMock: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  FindCatalogObjectByUID: (...args: unknown[]) => findCatalogObjectByUIDMock(...args),
  FindCatalogObjectMatch: (...args: unknown[]) => findCatalogObjectMatchMock(...args),
}));

import type { ResourceLink, ResourceRef } from '@core/refresh/types';
import {
  resolveCatalogObjectByUID,
  resolveCatalogObjectMatch,
  resourceLinkToObjectReference,
  validateResourceLink,
} from './resourceLinkIdentity';

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

  it('rejects openable refs that did not carry apiGroup', () => {
    const { group: _group, ...missingGroup } = ref;
    const missingGroupLink = { ref: missingGroup } as unknown as ResourceLink;

    expect(validateResourceLink(missingGroupLink)).toBe(false);
    expect(resourceLinkToObjectReference(missingGroupLink)).toBeUndefined();
  });

  it('rejects custom-resource refs with an empty apiGroup', () => {
    const customWithoutGroup: ResourceRef = {
      ...ref,
      group: '',
      version: 'v1alpha1',
      kind: 'DBInstance',
      resource: 'dbinstances',
      name: 'primary',
    };

    expect(validateResourceLink({ ref: customWithoutGroup })).toBe(false);
    expect(resourceLinkToObjectReference({ ref: customWithoutGroup })).toBeUndefined();
  });

  it('accepts core built-in refs with an explicit empty apiGroup', () => {
    const pod: ResourceRef = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      resource: 'pods',
      namespace: 'prod',
      name: 'api',
    };

    expect(validateResourceLink({ ref: pod })).toBe(true);
    expect(resourceLinkToObjectReference({ ref: pod })).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        group: '',
        version: 'v1',
        kind: 'Pod',
        name: 'api',
      })
    );
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
