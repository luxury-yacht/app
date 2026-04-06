/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind.test.ts
 */

import { describe, expect, it } from 'vitest';

import { getObjectPanelKind } from './getObjectPanelKind';

describe('getObjectPanelKind', () => {
  it('normalises kind casing and builds scopes for standard resources', () => {
    const result = getObjectPanelKind({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
    });

    expect(result.objectKind).toBe('pod');
    expect(result.detailScope).toBe('team-a:pod:api');
    expect(result.helmScope).toBeNull();
    expect(result.isHelmRelease).toBe(false);
    expect(result.isEvent).toBe(false);
  });

  it('falls back to cluster scope when namespace is empty', () => {
    const result = getObjectPanelKind(
      {
        kind: 'HelmRelease',
        name: 'shopping-cart',
        namespace: '',
      },
      { clusterScope: '__cluster__' }
    );

    expect(result.objectKind).toBe('helmrelease');
    expect(result.detailScope).toBe('__cluster__:helmrelease:shopping-cart');
    expect(result.helmScope).toBe('__cluster__:shopping-cart');
    expect(result.isHelmRelease).toBe(true);
  });

  it('marks event resources with event-specific flag', () => {
    const result = getObjectPanelKind({
      kind: 'Event',
      name: 'warning-123',
      namespace: 'default',
    });

    expect(result.isEvent).toBe(true);
    expect(result.detailScope).toBe('default:event:warning-123');
  });

  it('emits the GVK scope form when PanelObjectData carries group and version', () => {
    // Two different DBInstance CRDs share the lowercased kind "dbinstance"
    // but come from different API groups. With the GVK form threaded
    // through, the detailScope carries the full group/version so the
    // backend can disambiguate. See docs/plans/kind-only-objects.md.
    const result = getObjectPanelKind({
      kind: 'DBInstance',
      name: 'my-db',
      namespace: 'default',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
    });

    expect(result.objectKind).toBe('dbinstance');
    expect(result.detailScope).toBe('default:rds.services.k8s.aws/v1alpha1:dbinstance:my-db');
  });

  it('emits the GVK scope form for core resources with an empty group', () => {
    // Core resources (no API group, e.g. Pod) encode the group as an
    // empty string with a leading slash in the GVK form. The backend
    // parser strips this correctly.
    const result = getObjectPanelKind({
      kind: 'Pod',
      name: 'api',
      namespace: 'team-a',
      group: '',
      version: 'v1',
    });

    expect(result.detailScope).toBe('team-a:/v1:pod:api');
  });
});
