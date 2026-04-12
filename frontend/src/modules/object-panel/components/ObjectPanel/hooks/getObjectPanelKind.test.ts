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
    // backend can disambiguate.
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

  it('builds eventsScope from the original-case kind so a single source of truth feeds both consumers', () => {
    // The events refresh-domain producer expects the kind in its
    // original case (matches how the backend events fetcher keys its
    // dispatch). detailScope uses the lowercased form. ObjectPanelContent
    // and EventsTab both consume eventsScope and MUST agree on the same
    // string — keep the computation in one place.
    const result = getObjectPanelKind({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
    });

    // detailScope is lowercase; eventsScope keeps the original case.
    expect(result.detailScope).toBe('cluster-1|team-a:deployment:api');
    expect(result.eventsScope).toBe('cluster-1|team-a:Deployment:api');
  });

  it('threads group/version into eventsScope when PanelObjectData carries them', () => {
    const result = getObjectPanelKind({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'documentdb.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });

    expect(result.eventsScope).toBe(
      'cluster-1|team-a:documentdb.services.k8s.aws/v1alpha1:DBInstance:orders'
    );
  });

  it('returns null eventsScope when objectData is incomplete', () => {
    expect(getObjectPanelKind(null).eventsScope).toBeNull();
    expect(getObjectPanelKind({ kind: 'Pod' }).eventsScope).toBeNull();
    expect(getObjectPanelKind({ name: 'api' }).eventsScope).toBeNull();
  });

  it('builds logScope using the lowercased kind so ObjectPanelContent and LogViewer agree', () => {
    // logScope is consumed by ObjectPanelContent (full-cleanup lifecycle
    // when the panel closes) AND by LogViewer (the actual streaming
    // start/stop). The two consumers used to compute their own scope
    // strings independently — same drift bug as eventsScope. The log
    // domain producer expects the lowercased kind (matches LogViewer's
    // historical convention), distinct from eventsScope's original case.
    const result = getObjectPanelKind({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      clusterId: 'cluster-1',
    });

    expect(result.logScope).toBe('cluster-1|team-a:deployment:api');
  });

  it('threads group/version into logScope when PanelObjectData carries them', () => {
    const result = getObjectPanelKind({
      kind: 'Deployment',
      name: 'api',
      namespace: 'team-a',
      group: 'apps',
      version: 'v1',
      clusterId: 'cluster-1',
    });

    expect(result.logScope).toBe('cluster-1|team-a:apps/v1:deployment:api');
  });

  it('keeps colliding kinds distinct in logScope by threading group/version', () => {
    const first = getObjectPanelKind({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });
    const second = getObjectPanelKind({
      kind: 'DBInstance',
      name: 'orders',
      namespace: 'team-a',
      group: 'documentdb.services.k8s.aws',
      version: 'v1alpha1',
      clusterId: 'cluster-1',
    });

    expect(first.logScope).toBe('cluster-1|team-a:rds.services.k8s.aws/v1alpha1:dbinstance:orders');
    expect(second.logScope).toBe(
      'cluster-1|team-a:documentdb.services.k8s.aws/v1alpha1:dbinstance:orders'
    );
    expect(first.logScope).not.toBe(second.logScope);
  });

  it('returns null logScope when objectData is incomplete', () => {
    expect(getObjectPanelKind(null).logScope).toBeNull();
    expect(getObjectPanelKind({ kind: 'Pod' }).logScope).toBeNull();
    expect(getObjectPanelKind({ name: 'api' }).logScope).toBeNull();
  });
});
