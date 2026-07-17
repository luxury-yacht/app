/**
 * frontend/src/shared/events/eventGridModel.test.ts
 *
 * Verifies shared Event grid row semantics so cluster, namespace, and object
 * panel Event surfaces keep search, keys, and related-object references aligned.
 */

import { describe, expect, it } from 'vitest';
import {
  clusterEventRowIdentity,
  eventGridActionReference,
  eventGridCanOpenRelatedObject,
  eventGridObjectNamespace,
  eventGridObjectReference,
  eventGridRelatedObjectInput,
  eventGridSearchText,
  eventGridStableKey,
  namespaceEventRowIdentity,
  objectPanelEventGridRow,
} from './eventGridModel';

describe('eventGridModel', () => {
  it('builds search text from the visible event fields', () => {
    expect(
      eventGridSearchText({
        kind: 'Event',
        namespace: 'prod',
        type: 'Warning',
        source: 'kubelet',
        reason: 'FailedMount',
        object: 'Pod/api',
        message: 'Unable to attach volume',
      })
    ).toEqual([
      'Event',
      'prod',
      'Warning',
      'kubelet',
      'FailedMount',
      'Pod/api',
      'Unable to attach volume',
    ]);
  });

  it('uses object namespace before event namespace before the default namespace', () => {
    expect(eventGridObjectNamespace({ objectNamespace: 'object-ns', namespace: 'event-ns' })).toBe(
      'object-ns'
    );
    expect(eventGridObjectNamespace({ namespace: 'event-ns' }, 'default')).toBe('event-ns');
    expect(eventGridObjectNamespace({}, 'default')).toBe('default');
  });

  it('builds cluster-scoped stable row keys', () => {
    expect(
      eventGridStableKey(
        {
          clusterId: 'cluster-a',
          namespace: 'prod',
          reason: 'FailedMount',
          source: 'kubelet',
          object: 'Pod/api',
          ageTimestamp: 1000,
        },
        2
      )
    ).toBe('cluster-a|prod-FailedMount-kubelet-Pod/api-1000-2');
  });

  it('builds required Event row identities for cluster and namespace views', () => {
    expect(
      clusterEventRowIdentity(
        {
          name: 'api.123',
          namespace: 'prod',
          clusterId: 'cluster-a',
        },
        'unused'
      )
    ).toBe('cluster-a|/v1/Event/prod/api.123');

    expect(
      namespaceEventRowIdentity(
        {
          name: 'api.123',
          objectNamespace: 'prod',
          clusterId: 'cluster-a',
        },
        'default',
        'unused'
      )
    ).toBe('cluster-a|/v1/Event/prod/api.123');
  });

  it('carries cluster identity and fallback GVK into related-object inputs', () => {
    expect(
      eventGridRelatedObjectInput(
        {
          object: 'Database/primary',
          objectUid: 'db-uid',
          namespace: 'events',
          objectNamespace: 'databases',
          clusterId: 'cluster-a',
          clusterName: 'alpha',
        },
        {
          fallbackKind: 'Database',
          fallbackGroup: 'db.example.io',
          fallbackVersion: 'v1',
        }
      )
    ).toEqual({
      object: 'Database/primary',
      involvedObject: undefined,
      objectUid: 'db-uid',
      objectApiVersion: undefined,
      objectNamespace: 'databases',
      eventNamespace: 'events',
      defaultNamespace: undefined,
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      fallbackKind: 'Database',
      fallbackGroup: 'db.example.io',
      fallbackVersion: 'v1',
    });
  });

  it('reports direct GVK-backed related objects as openable', () => {
    expect(
      eventGridCanOpenRelatedObject({
        object: 'Pod/api',
        objectApiVersion: 'v1',
        objectNamespace: 'prod',
        clusterId: 'cluster-a',
      })
    ).toBe(true);
  });

  it('normalizes object-panel event rows for the shared resolver', () => {
    expect(
      objectPanelEventGridRow(
        {
          objectKind: 'Pod',
          objectName: 'api',
          objectNamespace: '__cluster__',
          objectApiVersion: 'v1',
          clusterId: 'cluster-a',
        },
        '__cluster__'
      )
    ).toEqual({
      object: 'Pod/api',
      involvedObject: undefined,
      objectUid: undefined,
      objectApiVersion: 'v1',
      objectNamespace: undefined,
      clusterId: 'cluster-a',
      clusterName: undefined,
    });
  });

  it('builds object action references with Event identity and involved-object extras', () => {
    expect(
      eventGridActionReference(
        {
          name: 'api.123',
          uid: 'event-uid',
          namespace: 'prod',
          clusterId: 'cluster-a',
          clusterName: 'alpha',
        },
        'unused',
        { involvedObject: 'Pod/api' }
      )
    ).toEqual(
      expect.objectContaining({
        kind: 'Event',
        name: 'api.123',
        namespace: 'prod',
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        resource: 'events',
        uid: 'event-uid',
        involvedObject: 'Pod/api',
      })
    );
  });

  it('builds the Event object-panel reference from the Event itself', () => {
    expect(
      eventGridObjectReference(
        {
          name: 'api.123',
          uid: 'event-uid',
          namespace: 'prod',
          clusterId: 'cluster-a',
          clusterName: 'alpha',
        },
        'unused'
      )
    ).toEqual(
      expect.objectContaining({
        clusterId: 'cluster-a',
        clusterName: 'alpha',
        group: '',
        version: 'v1',
        kind: 'Event',
        resource: 'events',
        namespace: 'prod',
        name: 'api.123',
        uid: 'event-uid',
      })
    );
  });
});
